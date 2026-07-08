async function test() {
    let f = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const randomPhone = '99' + Math.floor(10000000 + Math.random() * 90000000).toString();
    const regRes = await f('https://laxmi-finance.onrender.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ 
            name: 'Test User',
            phone: randomPhone,
            password: 'password123',
            password_confirmation: 'password123',
            role: 'customer'
        })
    });
    
    console.log('REG STATUS:', regRes.status);
    console.log('REG BODY:', await regRes.text());
    
    if (regRes.status !== 201) return;
    
    const cookies = regRes.headers.get('set-cookie');
    
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
