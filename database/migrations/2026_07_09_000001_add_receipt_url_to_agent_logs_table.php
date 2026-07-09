<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('agent_logs', 'receipt_url')) {
                $table->string('receipt_url')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('agent_logs', function (Blueprint $table) {
            if (Schema::hasColumn('agent_logs', 'receipt_url')) {
                $table->dropColumn('receipt_url');
            }
        });
    }
};
