const fetch = require('node-fetch'); // wait fetch is built-in in node 18+
async function test() {
    let f = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const loginRes = await f('https://laxmi-finance.onrender.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: 'kaustavmitra494@gmail.com', password: 'KaustavCEO@2005' })
    });
    const loginText = await loginRes.text();
    console.log('LOGIN STATUS:', loginRes.status);
    console.log('LOGIN BODY:', loginText);
    
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
    
    const loanRes = await f('https://laxmi-finance.onrender.com/api/loans', {
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
