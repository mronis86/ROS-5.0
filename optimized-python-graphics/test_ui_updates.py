#!/usr/bin/env python3
"""
Test UI updates in the graphics generator
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
    
    def test_ui_updates():
        """Test that UI updates work correctly"""
        print("Testing UI updates...")
        
        # Create a minimal tkinter root (required for the app)
        root = tk.Tk()
        root.withdraw()  # Hide the window
        
        # Create the app instance
        app = OptimizedLiveGraphicsGenerator(root)
        
        # Set a test event ID
        app.event_id.set("test")
        
        print("App created successfully")
        
        # Test the connection process
        def connect_and_test():
            try:
                print("Starting connection test...")
                app.connect()
                
                # Wait a bit for Socket.IO to connect
                time.sleep(3)
                
                # Check the status
                current_status = app.status_label.cget("text")
                current_button = app.connect_btn.cget("text")
                
                print(f"Status: {current_status}")
                print(f"Button: {current_button}")
                
                if "[SUCCESS] Connected via Socket.IO" in current_status:
                    print("SUCCESS: UI shows Socket.IO connection")
                elif "[SUCCESS] Connected via API" in current_status:
                    print("SUCCESS: UI shows API connection (fallback)")
                else:
                    print(f"WARNING: Unexpected status: {current_status}")
                
                # Test disconnect
                print("Testing disconnect...")
                app.disconnect()
                time.sleep(1)
                
                disconnect_status = app.status_label.cget("text")
                disconnect_button = app.connect_btn.cget("text")
                
                print(f"Disconnect Status: {disconnect_status}")
                print(f"Disconnect Button: {disconnect_button}")
                
                if "[ERROR] Disconnected" in disconnect_status:
                    print("SUCCESS: UI shows disconnected state")
                else:
                    print(f"WARNING: Unexpected disconnect status: {disconnect_status}")
                
            except Exception as e:
                print(f"ERROR: Connection test failed: {e}")
            finally:
                root.quit()
        
        # Run the test in a separate thread
        test_thread = threading.Thread(target=connect_and_test)
        test_thread.daemon = True
        test_thread.start()
        
        # Start the tkinter main loop
        root.mainloop()
        
        print("UI test completed")
    
    if __name__ == "__main__":
        test_ui_updates()
        
except ImportError as e:
    print(f"ERROR: Import error: {e}")
    print("Make sure you're in the correct directory and all dependencies are installed")
except Exception as e:
    print(f"ERROR: {e}")
