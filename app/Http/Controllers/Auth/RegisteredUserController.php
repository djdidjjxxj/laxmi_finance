<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class RegisteredUserController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $role = $request->input('role', 'customer');

        if (! in_array($role, ['customer', 'agent'])) {
            $role = 'customer';
        }

        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'size:10', 'unique:users'],
            'password' => ['required', 'string', 'min:6', 'confirmed'],
        ];

        if ($role === 'agent') {
            $rules['zone'] = ['nullable', 'string', 'max:100'];
        }

        $request->validate($rules);

        $userData = [
            'name' => $request->name,
            'phone' => $request->phone,
            'password' => $request->password,
            'role' => $role,
        ];

        if ($role === 'customer') {
            $userData['customer_token'] = 'LFN-TMP-' . date('Y') . '-' . str_pad((User::max('id') ?? 0) + 1, 6, '0', STR_PAD_LEFT);
        }

        $user = User::create($userData);

        if ($role === 'agent' && $request->filled('zone')) {
            $user->customerProfile()->updateOrCreate(
                ['user_id' => $user->id],
                ['city' => $request->zone]
            );
        }

        Auth::login($user);

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'phone' => $user->phone,
                'token' => $user->customer_token,
                'role' => $user->role,
            ],
        ], 201);
    }
}
