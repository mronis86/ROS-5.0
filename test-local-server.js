// Test script for local server with Neon database
// This will verify your database connection and server endpoints

const http = require('http');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test configuration
const SERVER_PORT = 3002;
const TEST_EVENT_ID = 'test-event-123'; // Replace with your actual event ID

async function testEndpoint(path, description) {
    return new Promise((resolve) => {
        log(`\n📡 Testing: ${description}`, 'cyan');
        log(`   URL: http://localhost:${SERVER_PORT}${path}`, 'blue');
        
        const req = http.get(`http://localhost:${SERVER_PORT}${path}`, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    log(`   ✅ SUCCESS (${res.statusCode})`, 'green');
                    log(`   Response length: ${data.length} bytes`, 'blue');
                    if (data.length < 500) {
                        log(`   Response: ${data.substring(0, 200)}...`, 'blue');
                    }
                    resolve({ success: true, status: res.statusCode });
                } else {
                    log(`   ❌ FAILED (${res.statusCode})`, 'red');
                    log(`   Response: ${data.substring(0, 200)}`, 'red');
                    resolve({ success: false, status: res.statusCode });
                }
            });
        });
        
        req.on('error', (error) => {
            log(`   ❌ ERROR: ${error.message}`, 'red');
            resolve({ success: false, error: error.message });
        });
        
        req.setTimeout(5000, () => {
            req.destroy();
            log(`   ❌ TIMEOUT`, 'red');
            resolve({ success: false, error: 'Timeout' });
        });
    });
}

async function runTests() {
    log('🚀 Starting Local Server Tests', 'cyan');
    log('=' .repeat(60), 'cyan');
    
    // Check if server is running
    log('\n1️⃣  Checking if server is running...', 'yellow');
    const healthCheck = await testEndpoint('/', 'Server health check');
    
    if (!healthCheck.success) {
        log('\n❌ Server is not running!', 'red');
        log('   Please start the server first:', 'yellow');
        log('   node server.js', 'cyan');
        return;
    }
    
    log('\n2️⃣  Testing API endpoints...', 'yellow');
    
    // Test main API endpoint
    await testEndpoint(
        `/api/run-of-show-data/${TEST_EVENT_ID}`,
        'Main API - Run of Show Data'
    );
    
    // Test XML endpoints
    await testEndpoint(
        `/api/lower-thirds.xml?eventId=${TEST_EVENT_ID}`,
        'Lower Thirds XML'
    );
    
    await testEndpoint(
        `/api/schedule.xml?eventId=${TEST_EVENT_ID}`,
        'Schedule XML'
    );
    
    await testEndpoint(
        `/api/custom-columns.xml?eventId=${TEST_EVENT_ID}`,
        'Custom Columns XML'
    );
    
    // Test CSV endpoints
    await testEndpoint(
        `/api/lower-thirds.csv?eventId=${TEST_EVENT_ID}`,
        'Lower Thirds CSV'
    );
    
    await testEndpoint(
        `/api/schedule.csv?eventId=${TEST_EVENT_ID}`,
        'Schedule CSV'
    );
    
    await testEndpoint(
        `/api/custom-columns.csv?eventId=${TEST_EVENT_ID}`,
        'Custom Columns CSV'
    );
    
    log('\n' + '='.repeat(60), 'cyan');
    log('✅ Tests complete!', 'green');
    log('\nNext steps:', 'yellow');
    log('1. If all tests passed, your local server is working correctly', 'blue');
    log('2. You can now test the XML/CSV URLs in VMIX:', 'blue');
    log(`   http://localhost:${SERVER_PORT}/api/lower-thirds.xml?eventId=YOUR_EVENT_ID`, 'cyan');
    log('3. If ready, deploy to Netlify with the same setup', 'blue');
}

// Run the tests
runTests().catch((error) => {
    log(`\n❌ Unexpected error: ${error.message}`, 'red');
    console.error(error);
});

