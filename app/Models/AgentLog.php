<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AgentLog extends Model
{
    protected $fillable = [
        'agent_id',
        'loan_application_id',
        'application_number',
        'action',
        'receipt_url',
    ];

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }

    public function loanApplication()
    {
        return $this->belongsTo(LoanApplication::class);
    }
}
