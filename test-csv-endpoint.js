// Quick test to verify CSV endpoint is working
const http = require('http');

// Replace with your actual event ID
const EVENT_ID = 'test-event-123'; // UPDATE THIS!

console.log('Testing CSV endpoint...\n');
console.log(`URL: http://localhost:3002/api/lower-thirds.csv?eventId=${EVENT_ID}\n`);

const options = {
    hostname: 'localhost',
    port: 3002,
    path: `/api/lower-thirds.csv?eventId=${EVENT_ID}`,
    method: 'GET'
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Content-Type: ${res.headers['content-type']}\n`);
    
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('Response:');
        console.log('='.repeat(60));
        console.log(data.substring(0, 500)); // Show first 500 chars
        console.log('='.repeat(60));
        
        if (res.headers['content-type'] === 'text/csv') {
            console.log('\n✅ SUCCESS! Endpoint is returning CSV data');
        } else {
            console.log('\n❌ ERROR: Endpoint is NOT returning CSV');
            console.log(`   Got: ${res.headers['content-type']}`);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ ERROR:', error.message);
});

req.end();

