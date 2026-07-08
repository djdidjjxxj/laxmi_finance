async function test() {
    let f = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const randomPhone = '99' + Math.floor(10000000 + Math.random() * 90000000).toString();
    
    // Get CSRF cookie first
    const csrfRes = await f('https://laxmi-finance.onrender.com/sanctum/csrf-cookie', {
        headers: { 'Origin': 'https://laxmi-finance.onrender.com' }
    });
    
    let rawCookies = [];
    if (typeof csrfRes.headers.getSetCookie === 'function') {
        rawCookies = csrfRes.headers.getSetCookie();
    } else {
        const val = csrfRes.headers.get('set-cookie');
        if (val) rawCookies = [val];
    }
    
    let cookiesStr = rawCookies.map(c => c.split(';')[0]).join('; ');
    let xsrfToken = '';
    rawCookies.forEach(c => {
        if (c.startsWith('XSRF-TOKEN=')) {
            xsrfToken = decodeURIComponent(c.split('=')[1].split(';')[0]);
        }
    });

    const regRes = await f('https://laxmi-finance.onrender.com/api/auth/register', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            'Accept': 'application/json',
            'Cookie': cookiesStr,
            'X-XSRF-TOKEN': xsrfToken,
            'Origin': 'https://laxmi-finance.onrender.com',
            'Referer': 'https://laxmi-finance.onrender.com/'
        },
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
    
    let newCookies = [];
    if (typeof regRes.headers.getSetCookie === 'function') {
        newCookies = regRes.headers.getSetCookie();
    } else {
        const val = regRes.headers.get('set-cookie');
        if (val) newCookies = [val];
    }
    
    cookiesStr = newCookies.map(c => c.split(';')[0]).join('; ');
    newCookies.forEach(c => {
        if (c.startsWith('XSRF-TOKEN=')) {
            xsrfToken = decodeURIComponent(c.split('=')[1].split(';')[0]);
        }
    });
    
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
            'Cookie': cookiesStr,
            'X-XSRF-TOKEN': xsrfToken,
            'Origin': 'https://laxmi-finance.onrender.com',
            'Referer': 'https://laxmi-finance.onrender.com/'
        },
        body: JSON.stringify(loanData)
    });
    console.log('LOAN STATUS:', loanRes.status);
    console.log('LOAN BODY:', await loanRes.text());
}
test();
