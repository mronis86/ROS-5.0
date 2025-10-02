// Test script to verify authentication endpoints
const fetch = require('node-fetch');

const API_BASE_URL = 'https://ros-50-production.up.railway.app';

async function testAuth() {
  console.log('🧪 Testing Authentication Endpoints...\n');
  
  // Test 1: Health check
  console.log('1. Testing health endpoint...');
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await response.json();
    console.log('✅ Health check:', data.status);
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return;
  }
  
  // Test 2: Sign up
  console.log('\n2. Testing signup endpoint...');
  try {
    const testUser = {
      email: `test-${Date.now()}@example.com`,
      password: 'testpassword123',
      full_name: 'Test User'
    };
    
    const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testUser)
    });
    
    if (response.ok) {
      const userData = await response.json();
      console.log('✅ Signup successful:', {
        user_id: userData.user_id,
        email: userData.email,
        full_name: userData.full_name,
        role: userData.role
      });
      
      // Test 3: Sign in with the created user
      console.log('\n3. Testing signin endpoint...');
      const signinResponse = await fetch(`${API_BASE_URL}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password
        })
      });
      
      if (signinResponse.ok) {
        const signinData = await signinResponse.json();
        console.log('✅ Signin successful:', {
          user_id: signinData.user_id,
          email: signinData.email,
          full_name: signinData.full_name,
          role: signinData.role
        });
      } else {
        const errorData = await signinResponse.json();
        console.log('❌ Signin failed:', errorData.error);
      }
      
    } else {
      const errorData = await response.json();
      console.log('❌ Signup failed:', errorData.error);
    }
  } catch (error) {
    console.log('❌ Signup test failed:', error.message);
  }
  
  // Test 4: Try to sign up with duplicate email
  console.log('\n4. Testing duplicate email signup...');
  try {
    const duplicateUser = {
      email: 'duplicate@example.com',
      password: 'testpassword123',
      full_name: 'Duplicate User'
    };
    
    // First signup
    const response1 = await fetch(`${API_BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(duplicateUser)
    });
    
    if (response1.ok) {
      console.log('✅ First signup successful');
      
      // Try duplicate
      const response2 = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(duplicateUser)
      });
      
      if (response2.status === 400) {
        const errorData = await response2.json();
        console.log('✅ Duplicate email correctly rejected:', errorData.error);
      } else {
        console.log('❌ Duplicate email should have been rejected');
      }
    } else {
      console.log('❌ First signup failed');
    }
  } catch (error) {
    console.log('❌ Duplicate test failed:', error.message);
  }
  
  console.log('\n🎉 Authentication test completed!');
}

// Run the test
testAuth().catch(console.error);
