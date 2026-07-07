<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomerProfile extends Model
{
    protected $fillable = [
        'user_id',
        'aadhaar_name',
        'city',
        'address',
        'monthly_income',
        'metadata',
        'aadhaar',
    ];

    protected function casts(): array
    {
        return [
            'monthly_income' => 'integer',
            'metadata' => 'array',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
