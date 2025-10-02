#!/usr/bin/env python3
"""
Minimal working version of the graphics generator
"""

import tkinter as tk
from tkinter import ttk, messagebox
import requests
import socketio
import time
import threading

class MinimalGraphicsGenerator:
    def __init__(self, root):
        self.root = root
        self.root.title("Minimal Graphics Generator - Socket.IO Test")
        self.root.geometry("600x400")
        
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
        title_label = ttk.Label(main_frame, text="Minimal Graphics Generator", 
                               font=('Arial', 16, 'bold'))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20))
        
        # Event ID input
        ttk.Label(main_frame, text="Event ID:").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.event_id = tk.StringVar(value="test")
        event_entry = ttk.Entry(main_frame, textvariable=self.event_id, width=30)
        event_entry.grid(row=1, column=1, sticky=(tk.W, tk.E), pady=5)
        
        # Connection button
        self.connect_btn = ttk.Button(main_frame, text="Connect", command=self.toggle_connection)
        self.connect_btn.grid(row=2, column=0, columnspan=2, pady=10)
        
        # Status
        self.status_label = ttk.Label(main_frame, text="Disconnected", foreground='red')
        self.status_label.grid(row=3, column=0, columnspan=2, pady=5)
        
        # Log area
        log_frame = ttk.LabelFrame(main_frame, text="Log", padding="10")
        log_frame.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=10)
        
        self.log_text = tk.Text(log_frame, height=15, width=70)
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
        """Add message to log"""
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()
    
    def update_status(self, text, color='black'):
        """Update status label"""
        self.status_label.config(text=text, foreground=color)
        self.root.update_idletasks()
    
    def toggle_connection(self):
        if not self.is_connected:
            self.connect()
        else:
            self.disconnect()
    
    def connect(self):
        """Connect to server"""
        try:
            self.log_message("Starting connection...")
            self.update_status("Connecting...", 'orange')
            
            # Test API connection
            self.log_message("Testing API connection...")
            response = requests.get(f"{self.api_base_url}/health", timeout=10)
            if response.status_code == 200:
                self.log_message("SUCCESS: API connection successful")
            else:
                raise Exception(f"API returned status: {response.status_code}")
            
            # Test Socket.IO connection
            self.log_message("Testing Socket.IO connection...")
            self.sio = socketio.Client()
            
            @self.sio.event
            def connect():
                self.log_message("SUCCESS: Socket.IO connected")
                self.update_status("Connected via Socket.IO", 'green')
                self.connect_btn.config(text="Disconnect")
                self.is_connected = True
            
            @self.sio.event
            def disconnect():
                self.log_message("Socket.IO disconnected")
                self.update_status("Disconnected", 'red')
                self.connect_btn.config(text="Connect")
                self.is_connected = False
            
            @self.sio.event
            def connect_error(data):
                self.log_message(f"ERROR: Socket.IO connection error: {data}")
                self.update_status("Connection failed", 'red')
            
            # Connect
            self.sio.connect(self.api_base_url)
            
            # Wait for connection
            max_wait = 5
            wait_time = 0
            while wait_time < max_wait:
                if self.sio.connected:
                    self.log_message("SUCCESS: Socket.IO connection confirmed")
                    break
                time.sleep(0.5)
                wait_time += 0.5
            else:
                raise Exception("Socket.IO connection timeout")
            
        except Exception as e:
            self.log_message(f"ERROR: Connection failed: {str(e)}")
            self.update_status("Connection failed", 'red')
            if self.sio:
                try:
                    self.sio.disconnect()
                except:
                    pass
                self.sio = None
    
    def disconnect(self):
        """Disconnect from server"""
        if self.sio:
            self.sio.disconnect()
            self.sio = None
        self.is_connected = False
        self.connect_btn.config(text="Connect")
        self.update_status("Disconnected", 'red')
        self.log_message("Disconnected from server")

def main():
    root = tk.Tk()
    app = MinimalGraphicsGenerator(root)
    root.mainloop()

if __name__ == "__main__":
    main()
