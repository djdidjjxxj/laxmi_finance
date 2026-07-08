async function test() {
    const loginRes = await fetch('https://laxmi-finance.onrender.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: 'kaustavmitra494@gmail.com', password: 'Sagorika@2005' })
    });
    const loginText = await loginRes.text();
    console.log('LOGIN STATUS 2:', loginRes.status);
    console.log('LOGIN BODY 2:', loginText);
    
    if (loginRes.status !== 200) return;
    
    const cookies = loginRes.headers.get('set-cookie');
    
    const loanData = {
        loan_type: 'Personal',
        amount: 10000,
        tenure_days: 66,
        purpose: 'Test',
        city: 'Test',
        address: 'Test',
        monthly_income: 50000,
        co_borrower: {
            name: 'Test',
            phone: '1234567890',
            relation: 'Friend',
            address: 'Test'
        },
        documents: []
    };
    
    const loanRes = await fetch('https://laxmi-finance.onrender.com/api/loans', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            'Accept': 'application/json',
            'Cookie': cookies
        },
        body: JSON.stringify(loanData)
    });
    console.log('LOAN STATUS:', loanRes.status);
    console.log('LOAN BODY:', await loanRes.text());
}
test();
