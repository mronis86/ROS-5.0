#!/usr/bin/env python3
"""
Fixed Optimized Live Graphics Generator
Based on the working minimal version with full functionality
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import requests
import socketio
import time
import threading
import json
import csv
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import queue

class FixedGraphicsGenerator:
    def __init__(self, root):
        self.root = root
        self.root.title("Fixed Optimized Live Graphics Generator - Socket.IO + Neon")
        self.root.geometry("1000x750")  # Compact height
        
        # API Configuration
        self.api_base_url = 'https://ros-50-production.up.railway.app'
        self.sio = None
        self.is_connected = False
        self.is_running = False
        
        # Data storage
        self.schedule_data = None
        self.last_update = None
        self.message_queue = queue.Queue()
        self.update_thread = None
        
        # Disconnect timer
        self.disconnect_timer = None
        self.disconnect_duration = ""
        
        self.setup_ui()
    
    def setup_ui(self):
        # Main frame with less padding
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Title - more compact
        title_label = ttk.Label(main_frame, text="Live Graphics Generator - CSV", 
                               font=('Arial', 14, 'bold'))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 5))
        
        # Server Selection + Connection Status - COMBINED
        top_frame = ttk.Frame(main_frame)
        top_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(0, 5))
        
        # Server selection on left
        server_frame = ttk.LabelFrame(top_frame, text="🌐 Server", padding="5")
        server_frame.pack(side='left', fill='both', expand=True, padx=(0, 5))
        
        self.server_mode = tk.StringVar(value='railway')
        ttk.Radiobutton(server_frame, text="🚂 Railway", variable=self.server_mode, 
                       value='railway', command=self.switch_server).pack(anchor='w')
        ttk.Radiobutton(server_frame, text="🏠 Local", variable=self.server_mode, 
                       value='local', command=self.switch_server).pack(anchor='w')
        
        # Connection status on right
        status_frame = ttk.LabelFrame(top_frame, text="Status", padding="5")
        status_frame.pack(side='left', fill='both', expand=True)
        
        self.status_label = ttk.Label(status_frame, text="Disconnected", foreground='red')
        self.status_label.pack(anchor='w')
        
        self.api_label = ttk.Label(status_frame, text=f"API: {self.api_base_url}", 
                             font=('Arial', 7), foreground='gray')
        self.api_label.pack(anchor='w')
        
        # Configuration - more compact
        config_frame = ttk.LabelFrame(main_frame, text="Configuration", padding="5")
        config_frame.grid(row=2, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(0, 5))
        
        # Event ID
        ttk.Label(config_frame, text="Event ID:").grid(row=0, column=0, sticky=tk.W, padx=5)
        self.event_id = tk.StringVar()
        ttk.Entry(config_frame, textvariable=self.event_id, width=40).grid(row=0, column=1, sticky=(tk.W, tk.E), padx=5)
        
        # Output folder
        ttk.Label(config_frame, text="Output:").grid(row=1, column=0, sticky=tk.W, padx=5)
        folder_frame = ttk.Frame(config_frame)
        folder_frame.grid(row=1, column=1, sticky=(tk.W, tk.E), padx=5)
        
        self.output_folder = tk.StringVar()
        ttk.Entry(folder_frame, textvariable=self.output_folder, width=30).pack(side='left', fill='x', expand=True)
        ttk.Button(folder_frame, text="Browse", command=self.browse_folder).pack(side='left', padx=(5, 0))
        
        config_frame.columnconfigure(1, weight=1)
        
        # Data type checkboxes - more compact
        file_types_frame = ttk.LabelFrame(main_frame, text="CSV Files to Generate", padding="5")
        file_types_frame.grid(row=3, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(0, 5))
        
        self.gen_lower_thirds = tk.BooleanVar(value=True)
        self.gen_schedule = tk.BooleanVar(value=True)
        self.gen_custom = tk.BooleanVar(value=False)
        
        checkbox_container = ttk.Frame(file_types_frame)
        checkbox_container.pack(fill='x')
        
        ttk.Checkbutton(checkbox_container, text="Lower Thirds", variable=self.gen_lower_thirds).pack(side='left', padx=10)
        ttk.Checkbutton(checkbox_container, text="Schedule", variable=self.gen_schedule).pack(side='left', padx=10)
        ttk.Checkbutton(checkbox_container, text="Custom Columns", variable=self.gen_custom).pack(side='left', padx=10)
        
        # Control buttons - more compact
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=4, column=0, columnspan=2, pady=5)
        
        self.connect_btn = ttk.Button(button_frame, text="Connect", command=self.toggle_connection)
        self.connect_btn.pack(side='left', padx=3)
        
        self.generate_btn = ttk.Button(button_frame, text="Generate CSV Files", 
                                      command=self.generate_files, state='disabled')
        self.generate_btn.pack(side='left', padx=3)
        
        ttk.Button(button_frame, text="Refresh Data", 
                   command=self.refresh_data).pack(side='left', padx=3)
        
        ttk.Button(button_frame, text="Open Folder", 
                   command=self.open_folder).pack(side='left', padx=3)
        
        # Live data display - compact
        data_frame = ttk.LabelFrame(main_frame, text="Live Data Preview", padding="5")
        data_frame.grid(row=5, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 5))
        
        self.data_text = tk.Text(data_frame, height=10, width=80)
        data_scrollbar = ttk.Scrollbar(data_frame, orient="vertical", command=self.data_text.yview)
        self.data_text.configure(yscrollcommand=data_scrollbar.set)
        
        self.data_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        data_scrollbar.grid(row=0, column=1, sticky=(tk.N, tk.S))
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(5, weight=1)
        data_frame.columnconfigure(0, weight=1)
        data_frame.rowconfigure(0, weight=1)
    
    def browse_folder(self):
        """Browse for output folder"""
        folder = filedialog.askdirectory()
        if folder:
            self.output_folder.set(folder)
    
    def log_message(self, message):
        """Add message to log"""
        timestamp = time.strftime("%H:%M:%S")
        self.data_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.data_text.see(tk.END)
        self.root.update_idletasks()
    
    def update_status(self, text, color='black'):
        """Update status label"""
        self.status_label.config(text=text, foreground=color)
        self.root.update_idletasks()
    
    def switch_server(self):
        """Switch between Railway and Local Server"""
        try:
            mode = self.server_mode.get()
            
            # Disconnect if currently connected
            was_connected = self.is_connected
            if was_connected:
                self.disconnect()
            
            # Update API URL
            if mode == 'railway':
                self.api_base_url = 'https://ros-50-production.up.railway.app'
            else:  # local
                self.api_base_url = 'http://localhost:3002'
            
            # Update API label
            self.api_label.config(text=f"API: {self.api_base_url}")
            
            # Log the change
            server_name = "Railway" if mode == 'railway' else "Local Server"
            self.log_message(f"Switched to {server_name}: {self.api_base_url}")
            messagebox.showinfo("Server Changed", f"Now using {server_name}\n{self.api_base_url}\n\nClick 'Connect' to reconnect.")
            
            # Update connection status display
            self.update_status("Disconnected - Server changed", 'orange')
            
        except Exception as e:
            self.log_message(f"Error switching server: {e}")
            messagebox.showerror("Error", f"Failed to switch server: {e}")
    
    def toggle_connection(self):
        if not self.is_connected:
            self.connect()
        else:
            self.disconnect()
    
    def connect(self):
        """Connect to server"""
        if not self.event_id.get():
            messagebox.showerror("Error", "Please enter an Event ID")
            return
        
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
                # Join the event room
                self.sio.emit('join_event', {'eventId': self.event_id.get()})
                self.log_message("Joined event room")
                # Show disconnect timer dialog
                self.root.after(500, self.show_disconnect_timer_dialog)
            
            @self.sio.event
            def disconnect():
                self.log_message("Socket.IO disconnected")
                self.update_status("Disconnected", 'red')
                self.connect_btn.config(text="Connect")
                self.is_connected = False
            
            @self.sio.event
            def update(data):
                """Handle real-time updates"""
                try:
                    self.log_message("Received real-time update")
                    self.message_queue.put(data)
                except Exception as e:
                    self.log_message(f"ERROR: Update processing error: {str(e)}")
            
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
            
            # Start data update thread
            self.start_update_thread()
            
            # Enable generate button
            self.generate_btn.config(state='normal')
            
        except Exception as e:
            self.log_message(f"ERROR: Connection failed: {str(e)}")
            self.update_status("Connection failed", 'red')
            if self.sio:
                try:
                    self.sio.disconnect()
                except:
                    pass
                self.sio = None
    
    def show_disconnect_timer_dialog(self):
        """Show dialog to select auto-disconnect timer"""
        dialog = tk.Toplevel(self.root)
        dialog.title("⏰ Auto-Disconnect Timer")
        dialog.geometry("500x400")
        dialog.transient(self.root)
        dialog.grab_set()
        
        # Center the dialog
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() // 2) - (500 // 2)
        y = (dialog.winfo_screenheight() // 2) - (400 // 2)
        dialog.geometry(f"+{x}+{y}")
        
        # Title
        ttk.Label(dialog, text="⏰ Auto-Disconnect Timer", 
                 font=('Arial', 16, 'bold')).pack(pady=(20, 10))
        ttk.Label(dialog, text="How long should this connection stay active?",
                 foreground='gray').pack(pady=(0, 20))
        
        # Time selector frame
        time_frame = ttk.Frame(dialog)
        time_frame.pack(pady=20)
        
        # Hours
        hours_frame = ttk.Frame(time_frame)
        hours_frame.pack(side='left', padx=10)
        ttk.Label(hours_frame, text="Hours").pack()
        hours_var = tk.IntVar(value=2)
        hours_spin = ttk.Spinbox(hours_frame, from_=0, to=24, textvariable=hours_var, 
                                width=10, font=('Arial', 14))
        hours_spin.pack()
        
        # Separator
        ttk.Label(time_frame, text=":", font=('Arial', 18)).pack(side='left', padx=5)
        
        # Minutes
        mins_frame = ttk.Frame(time_frame)
        mins_frame.pack(side='left', padx=10)
        ttk.Label(mins_frame, text="Minutes").pack()
        mins_var = tk.IntVar(value=0)
        mins_spin = ttk.Spinbox(mins_frame, from_=0, to=55, increment=5, 
                               textvariable=mins_var, width=10, font=('Arial', 14))
        mins_spin.pack()
        
        # Buttons
        btn_frame = ttk.Frame(dialog)
        btn_frame.pack(pady=20)
        
        def confirm():
            hours = hours_var.get()
            mins = mins_var.get()
            total_minutes = (hours * 60) + mins
            
            if total_minutes == 0:
                messagebox.showwarning("Invalid Time", 
                    "Please select a time greater than 0, or use 'Never Disconnect'")
                return
            
            self.start_disconnect_timer(hours, mins)
            dialog.destroy()
        
        def never():
            self.log_message("⏰ Disconnect timer: Never (running indefinitely)")
            dialog.destroy()
        
        ttk.Button(btn_frame, text="✓ Confirm", command=confirm, 
                  width=15).pack(side='left', padx=5)
        ttk.Button(btn_frame, text="∞ Never Disconnect", command=never, 
                  width=20).pack(side='left', padx=5)
        
        # Warning
        ttk.Label(dialog, text="⚠️ 'Never' may increase database costs", 
                 foreground='orange', font=('Arial', 9)).pack(pady=10)
    
    def start_disconnect_timer(self, hours, minutes):
        """Start the auto-disconnect timer"""
        total_minutes = (hours * 60) + minutes
        ms = total_minutes * 60 * 1000
        
        time_text = ''
        if hours > 0:
            time_text += f"{hours}h "
        if minutes > 0:
            time_text += f"{minutes}m"
        
        self.disconnect_duration = time_text.strip()
        self.log_message(f"⏰ Disconnect timer started: {self.disconnect_duration}")
        
        # Schedule disconnect
        self.disconnect_timer = self.root.after(ms, self.on_timer_expired)
    
    def on_timer_expired(self):
        """Called when disconnect timer expires"""
        self.log_message(f"⏰ Auto-disconnect timer expired ({self.disconnect_duration})")
        
        # Disconnect
        if self.is_connected:
            self.disconnect()
        
        # Show notification
        self.show_disconnect_notification()
    
    def show_disconnect_notification(self):
        """Show notification when disconnected due to timer"""
        dialog = tk.Toplevel(self.root)
        dialog.title("🔌 Connection Closed")
        dialog.geometry("450x200")
        dialog.transient(self.root)
        dialog.grab_set()
        
        # Center the dialog
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() // 2) - (450 // 2)
        y = (dialog.winfo_screenheight() // 2) - (200 // 2)
        dialog.geometry(f"+{x}+{y}")
        
        # Message
        ttk.Label(dialog, text="🔌", font=('Arial', 48)).pack(pady=(20, 10))
        ttk.Label(dialog, text="Connection Closed", 
                 font=('Arial', 14, 'bold')).pack()
        ttk.Label(dialog, text=f"Auto-disconnected after {self.disconnect_duration}",
                 foreground='gray').pack(pady=5)
        
        # Reconnect button
        def reconnect():
            dialog.destroy()
            self.connect()
        
        ttk.Button(dialog, text="🔄 Reconnect", command=reconnect,
                  width=20).pack(pady=20)
    
    def disconnect(self):
        """Disconnect from server"""
        if self.sio:
            self.sio.disconnect()
            self.sio = None
        self.is_connected = False
        self.connect_btn.config(text="Connect")
        self.generate_btn.config(state='disabled')
        self.update_status("Disconnected", 'red')
        self.log_message("Disconnected from server")
        
        # Stop disconnect timer
        if self.disconnect_timer:
            self.root.after_cancel(self.disconnect_timer)
            self.disconnect_timer = None
        
        # Stop update thread
        if self.update_thread and self.update_thread.is_alive():
            self.update_thread.join(timeout=1)
    
    def start_update_thread(self):
        """Start thread to process Socket.IO messages and update data"""
        def update_loop():
            while self.is_connected:
                try:
                    # Process Socket.IO messages
                    while not self.message_queue.empty():
                        message = self.message_queue.get_nowait()
                        self.process_websocket_message(message)
                    
                    # Update data display
                    self.update_data_display()
                    
                    time.sleep(0.1)  # Small delay to prevent high CPU usage
                    
                except Exception as e:
                    self.log_message(f"ERROR: Update thread error: {str(e)}")
                    time.sleep(1)
        
        self.update_thread = threading.Thread(target=update_loop, daemon=True)
        self.update_thread.start()
    
    def process_websocket_message(self, message):
        """Process incoming Socket.IO messages"""
        try:
            if message.get('type') == 'runOfShowDataUpdated':
                self.log_message("Received real-time data update")
                self.schedule_data = message.get('data')
                self.last_update = datetime.now()
                # Auto-regenerate files if enabled and output folder is set
                if self.auto_regenerate.get() and self.output_folder.get() and self.schedule_data:
                    self.auto_regenerate_files()
            elif message.get('type') == 'timerUpdated':
                self.log_message("Received timer update")
            elif message.get('type') == 'activeTimersUpdated':
                self.log_message("Received active timers update")
        except Exception as e:
            self.log_message(f"ERROR: Message processing error: {str(e)}")
    
    def refresh_data(self):
        """Manually refresh data from API"""
        if not self.event_id.get():
            messagebox.showerror("Error", "Please enter an Event ID")
            return
        
        try:
            self.log_message("Refreshing data...")
            self.update_status("Refreshing data...", 'orange')
            url = f"{self.api_base_url}/api/run-of-show-data/{self.event_id.get()}"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            self.schedule_data = response.json()
            self.last_update = datetime.now()
            self.update_data_display()
            self.update_status("Data refreshed", 'green')
            self.log_message("SUCCESS: Data refreshed from API")
            
        except Exception as e:
            self.log_message(f"ERROR: Refresh failed: {str(e)}")
            self.update_status("Refresh failed", 'red')
    
    def update_data_display(self):
        """Update the data display in the UI"""
        if not self.schedule_data:
            return
        
        try:
            # Clear previous data
            self.data_text.delete(1.0, tk.END)
            
            # Display basic info
            self.data_text.insert(tk.END, f"Live Graphics Data\n")
            self.data_text.insert(tk.END, f"Event ID: {self.event_id.get()}\n")
            self.data_text.insert(tk.END, f"Last Update: {self.last_update.strftime('%H:%M:%S') if self.last_update else 'Never'}\n")
            self.data_text.insert(tk.END, f"Connection: {'Socket.IO' if self.is_connected else 'Disconnected'}\n\n")
            
            # Display schedule items
            if 'schedule_items' in self.schedule_data:
                items = self.schedule_data['schedule_items']
                self.data_text.insert(tk.END, f"Schedule Items ({len(items)} total):\n")
                
                for i, item in enumerate(items[:10]):  # Show first 10 items
                    self.data_text.insert(tk.END, f"  {i+1}. {item.get('segmentName', 'Unnamed')}\n")
                
                if len(items) > 10:
                    self.data_text.insert(tk.END, f"  ... and {len(items) - 10} more items\n")
            
            # Display custom columns
            if 'custom_columns' in self.schedule_data:
                columns = self.schedule_data['custom_columns']
                self.data_text.insert(tk.END, f"\nCustom Columns ({len(columns)} total):\n")
                for col in columns[:5]:  # Show first 5 columns
                    self.data_text.insert(tk.END, f"  - {col.get('name', 'Unnamed')}\n")
            
        except Exception as e:
            self.log_message(f"ERROR: Display update error: {str(e)}")
    
    def generate_files(self):
        """Generate CSV files based on selected data types"""
        if not self.output_folder.get():
            messagebox.showerror("Error", "Please select an output folder")
            return
        
        if not self.schedule_data:
            messagebox.showerror("Error", "No data available. Please refresh data first.")
            return
        
        self.log_message("Generating selected CSV files...")
        self.update_status("Generating files...", 'orange')
        
        success_count = 0
        error_count = 0
        
        # Generate CSV files based on selected data types
        if self.gen_schedule.get():
            try:
                self.generate_schedule_csv()
                success_count += 1
            except Exception as e:
                self.log_message(f"ERROR: Schedule CSV failed: {str(e)}")
                error_count += 1
        
        if self.gen_lower_thirds.get():
            try:
                self.generate_lower_thirds_csv()
                success_count += 1
            except Exception as e:
                self.log_message(f"ERROR: Lower Thirds CSV failed: {str(e)}")
                error_count += 1
        
        if self.gen_custom.get():
            try:
                self.generate_custom_columns_csv()
                success_count += 1
            except Exception as e:
                self.log_message(f"ERROR: Custom Columns CSV failed: {str(e)}")
                error_count += 1
        
        # Update status based on results
        if error_count == 0 and success_count > 0:
            self.update_status(f"CSV files generated successfully ({success_count} files)", 'green')
            self.log_message(f"SUCCESS: Generated {success_count} CSV file(s)")
        elif success_count > 0:
            self.update_status(f"Partial success ({success_count} succeeded, {error_count} failed)", 'orange')
            self.log_message(f"WARNING: {success_count} succeeded, {error_count} failed")
        else:
            self.update_status("No files generated", 'red')
            self.log_message("ERROR: All file generations failed or no files selected")
    
    def auto_regenerate_files(self):
        """Auto-regenerate files when data changes (low egress)"""
        try:
            self.log_message("Auto-regenerating selected CSV files due to data change...")
            
            # Generate only selected CSV files silently (no UI updates to avoid spam)
            if self.gen_schedule.get():
                try:
                    self.generate_schedule_csv()
                except Exception as e:
                    self.log_message(f"ERROR: Auto-regenerate Schedule CSV failed: {str(e)}")
            
            if self.gen_lower_thirds.get():
                try:
                    self.generate_lower_thirds_csv()
                except Exception as e:
                    self.log_message(f"ERROR: Auto-regenerate Lower Thirds CSV failed: {str(e)}")
            
            if self.gen_custom.get():
                try:
                    self.generate_custom_columns_csv()
                except Exception as e:
                    self.log_message(f"ERROR: Auto-regenerate Custom Columns CSV failed: {str(e)}")
            
            self.log_message("SUCCESS: Files auto-updated")
            
        except Exception as e:
            self.log_message(f"ERROR: Auto-regeneration failed: {str(e)}")
    
    def generate_schedule_xml(self):
        """Generate schedule XML file"""
        filename = os.path.join(self.output_folder.get(), "schedule.xml")
        
        root = ET.Element("schedule")
        root.set("event_id", self.event_id.get())
        root.set("generated_at", datetime.now().isoformat())
        
        if 'schedule_items' in self.schedule_data:
            for item in self.schedule_data['schedule_items']:
                item_elem = ET.SubElement(root, "item")
                item_elem.set("id", str(item.get('id', '')))
                item_elem.set("name", item.get('segmentName', ''))
                item_elem.set("start_time", item.get('startTime', ''))
                item_elem.set("duration", str(item.get('duration', 0)))
                
                # Add notes
                if item.get('notes'):
                    notes_elem = ET.SubElement(item_elem, "notes")
                    notes_elem.text = item.get('notes', '')
                
                # Add speakers
                if item.get('speakers'):
                    speakers_elem = ET.SubElement(item_elem, "speakers")
                    for speaker in item.get('speakers', []):
                        speaker_elem = ET.SubElement(speakers_elem, "speaker")
                        speaker_elem.text = speaker.get('name', '')
        
        tree = ET.ElementTree(root)
        tree.write(filename, encoding='utf-8', xml_declaration=True)
        
        self.log_message(f"SUCCESS: Generated {filename}")
    
    def generate_schedule_csv(self):
        """Generate schedule CSV file"""
        filename = os.path.join(self.output_folder.get(), "schedule.csv")
        
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['ID', 'Name', 'Start Time', 'Duration', 'Notes', 'Speakers'])
            
            if 'schedule_items' in self.schedule_data:
                for item in self.schedule_data['schedule_items']:
                    # Parse speakers - might be JSON string or list
                    speakers_data = item.get('speakers', [])
                    if isinstance(speakers_data, str):
                        try:
                            speakers_data = json.loads(speakers_data) if speakers_data else []
                        except:
                            speakers_data = []
                    
                    speakers = ', '.join([s.get('name', '') if isinstance(s, dict) else str(s) for s in speakers_data])
                    writer.writerow([
                        item.get('id', ''),
                        item.get('segmentName', ''),
                        item.get('startTime', ''),
                        item.get('duration', 0),
                        item.get('notes', ''),
                        speakers
                    ])
        
        self.log_message(f"SUCCESS: Generated {filename}")
    
    def generate_lower_thirds_xml(self):
        """Generate lower thirds XML file"""
        filename = os.path.join(self.output_folder.get(), "lower_thirds.xml")
        
        root = ET.Element("lower_thirds")
        root.set("event_id", self.event_id.get())
        root.set("generated_at", datetime.now().isoformat())
        
        if 'schedule_items' in self.schedule_data:
            for item in self.schedule_data['schedule_items']:
                speakers_data = item.get('speakers', [])
                
                # Parse speakers - might be JSON string or list
                if isinstance(speakers_data, str):
                    try:
                        speakers_data = json.loads(speakers_data) if speakers_data else []
                    except:
                        speakers_data = []
                
                if speakers_data:
                    for speaker in speakers_data:
                        if isinstance(speaker, dict):
                            speaker_elem = ET.SubElement(root, "speaker")
                            speaker_elem.set("name", speaker.get('name', ''))
                            speaker_elem.set("title", speaker.get('title', ''))
                            speaker_elem.set("segment", item.get('segmentName', ''))
        
        tree = ET.ElementTree(root)
        tree.write(filename, encoding='utf-8', xml_declaration=True)
        
        self.log_message(f"SUCCESS: Generated {filename}")
    
    def generate_lower_thirds_csv(self):
        """Generate lower thirds CSV file"""
        filename = os.path.join(self.output_folder.get(), "lower_thirds.csv")
        
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Name', 'Title', 'Segment'])
            
            if 'schedule_items' in self.schedule_data:
                for item in self.schedule_data['schedule_items']:
                    speakers_data = item.get('speakers', [])
                    
                    # Parse speakers - might be JSON string or list
                    if isinstance(speakers_data, str):
                        try:
                            speakers_data = json.loads(speakers_data) if speakers_data else []
                        except:
                            speakers_data = []
                    
                    if speakers_data:
                        for speaker in speakers_data:
                            if isinstance(speaker, dict):
                                writer.writerow([
                                    speaker.get('name', ''),
                                    speaker.get('title', ''),
                                    item.get('segmentName', '')
                                ])
        
        self.log_message(f"SUCCESS: Generated {filename}")
    
    def generate_custom_columns_xml(self):
        """Generate custom columns XML file"""
        filename = os.path.join(self.output_folder.get(), "custom_columns.xml")
        
        root = ET.Element("custom_columns")
        root.set("event_id", self.event_id.get())
        root.set("generated_at", datetime.now().isoformat())
        
        if 'custom_columns' in self.schedule_data:
            for col in self.schedule_data['custom_columns']:
                col_elem = ET.SubElement(root, "column")
                col_elem.set("name", col.get('name', ''))
                col_elem.set("type", col.get('type', ''))
                col_elem.set("required", str(col.get('required', False)))
        
        tree = ET.ElementTree(root)
        tree.write(filename, encoding='utf-8', xml_declaration=True)
        
        self.log_message(f"SUCCESS: Generated {filename}")
    
    def generate_custom_columns_csv(self):
        """Generate custom columns CSV file"""
        filename = os.path.join(self.output_folder.get(), "custom_columns.csv")
        
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Name', 'Type', 'Required'])
            
            if 'custom_columns' in self.schedule_data:
                for col in self.schedule_data['custom_columns']:
                    writer.writerow([
                        col.get('name', ''),
                        col.get('type', ''),
                        col.get('required', False)
                    ])
        
        self.log_message(f"SUCCESS: Generated {filename}")
    
    def open_folder(self):
        """Open output folder"""
        if self.output_folder.get():
            os.startfile(self.output_folder.get())
        else:
            messagebox.showwarning("Warning", "Please select an output folder first")

def main():
    root = tk.Tk()
    app = FixedGraphicsGenerator(root)
    root.mainloop()

if __name__ == "__main__":
    main()
