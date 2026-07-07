<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LoanApplication extends Model
{
    protected $fillable = [
        'customer_id',
        'assigned_agent_id',
        'application_number',
        'loan_type',
        'amount',
        'tenure_days',
        'daily_emi',
        'total_payable',
        'status',
        'purpose',
        'city',
        'address',
        'monthly_income',
        'co_borrower',
        'documents',
        'aadhaar',
        'pan',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'tenure_days' => 'integer',
            'daily_emi' => 'decimal:2',
            'total_payable' => 'decimal:2',
            'monthly_income' => 'integer',
            'co_borrower' => 'array',
            'documents' => 'array',
        ];
    }

    public function customer()
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function assignedAgent()
    {
        return $this->belongsTo(User::class, 'assigned_agent_id');
    }
}
