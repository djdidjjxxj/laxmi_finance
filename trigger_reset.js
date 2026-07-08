async function run() {
    console.log('Sending request to reset customers and agents (restart identity)...');
    const res = await fetch('https://laxmi-finance.onrender.com/api/temp-reset-db-identity');
    console.log('STATUS:', res.status);
    console.log('BODY:', await res.text());
}
run();
