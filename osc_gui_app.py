import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext, simpledialog
import threading
import time
import json
import socket
import struct
from datetime import datetime
from supabase import create_client, Client
import os
import webbrowser

# Supabase configuration
SUPABASE_URL = 'https://huqijhevmtgardkyeowa.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk'

class OSCServer:
    def __init__(self, port=57130):
        self.port = port
        self.running = False
        self.socket = None
        self.thread = None
        
    def start(self):
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.socket.bind(('0.0.0.0', self.port))
            self.running = True
            self.thread = threading.Thread(target=self._listen, daemon=True)
            self.thread.start()
            return True
        except Exception as e:
            return False, str(e)
    
    def stop(self):
        self.running = False
        if self.socket:
            self.socket.close()
    
    def _listen(self):
        while self.running:
            try:
                data, addr = self.socket.recvfrom(1024)
                self._handle_message(data, addr)
            except:
                pass
    
    def _handle_message(self, data, addr):
        try:
            # Simple OSC message parsing (basic implementation)
            message = data.decode('utf-8', errors='ignore')
            print(f"OSC from {addr}: {message}")
            
            # Log to GUI if available
            if hasattr(self, 'log_message'):
                self.log_message(f"OSC from {addr}: {message}")
            
            # Handle common OSC commands
            if '/ping' in message:
                self._send_response('/pong', ['server', 'alive'], addr)
                if hasattr(self, 'log_message'):
                    self.log_message(f"Sent pong to {addr}")
            elif '/list-events' in message:
                self._send_event_list(addr)
                if hasattr(self, 'log_message'):
                    self.log_message(f"Sent event list to {addr}")
            elif '/set-event' in message:
                # Extract event ID from message
                parts = message.split()
                if len(parts) > 1:
                    event_id = parts[1]
                    self._send_response('/event-set', [event_id], addr)
                    if hasattr(self, 'log_message'):
                        self.log_message(f"Set event {event_id} for {addr}")
            elif '/cue/' in message and '/load' in message:
                # Handle cue load commands like /cue/2/load
                if hasattr(self, 'log_message'):
                    self.log_message(f"Received cue load command: {message}")
                # Extract cue number
                try:
                    cue_parts = message.split('/')
                    if len(cue_parts) >= 3:
                        cue_number = cue_parts[2]
                        self.log_message(f"Loading cue {cue_number}")
                        # Update Supabase with cue load
                        if hasattr(self, 'update_supabase_cue_load'):
                            self.update_supabase_cue_load(cue_number)
                        else:
                            self.log_message("❌ update_supabase_cue_load function not available")
                except:
                    pass
            elif '/timer/start' in message:
                if hasattr(self, 'log_message'):
                    self.log_message(f"Received timer start command: {message}")
                if hasattr(self, 'update_supabase_timer'):
                    self.update_supabase_timer('start')
                else:
                    self.log_message("❌ update_supabase_timer function not available")
            elif '/timer/stop' in message:
                if hasattr(self, 'log_message'):
                    self.log_message(f"Received timer stop command: {message}")
                if hasattr(self, 'update_supabase_timer'):
                    self.update_supabase_timer('stop')
                else:
                    self.log_message("❌ update_supabase_timer function not available")
            elif '/timer/reset' in message:
                if hasattr(self, 'log_message'):
                    self.log_message(f"Received timer reset command: {message}")
                if hasattr(self, 'update_supabase_timer'):
                    self.update_supabase_timer('reset')
                else:
                    self.log_message("❌ update_supabase_timer function not available")
            elif '/subtimer/' in message:
                # Handle sub-timer commands like /subtimer/cue/5/start - EXACT NODE.JS LOGIC
                if hasattr(self, 'log_message'):
                    self.log_message(f"🎯 Received subtimer command: {message}")
                try:
                    # Parse /subtimer/cue/5/start or /subtimer/cue/5/stop - EXACT NODE.JS LOGIC
                    parts = message.split('/')
                    self.log_message(f"🔍 Parsed parts: {parts}")
                    
                    # Special handling for /subtimer/cue/5/start format - EXACT NODE.JS LOGIC
                    if len(parts) >= 4 and parts[1] == 'subtimer' and parts[2] == 'cue':
                        cue_number = parts[3]
                        # The action (start/stop) is in the address path, not args - EXACT NODE.JS LOGIC
                        action = parts[4] if len(parts) > 4 else 'start'
                        self.log_message(f"🎯 Parsed subtimer: cue={cue_number}, action={action}")
                        
                        if hasattr(self, 'update_supabase_subtimer'):
                            self.log_message(f"🔄 Calling update_supabase_subtimer...")
                            self.update_supabase_subtimer(cue_number, action)
                        else:
                            self.log_message("❌ update_supabase_subtimer function not available")
                    else:
                        self.log_message(f"❌ Invalid subtimer command format: {message}")
                        self.log_message(f"❌ Expected format: /subtimer/cue/5/start or /subtimer/cue/5/stop")
                except Exception as e:
                    self.log_message(f"❌ Error parsing subtimer command: {e}")
                    import traceback
                    self.log_message(f"❌ Traceback: {traceback.format_exc()}")
            else:
                if hasattr(self, 'log_message'):
                    self.log_message(f"Unknown OSC command: {message}")
            
        except Exception as e:
            print(f"Error handling OSC message: {e}")
            if hasattr(self, 'log_message'):
                self.log_message(f"Error handling OSC message: {e}")
    
    def _send_response(self, address, args, addr):
        # Simple OSC response (basic implementation)
        response = f"{address} {' '.join(map(str, args))}"
        self.socket.sendto(response.encode(), addr)
    
    def _send_event_list(self, addr):
        # This would be implemented with actual Supabase data
        events = ["Event 1", "Event 2", "Event 3"]  # Placeholder
        self._send_response('/events', events, addr)

