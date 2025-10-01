import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext, simpledialog
import threading
import time
import json
import socket
import struct
from datetime import datetime, timedelta
from supabase import create_client, Client
import os
import webbrowser
import asyncio
import queue

# Supabase configuration
SUPABASE_URL = 'https://huqijhevmtgardkyeowa.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk'

def parse_osc_message(data):
    """Simple OSC message parser"""
    try:
        # Find null terminator for address
        null_idx = data.find(b'\x00')
        if null_idx == -1:
            return None, []
        
        address = data[:null_idx].decode('utf-8')
        
        # Pad to 4-byte boundary
        padded_addr_len = ((null_idx + 1) + 3) // 4 * 4
        
        if len(data) <= padded_addr_len:
            return address, []
        
        # Find type tag
        type_start = padded_addr_len
        if type_start >= len(data) or data[type_start:type_start+1] != b',':
            return address, []
        
        type_null = data.find(b'\x00', type_start)
        if type_null == -1:
            return address, []
        
        type_tags = data[type_start+1:type_null].decode('utf-8')
        
        # Parse arguments
        args = []
        padded_type_len = ((type_null + 1) + 3) // 4 * 4
        arg_start = padded_type_len
        
        for tag in type_tags:
            if arg_start >= len(data):
                break
                
            if tag == 's':  # String
                str_end = data.find(b'\x00', arg_start)
                if str_end == -1:
                    break
                args.append(data[arg_start:str_end].decode('utf-8'))
                arg_start = ((str_end + 1) + 3) // 4 * 4
            elif tag == 'i':  # Int32
                if arg_start + 4 > len(data):
                    break
                args.append(struct.unpack('>i', data[arg_start:arg_start+4])[0])
                arg_start += 4
            elif tag == 'f':  # Float32
                if arg_start + 4 > len(data):
                    break
                args.append(struct.unpack('>f', data[arg_start:arg_start+4])[0])
                arg_start += 4
        
        return address, args
    except:
        return None, []

def create_osc_message(address, args=None):
    """Create OSC message"""
    if args is None:
        args = []
    
    # Address string (null-terminated, padded to 4-byte boundary)
    addr_bytes = address.encode('utf-8') + b'\x00'
    addr_padded = addr_bytes + b'\x00' * (4 - len(addr_bytes) % 4) % 4
    
    if not args:
        return addr_padded
    
    # Type tag string
    type_tag = ',' + ''.join(['s' if isinstance(arg, str) else 'i' if isinstance(arg, int) else 'f' for arg in args])
    type_bytes = type_tag.encode('utf-8') + b'\x00'
    type_padded = type_bytes + b'\x00' * (4 - len(type_bytes) % 4) % 4
    
    # Arguments
    arg_bytes = b''
    for arg in args:
        if isinstance(arg, str):
            s = arg.encode('utf-8') + b'\x00'
            s_padded = s + b'\x00' * (4 - len(s) % 4) % 4
            arg_bytes += s_padded
        elif isinstance(arg, int):
            arg_bytes += struct.pack('>i', arg)
        elif isinstance(arg, float):
            arg_bytes += struct.pack('>f', arg)
    
    return addr_padded + type_padded + arg_bytes

class OSCServer:
    def __init__(self, port=57130):
        self.port = port
        self.running = False
        self.socket = None
        self.thread = None
        self.message_queue = queue.Queue()
        
    def start(self):
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.socket.settimeout(1.0)  # Add timeout to prevent blocking
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
                # Debug: Log raw data received
                print(f"Raw OSC data received from {addr}: {data}")
                # Put message in queue for processing
                self.message_queue.put((data, addr))
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:  # Only log if we're supposed to be running
                    print(f"Socket receive error: {e}")
    
    def send_response(self, address, args, client_addr):
        """Send OSC response to client"""
        try:
            response = create_osc_message(address, args)
            self.socket.sendto(response, client_addr)
        except Exception as e:
            print(f"Error sending response: {e}")
            # Don't raise the error, just log it

class OSCGUIApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Run of Show - OSC Control Panel")
        self.root.geometry("1200x900")
        
        # Supabase client
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # OSC Server
        self.osc_server = OSCServer()
        
        # Current event and data
        self.current_event = None
        self.current_event_id = None
        self.schedule_data = []
        self.active_item_id = None
        self.events = []
        self.user = None
        self.authenticated = False
        self.current_day = 1  # Track current day for multi-day events
        
        # Message processing
        self.processing_messages = False
        
        self.setup_ui()
        self.start_osc_server()
        self.start_message_processor()
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
        # Main container with much larger layout
        main_frame = ttk.Frame(parent)
        main_frame.pack(fill='both', expand=True, padx=10, pady=15)
        
        # Authentication status with better styling
        auth_frame = ttk.LabelFrame(main_frame, text="🔐 Authentication Status", padding=25)
        auth_frame.pack(fill='x', pady=(0, 25))
        
        self.auth_status_var = tk.StringVar(value="Not authenticated")
        status_label = ttk.Label(auth_frame, textvariable=self.auth_status_var, font=('Arial', 14, 'bold'))
        status_label.pack(pady=(0, 20))
        
        # Sign in form with much larger layout
        signin_frame = ttk.LabelFrame(main_frame, text="📝 Sign In / Sign Up", padding=25)
        signin_frame.pack(fill='x', pady=(0, 25))
        
        # Email input with adjusted styling (20% less wide, 50% taller)
        email_frame = ttk.Frame(signin_frame)
        email_frame.pack(fill='x', pady=(0, 20))
        
        ttk.Label(email_frame, text="📧 Email:", font=('Arial', 12, 'bold')).pack(anchor='w')
        self.email_var = tk.StringVar()
        email_entry = ttk.Entry(email_frame, textvariable=self.email_var, width=30, font=('Arial', 14))
        email_entry.pack(fill='x', pady=(8, 0))
        
        # Password input with adjusted styling (20% less wide, 50% taller)
        password_frame = ttk.Frame(signin_frame)
        password_frame.pack(fill='x', pady=(0, 25))
        
        ttk.Label(password_frame, text="🔒 Password:", font=('Arial', 12, 'bold')).pack(anchor='w')
        self.password_var = tk.StringVar()
        password_entry = ttk.Entry(password_frame, textvariable=self.password_var, show="*", width=30, font=('Arial', 14))
        password_entry.pack(fill='x', pady=(8, 0))
        
        # Buttons with larger styling
        button_frame = ttk.Frame(signin_frame)
        button_frame.pack(fill='x')
        
        # Primary buttons with larger size
        primary_frame = ttk.Frame(button_frame)
        primary_frame.pack(side='left')
        
        signin_btn = ttk.Button(primary_frame, text="🚀 Sign In", command=self.sign_in, style='Accent.TButton', width=18)
        signin_btn.pack(side='left', padx=(0, 15))
        
        signup_btn = ttk.Button(primary_frame, text="📝 Sign Up", command=self.sign_up, width=18)
        signup_btn.pack(side='left', padx=(0, 15))
        
        # Secondary button with larger size
        signout_btn = ttk.Button(button_frame, text="🚪 Sign Out", command=self.sign_out, width=18)
        signout_btn.pack(side='right')
        
        # Direct connection option with larger styling
        direct_frame = ttk.LabelFrame(main_frame, text="🔓 Direct Connection (No Auth Required)", padding=25)
        direct_frame.pack(fill='x')
        
        info_text = "You can load events without signing in using the anonymous key.\nThis provides basic functionality without full authentication."
        ttk.Label(direct_frame, text=info_text, font=('Arial', 11), foreground='gray', justify='left').pack(anchor='w', pady=(0, 20))
        
        direct_btn = ttk.Button(direct_frame, text="📂 Load Events (No Auth)", command=self.load_events_direct, style='Accent.TButton')
        direct_btn.pack(anchor='w')
    
    def setup_events_tab(self, parent):
        # Main container
        main_frame = ttk.Frame(parent)
        main_frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Top section - Filters and Search
        filter_frame = ttk.LabelFrame(main_frame, text="Filter & Search")
        filter_frame.pack(fill='x', pady=(0, 10))
        
        # Filter controls
        controls_frame = ttk.Frame(filter_frame)
        controls_frame.pack(fill='x', padx=10, pady=10)
        
        ttk.Label(controls_frame, text="Filter:").pack(side='left', padx=(0, 5))
        
        self.filter_var = tk.StringVar(value="all")
        filter_combo = ttk.Combobox(controls_frame, textvariable=self.filter_var, width=15, state="readonly")
        filter_combo['values'] = ("all", "past", "recent", "today", "this week", "this month", "multi-day", "single-day")
        filter_combo.pack(side='left', padx=(0, 20))
        filter_combo.bind('<<ComboboxSelected>>', self.filter_events)
        
        ttk.Label(controls_frame, text="Search:").pack(side='left', padx=(0, 5))
        
        self.search_var = tk.StringVar()
        search_entry = ttk.Entry(controls_frame, textvariable=self.search_var, width=30)
        search_entry.pack(side='left', padx=(0, 10))
        search_entry.bind('<KeyRelease>', self.filter_events)
        
        # Refresh button
        ttk.Button(controls_frame, text="Refresh Events", command=self.load_events).pack(side='right', padx=(10, 0))
        
        # Events list section
        events_frame = ttk.LabelFrame(main_frame, text="Events")
        events_frame.pack(fill='both', expand=True, pady=(0, 10))
        
        # Create a frame with scrollbar for the events list
        list_container = ttk.Frame(events_frame)
        list_container.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Create listbox with scrollbar
        list_frame = ttk.Frame(list_container)
        list_frame.pack(fill='both', expand=True)
        
        # Create a grid-like display using Treeview for better formatting
        columns = ('date', 'name', 'location', 'days', 'status')
        self.events_tree = ttk.Treeview(list_frame, columns=columns, show='headings', height=8)
        
        # Configure column headings
        self.events_tree.heading('date', text='📅 Date')
        self.events_tree.heading('name', text='📝 Event Name')
        self.events_tree.heading('location', text='📍 Location')
        self.events_tree.heading('days', text='📆 Days')
        self.events_tree.heading('status', text='🔄 Status')
        
        # Configure column widths - make them larger
        self.events_tree.column('date', width=120, anchor='center')
        self.events_tree.column('name', width=300, anchor='w')
        self.events_tree.column('location', width=200, anchor='w')
        self.events_tree.column('days', width=80, anchor='center')
        self.events_tree.column('status', width=100, anchor='center')
        
        # Style the treeview with alternating rows
        style = ttk.Style()
        style.configure("Treeview", 
                       background='#ffffff',
                       foreground='#212529',
                       fieldbackground='#ffffff',
                       font=('Arial', 12),
                       rowheight=30)
        style.configure("Treeview.Heading", 
                       background='#e9ecef',
                       foreground='#495057',
                       font=('Arial', 12, 'bold'))
        style.map("Treeview", 
                 background=[('selected', '#007bff')],
                 foreground=[('selected', 'white')])
        
        # Configure alternating row colors
        style.configure("Treeview", 
                       background='#ffffff',
                       fieldbackground='#ffffff')
        style.configure("Treeview.Even", 
                       background='#f8f9fa',
                       fieldbackground='#f8f9fa')
        
        # Add scrollbar
        scrollbar = ttk.Scrollbar(list_frame, orient='vertical', command=self.events_tree.yview)
        self.events_tree.configure(yscrollcommand=scrollbar.set)
        
        self.events_tree.pack(side='left', fill='both', expand=True, padx=(0, 5))
        scrollbar.pack(side='right', fill='y')
        
        # Bind selection event
        self.events_tree.bind('<<TreeviewSelect>>', self.on_event_tree_select)
        
        # Event details section
        details_frame = ttk.LabelFrame(main_frame, text="Event Details")
        details_frame.pack(fill='both', expand=True)
        
        self.details_text = scrolledtext.ScrolledText(
            details_frame, 
            height=4,
            font=('Consolas', 11),
            bg='#f8f9fa',
            fg='#212529',
            relief='flat',
            borderwidth=1
        )
        self.details_text.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Current active event and action buttons
        action_frame = ttk.LabelFrame(main_frame, text="Actions")
        action_frame.pack(fill='x', pady=(10, 0))
        
        # Current active event display
        active_frame = ttk.Frame(action_frame)
        active_frame.pack(fill='x', padx=10, pady=5)
        
        ttk.Label(active_frame, text="Active Event:", font=('TkDefaultFont', 10, 'bold')).pack(side='left')
        self.active_event_var = tk.StringVar(value="None selected")
        ttk.Label(active_frame, textvariable=self.active_event_var, font=('TkDefaultFont', 10, 'bold')).pack(side='left', padx=(10, 0))
        
        # Day selection for multi-day events
        day_selection_frame = ttk.Frame(action_frame)
        day_selection_frame.pack(fill='x', padx=10, pady=5)
        
        ttk.Label(day_selection_frame, text="Working Day:", font=('TkDefaultFont', 10, 'bold')).pack(side='left')
        
        self.event_day_var = tk.StringVar(value="1")
        self.event_day_combo = ttk.Combobox(day_selection_frame, textvariable=self.event_day_var, width=10, state="readonly")
        self.event_day_combo['values'] = ("1", "2", "3", "4", "5", "6", "7")
        self.event_day_combo.pack(side='left', padx=(10, 10))
        self.event_day_combo.bind('<<ComboboxSelected>>', self.on_event_day_change)
        
        self.event_day_status_var = tk.StringVar(value="Day 1")
        ttk.Label(day_selection_frame, textvariable=self.event_day_status_var, font=('TkDefaultFont', 9)).pack(side='left', padx=(10, 0))
        
        # Auto-refresh controls
        auto_frame = ttk.Frame(action_frame)
        auto_frame.pack(fill='x', padx=10, pady=5)
        
        self.auto_refresh_var = tk.BooleanVar()
        auto_check = ttk.Checkbutton(auto_frame, text="Auto-refresh schedule (30s)", variable=self.auto_refresh_var, command=self.toggle_auto_refresh)
        auto_check.pack(side='left')
        
        self.schedule_status_var = tk.StringVar(value="No schedule loaded")
        ttk.Label(auto_frame, textvariable=self.schedule_status_var, font=('TkDefaultFont', 9)).pack(side='right')
        
        # Action buttons
        button_frame = ttk.Frame(action_frame)
        button_frame.pack(fill='x', padx=10, pady=(0, 10))
        
        ttk.Button(button_frame, text="Set as Active Event", command=self.set_active_event).pack(side='left', padx=(0, 5))
        ttk.Button(button_frame, text="View Schedule", command=self.view_event_schedule).pack(side='left', padx=(0, 5))
        ttk.Button(button_frame, text="Refresh Schedule", command=self.refresh_current_schedule).pack(side='left', padx=(0, 5))
    
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
        
        # Day selector for multi-day events
        day_frame = ttk.LabelFrame(parent, text="Multi-Day Event Control")
        day_frame.pack(fill='x', padx=5, pady=5)
        
        day_controls = ttk.Frame(day_frame)
        day_controls.pack(fill='x', padx=10, pady=10)
        
        ttk.Label(day_controls, text="Current Day:").pack(side='left', padx=(0, 10))
        
        self.day_var = tk.StringVar(value="1")
        self.day_combo = ttk.Combobox(day_controls, textvariable=self.day_var, width=10, state="readonly")
        self.day_combo['values'] = ("1", "2", "3", "4", "5", "6", "7")
        self.day_combo.pack(side='left', padx=(0, 10))
        self.day_combo.bind('<<ComboboxSelected>>', self.on_day_change)
        
        ttk.Button(day_controls, text="Refresh Day", command=self.refresh_current_day).pack(side='left', padx=(10, 0))
        
        self.day_status_var = tk.StringVar(value="Day 1 selected")
        ttk.Label(day_controls, textvariable=self.day_status_var).pack(side='right')
        
        # OSC Commands
        commands_frame = ttk.LabelFrame(parent, text="Supported OSC Commands")
        commands_frame.pack(fill='both', expand=True, padx=5, pady=5)
        
        commands_text = """OSC Commands (enhanced for multi-day events):
/set-event <eventId>              - Set current event
/list-events                      - List all events  
/cue/<cueName>/load               - Load a cue (for current day)
/timer/start                      - Start main timer
/timer/stop                       - Stop main timer
/timer/reset                      - Reset main timer
/subtimer/cue/<cueNumber>/start   - Start sub-timer (for current day)
/subtimer/cue/<cueNumber>/stop    - Stop sub-timer (for current day)
/status                           - Get current status
/list-cues                        - List available cues (for current day)
/set-day <dayNumber>               - Set current day (1-7)
/get-day                          - Get current day

Multi-Day Event Usage:
1. /set-event ea4ca3b2-d517-4efe-8e1c-e47b62a99b0b
2. /set-day 2                     - Switch to day 2
3. /list-cues                     - See cues for day 2
4. /cue/1/load                    - Load cue 1 from day 2
5. /timer/start
6. /subtimer/cue/5/start          - Start sub-timer for cue 5 on day 2"""
        
        cmd_text_widget = scrolledtext.ScrolledText(commands_frame, height=12, width=60)
        cmd_text_widget.pack(pady=5, fill='both', expand=True)
        cmd_text_widget.insert('1.0', commands_text)
        cmd_text_widget.config(state='disabled')
    
    def setup_log_tab(self, parent):
        self.log_text = scrolledtext.ScrolledText(parent, height=25)
        self.log_text.pack(fill='both', expand=True, padx=5, pady=5)
        
        # Clear log button
        button_frame = ttk.Frame(parent)
        button_frame.pack(pady=5)
        ttk.Button(button_frame, text="Clear Log", command=self.clear_log).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Test OSC Connection", command=self.test_osc_connection).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Test Simple OSC", command=self.test_simple_osc).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Check Server Status", command=self.check_server_status).pack(side='left', padx=5)
    
    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}\n"
        
        # Use thread-safe method to update GUI
        self.root.after(0, self._update_log, log_entry)
        print(log_entry.strip())
    
    def _update_log(self, log_entry):
        self.log_text.insert(tk.END, log_entry)
        self.log_text.see(tk.END)
    
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
    
    def start_message_processor(self):
        """Start message processor thread"""
        self.processing_messages = True
        processor_thread = threading.Thread(target=self._process_messages, daemon=True)
        processor_thread.start()
    
    def _process_messages(self):
        """Process OSC messages in separate thread"""
        while self.processing_messages:
            try:
                # Get message from queue with timeout
                data, addr = self.osc_server.message_queue.get(timeout=1.0)
                
                # Parse OSC message
                address, args = parse_osc_message(data)
                if address:
                    self.log_message(f"OSC Message: {address} {args}")
                    
                    # Process the command (in separate thread to avoid blocking)
                    threading.Thread(target=self._handle_osc_command, 
                                   args=(address, args, addr), daemon=True).start()
                
            except queue.Empty:
                continue
            except Exception as e:
                self.log_message(f"Error processing message: {e}")
    
    def _handle_osc_command(self, address, args, client_addr):
        """Handle OSC command - same logic as Node.js server"""
        try:
            parts = address.split('/')[1:]  # Remove empty first part
            if not parts:
                return
            
            command = parts[0]
            
            if command == 'set-event':
                event_id = args[0] if args else None
                if event_id:
                    self.load_event_data(event_id)
                    self.osc_server.send_response('/event/set', [event_id], client_addr)
                    self.log_message(f"Event set to: {event_id}")
                    
            elif command == 'list-events':
                self.list_events_osc(client_addr)
                
            elif command == 'cue' and len(parts) >= 3 and parts[2] == 'load':
                cue_name = parts[1]
                self.load_cue(cue_name)
                self.osc_server.send_response('/cue/loaded', [cue_name], client_addr)
                
            elif command == 'timer':
                if len(parts) >= 2:
                    action = parts[1]
                    if action == 'start':
                        self.start_timer()
                        self.osc_server.send_response('/timer/started', ['Timer started'], client_addr)
                    elif action == 'stop':
                        self.stop_timer()
                        self.osc_server.send_response('/timer/stopped', ['Timer stopped'], client_addr)
                    elif action == 'reset':
                        self.reset_main_timer()
                        try:
                            self.osc_server.send_response('/timer/reset', ['success'], client_addr)
                        except Exception as e:
                            self.log_message(f"Error sending reset response: {e}")
                        
            elif command == 'subtimer':
                # Handle /subtimer/cue/5/start or /subtimer/cue/5/stop
                if len(parts) >= 4 and parts[1] == 'cue':
                    cue_number = parts[2]
                    action = parts[3]
                    if action in ['start', 'stop']:
                        self.handle_sub_timer(cue_number, action)
                        response_addr = f'/subtimer/{"started" if action == "start" else "stopped"}'
                        self.osc_server.send_response(response_addr, [cue_number, 'success'], client_addr)
                        
            elif command == 'status':
                self.send_status_osc(client_addr)
                
            elif command == 'list-cues':
                self.list_cues_osc(client_addr)
                
            elif command == 'set-day':
                day_number = args[0] if args else None
                if day_number:
                    try:
                        day_num = int(day_number)
                        self.current_day = day_num
                        self.day_var.set(str(day_num))
                        self.day_status_var.set(f"Day {day_num} selected")
                        self.osc_server.send_response('/day/set', [f'Day set to {day_num}'], client_addr)
                        self.log_message(f"Day set to {day_num} via OSC")
                    except ValueError:
                        self.osc_server.send_response('/error', ['Invalid day number'], client_addr)
                else:
                    self.osc_server.send_response('/error', ['Day number required'], client_addr)
                    
            elif command == 'get-day':
                self.osc_server.send_response('/day/current', [f'Current day: {self.current_day}'], client_addr)
                
            else:
                self.log_message(f"Unknown OSC command: {address}")
                self.osc_server.send_response('/error', [f'Unknown command: {address}'], client_addr)
                
        except Exception as e:
            self.log_message(f"Error processing OSC command {address}: {e}")
            self.osc_server.send_response('/error', [f'Server error: {str(e)}'], client_addr)
    
    def load_event_data(self, event_id):
        """Load event data - same logic as Node.js server"""
        try:
            self.log_message(f"Loading event: {event_id}")
            
            # Fetch event data from run_of_show_data table
            response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', event_id).single().execute()
            
            if response.data:
                self.schedule_data = response.data.get('schedule_items', [])
                self.current_event_id = event_id
                
                # Update UI
                self.root.after(0, self.active_event_var.set, f"Event: {event_id}")
                
                self.log_message(f"Event '{event_id}' loaded with {len(self.schedule_data)} schedule items")
                
                # Update status display
                self.schedule_status_var.set(f"Loaded: {len(self.schedule_data)} items")
                
                # Update day selector with available days
                self.update_day_selector()
            else:
                raise Exception(f"Event not found: {event_id}")
                
        except Exception as e:
            self.log_message(f"Error loading event: {e}")
            raise e
    
    def load_cue(self, cue_name):
        """Load cue - same logic as Node.js server"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message(f"Loading cue: {cue_name} for day {self.current_day}")
        
        # Find the cue in the schedule for the current day
        item = None
        for schedule_item in self.schedule_data:
            # Check if this item matches the cue name and is for the current day
            cue_matches = (schedule_item.get('cue') == cue_name or 
                          schedule_item.get('customFields', {}).get('cue') == cue_name or
                          schedule_item.get('customFields', {}).get('cue') == f'CUE{cue_name}')
            
            # Check day - if no day specified, assume day 1, otherwise match current day
            item_day = schedule_item.get('day', 1)
            day_matches = (item_day == self.current_day)
            
            if cue_matches and day_matches:
                item = schedule_item
                break
        
        if not item:
            # Try to find any cue with this name across all days for better error message
            all_days_with_cue = []
            for schedule_item in self.schedule_data:
                cue_matches = (schedule_item.get('cue') == cue_name or 
                              schedule_item.get('customFields', {}).get('cue') == cue_name or
                              schedule_item.get('customFields', {}).get('cue') == f'CUE{cue_name}')
                if cue_matches:
                    item_day = schedule_item.get('day', 1)
                    all_days_with_cue.append(item_day)
            
            if all_days_with_cue:
                raise Exception(f'Cue {cue_name} not found for day {self.current_day}. Available on days: {sorted(set(all_days_with_cue))}')
            else:
                raise Exception(f'Cue {cue_name} not found in event schedule')
        
        # Calculate total duration in seconds for the RPC call
        total_seconds = (item.get('durationHours', 0) * 3600 + 
                        item.get('durationMinutes', 0) * 60 + 
                        item.get('durationSeconds', 0))
        
        # Calculate row number (1-based)
        row_number = self.schedule_data.index(item) + 1
        
        # Get cue display
        cue_display = item.get('customFields', {}).get('cue', item.get('cue', cue_name))
        
        # Load the cue using RPC with all required parameters
        try:
            response = self.supabase.rpc('load_cue_for_event', {
                'p_event_id': self.current_event_id,
                'p_item_id': str(item['id']),
                'p_user_id': 'python-osc-server',
                'p_duration_seconds': total_seconds,
                'p_row_is': row_number,
                'p_cue_is': cue_display,
                'p_timer_id': item.get('timerId')
            }).execute()
            
            if response.data is not None or not hasattr(response, 'error') or not response.error:
                self.active_item_id = item['id']
                self.log_message(f"Cue '{cue_name}' loaded successfully (Item ID: {item['id']})")
            else:
                error_msg = response.error if hasattr(response, 'error') else 'Unknown error'
                raise Exception(f'RPC call failed: {error_msg}')
                
        except Exception as rpc_error:
            self.log_message(f"RPC Error details: {rpc_error}")
            raise Exception(f'Failed to load cue: {str(rpc_error)}')
    
    def start_timer(self):
        """Start timer - same logic as Node.js server"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        active_item = None
        for item in self.schedule_data:
            if item['id'] == self.active_item_id:
                active_item = item
                break
        
        if not active_item:
            raise Exception('No active item found for timer start')
        
        self.log_message(f"Starting timer for item: {self.active_item_id}")
        
        # Calculate row number (1-based)
        row_number = self.schedule_data.index(active_item) + 1
        
        # Get cue display
        cue_display = active_item.get('customFields', {}).get('cue', active_item.get('cue', ''))
        
        response = self.supabase.rpc('start_timer_for_event', {
            'p_event_id': self.current_event_id,
            'p_item_id': str(active_item['id']),
            'p_user_id': 'python-osc-server',
            'p_row_is': row_number,
            'p_cue_is': cue_display,
            'p_timer_id': active_item.get('timerId')
        }).execute()
        
        if response.data is None:  # Success
            self.log_message(f"Timer started for item: {self.active_item_id}")
        else:
            raise Exception('Failed to start timer')
    
    def stop_timer(self):
        """Stop timer - same logic as Node.js server"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message(f"Stopping timer for item: {self.active_item_id}")
        
        try:
            # Update all the fields that need to change when stopping
            response = self.supabase.table('active_timers').update({
                'is_running': False,
                'is_active': False,
                'timer_state': 'stopped'
            }).eq('event_id', self.current_event_id).eq('item_id', str(self.active_item_id)).execute()
            
            self.log_message(f"Stop timer response: {response}")
            
            if response.data:
                self.log_message(f"Timer stopped successfully - {len(response.data)} records updated")
            else:
                self.log_message("Timer stop - no records were updated (timer may not be running)")
                
        except Exception as e:
            self.log_message(f"Error stopping timer: {e}")
            raise e
    
    def reset_main_timer(self):
        """Reset main timer - same logic as Node.js server"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message("Performing complete reset (like React app reset button)...")
        
        try:
            # 1. Clear completed cues (purple highlighting) - direct table delete
            self.log_message(f"Clearing completed cues for event_id: {self.current_event_id}")
            try:
                # Test basic connection first
                self.log_message("Testing Supabase connection...")
                test_response = self.supabase.table('calendar_events').select('id').limit(1).execute()
                self.log_message(f"Connection test - calendar_events: {len(test_response.data)} records")
                
                # Try to access completed_cues table with different approaches
                self.log_message("Trying to access completed_cues table...")
                try:
                    all_response = self.supabase.table('completed_cues').select('*').execute()
                    self.log_message(f"All completed_cues records: {len(all_response.data)} total")
                    for record in all_response.data:
                        self.log_message(f"  - Record event_id: {record.get('event_id')} (type: {type(record.get('event_id'))})")
                except Exception as table_error:
                    self.log_message(f"Error accessing completed_cues table: {table_error}")
                    
                    # Try alternative table names
                    for table_name in ['completed_cues', 'Completed_Cues', 'completed-cues']:
                        try:
                            alt_response = self.supabase.table(table_name).select('*').execute()
                            self.log_message(f"Found table '{table_name}' with {len(alt_response.data)} records")
                            break
                        except:
                            self.log_message(f"Table '{table_name}' not accessible")
                
                # Check for our specific event_id
                check_response = self.supabase.table('completed_cues').select('*').eq('event_id', self.current_event_id).execute()
                self.log_message(f"Found {len(check_response.data)} completed cues for our event_id")
                
                # Try different event_id formats if needed
                if len(check_response.data) == 0:
                    # Try as string
                    check_response_str = self.supabase.table('completed_cues').select('*').eq('event_id', str(self.current_event_id)).execute()
                    self.log_message(f"Found {len(check_response_str.data)} completed cues with string event_id")
                    
                    if len(check_response_str.data) > 0:
                        # Use string format for delete
                        completed_response = self.supabase.table('completed_cues').delete().eq('event_id', str(self.current_event_id)).execute()
                        self.log_message(f"Delete completed with string event_id")
                    else:
                        self.log_message("No completed cues found to delete")
                else:
                    # Direct delete from completed_cues table
                    completed_response = self.supabase.table('completed_cues').delete().eq('event_id', self.current_event_id).execute()
                    self.log_message(f"Delete completed - response: {completed_response}")
                
            except Exception as e:
                self.log_message(f"Failed to clear completed cues: {e}")
            
            # 2. Clear all active timers
            self.log_message("Clearing all active timers...")
            try:
                active_response = self.supabase.table('active_timers').delete().eq('event_id', self.current_event_id).execute()
                self.log_message("Cleared all active timers")
            except Exception as e:
                self.log_message(f"Failed to clear active timers: {e}")
            
            # 3. Clear all sub-cue timers
            self.log_message("Clearing all sub-cue timers...")
            try:
                sub_response = self.supabase.table('sub_cue_timers').delete().eq('event_id', self.current_event_id).execute()
                self.log_message("Cleared all sub-cue timers")
            except Exception as e:
                self.log_message(f"Failed to clear sub-cue timers: {e}")
            
            # 4. Clear local state
            self.active_item_id = None
            
            self.log_message("Complete reset finished - all highlighting and states cleared")
            
        except Exception as error:
            self.log_message(f"Error during reset: {error}")
            raise error
    
    def handle_sub_timer(self, cue_number, action):
        """Handle sub timer - same logic as Node.js server"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message(f"Sub-timer {action} for cue: {cue_number} on day {self.current_day}")
        
        # Find the item with the specified cue number for the current day
        item = None
        for schedule_item in self.schedule_data:
            # Check if this item matches the cue number and is for the current day
            cue_matches = (str(schedule_item.get('cue', '')) == str(cue_number) or
                          str(schedule_item.get('customFields', {}).get('cue', '')) == str(cue_number))
            
            # Check day - if no day specified, assume day 1, otherwise match current day
            item_day = schedule_item.get('day', 1)
            day_matches = (item_day == self.current_day)
            
            if cue_matches and day_matches:
                item = schedule_item
                break
        
        if not item:
            # Try to find any cue with this number across all days for better error message
            all_days_with_cue = []
            for schedule_item in self.schedule_data:
                cue_matches = (str(schedule_item.get('cue', '')) == str(cue_number) or
                              str(schedule_item.get('customFields', {}).get('cue', '')) == str(cue_number))
                if cue_matches:
                    item_day = schedule_item.get('day', 1)
                    all_days_with_cue.append(item_day)
            
            if all_days_with_cue:
                raise Exception(f'Cue {cue_number} not found for day {self.current_day}. Available on days: {sorted(set(all_days_with_cue))}')
            else:
                raise Exception(f'Cue {cue_number} not found in event schedule')
        
        if action == 'start':
            # Calculate total duration in seconds
            total_seconds = (item.get('durationHours', 0) * 3600 + 
                           item.get('durationMinutes', 0) * 60 + 
                           item.get('durationSeconds', 0))
            
            # Calculate row number (1-based)
            row_number = self.schedule_data.index(item) + 1
            
            # Get cue display
            cue_display = item.get('customFields', {}).get('cue', item.get('cue', f'CUE {cue_number}'))
            
            # Start sub-timer using RPC
            response = self.supabase.rpc('start_sub_cue_timer_for_event', {
                'p_event_id': self.current_event_id,
                'p_item_id': str(item['id']),
                'p_user_id': 'python-osc-server',
                'p_duration_seconds': total_seconds,
                'p_row_is': row_number,
                'p_cue_is': cue_display,
                'p_timer_id': item.get('timerId')
            }).execute()
            
            self.log_message(f"Started sub-timer for cue '{cue_number}' (Item ID: {item['id']})")
            
        elif action == 'stop':
            # Stop sub-timer using RPC
            response = self.supabase.rpc('stop_sub_cue_timer_for_event', {
                'p_event_id': self.current_event_id,
                'p_item_id': str(item['id'])
            }).execute()
            
            self.log_message(f"Stopped sub-timer for cue '{cue_number}' (Item ID: {item['id']})")
    
    def list_events_osc(self, client_addr):
        """List events via OSC"""
        try:
            response = self.supabase.table('calendar_events').select('id, name, created_at').order('created_at', desc=True).execute()
            
            if response.data:
                for i, event in enumerate(response.data):
                    event_info = f"{i + 1}. Event ID: {event['id']}\n   Name: {event.get('name', 'Unnamed')}\n   Created: {event.get('created_at', 'Unknown')}"
                    self.osc_server.send_response('/events/list', [event_info], client_addr)
                    
        except Exception as e:
            self.log_message(f"Error listing events: {e}")
            self.osc_server.send_response('/error', [f'Failed to list events: {str(e)}'], client_addr)
    
    def list_cues_osc(self, client_addr):
        """List cues via OSC for current day"""
        if not self.current_event_id:
            self.osc_server.send_response('/error', ['No event loaded. Please set an event first.'], client_addr)
            return
        
        # Only show cues for the current day
        cues = []
        for item in self.schedule_data:
            item_day = item.get('day', 1)
            if item_day == self.current_day:
                cue = item.get('cue') or item.get('customFields', {}).get('cue')
                if cue:
                    cues.append(cue)
        
        # Remove duplicates and sort
        cues = sorted(list(set(cues)))
        
        if cues:
            self.osc_server.send_response('/cues/list', [f"Day {self.current_day} cues:"], client_addr)
            for i, cue in enumerate(cues):
                self.osc_server.send_response('/cues/list', [f"{i + 1}. {cue}"], client_addr)
        else:
            self.osc_server.send_response('/cues/list', [f"No cues found for day {self.current_day}"], client_addr)
    
    def send_status_osc(self, client_addr):
        """Send status via OSC"""
        if self.current_event_id:
            # Count items for current day
            day_items = [item for item in self.schedule_data if item.get('day', 1) == self.current_day]
            status_message = (f"Event: {self.current_event_id}, Day: {self.current_day}, "
                            f"Day Items: {len(day_items)}, Total Items: {len(self.schedule_data)}, "
                            f"Active: {self.active_item_id or 'None'}")
        else:
            status_message = 'No event loaded'
        
        self.osc_server.send_response('/status/info', [status_message], client_addr)
        self.log_message("Status sent")
    
    # UI Event handlers (existing methods)
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
        """Sign in with email and password from form fields"""
        email = self.email_var.get()
        password = self.password_var.get()
        
        if not email or not password:
            messagebox.showerror("Error", "Please enter both email and password")
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
        """Sign up with email and password from form fields"""
        email = self.email_var.get()
        password = self.password_var.get()
        
        if not email or not password:
            messagebox.showerror("Error", "Please enter both email and password")
            return
        
        try:
            response = self.supabase.auth.sign_up({
                "email": email,
                "password": password
            })
            
            if response.user:
                self.user = response.user
                self.authenticated = True
                self.auth_status_var.set(f"Authenticated as: {self.user.email}")
                self.load_events()
                self.log_message(f"Successfully signed up and signed in as: {self.user.email}")
                messagebox.showinfo("Success", "Successfully signed up and signed in!")
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
            self.active_event_var.set("None")
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
            
            response = self.supabase.table('calendar_events').select('*').order('date', desc=True).execute()
            
            if response.data:
                self.events = response.data
                self.all_events = self.events.copy()  # Store for filtering
                self.filter_events()  # Apply current filters
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
                self.all_events = self.events.copy()  # Store for filtering
                self.filter_events()  # Apply current filters
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
            try:
                self.load_event_data(self.current_event['id'])
                
                # Set the day from the event day selector
                selected_day = int(self.event_day_var.get())
                self.current_day = selected_day
                
                # Update OSC day selector to match
                if hasattr(self, 'day_var'):
                    self.day_var.set(str(selected_day))
                    self.day_status_var.set(f"Day {selected_day} selected")
                
                self.log_message(f"Active event set to: {self.current_event['name']} (Day {selected_day})")
                messagebox.showinfo("Success", f"Active event set to: {self.current_event['name']} (Day {selected_day})")
            except Exception as e:
                self.log_message(f"Error setting active event: {e}")
                messagebox.showerror("Error", f"Failed to set active event: {e}")
        else:
            messagebox.showwarning("Warning", "Please select an event first")
    
    def filter_events(self, event=None):
        """Filter events based on filter selection and search text - using React app logic"""
        if not hasattr(self, 'all_events'):
            self.all_events = self.events.copy()
        
        # Debug: show available events
        self.log_message(f"Available events: {len(self.all_events)}")
        for i, e in enumerate(self.all_events[:3]):  # Show first 3 events
            self.log_message(f"  Event {i+1}: '{e.get('name', 'No name')}' at '{e.get('location', 'No location')}' on '{e.get('date', 'No date')}'")
            # Debug: Show all available fields
            self.log_message(f"    Available fields: {list(e.keys())}")
            self.log_message(f"    Full event data: {e}")
        
        # Get filter and search values
        filter_type = self.filter_var.get()
        search_text = self.search_var.get().strip().lower()
        
        # Apply React app filtering logic
        now = datetime.now()
        today = datetime(now.year, now.month, now.day)  # Start of today
        
        filtered_events = []
        
        for event in self.all_events:
            # Parse date like React app does - without timezone conversion
            try:
                if event.get('date'):
                    date_parts = event['date'].split('-')
                    if len(date_parts) == 3:
                        year, month, day = map(int, date_parts)
                        event_date = datetime(year, month - 1, day)  # month is 0-indexed
                    else:
                        event_date = datetime.now()
                else:
                    event_date = datetime.now()
            except:
                event_date = datetime.now()
            
            # Date filter (like React app's activeTab logic)
            if filter_type == "past":
                date_match = event_date < today
            elif filter_type == "recent":
                # Last 7 days
                date_match = (today - event_date).days <= 7
            elif filter_type == "today":
                date_match = event_date.date() == today.date()
            elif filter_type == "this week":
                week_start = today - timedelta(days=today.weekday())
                week_end = week_start + timedelta(days=6)
                date_match = week_start.date() <= event_date.date() <= week_end.date()
            elif filter_type == "this month":
                date_match = event_date.month == today.month and event_date.year == today.year
            else:  # "all", "multi-day", "single-day"
                date_match = True
            
            # Search filter (like React app's searchMatch logic)
            search_match = True
            if search_text:
                search_match = (
                    search_text in event.get('name', '').lower() or
                    search_text in event.get('location', '').lower() or
                    search_text in event.get('date', '').lower()
                )
            
            # Multi-day/Single-day filter
            day_type_match = True
            if filter_type in ["multi-day", "single-day"]:
                try:
                    # Check if this is a multi-day event
                    response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', event['id']).single().execute()
                    if response.data and response.data.get('schedule_items'):
                        schedule_items = response.data.get('schedule_items', [])
                        available_days = set()
                        for item in schedule_items:
                            day = item.get('day', 1)
                            available_days.add(day)
                        
                        is_multi_day = len(available_days) > 1
                        
                        if filter_type == "multi-day":
                            day_type_match = is_multi_day
                        elif filter_type == "single-day":
                            day_type_match = not is_multi_day
                    else:
                        # No schedule data, assume single day
                        day_type_match = (filter_type == "single-day")
                except:
                    # Error checking, assume single day
                    day_type_match = (filter_type == "single-day")
            
            # Combine filters
            if date_match and search_match and day_type_match:
                filtered_events.append(event)
        
        # Sort events by date (like React app)
        filtered_events.sort(key=lambda e: e.get('date', ''), reverse=(filter_type == "past"))
        
        # Update treeview instead of listbox
        for item in self.events_tree.get_children():
            self.events_tree.delete(item)
        
        for event in filtered_events:
            # Format event display like React app
            event_name = event.get('name', 'Unnamed')
            event_date = event.get('date', 'No date')
            
            # Try to get location from schedule_data JSON first, then other fields
            event_location = 'No location'
            
            # Check schedule_data JSON for location
            schedule_data = event.get('schedule_data')
            if schedule_data:
                try:
                    if isinstance(schedule_data, str):
                        import json
                        schedule_json = json.loads(schedule_data)
                        event_location = schedule_json.get('location', 'No location')
                    elif isinstance(schedule_data, dict):
                        event_location = schedule_data.get('location', 'No location')
                except:
                    pass
            
            # Fallback to other possible location fields
            if event_location == 'No location':
                event_location = (event.get('location') or 
                                event.get('event_location') or 
                                event.get('venue') or 
                                event.get('place') or 
                                'No location')
            
            # Format date nicely
            try:
                if event_date != 'No date':
                    date_parts = event_date.split('-')
                    if len(date_parts) == 3:
                        year, month, day = map(int, date_parts)
                        formatted_date = f"{month}/{day}/{year}"
                    else:
                        formatted_date = event_date
                else:
                    formatted_date = event_date
            except:
                formatted_date = event_date
            
            # Check if this is a multi-day event by looking at run_of_show_data
            days_count = "1"
            event_status = "Single Day"
            try:
                # Try to get schedule data to count days
                response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', event['id']).single().execute()
                if response.data and response.data.get('schedule_items'):
                    schedule_items = response.data.get('schedule_items', [])
                    available_days = set()
                    for item in schedule_items:
                        day = item.get('day', 1)
                        available_days.add(day)
                    
                    if len(available_days) > 1:
                        days_count = str(len(available_days))
                        event_status = f"Multi-Day ({len(available_days)} days)"
                    else:
                        days_count = "1"
                        event_status = "Single Day"
            except:
                # If we can't check, assume single day
                days_count = "1"
                event_status = "Single Day"
            
            # Insert into treeview with proper grid formatting and alternating colors
            item = self.events_tree.insert('', 'end', values=(formatted_date, event_name, event_location, days_count, event_status))
            
            # Add alternating row colors
            if len(self.events_tree.get_children()) % 2 == 0:
                self.events_tree.item(item, tags=('even',))
        
        # Store filtered events for selection
        self.filtered_events = filtered_events
        
        self.log_message(f"Filtered to {len(filtered_events)} events (filter: {filter_type}, search: '{search_text}')")
    
    def is_past(self, event):
        """Check if event is in the past"""
        try:
            event_date = datetime.fromisoformat(event.get('date', '').replace('Z', '+00:00'))
            return event_date < datetime.now()
        except:
            return False
    
    def is_recent(self, event, days):
        """Check if event is within last N days"""
        try:
            event_date = datetime.fromisoformat(event.get('date', '').replace('Z', '+00:00'))
            return (datetime.now() - event_date).days <= days
        except:
            return True
    
    def is_today(self, event):
        """Check if event is today"""
        try:
            event_date = datetime.fromisoformat(event.get('date', '').replace('Z', '+00:00'))
            return event_date.date() == datetime.now().date()
        except:
            return False
    
    def is_this_week(self, event):
        """Check if event is this week"""
        try:
            event_date = datetime.fromisoformat(event.get('date', '').replace('Z', '+00:00'))
            now = datetime.now()
            week_start = now - timedelta(days=now.weekday())
            week_end = week_start + timedelta(days=6)
            return week_start.date() <= event_date.date() <= week_end.date()
        except:
            return False
    
    def is_this_month(self, event):
        """Check if event is this month"""
        try:
            event_date = datetime.fromisoformat(event.get('date', '').replace('Z', '+00:00'))
            return event_date.month == datetime.now().month and event_date.year == datetime.now().year
        except:
            return False
    
    def on_event_tree_select(self, event):
        """Handle event selection from treeview"""
        selection = self.events_tree.selection()
        if selection:
            item = selection[0]
            index = self.events_tree.index(item)
            if hasattr(self, 'filtered_events') and index < len(self.filtered_events):
                self.current_event = self.filtered_events[index]
                
                # Update event details with better formatting
                details = "📅 EVENT DETAILS\n"
                details += "=" * 50 + "\n\n"
                details += f"🆔 Event ID: {self.current_event['id']}\n"
                details += f"📝 Name: {self.current_event.get('name', 'N/A')}\n"
                details += f"📅 Date: {self.current_event.get('date', 'N/A')}\n"
                
                # Try to get location from schedule_data JSON first, then other fields
                location = 'N/A'
                
                # Check schedule_data JSON for location
                schedule_data = self.current_event.get('schedule_data')
                if schedule_data:
                    try:
                        if isinstance(schedule_data, str):
                            import json
                            schedule_json = json.loads(schedule_data)
                            location = schedule_json.get('location', 'N/A')
                        elif isinstance(schedule_data, dict):
                            location = schedule_data.get('location', 'N/A')
                    except:
                        pass
                
                # Fallback to other possible location fields
                if location == 'N/A':
                    location = (self.current_event.get('location') or 
                              self.current_event.get('event_location') or 
                              self.current_event.get('venue') or 
                              self.current_event.get('place') or 
                              'N/A')
                details += f"📍 Location: {location}\n"
                details += f"⏰ Created: {self.current_event.get('created_at', 'N/A')}\n"
                
                self.details_text.delete(1.0, tk.END)
                self.details_text.insert(1.0, details)
                
                self.log_message(f"Selected event: {self.current_event['name']}")
                
                # Update day selector for this event
                self.update_event_day_selector()
    
    def on_event_day_change(self, event=None):
        """Handle event day selection change"""
        try:
            new_day = int(self.event_day_var.get())
            self.current_day = new_day
            self.event_day_status_var.set(f"Day {new_day}")
            self.log_message(f"Switched to day {new_day} for event")
            
            # Also update the OSC day selector
            if hasattr(self, 'day_var'):
                self.day_var.set(str(new_day))
                self.day_status_var.set(f"Day {new_day} selected")
        except Exception as e:
            self.log_message(f"Error changing event day: {e}")
    
    def update_event_day_selector(self):
        """Update the event day selector based on the selected event"""
        if hasattr(self, 'current_event') and self.current_event:
            try:
                # Get schedule data for this event to determine available days
                response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', self.current_event['id']).single().execute()
                
                if response.data and response.data.get('schedule_items'):
                    schedule_items = response.data.get('schedule_items', [])
                    available_days = set()
                    for item in schedule_items:
                        day = item.get('day', 1)
                        available_days.add(day)
                    
                    if available_days:
                        sorted_days = sorted(available_days)
                        self.event_day_combo['values'] = [str(d) for d in sorted_days]
                        self.log_message(f"Available days for {self.current_event['name']}: {sorted_days}")
                        
                        # If current day is not available, switch to the first available day
                        if self.current_day not in available_days:
                            self.current_day = sorted_days[0]
                            self.event_day_var.set(str(self.current_day))
                            self.event_day_status_var.set(f"Day {self.current_day} (auto-switched)")
                            self.log_message(f"Auto-switched to day {self.current_day}")
                        else:
                            self.event_day_var.set(str(self.current_day))
                            self.event_day_status_var.set(f"Day {self.current_day}")
                    else:
                        self.event_day_combo['values'] = ["1"]
                        self.event_day_var.set("1")
                        self.event_day_status_var.set("Day 1")
                        self.log_message("No days found, defaulting to day 1")
                else:
                    self.event_day_combo['values'] = ["1"]
                    self.event_day_var.set("1")
                    self.event_day_status_var.set("Day 1")
                    self.log_message("No schedule data found, defaulting to day 1")
            except Exception as e:
                self.log_message(f"Error updating event day selector: {e}")
                self.event_day_combo['values'] = ["1"]
                self.event_day_var.set("1")
                self.event_day_status_var.set("Day 1")
        else:
            self.event_day_combo['values'] = ["1"]
            self.event_day_var.set("1")
            self.event_day_status_var.set("Day 1")
    
    def view_event_schedule(self):
        """View schedule for selected event"""
        if self.current_event:
            try:
                self.load_event_data(self.current_event['id'])
                self.log_message(f"Loaded schedule for: {self.current_event['name']}")
                messagebox.showinfo("Success", f"Schedule loaded for: {self.current_event['name']}")
            except Exception as e:
                self.log_message(f"Error loading schedule: {e}")
                messagebox.showerror("Error", f"Failed to load schedule: {e}")
        else:
            messagebox.showwarning("Warning", "Please select an event first")
    
    def refresh_current_schedule(self):
        """Refresh the currently loaded schedule to get latest changes"""
        if hasattr(self, 'current_event_id') and self.current_event_id:
            try:
                self.log_message(f"Refreshing schedule for event: {self.current_event_id}")
                self.load_event_data(self.current_event_id)
                self.log_message(f"✅ Schedule refreshed! Now has {len(self.schedule_data)} items")
                messagebox.showinfo("Schedule Refreshed", f"Schedule updated with {len(self.schedule_data)} items")
            except Exception as e:
                self.log_message(f"Error refreshing schedule: {e}")
                messagebox.showerror("Error", f"Failed to refresh schedule: {e}")
        else:
            messagebox.showwarning("Warning", "No schedule currently loaded. Please load a schedule first.")
    
    def toggle_auto_refresh(self):
        """Toggle automatic schedule refresh"""
        if self.auto_refresh_var.get():
            self.start_auto_refresh()
        else:
            self.stop_auto_refresh()
    
    def start_auto_refresh(self):
        """Start automatic schedule refresh every 30 seconds"""
        if hasattr(self, 'current_event_id') and self.current_event_id:
            self.auto_refresh_timer = self.root.after(30000, self.auto_refresh_schedule)  # 30 seconds
            self.schedule_status_var.set("Auto-refresh ON - checking every 30s")
            self.log_message("🔄 Auto-refresh enabled - will check for schedule changes every 30 seconds")
        else:
            self.auto_refresh_var.set(False)
            messagebox.showwarning("Warning", "No schedule loaded. Please load a schedule first to enable auto-refresh.")
    
    def stop_auto_refresh(self):
        """Stop automatic schedule refresh"""
        if hasattr(self, 'auto_refresh_timer'):
            self.root.after_cancel(self.auto_refresh_timer)
        self.schedule_status_var.set("Auto-refresh OFF")
        self.log_message("⏹️ Auto-refresh disabled")
    
    def auto_refresh_schedule(self):
        """Automatically refresh schedule and check for changes"""
        if hasattr(self, 'current_event_id') and self.current_event_id and self.auto_refresh_var.get():
            try:
                # Store current item count
                old_count = len(self.schedule_data) if hasattr(self, 'schedule_data') else 0
                
                # Fetch latest schedule
                response = self.supabase.table('run_of_show_data').select('schedule_items').eq('event_id', self.current_event_id).single().execute()
                
                if response.data:
                    new_schedule = response.data.get('schedule_items', [])
                    new_count = len(new_schedule)
                    
                    if new_count != old_count:
                        # Schedule changed!
                        self.schedule_data = new_schedule
                        self.log_message(f"🔄 Schedule auto-updated! Items changed from {old_count} to {new_count}")
                        self.schedule_status_var.set(f"Updated! {new_count} items (was {old_count})")
                        
                        # Show notification
                        self.root.after(0, lambda: messagebox.showinfo("Schedule Updated", 
                            f"Schedule automatically updated!\n\nItems changed from {old_count} to {new_count}"))
                    else:
                        self.schedule_status_var.set(f"No changes - {new_count} items")
                
                # Schedule next check
                if self.auto_refresh_var.get():
                    self.auto_refresh_timer = self.root.after(30000, self.auto_refresh_schedule)
                    
            except Exception as e:
                self.log_message(f"Auto-refresh error: {e}")
                self.schedule_status_var.set("Auto-refresh error")
                # Still schedule next check
                if self.auto_refresh_var.get():
                    self.auto_refresh_timer = self.root.after(30000, self.auto_refresh_schedule)
    
    def test_osc_connection(self):
        """Test OSC connection by sending a ping to localhost"""
        try:
            test_message = create_osc_message("/ping", ["test"])
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            test_socket.sendto(test_message, ('127.0.0.1', 57130))
            test_socket.close()
            self.log_message("Test OSC ping sent to localhost:57130")
        except Exception as e:
            self.log_message(f"Test OSC connection failed: {e}")
    
    def test_simple_osc(self):
        """Test with a very simple OSC message"""
        try:
            # Send simple test message directly to our server
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            simple_message = b'/test\x00\x00\x00'  # Simple OSC address with padding
            test_socket.sendto(simple_message, ('127.0.0.1', self.osc_server.port))
            test_socket.close()
            self.log_message(f"Simple OSC test sent to port {self.osc_server.port}")
        except Exception as e:
            self.log_message(f"Simple OSC test failed: {e}")
    
    def check_server_status(self):
        """Check if the server is actually listening"""
        try:
            # Try to create a socket on the same port to see if it's in use
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            test_socket.bind(('127.0.0.1', self.osc_server.port + 1))  # Try next port
            test_socket.close()
            
            server_running = self.osc_server.running
            socket_exists = self.osc_server.socket is not None
            thread_alive = self.osc_server.thread.is_alive() if self.osc_server.thread else False
            
            status = f"""Server Status:
