#!/usr/bin/env python3
"""
Test connection to the API server
Simple script to debug connection issues
"""

import requests
import socketio
import json
import time

def test_api_connection():
    """Test basic API connection"""
    print("Testing API connection...")
    
    api_url = "https://ros-50-production.up.railway.app"
    
    # Try different API endpoints (based on actual API server)
    test_endpoints = [
        f"{api_url}/health",  # Health check endpoint
        f"{api_url}/api/calendar-events",  # Calendar events endpoint
        f"{api_url}/",  # Root endpoint
        f"{api_url}/api"  # API root
    ]
    
    for endpoint in test_endpoints:
        try:
            print(f"  Trying: {endpoint}")
            response = requests.get(endpoint, timeout=10)
            print(f"  Response: {response.status_code}")
            
            if response.status_code == 200:
                print("SUCCESS: API server is reachable")
                return True
            elif response.status_code == 404:
                print("  WARNING: Endpoint not found, trying next...")
                continue
            else:
                print(f"  WARNING: Unexpected status: {response.status_code}")
                continue
                
        except Exception as e:
            print(f"  FAILED: {str(e)}")
            continue
    
    print("ERROR: No working API endpoints found")
    return False

def test_socketio_connection():
    """Test Socket.IO connection"""
    print("\nTesting Socket.IO connection...")
    
    api_url = "https://ros-50-production.up.railway.app"
    
    try:
        # Create Socket.IO client
        sio = socketio.Client()
        
        @sio.event
        def connect():
            print("SUCCESS: Socket.IO connected successfully")
            sio.disconnect()
        
        @sio.event
        def disconnect():
            print("Socket.IO disconnected")
        
        @sio.event
        def connect_error(data):
            print(f"ERROR: Socket.IO connection error: {data}")
        
        # Try to connect (remove timeout parameter)
        sio.connect(api_url)
        time.sleep(3)  # Give it more time to connect
        
        if sio.connected:
            print("SUCCESS: Socket.IO connection successful")
            return True
        else:
            print("ERROR: Socket.IO connection failed")
            return False
            
    except Exception as e:
        print(f"ERROR: Socket.IO connection failed: {str(e)}")
        return False

def main():
    print("Testing Optimized Graphics Generator Connection")
    print("=" * 50)
    
    # Test API connection
    api_success = test_api_connection()
    
    # Test Socket.IO connection
    socketio_success = test_socketio_connection()
    
    print("\n" + "=" * 50)
    print("Test Results:")
    print(f"API Connection: {'SUCCESS' if api_success else 'FAILED'}")
    print(f"Socket.IO Connection: {'SUCCESS' if socketio_success else 'FAILED'}")
    
    if api_success and socketio_success:
        print("\nAll connections successful! The graphics generator should work.")
    elif api_success:
        print("\nAPI works but Socket.IO failed. Graphics generator will work in API-only mode.")
    else:
        print("\nBoth connections failed. Check your internet connection and server status.")
    
    print("\nPress Enter to exit...")
    input()

if __name__ == "__main__":
    main()
