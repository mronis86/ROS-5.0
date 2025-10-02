#!/usr/bin/env python3
"""
Debug version of the graphics generator
This will help us see exactly what's happening with the connection
"""

import tkinter as tk
from tkinter import ttk, messagebox
import requests
import socketio
import threading
import time

class DebugGraphicsGenerator:
    def __init__(self, root):
        self.root = root
        self.root.title("Debug Graphics Generator")
        self.root.geometry("800x600")
        
        # API Configuration
        self.api_base_url = 'https://ros-50-production.up.railway.app'
        self.sio = None
        self.is_connected = False
        
        self.setup_ui()
    
    def setup_ui(self):
        # Main frame
        main_frame = ttk.Frame(self.root, padding="20")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Title
        title_label = ttk.Label(main_frame, text="Debug Graphics Generator", 
                               font=('Arial', 16, 'bold'))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20))
        
        # Event ID input
        ttk.Label(main_frame, text="Event ID:").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.event_id = tk.StringVar(value="test")
        event_entry = ttk.Entry(main_frame, textvariable=self.event_id, width=30)
        event_entry.grid(row=1, column=1, sticky=(tk.W, tk.E), pady=5)
        
        # Connection button
        self.connect_btn = ttk.Button(main_frame, text="🔌 Connect", command=self.toggle_connection)
        self.connect_btn.grid(row=2, column=0, columnspan=2, pady=10)
        
        # Status
        self.status_label = ttk.Label(main_frame, text="❌ Disconnected", foreground='red')
        self.status_label.grid(row=3, column=0, columnspan=2, pady=5)
        
        # Log area
        log_frame = ttk.LabelFrame(main_frame, text="Debug Log", padding="10")
        log_frame.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=10)
        
        self.log_text = tk.Text(log_frame, height=20, width=80)
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        
        self.log_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        scrollbar.grid(row=0, column=1, sticky=(tk.N, tk.S))
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(4, weight=1)
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
    
    def log_message(self, message):
        """Add message to debug log"""
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()
    
    def toggle_connection(self):
        if not self.is_connected:
            self.connect()
        else:
            self.disconnect()
    
    def connect(self):
        """Test connection step by step"""
        self.log_message("=== STARTING CONNECTION TEST ===")
        
        try:
            # Step 1: Test API health
            self.log_message("Step 1: Testing API health check...")
            health_url = f"{self.api_base_url}/health"
            response = requests.get(health_url, timeout=10)
            self.log_message(f"Health check response: {response.status_code}")
            
            if response.status_code == 200:
                self.log_message("✅ API health check successful")
            else:
                self.log_message(f"⚠️ API health check returned: {response.status_code}")
            
            # Step 2: Test specific endpoint
            self.log_message("Step 2: Testing run-of-show endpoint...")
            url = f"{self.api_base_url}/api/run-of-show-data/{self.event_id.get()}"
            response = requests.get(url, timeout=10)
            self.log_message(f"Run-of-show response: {response.status_code}")
            
            if response.status_code == 200:
                self.log_message("✅ Run-of-show endpoint successful")
            else:
                self.log_message(f"⚠️ Run-of-show endpoint returned: {response.status_code}")
            
            # Step 3: Test Socket.IO connection
            self.log_message("Step 3: Testing Socket.IO connection...")
            self.test_socketio()
            
        except Exception as e:
            self.log_message(f"❌ Connection test failed: {str(e)}")
            self.status_label.config(text="❌ Connection Failed", foreground='red')
    
    def test_socketio(self):
        """Test Socket.IO connection with detailed logging"""
        try:
            self.log_message("Creating Socket.IO client...")
            self.sio = socketio.Client()
            
            # Define event handlers with detailed logging
            @self.sio.event
            def connect():
                self.log_message("✅ Socket.IO connected successfully!")
                self.is_connected = True
                self.connect_btn.config(text="🔌 Disconnect")
                self.status_label.config(text="✅ Connected", foreground='green')
                # Join the event room
                self.sio.emit('join_event', {'eventId': self.event_id.get()})
                self.log_message("Sent join_event message")
            
            @self.sio.event
            def disconnect():
                self.log_message("🔌 Socket.IO disconnected")
                self.is_connected = False
                self.connect_btn.config(text="🔌 Connect")
                self.status_label.config(text="❌ Disconnected", foreground='red')
            
            @self.sio.event
            def update(data):
                self.log_message(f"📡 Received update: {data}")
            
            @self.sio.event
            def connect_error(data):
                self.log_message(f"❌ Socket.IO connection error: {data}")
                self.status_label.config(text="❌ Socket.IO Error", foreground='red')
            
            # Try to connect
            self.log_message(f"Attempting to connect to: {self.api_base_url}")
            self.sio.connect(self.api_base_url)
            self.log_message("Socket.IO connect() called")
            
            # Wait a bit to see if connection succeeds
            time.sleep(2)
            
            if self.sio.connected:
                self.log_message("✅ Socket.IO connection confirmed!")
            else:
                self.log_message("⚠️ Socket.IO connection not confirmed")
                
        except Exception as e:
            self.log_message(f"❌ Socket.IO test failed: {str(e)}")
            self.status_label.config(text="❌ Socket.IO Failed", foreground='red')
    
    def disconnect(self):
        """Disconnect from server"""
        if self.sio:
            self.sio.disconnect()
            self.sio = None
        self.is_connected = False
        self.connect_btn.config(text="🔌 Connect")
        self.status_label.config(text="❌ Disconnected", foreground='red')
        self.log_message("=== DISCONNECTED ===")

def main():
    root = tk.Tk()
    app = DebugGraphicsGenerator(root)
    root.mainloop()

if __name__ == "__main__":
    main()
