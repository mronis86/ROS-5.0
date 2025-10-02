#!/usr/bin/env python3
"""
Run the main application and test the connection
"""

import sys
import os
import time
import threading

# Add the current directory to the path so we can import the main module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from optimized_live_graphics_generator import OptimizedLiveGraphicsGenerator
    import tkinter as tk
    
    def run_app_test():
        """Run the main application and test connection"""
        print("Starting Optimized Live Graphics Generator...")
        
        # Create the main window
        root = tk.Tk()
        
        # Create the app instance
        app = OptimizedLiveGraphicsGenerator(root)
        
        # Set a test event ID
        app.event_id.set("test")
        
        print("App created successfully")
        print("Click the Connect button to test the connection")
        print("The status should change to show connected state")
        
        # Start the application
        root.mainloop()
        
        print("Application closed")
    
    if __name__ == "__main__":
        run_app_test()
        
except ImportError as e:
    print(f"ERROR: Import error: {e}")
    print("Make sure you're in the correct directory and all dependencies are installed")
except Exception as e:
    print(f"ERROR: {e}")
