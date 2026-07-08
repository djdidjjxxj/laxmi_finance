<?php
$url = 'https://laxmi-finance.onrender.com';
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url . '/api/auth/login');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['email' => 'kaustavmitra494@gmail.com', 'password' => 'KaustavCEO@2005']));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json', 'Accept: application/json']);
curl_setopt($ch, CURLOPT_HEADER, true);
$response = curl_exec($ch);
$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$header = substr($response, 0, $header_size);
$body = substr($response, $header_size);
echo "LOGIN BODY:\n" . $body . "\n\n";

preg_match_all('/^Set-Cookie:\s*([^;]*)/mi', $header, $matches);
$cookies = array();
foreach($matches[1] as $item) {
    parse_str($item, $cookie);
    $cookies = array_merge($cookies, $cookie);
}
$cookieStr = '';
foreach ($cookies as $key => $val) {
    $cookieStr .= $key . '=' . $val . '; ';
}

$loanData = [
    'loan_type' => 'Personal',
    'amount' => 10000,
    'tenure_days' => 66,
    'purpose' => 'Test',
    'city' => 'Test',
    'address' => 'Test',
    'monthly_income' => 50000,
    'co_borrower' => [
        'name' => 'Test',
        'phone' => '1234567890',
        'relation' => 'Friend',
        'address' => 'Test'
    ]
];

curl_setopt($ch, CURLOPT_URL, $url . '/api/loans');
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($loanData));
curl_setopt($ch, CURLOPT_COOKIE, $cookieStr);
$response2 = curl_exec($ch);
$header_size2 = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$header2 = substr($response2, 0, $header_size2);
$body2 = substr($response2, $header_size2);

$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo "LOAN SUBMIT HTTP: " . $httpCode . "\n";
echo "LOAN SUBMIT BODY:\n" . $body2 . "\n";

curl_close($ch);
