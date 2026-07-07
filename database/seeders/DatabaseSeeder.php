<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        User::firstOrCreate(
            ['email' => 'laxmifinance_admin'],
            [
                'name' => 'Admin',
                'phone' => '9999999999',
                'password' => '25951046',
                'role' => 'admin',
                'is_active' => true,
            ]
        );
    }
}
