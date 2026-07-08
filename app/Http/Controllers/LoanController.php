<?php

namespace App\Http\Controllers;

use App\Models\AgentLog;
use App\Models\CustomerProfile;
use App\Models\LoanApplication;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;

class LoanController extends Controller
{
    public function data(Request $request): JsonResponse
    {
        $user = $request->user();
        $role = $user->role;

        if ($role === 'admin') {
            $customers = User::where('role', 'customer')->get()->map(fn ($c) => $this->formatCustomer($c));
            $applications = LoanApplication::with(['customer', 'assignedAgent'])->latest()->get()->map(fn ($a) => $this->formatApp($a));
            $agents = User::where('role', 'agent')->get()->map(fn ($a) => $this->formatAgent($a));
            $agentLogs = AgentLog::latest()->get()->map(fn ($l) => $this->formatLog($l));
        } elseif ($role === 'agent') {
            $customers = User::where('role', 'customer')->get()->map(fn ($c) => $this->formatCustomer($c));
            $applications = LoanApplication::with(['customer', 'assignedAgent'])->latest()->get()->map(fn ($a) => $this->formatApp($a));
            $agents = collect([$this->formatAgent($user)]);
            $agentLogs = AgentLog::where('agent_id', $user->id)->latest()->get()->map(fn ($l) => $this->formatLog($l));
        } else {
            $customers = collect([$this->formatCustomer($user)]);
            $applications = LoanApplication::where('customer_id', $user->id)->with(['customer', 'assignedAgent'])->latest()->get()->map(fn ($a) => $this->formatApp($a));
            $agents = collect();
            $loanIds = LoanApplication::where('customer_id', $user->id)->pluck('id');
            $agentLogs = AgentLog::whereIn('loan_application_id', $loanIds)->latest()->get()->map(fn ($l) => $this->formatLog($l));
        }

        return response()->json([
            'customers' => $customers->values(),
            'applications' => $applications->values(),
            'agents' => $agents->values(),
            'agentLogs' => $agentLogs->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'loan_type' => ['required', 'string', 'in:Personal,Business'],
            'amount' => ['required', 'integer', 'min:1000', 'max:20000'],
            'tenure_days' => ['required', 'integer', 'in:33,66'],
            'purpose' => ['required', 'string'],
            'city' => ['required', 'string'],
            'address' => ['required', 'string'],
            'monthly_income' => ['required', 'integer'],
            'co_borrower' => ['required', 'array'],
            'co_borrower.name' => ['required', 'string'],
            'co_borrower.phone' => ['required', 'string'],
            'co_borrower.relation' => ['required', 'string'],
            'co_borrower.address' => ['required', 'string'],
            'documents' => ['nullable', 'array'],
            'customer_phone' => ['nullable', 'string', 'size:10'],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'aadhaar' => ['nullable', 'string', 'size:12'],
            'pan' => ['nullable', 'string', 'size:10'],
        ]);

        $user = $request->user();
        $customerId = $user->id;
        $agentId = null;

        if ($user->role === 'agent' && $request->filled('customer_phone')) {
            $customer = User::where('phone', $request->customer_phone)->where('role', 'customer')->first();
            if (! $customer) {
                $customer = User::create([
                    'name' => $request->customer_name ?? 'Customer',
                    'phone' => $request->customer_phone,
                    'password' => 'laxmi' . $request->customer_phone,
                    'role' => 'customer',
                    'customer_token' => 'LFN-TMP-' . date('Y') . '-' . str_pad(User::count() + 1, 6, '0', STR_PAD_LEFT),
                ]);
            }
            $customerId = $customer->id;
            $agentId = $user->id;
        }

        $amount = $request->amount;
        $tenure = $request->tenure_days;
        $dailyEMI = ($tenure == 33) ? round($amount * 0.04) : round($amount * 0.02);
        $totalPayable = $dailyEMI * $tenure;

        $appNumber = 'LFN-TMP-' . date('Y') . '-' . str_pad(LoanApplication::count() + 1, 6, '0', STR_PAD_LEFT);

        $loan = LoanApplication::create([
            'customer_id' => $customerId,
            'application_number' => $appNumber,
            'loan_type' => $request->loan_type,
            'amount' => $amount,
            'tenure_days' => $tenure,
            'daily_emi' => $dailyEMI,
            'total_payable' => $totalPayable,
            'status' => 'pending',
            'purpose' => $request->purpose,
            'city' => $request->city,
            'address' => $request->address,
            'monthly_income' => $request->monthly_income,
            'co_borrower' => $request->co_borrower,
            'documents' => $request->documents ?? [],
            'assigned_agent_id' => $agentId,
            'aadhaar' => $request->aadhaar,
            'pan' => $request->pan,
        ]);

        $customerUser = User::find($customerId);
        $customerName = $customerUser ? $customerUser->name : 'Customer';

        CustomerProfile::updateOrCreate(
            ['user_id' => $customerId],
            [
                'aadhaar_name' => $customerName,
                'city' => $request->city,
                'address' => $request->address,
                'monthly_income' => $request->monthly_income,
                'aadhaar' => $request->aadhaar,
                'pan' => $request->pan,
            ]
        );

        return response()->json([
            'loan' => $this->formatApp($loan->load(['customer', 'assignedAgent'])),
        ], 201);
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'status' => ['required', 'in:approved,rejected,cancelled'],
        ]);

        $user = $request->user();
        if ($user->role !== 'admin') {
            return response()->json(['message' => 'Only admin can approve or reject loans'], 403);
        }

        $loan = LoanApplication::where('application_number', $id)->firstOrFail();

        if ($request->status === 'cancelled' && $loan->status !== 'approved') {
            return response()->json(['message' => 'Only approved loans can be cancelled'], 422);
        }

        if ($request->status === 'approved' && $loan->status !== 'pending') {
            return response()->json(['message' => 'Only pending loans can be approved'], 422);
        }

        if ($request->status === 'rejected' && $loan->status !== 'pending') {
            return response()->json(['message' => 'Only pending loans can be rejected'], 422);
        }

        $loan->update(['status' => $request->status]);

        $customerToken = null;
        if ($request->status === 'approved') {
            $customer = $loan->customer;
            if ($customer && str_starts_with($customer->customer_token ?? '', 'LFN-TMP-')) {
                $customerToken = str_replace('LFN-TMP-', 'LFN-', $customer->customer_token);
                $customer->update(['customer_token' => $customerToken]);
            }
        }

        return response()->json([
            'loan' => $this->formatApp($loan->fresh()->load(['customer', 'assignedAgent'])),
            'customer_token' => $customerToken,
        ]);
    }

    public function assignAgent(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($user->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $request->validate([
            'agent_name' => ['required', 'string'],
        ]);

        $loan = LoanApplication::where('application_number', $id)->firstOrFail();
        $agent = User::where('role', 'agent')->where('name', $request->agent_name)->first();

        if (! $agent) {
            return response()->json(['message' => 'Agent not found'], 422);
        }

        $loan->update(['assigned_agent_id' => $agent->id]);

        return response()->json([
            'loan' => $this->formatApp($loan->fresh()->load(['customer', 'assignedAgent'])),
        ]);
    }

    public function logActivity(Request $request): JsonResponse
    {
        $request->validate([
            'application_number' => ['required', 'string'],
            'action' => ['required', 'in:visited,collected'],
        ]);

        $user = $request->user();
        $loan = LoanApplication::where('application_number', $request->application_number)->firstOrFail();

        AgentLog::create([
            'agent_id' => $user->id,
            'loan_application_id' => $loan->id,
            'application_number' => $request->application_number,
            'action' => $request->action,
        ]);

        return response()->json(['success' => true]);
    }

    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:5120'],
        ]);

        $path = $request->file('file')->store('uploads', 'public');

        return response()->json([
            'path' => '/storage/' . $path,
        ]);
    }

    public function deleteLoan(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($user->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $loan = LoanApplication::where('application_number', $id)->firstOrFail();
        AgentLog::where('loan_application_id', $loan->id)->delete();
        $loan->delete();

        return response()->json(['message' => 'Application deleted successfully']);
    }

    public function emiDues(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! in_array($user->role, ['admin', 'agent'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $approved = LoanApplication::where('status', 'approved')
            ->with(['customer', 'assignedAgent'])
            ->get();

        $dues = [];
        foreach ($approved as $loan) {
            $paidCount = AgentLog::where('loan_application_id', $loan->id)
                ->where('action', 'collected')
                ->count();
            $daysElapsed = max(1, (int) now()->diffInDays($loan->updated_at));
            $daysElapsed = min($daysElapsed, $loan->tenure_days);
            $dueCount = max(0, $daysElapsed - $paidCount);

            if ($dueCount > 0) {
                $dues[] = [
                    'id' => $loan->application_number,
                    'customerName' => $loan->customer?->name ?? '',
                    'customerPhone' => $loan->customer?->phone ?? '',
                    'dailyEMI' => (float) $loan->daily_emi,
                    'dueCount' => $dueCount,
                    'dueAmount' => (float) ($loan->daily_emi * $dueCount),
                    'assignedAgent' => $loan->assignedAgent?->name ?? '',
                ];
            }
        }

        return response()->json(['dues' => $dues]);
    }

    public function deleteAccount(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->role === 'admin') {
            return response()->json(['message' => 'Admin accounts cannot be deleted'], 403);
        }

        if ($user->role === 'customer') {
            $activeLoans = LoanApplication::where('customer_id', $user->id)
                ->whereIn('status', ['pending', 'approved'])
                ->count();

            if ($activeLoans > 0) {
                return response()->json([
                    'message' => 'Cannot delete account while you have active loans. Please wait until all loans are completed or rejected.',
                ], 422);
            }
        }

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        $user->delete();

        return response()->json(['message' => 'Account deleted successfully']);
    }

    public function pdf(string $id)
    {
        $loan = LoanApplication::where('application_number', $id)
            ->with(['customer', 'assignedAgent'])
            ->firstOrFail();

        return view('pdf.loan-application', ['loan' => $loan]);
    }

    private function formatApp(LoanApplication $a): array
    {
        return [
            'id' => $a->application_number,
            'customerId' => (string) $a->customer_id,
            'customerName' => $a->customer?->name ?? '',
            'customerPhone' => $a->customer?->phone ?? '',
            'loanType' => $a->loan_type,
            'amount' => (int) $a->amount,
            'tenure' => (int) $a->tenure_days,
            'dailyEMI' => (float) $a->daily_emi,
            'totalPayable' => (float) $a->total_payable,
            'status' => $a->status,
            'assignedAgent' => $a->assignedAgent?->name ?? '',
            'assignedAgentPhone' => $a->assignedAgent?->phone ?? '',
            'purpose' => $a->purpose ?? '',
            'city' => $a->city ?? '',
            'createdAt' => $a->created_at->format('j/n/Y'),
            'address' => $a->address ?? '',
            'income' => (int) ($a->monthly_income ?? 0),
            'coBorrowerName' => $a->co_borrower['name'] ?? '',
            'coBorrowerPhone' => $a->co_borrower['phone'] ?? '',
            'coBorrowerRelation' => $a->co_borrower['relation'] ?? '',
            'coBorrowerAddress' => $a->co_borrower['address'] ?? '',
            'documents' => $a->documents ?? [],
            'customerPhoto' => $a->customer?->customerProfile?->photo ?? '',
            'aadhaar' => $a->aadhaar ?? '',
            'pan' => $a->pan ?? '',
        ];
    }

    private function formatCustomer(User $c): array
    {
        return [
            'id' => (string) $c->id,
            'name' => $c->name,
            'phone' => $c->phone,
            'password' => '',
            'token' => $c->customer_token ?? '',
            'createdAt' => $c->created_at?->format('j/n/Y') ?? '',
        ];
    }

    private function formatAgent(User $a): array
    {
        return [
            'id' => (string) $a->id,
            'name' => $a->name,
            'phone' => $a->phone,
            'password' => '',
            'zone' => $a->customerProfile?->city ?? 'Mumbai',
        ];
    }

    private function formatLog(AgentLog $l): array
    {
        return [
            'agentId' => (string) $l->agent_id,
            'appId' => $l->application_number,
            'action' => $l->action,
            'time' => $l->created_at->toDateTimeString(),
        ];
    }

    public function getDbTables(Request $request): JsonResponse
    {
        if ($request->user()->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $tables = \Illuminate\Support\Facades\DB::select(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
        );
        $realTables = collect($tables)->pluck('table_name')->values();

        $virtualTables = collect([
            'customer_profiles',
            'Loans_ongoing',
            'Loans_completed',
            'Loans_rejected',
            'Agents_profiles'
        ]);

        $allTables = $virtualTables->merge($realTables->reject(fn($t) => $t === 'customer_profiles'))->unique()->values();

        return response()->json([
            'tables' => $allTables
        ]);
    }

    public function getDbTableData(Request $request, string $table): JsonResponse
    {
        if ($request->user()->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            return response()->json(['message' => 'Invalid table name'], 400);
        }

        if ($table === 'customer_profiles') {
            $columns = [
                ['name' => 'id', 'type' => 'bigint'],
                ['name' => 'user_id', 'type' => 'bigint'],
                ['name' => 'customer_name', 'type' => 'character varying'],
                ['name' => 'aadhaar_name', 'type' => 'character varying'],
                ['name' => 'aadhaar', 'type' => 'character varying'],
                ['name' => 'city', 'type' => 'character varying'],
                ['name' => 'address', 'type' => 'text'],
                ['name' => 'monthly_income', 'type' => 'integer'],
                ['name' => 'created_at', 'type' => 'timestamp']
            ];
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT cp.id, cp.user_id, u.name as customer_name, cp.aadhaar_name, cp.aadhaar, cp.city, cp.address, cp.monthly_income, cp.created_at FROM customer_profiles cp LEFT JOIN users u ON u.id = cp.user_id ORDER BY cp.id LIMIT 200"
            );
        } elseif ($table === 'Loans_ongoing') {
            $columns = [
                ['name' => 'id', 'type' => 'bigint'],
                ['name' => 'application_number', 'type' => 'character varying'],
                ['name' => 'customer_name', 'type' => 'character varying'],
                ['name' => 'amount', 'type' => 'integer'],
                ['name' => 'tenure_days', 'type' => 'integer'],
                ['name' => 'daily_emi', 'type' => 'decimal'],
                ['name' => 'total_payable', 'type' => 'decimal'],
                ['name' => 'status', 'type' => 'character varying'],
                ['name' => 'aadhaar', 'type' => 'character varying'],
                ['name' => 'purpose', 'type' => 'character varying'],
                ['name' => 'created_at', 'type' => 'timestamp']
            ];
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT l.id, l.application_number, u.name as customer_name, l.amount, l.tenure_days, l.daily_emi, l.total_payable, l.status, l.aadhaar, l.purpose, l.created_at FROM loan_applications l LEFT JOIN users u ON u.id = l.customer_id WHERE l.status = 'approved' ORDER BY l.id LIMIT 200"
            );
        } elseif ($table === 'Loans_completed') {
            $columns = [
                ['name' => 'id', 'type' => 'bigint'],
                ['name' => 'application_number', 'type' => 'character varying'],
                ['name' => 'customer_name', 'type' => 'character varying'],
                ['name' => 'amount', 'type' => 'integer'],
                ['name' => 'tenure_days', 'type' => 'integer'],
                ['name' => 'daily_emi', 'type' => 'decimal'],
                ['name' => 'total_payable', 'type' => 'decimal'],
                ['name' => 'status', 'type' => 'character varying'],
                ['name' => 'aadhaar', 'type' => 'character varying'],
                ['name' => 'purpose', 'type' => 'character varying'],
                ['name' => 'created_at', 'type' => 'timestamp']
            ];
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT l.id, l.application_number, u.name as customer_name, l.amount, l.tenure_days, l.daily_emi, l.total_payable, l.status, l.aadhaar, l.purpose, l.created_at FROM loan_applications l LEFT JOIN users u ON u.id = l.customer_id WHERE l.status = 'completed' OR (SELECT COUNT(*) FROM agent_logs WHERE loan_application_id = l.id AND action = 'collected') >= l.tenure_days ORDER BY l.id LIMIT 200"
            );
        } elseif ($table === 'Loans_rejected') {
            $columns = [
                ['name' => 'id', 'type' => 'bigint'],
                ['name' => 'application_number', 'type' => 'character varying'],
                ['name' => 'customer_name', 'type' => 'character varying'],
                ['name' => 'amount', 'type' => 'integer'],
                ['name' => 'tenure_days', 'type' => 'integer'],
                ['name' => 'daily_emi', 'type' => 'decimal'],
                ['name' => 'total_payable', 'type' => 'decimal'],
                ['name' => 'status', 'type' => 'character varying'],
                ['name' => 'aadhaar', 'type' => 'character varying'],
                ['name' => 'purpose', 'type' => 'character varying'],
                ['name' => 'created_at', 'type' => 'timestamp']
            ];
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT l.id, l.application_number, u.name as customer_name, l.amount, l.tenure_days, l.daily_emi, l.total_payable, l.status, l.aadhaar, l.purpose, l.created_at FROM loan_applications l LEFT JOIN users u ON u.id = l.customer_id WHERE l.status = 'rejected' ORDER BY l.id LIMIT 200"
            );
        } elseif ($table === 'Agents_profiles') {
            $columns = [
                ['name' => 'id', 'type' => 'bigint'],
                ['name' => 'name', 'type' => 'character varying'],
                ['name' => 'phone', 'type' => 'character varying'],
                ['name' => 'is_active', 'type' => 'boolean'],
                ['name' => 'zone', 'type' => 'character varying'],
                ['name' => 'created_at', 'type' => 'timestamp']
            ];
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT u.id, u.name, u.phone, u.is_active, cp.city as zone, u.created_at FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.role = 'agent' ORDER BY u.id LIMIT 200"
            );
        } else {
            $columnsInfo = \Illuminate\Support\Facades\DB::select(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :table ORDER BY ordinal_position",
                ['table' => $table]
            );
            $columns = collect($columnsInfo)->map(fn($c) => [
                'name' => $c->column_name,
                'type' => $c->data_type
            ])->toArray();

            $rows = \Illuminate\Support\Facades\DB::select("SELECT * FROM \"{$table}\" LIMIT 200");
        }

        return response()->json([
            'table' => $table,
            'columns' => $columns,
            'rows' => $rows
        ]);
    }

    public function updateDbRow(Request $request, string $table): JsonResponse
    {
        if ($request->user()->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $request->validate([
            'id' => ['required'],
            'data' => ['required', 'array']
        ]);

        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            return response()->json(['message' => 'Invalid table name'], 400);
        }

        $physicalTable = $table;
        if ($table === 'Loans_ongoing' || $table === 'Loans_completed' || $table === 'Loans_rejected') {
            $physicalTable = 'loan_applications';
        } elseif ($table === 'Agents_profiles') {
            $physicalTable = 'users';
        }

        // Handle virtual fields map back to underlying table
        if (isset($request->data['customer_name'])) {
            if ($physicalTable === 'customer_profiles') {
                $profile = \Illuminate\Support\Facades\DB::table('customer_profiles')->where('id', $request->id)->first();
                if ($profile) {
                    \Illuminate\Support\Facades\DB::table('users')->where('id', $profile->user_id)->update(['name' => $request->data['customer_name']]);
                }
            } elseif ($physicalTable === 'loan_applications') {
                $loan = \Illuminate\Support\Facades\DB::table('loan_applications')->where('id', $request->id)->first();
                if ($loan) {
                    \Illuminate\Support\Facades\DB::table('users')->where('id', $loan->customer_id)->update(['name' => $request->data['customer_name']]);
                }
            }
        }

        if ($table === 'Agents_profiles' && isset($request->data['zone'])) {
            \Illuminate\Support\Facades\DB::table('customer_profiles')
                ->updateOrInsert(
                    ['user_id' => $request->id],
                    ['city' => $request->data['zone']]
                );
        }

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing($physicalTable);
        $updateData = collect($request->data)
            ->only($columns)
            ->except(['id', 'created_at', 'updated_at'])
            ->toArray();

        foreach ($updateData as $key => $val) {
            if (in_array($key, ['co_borrower', 'documents', 'metadata']) && is_array($val)) {
                $updateData[$key] = json_encode($val);
            }
        }

        if (count($updateData) > 0) {
            \Illuminate\Support\Facades\DB::table($physicalTable)->where('id', $request->id)->update($updateData);
        }

        return response()->json(['success' => true]);
    }

    public function deleteDbRow(Request $request, string $table, string $id): JsonResponse
    {
        if ($request->user()->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            return response()->json(['message' => 'Invalid table name'], 400);
        }

        $physicalTable = $table;
        if ($table === 'Loans_ongoing' || $table === 'Loans_completed' || $table === 'Loans_rejected') {
            $physicalTable = 'loan_applications';
        } elseif ($table === 'Agents_profiles') {
            $physicalTable = 'users';
        }

        if ($physicalTable === 'users') {
            \Illuminate\Support\Facades\DB::table('customer_profiles')->where('user_id', $id)->delete();
            \Illuminate\Support\Facades\DB::table('loan_applications')->where('customer_id', $id)->orWhere('assigned_agent_id', $id)->delete();
        }

        \Illuminate\Support\Facades\DB::table($physicalTable)->where('id', $id)->delete();

        return response()->json(['success' => true]);
    }

    public function health(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'timestamp' => now()->toIso8601String()
        ]);
    }
}