class OSCGUIApp:
    def __init__(self, root):
        self.root = root
        self.root.title("OSC Control Panel")
        self.root.geometry("900x700")
        
        # Supabase client
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # OSC Server
        self.osc_server = OSCServer()
        self.osc_server.log_message = self.log_message  # Pass log function to OSC server
        self.osc_server.update_supabase_cue_load = self.update_supabase_cue_load  # Pass update function
        self.osc_server.update_supabase_timer = self.update_supabase_timer  # Pass update function
        self.osc_server.update_supabase_subtimer = self.update_supabase_subtimer  # Pass subtimer function
        
        # Current event and user
        self.current_event = None
        self.events = []
        self.user = None
        self.authenticated = False
        
        self.setup_ui()
        self.start_osc_server()
        self.check_authentication()
    
    def setup_ui(self):
        # Create notebook for tabs
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Authentication Tab
        auth_frame = ttk.Frame(notebook)
        notebook.add(auth_frame, text="Authentication")
        self.setup_auth_tab(auth_frame)
        
        # Events Tab
        events_frame = ttk.Frame(notebook)
        notebook.add(events_frame, text="Events")
        self.setup_events_tab(events_frame)
        
        # OSC Tab
        osc_frame = ttk.Frame(notebook)
        notebook.add(osc_frame, text="OSC Server")
        self.setup_osc_tab(osc_frame)
        
        # Log Tab
        log_frame = ttk.Frame(notebook)
        notebook.add(log_frame, text="Log")
        self.setup_log_tab(log_frame)
    
    def setup_auth_tab(self, parent):
        # Authentication status
        auth_frame = ttk.LabelFrame(parent, text="Authentication Status")
        auth_frame.pack(fill='x', padx=5, pady=5)
        
        self.auth_status_var = tk.StringVar(value="Not authenticated")
        ttk.Label(auth_frame, textvariable=self.auth_status_var).pack(pady=5)
        
        # Auth buttons
        button_frame = ttk.Frame(auth_frame)
        button_frame.pack(pady=5)
        
        ttk.Button(button_frame, text="Sign In", command=self.sign_in).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Sign Up", command=self.sign_up).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Sign Out", command=self.sign_out).pack(side='left', padx=5)
        
        # Direct connection option
        direct_frame = ttk.LabelFrame(parent, text="Direct Connection (No Auth Required)")
        direct_frame.pack(fill='x', padx=5, pady=5)
        
        ttk.Label(direct_frame, text="You can load events without signing in using the anon key").pack(pady=5)
        ttk.Button(direct_frame, text="Load Events (No Auth)", command=self.load_events_direct).pack(pady=5)
    
    def setup_events_tab(self, parent):
        # Event selection
        events_frame = ttk.LabelFrame(parent, text="Events")
        events_frame.pack(fill='both', expand=True, padx=5, pady=5)
        
        ttk.Label(events_frame, text="Select Event:").pack(pady=5)
        
        self.event_var = tk.StringVar()
        self.event_combo = ttk.Combobox(events_frame, textvariable=self.event_var, width=60)
        self.event_combo.pack(pady=5)
        self.event_combo.bind('<<ComboboxSelected>>', self.on_event_selected)
        
        button_frame = ttk.Frame(events_frame)
        button_frame.pack(pady=5)
        
        ttk.Button(button_frame, text="Refresh Events", command=self.load_events).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Set as Active Event", command=self.set_active_event).pack(side='left', padx=5)
        
        # Event details
        details_frame = ttk.LabelFrame(events_frame, text="Event Details")
        details_frame.pack(fill='both', expand=True, pady=10)
        
        self.details_text = scrolledtext.ScrolledText(details_frame, height=8)
        self.details_text.pack(fill='both', expand=True, padx=5, pady=5)
    
    def setup_osc_tab(self, parent):
        # Server status
        status_frame = ttk.LabelFrame(parent, text="Server Status")
        status_frame.pack(fill='x', padx=5, pady=5)
        
        self.status_var = tk.StringVar(value="Starting...")
        ttk.Label(status_frame, textvariable=self.status_var).pack(pady=5)
        
        # Supabase status
        supabase_frame = ttk.LabelFrame(parent, text="Supabase Integration")
        supabase_frame.pack(fill='x', padx=5, pady=5)
        
        self.supabase_status_var = tk.StringVar(value="Ready to update Supabase")
        ttk.Label(supabase_frame, textvariable=self.supabase_status_var).pack(pady=5)
        
        ttk.Label(supabase_frame, text="OSC commands will automatically update Supabase when an event is selected").pack(pady=2)
        
        # OSC Commands
        commands_frame = ttk.LabelFrame(parent, text="OSC Commands")
        commands_frame.pack(fill='both', expand=True, padx=5, pady=5)
        
        commands_text = """
Supported OSC Commands:
/list-events          - List all events
/set-event <id>       - Set current event
/ping                 - Test connection
/timer/start          - Start timer
/timer/stop           - Stop timer
/timer/reset          - Reset timer
/cue/<id>/load        - Load cue
        """
        
        ttk.Label(commands_frame, text=commands_text, justify='left').pack(pady=10)
        
        # Test commands
        test_frame = ttk.LabelFrame(parent, text="Test Commands")
        test_frame.pack(fill='x', padx=5, pady=5)
        
        ttk.Button(test_frame, text="Test Ping", command=self.test_ping).pack(side='left', padx=5)
        ttk.Button(test_frame, text="List Events", command=self.test_list_events).pack(side='left', padx=5)
        ttk.Button(test_frame, text="Test OSC Connection", command=self.test_osc_connection).pack(side='left', padx=5)
    
    def setup_log_tab(self, parent):
        self.log_text = scrolledtext.ScrolledText(parent, height=20)
        self.log_text.pack(fill='both', expand=True, padx=5, pady=5)
        
        # Clear log button
        ttk.Button(parent, text="Clear Log", command=self.clear_log).pack(pady=5)
    
    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}\n"
        
        self.log_text.insert(tk.END, log_entry)
        self.log_text.see(tk.END)
        
        # Also print to console
        print(log_entry.strip())
    
    def clear_log(self):
        self.log_text.delete(1.0, tk.END)
    
    def start_osc_server(self):
        success = self.osc_server.start()
        if success:
            self.status_var.set(f"OSC Server running on port {self.osc_server.port}")
            self.log_message(f"OSC Server started on port {self.osc_server.port}")
        else:
            self.status_var.set("Failed to start OSC Server")
            self.log_message("Failed to start OSC Server")
    
    def check_authentication(self):
        """Check if user is already authenticated"""
        try:
            session = self.supabase.auth.get_session()
            if session and hasattr(session, 'session') and session.session and session.session.user:
                self.user = session.session.user
                self.authenticated = True
                self.auth_status_var.set(f"Authenticated as: {self.user.email}")
                self.load_events()
                self.log_message(f"Already authenticated as: {self.user.email}")
            else:
                self.auth_status_var.set("Not authenticated")
                self.log_message("Not authenticated - you can still load events without signing in")
        except Exception as e:
            self.log_message(f"Error checking authentication: {e}")
            self.auth_status_var.set("Not authenticated")
    
    def sign_in(self):
        """Sign in with email and password"""
        email = simpledialog.askstring("Sign In", "Enter your email:")
        if not email:
            return
        
        password = simpledialog.askstring("Sign In", "Enter your password:", show='*')
        if not password:
            return
        
        try:
            response = self.supabase.auth.sign_in_with_password({
                "email": email,
                "password": password
            })
            
            if response.user:
                self.user = response.user
                self.authenticated = True
                self.auth_status_var.set(f"Authenticated as: {self.user.email}")
                self.load_events()
                self.log_message(f"Successfully signed in as: {self.user.email}")
                messagebox.showinfo("Success", "Successfully signed in!")
            else:
                self.log_message("Sign in failed")
                messagebox.showerror("Error", "Sign in failed")
                
        except Exception as e:
            self.log_message(f"Sign in error: {e}")
            messagebox.showerror("Error", f"Sign in failed: {e}")
    
    def sign_up(self):
        """Sign up with email and password"""
        email = simpledialog.askstring("Sign Up", "Enter your email:")
        if not email:
            return
        
        password = simpledialog.askstring("Sign Up", "Enter your password:", show='*')
        if not password:
            return
        
        full_name = simpledialog.askstring("Sign Up", "Enter your full name:")
        if not full_name:
            return
        
        try:
            response = self.supabase.auth.sign_up({
                "email": email,
                "password": password,
                "options": {
                    "data": {
                        "full_name": full_name
                    }
                }
            })
            
            if response.user:
                self.log_message(f"Account created for: {email}")
                messagebox.showinfo("Success", "Account created! Please check your email to confirm.")
            else:
                self.log_message("Sign up failed")
                messagebox.showerror("Error", "Sign up failed")
                
        except Exception as e:
            self.log_message(f"Sign up error: {e}")
            messagebox.showerror("Error", f"Sign up failed: {e}")
    
    def sign_out(self):
        """Sign out"""
        try:
            self.supabase.auth.sign_out()
            self.user = None
            self.authenticated = False
            self.auth_status_var.set("Not authenticated")
            self.events = []
            self.event_combo['values'] = []
            self.details_text.delete(1.0, tk.END)
            self.log_message("Signed out successfully")
            messagebox.showinfo("Success", "Signed out successfully")
        except Exception as e:
            self.log_message(f"Sign out error: {e}")
            messagebox.showerror("Error", f"Sign out failed: {e}")
    
    def load_events(self):
        """Load events with authentication"""
        if not self.authenticated:
            self.log_message("Not authenticated - trying direct connection...")
            self.load_events_direct()
            return
            
        try:
            self.log_message("Loading events from Supabase (authenticated)...")
            
            # Try to load events (works with anon key for public data)
            response = self.supabase.table('calendar_events').select('*').order('date', desc=True).execute()
            
            if response.data:
                self.events = response.data
                event_names = [f"{event['id']}: {event.get('name', 'Unnamed')} ({event.get('date', 'No date')})" for event in self.events]
                self.event_combo['values'] = event_names
                self.log_message(f"Loaded {len(self.events)} events")
            else:
                self.log_message("No events found")
                self.events = []
                self.event_combo['values'] = []
                
        except Exception as e:
            self.log_message(f"Error loading events: {e}")
            self.load_events_direct()
    
    def load_events_direct(self):
        """Load events without authentication using direct API"""
        try:
            self.log_message("Loading events via direct API (no auth required)...")
            
            # Direct HTTP request to Supabase
            import requests
            url = f"{SUPABASE_URL}/rest/v1/calendar_events"
            headers = {
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}'
            }
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                events = response.json()
                self.events = events
                event_names = [f"{event['id']}: {event.get('name', 'Unnamed')} ({event.get('date', 'No date')})" for event in self.events]
                self.event_combo['values'] = event_names
                self.log_message(f"Loaded {len(self.events)} events via direct API (no auth required)")
            else:
                self.log_message(f"Direct API failed: {response.status_code}")
                messagebox.showerror("Error", f"Failed to load events: {response.status_code}")
        except Exception as e:
            self.log_message(f"Direct API also failed: {e}")
            messagebox.showerror("Error", f"Failed to load events: {e}")
    
    def set_active_event(self):
        """Set the selected event as active for OSC commands"""
        if self.current_event:
            self.log_message(f"Active event set to: {self.current_event['name']}")
            messagebox.showinfo("Success", f"Active event set to: {self.current_event['name']}")
        else:
            messagebox.showwarning("Warning", "Please select an event first")
    
    def on_event_selected(self, event):
        selection = self.event_var.get()
        if selection:
            event_id = selection.split(':')[0]
            self.current_event = next((e for e in self.events if str(e['id']) == event_id), None)
            
            if self.current_event:
                details = f"Event ID: {self.current_event['id']}\n"
                details += f"Name: {self.current_event.get('name', 'N/A')}\n"
                details += f"Date: {self.current_event.get('date', 'N/A')}\n"
                details += f"Location: {self.current_event.get('location', 'N/A')}\n"
                
                self.details_text.delete(1.0, tk.END)
                self.details_text.insert(1.0, details)
                
                self.log_message(f"Selected event: {self.current_event['name']}")
    
    def test_ping(self):
        # Send ping to local OSC server
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(b'/ping', ('localhost', self.osc_server.port))
            sock.close()
            self.log_message("Ping sent to OSC server")
        except Exception as e:
            self.log_message(f"Error sending ping: {e}")
    
    def test_list_events(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(b'/list-events', ('localhost', self.osc_server.port))
            sock.close()
            self.log_message("List events command sent")
        except Exception as e:
            self.log_message(f"Error sending list events: {e}")
    
    def test_osc_connection(self):
        """Test OSC connection by sending a ping to localhost"""
        try:
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            test_socket.sendto(b"/ping", ('127.0.0.1', 57130))
            test_socket.close()
            self.log_message("Test OSC ping sent to localhost:57130")
        except Exception as e:
            self.log_message(f"Test OSC connection failed: {e}")
    
    def update_supabase_cue_load(self, cue_number):
        """Update Supabase when a cue is loaded - use the same RPC function as Node.js server"""
        try:
            if not self.current_event:
                self.log_message("No active event selected - cannot update Supabase")
                return
            
            self.log_message(f"🔄 Attempting to update Supabase for cue {cue_number}...")
            
            # Use the same RPC function as the Node.js server
            try:
                # First, we need to find the item in the schedule that matches this cue number
                # Get the run_of_show_data for this event
                response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', self.current_event['id']).execute()
                
                if not response.data or len(response.data) == 0:
                    self.log_message(f"❌ No run_of_show_data found for event {self.current_event['id']}")
                    self.supabase_status_var.set(f"❌ Cue {cue_number} - No event data found")
                    return
                
                schedule_items = response.data[0]['schedule_items']
                
                # Debug: Log available cues
                self.log_message(f"🔍 Available schedule items: {len(schedule_items)}")
                for i, item in enumerate(schedule_items):  # Show ALL items
                    cue_val = item.get('cue', 'No cue')
                    custom_cue = item.get('customFields', {}).get('cue', 'No custom cue')
                    self.log_message(f"   Item {i+1}: cue='{cue_val}', customFields.cue='{custom_cue}', id={item.get('id')}")
                
                # Find the item with matching cue number (like Node.js server)
                item_to_load = None
                for item in schedule_items:
                    # Check if the cue field matches the cue number
                    if str(item.get('cue', '')) == str(cue_number):
                        item_to_load = item
                        break
                    # Also check customFields.cue
                    elif str(item.get('customFields', {}).get('cue', '')) == str(cue_number):
                        item_to_load = item
                        break
                
                if not item_to_load:
                    self.log_message(f"❌ Cue {cue_number} not found in event schedule")
                    self.supabase_status_var.set(f"❌ Cue {cue_number} - Not found in schedule")
                    return
                
                # Calculate total duration in seconds
                total_seconds = (item_to_load.get('durationHours', 0) * 3600 + 
                               item_to_load.get('durationMinutes', 0) * 60 + 
                               item_to_load.get('durationSeconds', 0))
                
                # Calculate row number (1-based)
                row_number = schedule_items.index(item_to_load) + 1
                
                # Get cue display from customFields
                cue_display = item_to_load.get('customFields', {}).get('cue', item_to_load.get('cue', ''))
                
                # Use the same RPC function as the Node.js server
                rpc_response = self.supabase.rpc('load_cue_for_event', {
                    'p_event_id': self.current_event['id'],
                    'p_item_id': str(item_to_load['id']),
                    'p_user_id': 'python-osc-server',
                    'p_duration_seconds': total_seconds,
                    'p_row_is': row_number,
                    'p_cue_is': cue_display,
                    'p_timer_id': item_to_load.get('timerId')
                }).execute()
                
                if rpc_response.data:
                    self.log_message(f"✅ Updated Supabase: Cue {cue_number} loaded for event {self.current_event['name']}")
                    self.supabase_status_var.set(f"✅ Cue {cue_number} loaded - Supabase updated")
                else:
                    self.log_message(f"⚠️ Cue {cue_number} loaded but RPC call failed")
                    self.supabase_status_var.set(f"⚠️ Cue {cue_number} loaded - Supabase update failed")
                    
            except Exception as e:
                self.log_message(f"❌ Error calling load_cue_for_event RPC: {e}")
                self.supabase_status_var.set(f"❌ Cue {cue_number} - Supabase update failed")
                
        except Exception as e:
            self.log_message(f"❌ Error updating Supabase for cue load: {e}")
            self.supabase_status_var.set(f"❌ Cue {cue_number} - Supabase update failed")
    
    def update_supabase_timer(self, action):
        """Update Supabase when timer commands are received - use RPC functions like Node.js server"""
        try:
            if not self.current_event:
                self.log_message("No active event selected - cannot update Supabase")
                return
            
            self.log_message(f"🔄 Attempting to update Supabase for timer {action}...")
            
            # Get the run_of_show_data for this event to find the active item
            try:
                response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', self.current_event['id']).execute()
                
                if not response.data or len(response.data) == 0:
                    self.log_message(f"❌ No run_of_show_data found for event {self.current_event['id']}")
                    self.supabase_status_var.set(f"❌ Timer {action} - No event data found")
                    return
                
                schedule_items = response.data[0]['schedule_items']
                
                # Find the currently active item (the one that was last loaded)
                # First try to find by is_active flag
                active_item = None
                for item in schedule_items:
                    if item.get('is_active', False):
                        active_item = item
                        break
                
                # If no active item found by flag, get the last loaded cue from active_timers table
                if not active_item:
                    self.log_message(f"🔍 No active item found in schedule, checking active_timers table...")
                    try:
                        timer_response = self.supabase.table('active_timers').select('last_loaded_cue_id, item_id').eq('event_id', self.current_event['id']).order('updated_at', desc=True).limit(1).execute()
                        
                        if timer_response.data and len(timer_response.data) > 0:
                            timer_data = timer_response.data[0]
                            # Try to find the item by last_loaded_cue_id or item_id
                            for item in schedule_items:
                                if (str(item.get('id')) == str(timer_data.get('item_id')) or 
                                    str(item.get('cue')) == str(timer_data.get('last_loaded_cue_id'))):
                                    active_item = item
                                    self.log_message(f"🔍 Found active item by timer data: cue={item.get('cue')}, id={item.get('id')}")
                                    break
                    except Exception as e:
                        self.log_message(f"❌ Error checking active_timers: {e}")
                
                if not active_item:
                    self.log_message(f"❌ No active item found for timer {action}")
                    self.supabase_status_var.set(f"❌ Timer {action} - No active item")
                    return
                
                # Calculate total duration in seconds
                total_seconds = (active_item.get('durationHours', 0) * 3600 + 
                               active_item.get('durationMinutes', 0) * 60 + 
                               active_item.get('durationSeconds', 0))
                
                # Calculate row number (1-based)
                row_number = schedule_items.index(active_item) + 1
                
                # Get cue display from customFields
                cue_display = active_item.get('customFields', {}).get('cue', active_item.get('cue', ''))
                
                if action == 'start':
                    # Use the same RPC function as the Node.js server
                    rpc_response = self.supabase.rpc('start_timer_for_event', {
                        'p_event_id': self.current_event['id'],
                        'p_item_id': str(active_item['id']),
                        'p_user_id': 'python-osc-server',
                        'p_row_is': row_number,
                        'p_cue_is': cue_display,
                        'p_timer_id': active_item.get('timerId')
                    }).execute()
                    
                    if rpc_response.data:
                        self.log_message(f"✅ Updated Supabase: Timer {action} for event {self.current_event['name']}")
                        self.supabase_status_var.set(f"✅ Timer {action} - Supabase updated")
                    else:
                        self.log_message(f"⚠️ Timer {action} executed but RPC call failed")
                        self.supabase_status_var.set(f"⚠️ Timer {action} - Supabase update failed")
                        
                elif action == 'stop':
                    # Update active_timers table to stop the timer
                    update_response = self.supabase.table('active_timers').update({
                        'is_running': False,
                        'is_active': False,
                        'timer_state': 'stopped',
                        'updated_at': datetime.now().isoformat()
                    }).eq('event_id', self.current_event['id']).eq('item_id', active_item['id']).execute()
                    
                    if update_response.data:
                        self.log_message(f"✅ Updated Supabase: Timer {action} for event {self.current_event['name']}")
                        self.supabase_status_var.set(f"✅ Timer {action} - Supabase updated")
                    else:
                        self.log_message(f"⚠️ Timer {action} executed but update failed")
                        self.supabase_status_var.set(f"⚠️ Timer {action} - Supabase update failed")
                        
                elif action == 'reset':
                    # Reset timer by updating active_timers table
                    update_response = self.supabase.table('active_timers').update({
                        'is_running': False,
                        'is_active': False,
                        'timer_state': 'stopped',
                        'updated_at': datetime.now().isoformat()
                    }).eq('event_id', self.current_event['id']).eq('item_id', active_item['id']).execute()
                    
                    if update_response.data:
                        self.log_message(f"✅ Updated Supabase: Timer {action} for event {self.current_event['name']}")
                        self.supabase_status_var.set(f"✅ Timer {action} - Supabase updated")
                    else:
                        self.log_message(f"⚠️ Timer {action} executed but update failed")
                        self.supabase_status_var.set(f"⚠️ Timer {action} - Supabase update failed")
                    
            except Exception as e:
                self.log_message(f"❌ Error calling timer RPC: {e}")
                self.supabase_status_var.set(f"❌ Timer {action} - Supabase update failed")
                
        except Exception as e:
            self.log_message(f"❌ Error updating Supabase for timer {action}: {e}")
            self.supabase_status_var.set(f"❌ Timer {action} - Supabase update failed")

    def update_supabase_subtimer(self, cue_number, action):
        """Update Supabase for subtimer commands - EXACT NODE.JS LOGIC"""
        try:
            if not self.current_event:
                self.log_message("No event loaded. Please set an event first.")
                return
            
            self.log_message(f"🎯 Starting subtimer {action} for cue: {cue_number}")
            self.log_message(f"🔍 Current event ID: {self.current_event['id']}")
            
            # Get the run_of_show_data for this event - EXACT NODE.JS LOGIC
            try:
                self.log_message(f"🔄 Fetching run_of_show_data for event_id: {self.current_event['id']}")
                response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', self.current_event['id']).execute()
                self.log_message(f"🔄 Supabase response received: {response}")
                
                if not response.data or len(response.data) == 0:
                    self.log_message(f"❌ No run_of_show_data found for event {self.current_event['id']}")
                    return
                
                schedule_items = response.data[0]['schedule_items']
                self.log_message(f"🔍 Found {len(schedule_items)} schedule items")
                
                # Find the item with the specified cue number - EXACT NODE.JS LOGIC
                self.log_message(f"🔍 Looking for cue number: {cue_number}")
                item = None
                for schedule_item in schedule_items:
                    cue_val = schedule_item.get('cue', '')
                    self.log_message(f"🔍 Checking item: cue='{cue_val}' (type: {type(cue_val)})")
                    if str(cue_val) == str(cue_number):
                        item = schedule_item
                        self.log_message(f"✅ Found matching item: cue='{cue_val}', id={schedule_item.get('id')}")
                        break
                
                if not item:
                    self.log_message(f"❌ No item found with cue number: {cue_number}")
                    return
                
                # Use a dummy user ID for OSC server operations - EXACT NODE.JS LOGIC
                user_id = 'python-osc-server'
                
                if action == 'start':
                    # Calculate total duration in seconds - EXACT NODE.JS LOGIC
                    total_seconds = (item.get('durationHours', 0) * 3600 + 
                                   item.get('durationMinutes', 0) * 60 + 
                                   item.get('durationSeconds', 0))
                    
                    # Calculate row number (1-based) - EXACT NODE.JS LOGIC
                    # Find the index by matching the item ID instead of object reference
                    row_number = 1
                    for i, schedule_item in enumerate(schedule_items):
                        if schedule_item.get('id') == item.get('id'):
                            row_number = i + 1
                            break
                    self.log_message(f"🔍 Calculated row number: {row_number}")
                    
                    # Get cue display from customFields - EXACT NODE.JS LOGIC
                    cue_display = item.get('customFields', {}).get('cue', item.get('cue', ''))
                    
                    self.log_message(f"🔄 Calling start_sub_cue_timer_for_event RPC:")
                    self.log_message(f"   p_event_id: {self.current_event['id']}")
                    self.log_message(f"   p_item_id: {str(item['id'])}")
                    self.log_message(f"   p_user_id: {user_id}")
                    self.log_message(f"   p_duration_seconds: {total_seconds}")
                    self.log_message(f"   p_row_is: {row_number}")
                    self.log_message(f"   p_cue_is: {cue_display}")
                    self.log_message(f"   p_timer_id: {item.get('timerId')}")
                    
                    try:
                        self.log_message(f"🔄 About to call RPC function...")
                        # Use the same RPC function as the React app - EXACT NODE.JS LOGIC
                        rpc_response = self.supabase.rpc('start_sub_cue_timer_for_event', {
                            'p_event_id': self.current_event['id'],
                            'p_item_id': str(item['id']),
                            'p_user_id': user_id,
                            'p_duration_seconds': total_seconds,
                            'p_row_is': row_number,
                            'p_cue_is': cue_display,
                            'p_timer_id': item.get('timerId')
                        }).execute()
                        
                        self.log_message(f"🔄 RPC call completed!")
                        self.log_message(f"🔄 RPC response: {rpc_response}")
                        
                        self.log_message(f"✅ Started sub-cue timer for cue '{cue_number}' (Item ID: {item['id']})")
                        self.supabase_status_var.set(f"✅ Subtimer {action} cue {cue_number} - Supabase updated")
                        
                    except Exception as rpc_error:
                        self.log_message(f"❌ Error starting sub-cue timer in Supabase: {rpc_error}")
                        self.log_message(f"❌ RPC error type: {type(rpc_error)}")
                        import traceback
                        self.log_message(f"❌ RPC traceback: {traceback.format_exc()}")
                        self.supabase_status_var.set(f"❌ Subtimer {action} cue {cue_number} - RPC failed")
                        
                elif action == 'stop':
                    self.log_message(f"🔄 Calling stop_sub_cue_timer_for_event RPC:")
                    self.log_message(f"   p_event_id: {self.current_event['id']}")
                    self.log_message(f"   p_item_id: {str(item['id'])}")
                    
                    try:
                        # Use the same RPC function as the React app to stop - EXACT NODE.JS LOGIC
                        rpc_response = self.supabase.rpc('stop_sub_cue_timer_for_event', {
                            'p_event_id': self.current_event['id'],
                            'p_item_id': str(item['id'])
                        }).execute()
                        
                        self.log_message(f"✅ Stopped sub-cue timer for cue '{cue_number}' (Item ID: {item['id']})")
                        self.supabase_status_var.set(f"✅ Subtimer {action} cue {cue_number} - Supabase updated")
                        
                    except Exception as rpc_error:
                        self.log_message(f"❌ Error stopping sub-cue timer in Supabase: {rpc_error}")
                        self.supabase_status_var.set(f"❌ Subtimer {action} cue {cue_number} - RPC failed")
                        
            except Exception as e:
                self.log_message(f"❌ Error in subtimer operation: {e}")
                self.supabase_status_var.set(f"❌ Subtimer {action} cue {cue_number} - Supabase update failed")
                
        except Exception as e:
            self.log_message(f"❌ Error updating Supabase for subtimer {action} cue {cue_number}: {e}")
            self.supabase_status_var.set(f"❌ Subtimer {action} cue {cue_number} - Supabase update failed")
    
    def on_closing(self):
        self.log_message("Shutting down OSC server...")
        self.osc_server.stop()
        self.root.destroy()

def main():
    root = tk.Tk()
    app = OSCGUIApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()

if __name__ == "__main__":
    main()
