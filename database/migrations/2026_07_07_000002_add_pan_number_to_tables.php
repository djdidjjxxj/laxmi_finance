<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('customer_profiles', 'pan')) {
            Schema::table('customer_profiles', function (Blueprint $table) {
                $table->string('pan', 10)->nullable();
            });
        }

        if (!Schema::hasColumn('loan_applications', 'pan')) {
            Schema::table('loan_applications', function (Blueprint $table) {
                $table->string('pan', 10)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('customer_profiles', 'pan')) {
            Schema::table('customer_profiles', function (Blueprint $table) {
                $table->dropColumn('pan');
            });
        }

        if (Schema::hasColumn('loan_applications', 'pan')) {
            Schema::table('loan_applications', function (Blueprint $table) {
                $table->dropColumn('pan');
            });
        }
    }
};
