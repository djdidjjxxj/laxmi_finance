<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if (isset($_SERVER['HTTP_X_FORWARDED_HOST'])) {
            $host = $_SERVER['HTTP_X_FORWARDED_HOST'];
        } elseif (isset($_SERVER['HTTP_HOST'])) {
            $host = $_SERVER['HTTP_HOST'];
        } else {
            $host = null;
        }

        if ($host) {
            $domains = config('sanctum.stateful', []);
            $host = explode(':', $host)[0];
            if (!in_array($host, $domains)) {
                $domains[] = $host;
                config(['sanctum.stateful' => $domains]);
            }
        }
    }
}
