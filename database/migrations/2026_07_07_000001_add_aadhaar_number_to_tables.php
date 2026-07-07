<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('customer_profiles', 'aadhaar')) {
            Schema::table('customer_profiles', function (Blueprint $table) {
                $table->string('aadhaar', 12)->nullable();
            });
        }

        if (!Schema::hasColumn('loan_applications', 'aadhaar')) {
            Schema::table('loan_applications', function (Blueprint $table) {
                $table->string('aadhaar', 12)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('customer_profiles', 'aadhaar')) {
            Schema::table('customer_profiles', function (Blueprint $table) {
                $table->dropColumn('aadhaar');
            });
        }

        if (Schema::hasColumn('loan_applications', 'aadhaar')) {
            Schema::table('loan_applications', function (Blueprint $table) {
                $table->dropColumn('aadhaar');
            });
        }
    }
};
