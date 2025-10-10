// Test script to send OSC commands to the ROS OSC Control app
// Usage: node test-osc-commands.js
// MATCHES OSCModalSimplified.tsx commands

const osc = require('osc');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 57121;

// Create OSC UDP port
const udpPort = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 57122, // Use different port for sending
  remoteAddress: TARGET_HOST,
  remotePort: TARGET_PORT
});

udpPort.on('ready', () => {
  console.log('✅ OSC Test Client Ready');
  console.log(`📡 Sending to ${TARGET_HOST}:${TARGET_PORT}`);
  console.log('');
  
  // Run tests
  runTests();
});

udpPort.on('error', (error) => {
  console.error('❌ OSC Error:', error);
});

udpPort.open();

function sendOSC(address, args = []) {
  console.log(`📤 Sending: ${address}`, args);
  udpPort.send({
    address: address,
    args: args
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Running OSC Tests (OSCModalSimplified format)...');
  console.log('');
  
  // Test 1: Load cue by cue number (format: /cue/{cueNumber}/load)
  console.log('Test 1: Load cue "1" (/cue/1/load)');
  sendOSC('/cue/1/load');
  await wait(2000);
  
  // Test 2: Load cue with decimal
  console.log('Test 2: Load cue "1.1" (/cue/1.1/load)');
  sendOSC('/cue/1.1/load');
  await wait(2000);
  
  // Test 3: Load cue with letter
  console.log('Test 3: Load cue "1A" (/cue/1A/load)');
  sendOSC('/cue/1A/load');
  await wait(2000);
  
  // Test 4: Start timer
  console.log('Test 4: Start timer (/timer/start)');
  sendOSC('/timer/start');
  await wait(3000);
  
  // Test 5: Stop timer
  console.log('Test 5: Stop timer (/timer/stop)');
  sendOSC('/timer/stop');
  await wait(2000);
  
  // Test 6: Reset timer
  console.log('Test 6: Reset timer (/timer/reset)');
  sendOSC('/timer/reset');
  await wait(2000);
  
  // Test 7: Sub-timer start
  console.log('Test 7: Start sub-timer for cue 5 (/subtimer/cue/5/start)');
  sendOSC('/subtimer/cue/5/start');
  await wait(2000);
  
  // Test 8: Sub-timer stop
  console.log('Test 8: Stop sub-timer for cue 5 (/subtimer/cue/5/stop)');
  sendOSC('/subtimer/cue/5/stop');
  await wait(2000);
  
  // Test 9: Set day
  console.log('Test 9: Set day to 2 (/set-day with arg 2)');
  sendOSC('/set-day', [{ type: 'i', value: 2 }]);
  await wait(2000);
  
  // Test 10: Get day
  console.log('Test 10: Get current day (/get-day)');
  sendOSC('/get-day');
  await wait(2000);
  
  // Test 11: List cues
  console.log('Test 11: List cues (/list-cues)');
  sendOSC('/list-cues');
  await wait(2000);
  
  console.log('');
  console.log('✅ All tests completed!');
  console.log('Check the ROS OSC Control app to verify the commands were received');
  console.log('');
  
  // Close after tests
  setTimeout(() => {
    udpPort.close();
    process.exit(0);
  }, 1000);
}
