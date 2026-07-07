<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loan_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('assigned_agent_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('application_number')->unique();
            $table->string('loan_type', 40);
            $table->unsignedInteger('amount');
            $table->unsignedSmallInteger('tenure_days');
            $table->decimal('daily_emi', 10, 2)->nullable();
            $table->decimal('total_payable', 10, 2)->nullable();
            $table->string('status', 32)->default('pending')->index();
            $table->string('purpose')->nullable();
            $table->string('city')->nullable();
            $table->text('address')->nullable();
            $table->unsignedInteger('monthly_income')->nullable();
            $table->json('co_borrower')->nullable();
            $table->json('documents')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('loan_applications');
    }
};