- Server running: {server_running}
- Socket exists: {socket_exists} 
- Thread alive: {thread_alive}
- Port: {self.osc_server.port}
- Queue size: {self.osc_server.message_queue.qsize()}"""
            
            self.log_message(status)
            
        except Exception as e:
            self.log_message(f"Error checking server status: {e}")
    
    def on_day_change(self, event=None):
        """Handle day selection change"""
        try:
            new_day = int(self.day_var.get())
            self.current_day = new_day
            self.day_status_var.set(f"Day {new_day} selected")
            self.log_message(f"Switched to day {new_day}")
            
            # Update the day combo values based on available days in the schedule
            if hasattr(self, 'schedule_data') and self.schedule_data:
                available_days = set()
                for item in self.schedule_data:
                    day = item.get('day', 1)
                    available_days.add(day)
                
                if available_days:
                    sorted_days = sorted(available_days)
                    self.day_combo['values'] = [str(d) for d in sorted_days]
                    self.log_message(f"Available days in schedule: {sorted_days}")
        except Exception as e:
            self.log_message(f"Error changing day: {e}")
    
    def update_day_selector(self):
        """Update the day selector with available days from the schedule"""
        if hasattr(self, 'schedule_data') and self.schedule_data:
            available_days = set()
            for item in self.schedule_data:
                day = item.get('day', 1)
                available_days.add(day)
            
            if available_days:
                sorted_days = sorted(available_days)
                self.day_combo['values'] = [str(d) for d in sorted_days]
                self.log_message(f"Available days in schedule: {sorted_days}")
                
                # If current day is not available, switch to the first available day
                if self.current_day not in available_days:
                    self.current_day = sorted_days[0]
                    self.day_var.set(str(self.current_day))
                    self.day_status_var.set(f"Day {self.current_day} selected (auto-switched)")
                    self.log_message(f"Auto-switched to day {self.current_day} (previous day not available)")
                else:
                    self.day_status_var.set(f"Day {self.current_day} selected")
            else:
                self.log_message("No days found in schedule")
        else:
            self.log_message("No schedule data available")

    def refresh_current_day(self):
        """Refresh the current day's data"""
        if hasattr(self, 'current_event_id') and self.current_event_id:
            try:
                self.log_message(f"Refreshing day {self.current_day} data for event: {self.current_event_id}")
                self.load_event_data(self.current_event_id)
                self.log_message(f"✅ Day {self.current_day} data refreshed! Now has {len(self.schedule_data)} items")
            except Exception as e:
                self.log_message(f"Error refreshing day data: {e}")
        else:
            self.log_message("No event loaded. Please load an event first.")

    def on_closing(self):
        """Clean shutdown"""
        self.log_message("Shutting down...")
        self.processing_messages = False
        if self.osc_server:
            self.osc_server.stop()
        self.root.destroy()

def main():
    root = tk.Tk()
    app = OSCGUIApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()

if __name__ == "__main__":
    main()