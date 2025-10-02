#!/usr/bin/env python3
"""
Test the UI fix for connection status
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
    
    def test_ui_fix():
        """Test that UI updates work correctly"""
        print("Testing UI fix...")
        
        # Create the main window
        root = tk.Tk()
        
        # Create the app instance
        app = OptimizedLiveGraphicsGenerator(root)
        
        # Set a test event ID
        app.event_id.set("test")
        
        print("App created successfully")
        print("Status before connection:", app.status_label.cget("text"))
        
        # Test the connection
        def connect_test():
            try:
                print("Starting connection test...")
                app.connect()
                
                # Wait for connection
                time.sleep(3)
                
                # Check status
                status = app.status_label.cget("text")
                button = app.connect_btn.cget("text")
                
                print(f"Status after connection: {status}")
                print(f"Button after connection: {button}")
                
                if "[SUCCESS] Connected via Socket.IO" in status:
                    print("SUCCESS: UI shows Socket.IO connection!")
                elif "[SUCCESS] Connected via API" in status:
                    print("SUCCESS: UI shows API connection (fallback)!")
                else:
                    print(f"WARNING: Unexpected status: {status}")
                
                # Test disconnect
                print("Testing disconnect...")
                app.disconnect()
                time.sleep(1)
                
                disconnect_status = app.status_label.cget("text")
                disconnect_button = app.connect_btn.cget("text")
                
                print(f"Status after disconnect: {disconnect_status}")
                print(f"Button after disconnect: {disconnect_button}")
                
                if "[ERROR] Disconnected" in disconnect_status:
                    print("SUCCESS: UI shows disconnected state!")
                else:
                    print(f"WARNING: Unexpected disconnect status: {disconnect_status}")
                
            except Exception as e:
                print(f"ERROR: Test failed: {e}")
            finally:
                root.quit()
        
        # Run the test in a separate thread
        test_thread = threading.Thread(target=connect_test)
        test_thread.daemon = True
        test_thread.start()
        
        # Start the tkinter main loop
        root.mainloop()
        
        print("UI test completed")
    
    if __name__ == "__main__":
        test_ui_fix()
        
except ImportError as e:
    print(f"ERROR: Import error: {e}")
    print("Make sure you're in the correct directory and all dependencies are installed")
except Exception as e:
    print(f"ERROR: {e}")
