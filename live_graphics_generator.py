#!/usr/bin/env python3
"""
Live Graphics Generator
A desktop application that connects to Supabase and generates live graphics files
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import requests
import json
import csv
import os
import threading
import time
from datetime import datetime
import xml.etree.ElementTree as ET

class LiveGraphicsGenerator:
    def __init__(self, root):
        self.root = root
        self.root.title("Live Graphics Generator")
        self.root.geometry("800x600")
        
        # Supabase configuration
        self.supabase_url = "https://huqijhevmtgardkyeowa.supabase.co/rest/v1/run_of_show_data"
        self.supabase_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk"
        
        # Application state
        self.event_id = tk.StringVar()
        self.output_folder = tk.StringVar()
        self.is_running = False
        self.update_thread = None
        
        self.setup_ui()
        
    def setup_ui(self):
        # Main frame
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Event ID input
        ttk.Label(main_frame, text="Event ID:").grid(row=0, column=0, sticky=tk.W, pady=5)
        event_entry = ttk.Entry(main_frame, textvariable=self.event_id, width=50)
        event_entry.grid(row=0, column=1, sticky=(tk.W, tk.E), pady=5, padx=(10, 0))
        
        # Output folder selection
        ttk.Label(main_frame, text="Output Folder:").grid(row=1, column=0, sticky=tk.W, pady=5)
        folder_frame = ttk.Frame(main_frame)
        folder_frame.grid(row=1, column=1, sticky=(tk.W, tk.E), pady=5, padx=(10, 0))
        
        ttk.Entry(folder_frame, textvariable=self.output_folder, width=40).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(folder_frame, text="Browse", command=self.browse_folder).pack(side=tk.RIGHT, padx=(10, 0))
        
        # Control buttons
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=2, column=0, columnspan=2, pady=20)
        
        self.start_button = ttk.Button(button_frame, text="Start Live Updates", command=self.start_updates)
        self.start_button.pack(side=tk.LEFT, padx=5)
        
        self.stop_button = ttk.Button(button_frame, text="Stop Updates", command=self.stop_updates, state=tk.DISABLED)
        self.stop_button.pack(side=tk.LEFT, padx=5)
        
        self.test_button = ttk.Button(button_frame, text="Test Connection", command=self.test_connection)
        self.test_button.pack(side=tk.LEFT, padx=5)
        
        # Status and log
        ttk.Label(main_frame, text="Status:").grid(row=3, column=0, sticky=tk.W, pady=(20, 5))
        self.status_label = ttk.Label(main_frame, text="Ready", foreground="blue")
        self.status_label.grid(row=3, column=1, sticky=tk.W, pady=(20, 5), padx=(10, 0))
        
        # Log text area
        ttk.Label(main_frame, text="Log:").grid(row=4, column=0, sticky=(tk.W, tk.N), pady=5)
        
        log_frame = ttk.Frame(main_frame)
        log_frame.grid(row=4, column=1, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5, padx=(10, 0))
        
        self.log_text = tk.Text(log_frame, height=15, width=70)
        scrollbar = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        
        self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(4, weight=1)
        
    def browse_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.output_folder.set(folder)
            
    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()
        
    def test_connection(self):
        if not self.event_id.get():
            messagebox.showerror("Error", "Please enter an Event ID")
            return
            
        try:
            self.log_message("Testing connection...")
            response = requests.get(
                f"{self.supabase_url}?event_id=eq.{self.event_id.get()}",
                headers={
                    'apikey': self.supabase_key,
                    'Authorization': f'Bearer {self.supabase_key}'
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                if data:
                    self.log_message(f"✓ Connection successful! Found {len(data)} event(s)")
                    self.log_message(f"Event data: {json.dumps(data[0], indent=2)[:200]}...")
                else:
                    self.log_message("⚠ Connection successful but no data found for this Event ID")
            else:
                self.log_message(f"✗ Connection failed: {response.status_code}")
                
        except Exception as e:
            self.log_message(f"✗ Connection error: {str(e)}")
            
    def fetch_data(self):
        """Fetch data from Supabase"""
        try:
            response = requests.get(
                f"{self.supabase_url}?event_id=eq.{self.event_id.get()}",
                headers={
                    'apikey': self.supabase_key,
                    'Authorization': f'Bearer {self.supabase_key}'
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    return data[0]
            return None
            
        except Exception as e:
            self.log_message(f"Error fetching data: {str(e)}")
            return None
            
    def generate_lower_thirds_csv(self, data):
        """Generate lower thirds CSV"""
        if not data or 'schedule_items' not in data:
            return None
            
        schedule = data['schedule_items']
        csv_data = []
        
        # Headers
        headers = [
            'Row', 'Cue', 'Program', 'Segment Name',
            'Speaker 1 Name', 'Speaker 1 Title/Org', 'Speaker 1 Photo',
            'Speaker 2 Name', 'Speaker 2 Title/Org', 'Speaker 2 Photo',
            'Speaker 3 Name', 'Speaker 3 Title/Org', 'Speaker 3 Photo',
            'Speaker 4 Name', 'Speaker 4 Title/Org', 'Speaker 4 Photo',
            'Speaker 5 Name', 'Speaker 5 Title/Org', 'Speaker 5 Photo',
            'Speaker 6 Name', 'Speaker 6 Title/Org', 'Speaker 6 Photo',
            'Speaker 7 Name', 'Speaker 7 Title/Org', 'Speaker 7 Photo'
        ]
        csv_data.append(headers)
        
        # Process each schedule item
        for i, item in enumerate(schedule):
            row = [
                i + 1,
                item.get('customFields', {}).get('cue', ''),
                item.get('programType', ''),
                item.get('segmentName', '')
            ]
            
            # Initialize speaker slots
            speakers = [''] * 21  # 7 speakers × 3 fields each
            
            # Parse speakers if available
            if item.get('speakersText'):
                try:
                    speakers_data = json.loads(item['speakersText'])
                    for speaker in speakers_data:
                        slot = speaker.get('slot', 0)
                        if 1 <= slot <= 7:
                            base_idx = (slot - 1) * 3
                            speakers[base_idx] = speaker.get('fullName', '')
                            title = speaker.get('title', '')
                            org = speaker.get('org', '')
                            speakers[base_idx + 1] = f"{title}\n{org}" if title and org else title or org
                            speakers[base_idx + 2] = speaker.get('photoLink', '')
                except json.JSONDecodeError:
                    pass
                    
            row.extend(speakers)
            csv_data.append(row)
            
        return csv_data
        
    def generate_schedule_csv(self, data):
        """Generate schedule CSV"""
        if not data or 'schedule_items' not in data:
            return None
            
        schedule = data['schedule_items']
        master_start_time = data.get('settings', {}).get('masterStartTime', '')
        
        csv_data = [['Segment Name', 'Start Time']]
        
        for item in schedule:
            if item.get('isPublic', False):
                # Calculate start time
                start_time = self.calculate_start_time(schedule, item, master_start_time)
                csv_data.append([
                    item.get('segmentName', 'Untitled Segment'),
                    start_time or 'No Start Time'
                ])
                
        return csv_data
        
    def calculate_start_time(self, schedule, current_item, master_start_time):
        """Calculate start time for an item"""
        if not master_start_time:
            return ''
            
        try:
            # Find item index
            item_index = schedule.index(current_item)
            
            # If indented, no start time
            if current_item.get('isIndented', False):
                return ''
                
            # Calculate total seconds up to this item
            total_seconds = 0
            for i in range(item_index):
                item = schedule[i]
                if not item.get('isIndented', False):
                    total_seconds += (item.get('durationHours', 0) * 3600 + 
                                    item.get('durationMinutes', 0) * 60 + 
                                    item.get('durationSeconds', 0))
            
            # Add to master start time
            start_hours, start_minutes = map(int, master_start_time.split(':'))
            start_seconds = start_hours * 3600 + start_minutes * 60
            total_start_seconds = start_seconds + total_seconds
            
            final_hours = (total_start_seconds // 3600) % 24
            final_minutes = (total_start_seconds % 3600) // 60
            
            # Convert to 12-hour format
            from datetime import datetime
            dt = datetime.now().replace(hour=final_hours, minute=final_minutes, second=0)
            return dt.strftime('%I:%M %p')
            
        except Exception:
            return ''
            
    def generate_custom_graphics_csv(self, data):
        """Generate custom graphics CSV - only Row, Cue, and custom columns"""
        if not data or 'schedule_items' not in data:
            return None
            
        schedule = data['schedule_items']
        custom_columns = data.get('custom_columns', [])
        
        # Filter public items
        public_items = [item for item in schedule if item.get('isPublic', False)]
        
        if not public_items:
            return [['Row', 'Cue']]
        
        # Get custom column names
        custom_column_names = [col.get('name', '') for col in custom_columns if col.get('name')]
        
        # Create headers: Row, Cue, then custom columns
        headers = ['Row', 'Cue'] + custom_column_names
        csv_data = [headers]
        
        # Process each public item
        for i, item in enumerate(public_items):
            row = [
                i + 1,  # Row number
                item.get('customFields', {}).get('cue', 'CUE##')  # Cue field
            ]
            
            # Add custom column values
            for column_name in custom_column_names:
                value = item.get('customFields', {}).get(column_name, '')
                row.append(value)
            
            csv_data.append(row)
                
        return csv_data
        
    def save_csv(self, data, filename):
        """Save CSV data to file"""
        if not data:
            return False
            
        try:
            filepath = os.path.join(self.output_folder.get(), filename)
            with open(filepath, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.writer(csvfile)
                writer.writerows(data)
            return True
        except Exception as e:
            self.log_message(f"Error saving {filename}: {str(e)}")
            return False
            
    def update_files(self):
        """Update all graphics files"""
        if not self.is_running:
            return
            
        data = self.fetch_data()
        if not data:
            self.log_message("No data received")
            return
            
        # Generate and save files
        files_updated = 0
        
        # Lower Thirds CSV
        lower_thirds_data = self.generate_lower_thirds_csv(data)
        if lower_thirds_data and self.save_csv(lower_thirds_data, 'lower-thirds-live.csv'):
            files_updated += 1
            
        # Schedule CSV
        schedule_data = self.generate_schedule_csv(data)
        if schedule_data and self.save_csv(schedule_data, 'schedule-live.csv'):
            files_updated += 1
            
        # Custom Graphics CSV
        custom_graphics_data = self.generate_custom_graphics_csv(data)
        if custom_graphics_data and self.save_csv(custom_graphics_data, 'custom-graphics-live.csv'):
            files_updated += 1
            
        if files_updated > 0:
            self.log_message(f"Updated {files_updated} files")
        else:
            self.log_message("No files updated")
            
    def update_loop(self):
        """Main update loop"""
        while self.is_running:
            self.update_files()
            time.sleep(10)  # Update every 10 seconds
            
    def start_updates(self):
        """Start live updates"""
        if not self.event_id.get():
            messagebox.showerror("Error", "Please enter an Event ID")
            return
            
        if not self.output_folder.get():
            messagebox.showerror("Error", "Please select an output folder")
            return
            
        self.is_running = True
        self.start_button.config(state=tk.DISABLED)
        self.stop_button.config(state=tk.NORMAL)
        self.status_label.config(text="Running", foreground="green")
        
        self.log_message("Starting live updates...")
        
        # Start update thread
        self.update_thread = threading.Thread(target=self.update_loop, daemon=True)
        self.update_thread.start()
        
    def stop_updates(self):
        """Stop live updates"""
        self.is_running = False
        self.start_button.config(state=tk.NORMAL)
        self.stop_button.config(state=tk.DISABLED)
        self.status_label.config(text="Stopped", foreground="red")
        self.log_message("Live updates stopped")

def main():
    root = tk.Tk()
    app = LiveGraphicsGenerator(root)
    root.mainloop()

if __name__ == "__main__":
    main()
