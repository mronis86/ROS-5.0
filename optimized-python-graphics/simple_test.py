#!/usr/bin/env python3
"""
Simple test to see what's happening with the connection
"""

import requests
import socketio
import time

def test_connection():
    print("Testing connection step by step...")
    
    # Test 1: API connection
    print("\n1. Testing API connection...")
    try:
        response = requests.get("https://ros-50-production.up.railway.app/health", timeout=10)
        print(f"   API Response: {response.status_code}")
        if response.status_code == 200:
            print("   SUCCESS: API is reachable")
        else:
            print("   WARNING: API returned unexpected status")
    except Exception as e:
        print(f"   ERROR: API connection failed: {e}")
        return
    
    # Test 2: Socket.IO connection
    print("\n2. Testing Socket.IO connection...")
    try:
        sio = socketio.Client()
        
        @sio.event
        def connect():
            print("   SUCCESS: Socket.IO connected!")
        
        @sio.event
        def disconnect():
            print("   Socket.IO disconnected")
        
        @sio.event
        def connect_error(data):
            print(f"   ERROR: Socket.IO connection error: {data}")
        
        print("   Attempting to connect...")
        sio.connect("https://ros-50-production.up.railway.app")
        
        # Wait for connection
        time.sleep(3)
        
        if sio.connected:
            print("   SUCCESS: Socket.IO connection confirmed!")
            sio.disconnect()
        else:
            print("   ERROR: Socket.IO connection failed")
            
    except Exception as e:
        print(f"   ERROR: Socket.IO connection failed: {e}")
    
    print("\nTest completed!")

if __name__ == "__main__":
    test_connection()
