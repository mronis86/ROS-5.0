#!/usr/bin/env python3
"""
Python OSC GUI Application
Standalone OSC control interface that works independently of the browser.
"""

import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import threading
import time
import json
import requests
from datetime import datetime
import sys
import os

# Supabase configuration - using the same credentials as the TypeScript service
SUPABASE_URL = 'https://huqijhevmtgardkyeowa.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk'

try:
    from supabase import create_client, Client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    SUPABASE_AVAILABLE = True
    print("✅ Supabase client initialized successfully")
except ImportError:
    SUPABASE_AVAILABLE = False
    print("❌ Warning: Supabase Python client not available. Install with: pip install supabase")
except Exception as e:
    SUPABASE_AVAILABLE = False
    print(f"❌ Warning: Failed to initialize Supabase client: {e}")

class PythonOSCGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Python OSC Control Panel")
        self.root.geometry("800x600")
        self.root.configure(bg='#1e293b')
        
        # OSC Configuration
        self.osc_host = "localhost"
        self.osc_port = 57121
        self.osc_connected = False
        
        # Event Configuration
        self.event_id = None
        self.schedule_data = []
        self.active_item_id = None
        self.active_timers = {}
        
        # Create the GUI
        self.create_gui()
        
        # Start the OSC server in a separate thread
        self.start_osc_server()
        
        # Load event data
        self.load_event_data()
    
    def create_gui(self):
        """Create the main GUI interface"""
        # Main frame
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(2, weight=1)
        
        # Title
        title_label = ttk.Label(main_frame, text="Python OSC Control Panel", 
                               font=('Arial', 16, 'bold'))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20))
        
        # OSC Configuration Frame
        osc_frame = ttk.LabelFrame(main_frame, text="OSC Configuration", padding="10")
        osc_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(0, 10))
        
        # Host and Port
        ttk.Label(osc_frame, text="Host:").grid(row=0, column=0, sticky=tk.W, padx=(0, 5))
        self.host_entry = ttk.Entry(osc_frame, width=15)
        self.host_entry.insert(0, self.osc_host)
        self.host_entry.grid(row=0, column=1, padx=(0, 20))
        
        ttk.Label(osc_frame, text="Port:").grid(row=0, column=2, sticky=tk.W, padx=(0, 5))
        self.port_entry = ttk.Entry(osc_frame, width=10)
        self.port_entry.insert(0, str(self.osc_port))
        self.port_entry.grid(row=0, column=3, padx=(0, 20))
        
        # Connection Status
        self.status_label = ttk.Label(osc_frame, text="Status: Disconnected", foreground="red")
        self.status_label.grid(row=0, column=4, sticky=tk.W)
        
        # Connect/Disconnect Button
        self.connect_btn = ttk.Button(osc_frame, text="Connect", command=self.toggle_connection)
        self.connect_btn.grid(row=0, column=5, padx=(10, 0))
        
        # Event Configuration Frame
        event_frame = ttk.LabelFrame(main_frame, text="Event Configuration", padding="10")
        event_frame.grid(row=2, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        event_frame.columnconfigure(1, weight=1)
        
        # Event ID
        ttk.Label(event_frame, text="Event ID:").grid(row=0, column=0, sticky=tk.W, padx=(0, 5))
        self.event_id_entry = ttk.Entry(event_frame, width=40)
        self.event_id_entry.grid(row=0, column=1, sticky=(tk.W, tk.E), padx=(0, 10))
        
        # Load Event Button
        load_btn = ttk.Button(event_frame, text="Load Event", command=self.load_event_data)
        load_btn.grid(row=0, column=2)
        
        # Schedule Display
        ttk.Label(event_frame, text="Schedule Items:").grid(row=1, column=0, sticky=(tk.W, tk.N), pady=(10, 0))
        
        # Schedule listbox with scrollbar
        list_frame = ttk.Frame(event_frame)
        list_frame.grid(row=1, column=1, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(10, 0))
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)
        
        self.schedule_listbox = tk.Listbox(list_frame, height=8)
        self.schedule_listbox.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.schedule_listbox.yview)
        scrollbar.grid(row=0, column=1, sticky=(tk.N, tk.S))
        self.schedule_listbox.configure(yscrollcommand=scrollbar.set)
        
        # OSC Controls Frame
        controls_frame = ttk.LabelFrame(main_frame, text="OSC Controls", padding="10")
        controls_frame.grid(row=3, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(0, 10))
        
        # Cue Controls
        cue_frame = ttk.Frame(controls_frame)
        cue_frame.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=(0, 10))
        
        ttk.Label(cue_frame, text="Cue Name:").grid(row=0, column=0, sticky=tk.W, padx=(0, 5))
        self.cue_entry = ttk.Entry(cue_frame, width=15)
        self.cue_entry.grid(row=0, column=1, padx=(0, 10))
        
        ttk.Button(cue_frame, text="Load Cue", command=self.load_cue).grid(row=0, column=2, padx=(0, 5))
        ttk.Button(cue_frame, text="Start Timer", command=self.start_timer).grid(row=0, column=3, padx=(0, 5))
        ttk.Button(cue_frame, text="Stop Timer", command=self.stop_timer).grid(row=0, column=4, padx=(0, 5))
        ttk.Button(cue_frame, text="Reset Timer", command=self.reset_timer).grid(row=0, column=5)
        
        # Sub-Timer Controls
        subtimer_frame = ttk.Frame(controls_frame)
        subtimer_frame.grid(row=1, column=0, sticky=(tk.W, tk.E))
        
        ttk.Label(subtimer_frame, text="Sub-Timer ID:").grid(row=0, column=0, sticky=tk.W, padx=(0, 5))
        self.subtimer_entry = ttk.Entry(subtimer_frame, width=15)
        self.subtimer_entry.grid(row=0, column=1, padx=(0, 10))
        
        ttk.Button(subtimer_frame, text="Start Sub-Timer", command=self.start_subtimer).grid(row=0, column=2, padx=(0, 5))
        ttk.Button(subtimer_frame, text="Stop Sub-Timer", command=self.stop_subtimer).grid(row=0, column=3)
        
        # Log Frame
        log_frame = ttk.LabelFrame(main_frame, text="OSC Message Log", padding="10")
        log_frame.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        
        # Log text area
        self.log_text = scrolledtext.ScrolledText(log_frame, height=8, width=80)
        self.log_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Clear log button
        ttk.Button(log_frame, text="Clear Log", command=self.clear_log).grid(row=1, column=0, pady=(5, 0))
        
        # Configure grid weights for resizing
        main_frame.rowconfigure(2, weight=1)
        main_frame.rowconfigure(4, weight=1)
    
    def start_osc_server(self):
        """Start the OSC server in a separate thread"""
        def run_osc_server():
            try:
                import socket
                import struct
                
                # Create UDP socket
                self.osc_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.osc_socket.bind((self.osc_host, self.osc_port))
                self.osc_socket.settimeout(1.0)  # 1 second timeout for non-blocking
                
                # Use thread-safe GUI updates
                self.root.after(0, lambda: setattr(self, 'osc_connected', True))
                self.root.after(0, self.update_connection_status)
                self.root.after(0, lambda: self.log_message("OSC Server started on {}:{}".format(self.osc_host, self.osc_port)))
                
                while self.osc_connected:
                    try:
                        data, addr = self.osc_socket.recvfrom(1024)
                        # Use thread-safe GUI update for OSC messages
                        self.root.after(0, lambda d=data, a=addr: self.handle_osc_message(d, a))
                    except socket.timeout:
                        continue
                    except Exception as e:
                        self.root.after(0, lambda: self.log_message("OSC Error: {}".format(str(e))))
                        break
                        
            except Exception as e:
                self.root.after(0, lambda: self.log_message("Failed to start OSC server: {}".format(str(e))))
                self.root.after(0, lambda: setattr(self, 'osc_connected', False))
                self.root.after(0, self.update_connection_status)
        
        # Start OSC server in background thread
        osc_thread = threading.Thread(target=run_osc_server, daemon=True)
        osc_thread.start()
    
    def handle_osc_message(self, data, addr):
        """Handle incoming OSC messages"""
        try:
            # Parse OSC message (basic implementation)
            # OSC format: address + types + arguments
            if len(data) < 4:
                return
                
            # Find the address (null-terminated string)
            address_end = data.find(b'\x00')
            if address_end == -1:
                return
                
            address = data[:address_end].decode('utf-8', errors='ignore')
            
            # Find the type tag (starts after address padding)
            type_start = ((address_end + 4) // 4) * 4  # Align to 4-byte boundary
            if type_start >= len(data):
                return
                
            type_tag = data[type_start:type_start+1]
            if type_tag == b',':
                # Has arguments
                args_start = type_start + 1
                self.log_message("OSC: {} from {}".format(address, addr[0]))
                
                # Handle different OSC commands
                if address.startswith("/cue/") and address.endswith("/load"):
                    # Extract cue ID from address like "/cue/1/load"
                    parts = address.split("/")
                    if len(parts) >= 3:
                        cue_id = parts[2]
                        self.load_cue_by_id(cue_id)
                elif address == "/timer/start":
                    self.start_timer()
                elif address == "/timer/stop":
                    self.stop_timer()
                elif address == "/timer/reset":
                    self.reset_timer()
                elif address.startswith("/subtimer/") and address.endswith("/start"):
                    parts = address.split("/")
                    if len(parts) >= 3:
                        subtimer_id = parts[2]
                        self.start_subtimer_by_id(subtimer_id)
                elif address.startswith("/subtimer/") and address.endswith("/stop"):
                    parts = address.split("/")
                    if len(parts) >= 3:
                        subtimer_id = parts[2]
                        self.stop_subtimer_by_id(subtimer_id)
            else:
                # No arguments
                self.log_message("OSC: {} (no args) from {}".format(address, addr[0]))
                    
        except Exception as e:
            self.log_message("Error handling OSC message: {}".format(str(e)))
    
    def toggle_connection(self):
        """Toggle OSC connection"""
        if self.osc_connected:
            self.osc_connected = False
            if hasattr(self, 'osc_socket'):
                self.osc_socket.close()
            self.log_message("OSC Server stopped")
        else:
            self.osc_host = self.host_entry.get()
            self.osc_port = int(self.port_entry.get())
            self.start_osc_server()
        
        self.update_connection_status()
    
    def update_connection_status(self):
        """Update the connection status display"""
        if self.osc_connected:
            self.status_label.config(text="Status: Connected", foreground="green")
            self.connect_btn.config(text="Disconnect")
        else:
            self.status_label.config(text="Status: Disconnected", foreground="red")
            self.connect_btn.config(text="Connect")
    
    def load_event_data(self):
        """Load event data from Supabase"""
        if not SUPABASE_AVAILABLE:
            self.log_message("Supabase not available. Cannot load event data.")
            return
        
        event_id = self.event_id_entry.get().strip()
        if not event_id:
            messagebox.showerror("Error", "Please enter an Event ID")
            return
        
        try:
            self.log_message("Loading event data for: {}".format(event_id))
            
            # Use direct HTTP request like Node.js server does
            import requests
            
            SUPABASE_URL = 'https://huqijhevmtgardkyeowa.supabase.co'
            SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk'
            
            headers = {
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Fetch run_of_show_data (simple query like Node.js server)
            url = f"{SUPABASE_URL}/rest/v1/run_of_show_data?event_id=eq.{event_id}"
            
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            if data and len(data) > 0:
                event_data = data[0]
                self.schedule_data = event_data.get('schedule_items', [])
                self.event_id = event_id
                
                # Update schedule display
                self.update_schedule_display()
                self.log_message("Loaded {} schedule items".format(len(self.schedule_data)))
            else:
                self.log_message("No event found with ID: {}".format(event_id))
                
        except Exception as e:
            self.log_message("Error loading event data: {}".format(str(e)))
            messagebox.showerror("Error", "Failed to load event data: {}".format(str(e)))
    
    def update_schedule_display(self):
        """Update the schedule listbox"""
        self.schedule_listbox.delete(0, tk.END)
        
        for i, item in enumerate(self.schedule_data):
            display_text = "#{}: {}".format(i + 1, item.get('segmentName', 'Untitled'))
            if item.get('customFields', {}).get('cue'):
                display_text += " [{}]".format(item['customFields']['cue'])
            
            self.schedule_listbox.insert(tk.END, display_text)
    
    def load_cue(self):
        """Load a cue by name"""
        cue_name = self.cue_entry.get().strip()
        if not cue_name:
            messagebox.showerror("Error", "Please enter a cue name")
            return
        
        self.load_cue_by_id(cue_name)
    
    def load_cue_by_id(self, cue_id):
        """Load a cue by ID"""
        try:
            # Find the item in schedule by cue ID
            item = None
            for i, schedule_item in enumerate(self.schedule_data):
                if (schedule_item.get('customFields', {}).get('cue') == cue_id or 
                    schedule_item.get('customFields', {}).get('cue') == 'CUE {}'.format(cue_id) or
                    schedule_item.get('customFields', {}).get('cue') == 'CUE{}'.format(cue_id)):
                    item = schedule_item
                    break
            
            if item:
                self.active_item_id = item['id']
                self.log_message("Loaded cue: {} (Item ID: {})".format(cue_id, self.active_item_id))
                
                # Update Supabase if available
                if SUPABASE_AVAILABLE:
                    self.update_supabase_timer_state()
            else:
                self.log_message("Cue not found: {}".format(cue_id))
                
        except Exception as e:
            self.log_message("Error loading cue: {}".format(str(e)))
    
    def start_timer(self):
        """Start the main timer"""
        if not self.active_item_id:
            messagebox.showwarning("Warning", "No cue loaded. Please load a cue first.")
            return
        
        try:
            self.active_timers[self.active_item_id] = True
            self.log_message("Started timer for item: {}".format(self.active_item_id))
            
            # Update Supabase if available
            if SUPABASE_AVAILABLE:
                self.update_supabase_timer_state()
                
        except Exception as e:
            self.log_message("Error starting timer: {}".format(str(e)))
    
    def stop_timer(self):
        """Stop the main timer"""
        if not self.active_item_id:
            messagebox.showwarning("Warning", "No cue loaded. Please load a cue first.")
            return
        
        try:
            if self.active_item_id in self.active_timers:
                del self.active_timers[self.active_item_id]
                self.log_message("Stopped timer for item: {}".format(self.active_item_id))
                
                # Update Supabase if available
                if SUPABASE_AVAILABLE:
                    self.update_supabase_timer_state()
            else:
                self.log_message("No active timer for item: {}".format(self.active_item_id))
                
        except Exception as e:
            self.log_message("Error stopping timer: {}".format(str(e)))
    
    def reset_timer(self):
        """Reset all timers"""
        try:
            self.active_timers.clear()
            self.active_item_id = None
            self.log_message("Reset all timers")
            
            # Update Supabase if available
            if SUPABASE_AVAILABLE:
                self.update_supabase_timer_state()
                
        except Exception as e:
            self.log_message("Error resetting timers: {}".format(str(e)))
    
    def start_subtimer(self):
        """Start a sub-timer"""
        subtimer_id = self.subtimer_entry.get().strip()
        if not subtimer_id:
            messagebox.showerror("Error", "Please enter a sub-timer ID")
            return
        
        self.start_subtimer_by_id(subtimer_id)
    
    def start_subtimer_by_id(self, subtimer_id):
        """Start a sub-timer by ID"""
        try:
            # Find indented items (sub-cues) by ID
            item = None
            for schedule_item in self.schedule_data:
                if (schedule_item.get('isIndented', False) and 
                    (schedule_item.get('id') == subtimer_id or 
                     schedule_item.get('timerId') == subtimer_id)):
                    item = schedule_item
                    break
            
            if item:
                self.active_timers[item['id']] = True
                self.log_message("Started sub-timer: {} (Item ID: {})".format(subtimer_id, item['id']))
                
                # Update Supabase if available
                if SUPABASE_AVAILABLE:
                    self.update_supabase_timer_state()
            else:
                self.log_message("Sub-timer not found: {}".format(subtimer_id))
                
        except Exception as e:
            self.log_message("Error starting sub-timer: {}".format(str(e)))
    
    def stop_subtimer(self):
        """Stop a sub-timer"""
        subtimer_id = self.subtimer_entry.get().strip()
        if not subtimer_id:
            messagebox.showerror("Error", "Please enter a sub-timer ID")
            return
        
        self.stop_subtimer_by_id(subtimer_id)
    
    def stop_subtimer_by_id(self, subtimer_id):
        """Stop a sub-timer by ID"""
        try:
            # Find indented items (sub-cues) by ID
            item = None
            for schedule_item in self.schedule_data:
                if (schedule_item.get('isIndented', False) and 
                    (schedule_item.get('id') == subtimer_id or 
                     schedule_item.get('timerId') == subtimer_id)):
                    item = schedule_item
                    break
            
            if item and item['id'] in self.active_timers:
                del self.active_timers[item['id']]
                self.log_message("Stopped sub-timer: {} (Item ID: {})".format(subtimer_id, item['id']))
                
                # Update Supabase if available
                if SUPABASE_AVAILABLE:
                    self.update_supabase_timer_state()
            else:
                self.log_message("Sub-timer not found or not active: {}".format(subtimer_id))
                
        except Exception as e:
            self.log_message("Error stopping sub-timer: {}".format(str(e)))
    
    def update_supabase_timer_state(self):
        """Update timer state in Supabase"""
        # Note: This Python OSC GUI is read-only for now
        # It can load and display data, but doesn't update the database
        # For database updates, use the browser-based OSC modal or Node.js server
        self.log_message("Timer state updated locally (database updates not implemented)")
    
    def log_message(self, message):
        """Add a message to the log"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = "[{}] {}\n".format(timestamp, message)
        
        self.log_text.insert(tk.END, log_entry)
        self.log_text.see(tk.END)
        
        # Also print to console
        print(log_entry.strip())
    
    def clear_log(self):
        """Clear the log"""
        self.log_text.delete(1.0, tk.END)
    
    def on_closing(self):
        """Handle application closing"""
        if self.osc_connected:
            self.osc_connected = False
            if hasattr(self, 'osc_socket'):
                self.osc_socket.close()
        
        self.root.destroy()

def main():
    """Main function to run the application"""
    root = tk.Tk()
    app = PythonOSCGUI(root)
    
    # Handle window closing
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    
    # Start the GUI
    root.mainloop()

if __name__ == "__main__":
    main()
