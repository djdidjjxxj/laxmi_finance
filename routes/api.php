<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\LoanController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/register', [RegisteredUserController::class, 'store']);
Route::post('/auth/login', [AuthenticatedSessionController::class, 'store']);
Route::get('/auth/session', [AuthenticatedSessionController::class, 'show']);

Route::get('/health', [LoanController::class, 'health']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthenticatedSessionController::class, 'destroy']);
    Route::delete('/auth/account', [LoanController::class, 'deleteAccount']);

    Route::get('/data', [LoanController::class, 'data']);

    Route::post('/loans', [LoanController::class, 'store']);
    Route::put('/loans/{id}/status', [LoanController::class, 'updateStatus']);
    Route::put('/loans/{id}/assign', [LoanController::class, 'assignAgent']);
    Route::delete('/loans/{id}', [LoanController::class, 'deleteLoan']);
    Route::get('/loans/{id}/pdf', [LoanController::class, 'pdf']);

    Route::get('/emi-dues', [LoanController::class, 'emiDues']);

    Route::get('/admin/db/tables', [LoanController::class, 'getDbTables']);
    Route::get('/admin/db/tables/{table}', [LoanController::class, 'getDbTableData']);
    Route::put('/admin/db/tables/{table}/row', [LoanController::class, 'updateDbRow']);
    Route::delete('/admin/db/tables/{table}/row/{id}', [LoanController::class, 'deleteDbRow']);
    Route::delete('/admin/logs', [LoanController::class, 'clearLogs']);

    Route::post('/agent/log', [LoanController::class, 'logActivity']);

    Route::post('/uploads', [LoanController::class, 'upload']);
});

Route::get('/temp-reset-db-identity', function() {
    \Illuminate\Support\Facades\Schema::disableForeignKeyConstraints();
    \Illuminate\Support\Facades\DB::statement('TRUNCATE TABLE loan_applications RESTART IDENTITY CASCADE');
    \Illuminate\Support\Facades\DB::statement('TRUNCATE TABLE customer_profiles RESTART IDENTITY CASCADE');
    \Illuminate\Support\Facades\DB::statement('TRUNCATE TABLE agent_logs RESTART IDENTITY CASCADE');
    \Illuminate\Support\Facades\DB::statement('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
    
    // Recreate admin
    \App\Models\User::create([
        'name' => 'Admin',
        'email' => 'laxmifinance_admin',
        'phone' => '9999999999',
        'password' => '25951046',
        'role' => 'admin',
        'is_active' => true,
    ]);
    \Illuminate\Support\Facades\Schema::enableForeignKeyConstraints();
    return response()->json(['success' => true]);
});
