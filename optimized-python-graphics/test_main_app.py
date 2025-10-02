#!/usr/bin/env python3
"""
Test the main application with a simple connection test
"""

import sys
import os

# Add the current directory to the path so we can import the main module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from optimized_live_graphics_generator import OptimizedLiveGraphicsGenerator
    import tkinter as tk
    
    def test_connection():
        """Test the connection logic from the main app"""
        print("Testing main application connection logic...")
        
        # Create a minimal tkinter root (required for the app)
        root = tk.Tk()
        root.withdraw()  # Hide the window
        
        # Create the app instance
        app = OptimizedLiveGraphicsGenerator(root)
        
        # Set a test event ID
        app.event_id.set("test")
        
        print("App created successfully")
        print(f"API Base URL: {app.api_base_url}")
        print(f"Event ID: {app.event_id.get()}")
        
        # Test the API connection method
        try:
            print("\nTesting API connection...")
            app.test_api_connection()
            print("SUCCESS: API connection test passed")
        except Exception as e:
            print(f"ERROR: API connection test failed: {e}")
        
        # Test Socket.IO connection
        try:
            print("\nTesting Socket.IO connection...")
            app.start_websocket()
            print("SUCCESS: Socket.IO connection test passed")
        except Exception as e:
            print(f"ERROR: Socket.IO connection test failed: {e}")
        
        # Clean up
        if app.sio:
            app.sio.disconnect()
        
        root.destroy()
        print("\nTest completed")
    
    if __name__ == "__main__":
        test_connection()
        
except ImportError as e:
    print(f"ERROR: Import error: {e}")
    print("Make sure you're in the correct directory and all dependencies are installed")
except Exception as e:
    print(f"ERROR: {e}")
