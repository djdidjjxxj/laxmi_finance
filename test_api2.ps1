try {
    $response = Invoke-RestMethod -Uri 'https://laxmi-finance.onrender.com/api/auth/login' -Method Post -Body (@{email='kaustavmitra494@gmail.com';password='KaustavCEO@2005'} | ConvertTo-Json) -ContentType 'application/json' -Headers @{'Accept'='application/json'} -SessionVariable session
    Write-Host "$response: $($response | ConvertTo-Json -Depth 10)"
} catch {
    $streamReader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    $errResp = $streamReader.ReadToEnd()
    $streamReader.Close()
    Write-Host "LOGIN HTTP Error: $($_.Exception.Response.StatusCode.value__)"
    Write-Host "LOGIN Error Body: $errResp"
    exit
}

$loanData = @{
    loan_type = 'Personal'
    amount = 10000
    tenure_days = 66
    purpose = 'Test'
    city = 'Test'
    address = 'Test'
    monthly_income = 50000
    co_borrower = @{
        name = 'Test'
        phone = '1234567890'
        relation = 'Friend'
        address = 'Test'
    }
    documents = @()
} | ConvertTo-Json -Depth 10

try {
    $res2 = Invoke-RestMethod -Uri 'https://laxmi-finance.onrender.com/api/loans' -Method Post -Body $loanData -ContentType 'application/json' -Headers @{'Accept'='application/json'} -WebSession $session
    Write-Host "LOAN SUCCESS: $($res2 | ConvertTo-Json -Depth 10)"
} catch {
    $streamReader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    $errResp = $streamReader.ReadToEnd()
    $streamReader.Close()
    Write-Host "LOAN HTTP Error: $($_.Exception.Response.StatusCode.value__)"
    Write-Host "LOAN Error Body: $errResp"
}
