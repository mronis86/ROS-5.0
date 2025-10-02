import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import threading
import time
import json
import socket
import struct
from datetime import datetime, timedelta
import requests
import websocket
import queue
import os

# API Configuration - matches your existing API server
API_BASE_URL = os.getenv('API_BASE_URL', 'https://ros-50-production.up.railway.app')
WS_URL = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')

# Using API server which connects to Neon database

def parse_osc_message(data):
    """Simple OSC message parser"""
    try:
        null_idx = data.find(b'\x00')
        if null_idx == -1:
            return None, []
        
        address = data[:null_idx].decode('utf-8')
        padded_addr_len = ((null_idx + 1) + 3) // 4 * 4
        
        if len(data) <= padded_addr_len:
            return address, []
        
        type_start = padded_addr_len
        if type_start >= len(data) or data[type_start:type_start+1] != b',':
            return address, []
        
        type_null = data.find(b'\x00', type_start)
        if type_null == -1:
            return address, []
        
        type_tags = data[type_start+1:type_null].decode('utf-8')
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
    
    addr_bytes = address.encode('utf-8') + b'\x00'
    addr_padded = addr_bytes + b'\x00' * (4 - len(addr_bytes) % 4) % 4
    
    if not args:
        return addr_padded
    
    type_tag = ',' + ''.join(['s' if isinstance(arg, str) else 'i' if isinstance(arg, int) else 'f' for arg in args])
    type_bytes = type_tag.encode('utf-8') + b'\x00'
    type_padded = type_bytes + b'\x00' * (4 - len(type_bytes) % 4) % 4
    
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
            self.socket.settimeout(1.0)
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
                self.message_queue.put((data, addr))
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:
                    print(f"Socket receive error: {e}")
    
    def send_response(self, address, args, client_addr):
        """Send OSC response to client"""
        try:
            response = create_osc_message(address, args)
            self.socket.sendto(response, client_addr)
        except Exception as e:
            print(f"Error sending response: {e}")

class WebSocketOSCApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Run of Show - WebSocket OSC Control Panel")
        self.root.geometry("1200x900")
        
        # API Configuration
        self.api_base_url = API_BASE_URL
        self.ws_url = WS_URL
        
        # Using API server (connects to Neon database)
        
        # OSC Server
        self.osc_server = OSCServer()
        
        # Current event and data
        self.current_event = None
        self.current_event_id = None
        self.schedule_data = []
        self.active_item_id = None
        self.events = []
        self.current_day = 1
        
        # Authentication
        self.user = None
        self.authenticated = False
        
        # WebSocket connection
        self.websocket = None
        self.ws_connected = False
        
        # Message processing
        self.processing_messages = False
        
        self.setup_ui()
        self.start_osc_server()
        self.start_message_processor()
        self.connect_websocket()
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
        
        # Email input with adjusted styling
        email_frame = ttk.Frame(signin_frame)
        email_frame.pack(fill='x', pady=(0, 20))
        
        ttk.Label(email_frame, text="📧 Email:", font=('Arial', 12, 'bold')).pack(anchor='w')
        self.email_var = tk.StringVar()
        email_entry = ttk.Entry(email_frame, textvariable=self.email_var, width=30, font=('Arial', 14))
        email_entry.pack(fill='x', pady=(8, 0))
        
        # Password input with adjusted styling
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
        direct_frame = ttk.LabelFrame(main_frame, text="🔓 API Server Connection", padding=25)
        direct_frame.pack(fill='x')
        
        info_text = "The API server doesn't require authentication.\nUser identification is handled via user_id in API requests.\nYou can load events directly or set a user name for OSC commands."
        ttk.Label(direct_frame, text=info_text, font=('Arial', 11), foreground='gray', justify='left').pack(anchor='w', pady=(0, 20))
        
        direct_btn = ttk.Button(direct_frame, text="📂 Load Events Directly", command=self.load_events_direct, style='Accent.TButton')
        direct_btn.pack(anchor='w')
    
    def setup_events_tab(self, parent):
        main_frame = ttk.Frame(parent)
        main_frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Events list section
        events_frame = ttk.LabelFrame(main_frame, text="Events")
        events_frame.pack(fill='both', expand=True, pady=(0, 10))
        
        list_container = ttk.Frame(events_frame)
        list_container.pack(fill='both', expand=True, padx=10, pady=10)
        
        columns = ('date', 'name', 'location', 'days', 'status')
        self.events_tree = ttk.Treeview(list_container, columns=columns, show='headings', height=8)
        
        self.events_tree.heading('date', text='📅 Date')
        self.events_tree.heading('name', text='📝 Event Name')
        self.events_tree.heading('location', text='📍 Location')
        self.events_tree.heading('days', text='📆 Days')
        self.events_tree.heading('status', text='🔄 Status')
        
        self.events_tree.column('date', width=120, anchor='center')
        self.events_tree.column('name', width=300, anchor='w')
        self.events_tree.column('location', width=200, anchor='w')
        self.events_tree.column('days', width=80, anchor='center')
        self.events_tree.column('status', width=100, anchor='center')
        
        scrollbar = ttk.Scrollbar(list_container, orient='vertical', command=self.events_tree.yview)
        self.events_tree.configure(yscrollcommand=scrollbar.set)
        
        self.events_tree.pack(side='left', fill='both', expand=True, padx=(0, 5))
        scrollbar.pack(side='right', fill='y')
        
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
        
        # Action buttons
        action_frame = ttk.LabelFrame(main_frame, text="Actions")
        action_frame.pack(fill='x', pady=(10, 0))
        
        active_frame = ttk.Frame(action_frame)
        active_frame.pack(fill='x', padx=10, pady=5)
        
        ttk.Label(active_frame, text="Active Event:", font=('TkDefaultFont', 10, 'bold')).pack(side='left')
        self.active_event_var = tk.StringVar(value="None selected")
        ttk.Label(active_frame, textvariable=self.active_event_var, font=('TkDefaultFont', 10, 'bold')).pack(side='left', padx=(10, 0))
        
        # Day selection
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
        
        # WebSocket status
        ws_frame = ttk.LabelFrame(parent, text="WebSocket Connection")
        ws_frame.pack(fill='x', padx=5, pady=5)
        
        self.ws_status_var = tk.StringVar(value="Connecting...")
        ttk.Label(ws_frame, textvariable=self.ws_status_var).pack(pady=5)
        
        # Day selector
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
        
        commands_text = """OSC Commands (WebSocket + API powered):
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

WebSocket Features:
- Real-time updates (no polling)
- Minimal egress usage
- Same API as web application
- Automatic reconnection"""
        
        cmd_text_widget = scrolledtext.ScrolledText(commands_frame, height=12, width=60)
        cmd_text_widget.pack(pady=5, fill='both', expand=True)
        cmd_text_widget.insert('1.0', commands_text)
        cmd_text_widget.config(state='disabled')
    
    def setup_log_tab(self, parent):
        # Create main frame for log tab
        main_frame = ttk.Frame(parent)
        main_frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Log display section
        log_section = ttk.LabelFrame(main_frame, text="Activity Log")
        log_section.pack(fill='both', expand=True, pady=(0, 10))
        
        # Create log text widget with scrollbar
        self.log_text = scrolledtext.ScrolledText(log_section, height=20, wrap=tk.WORD)
        self.log_text.pack(fill='both', expand=True, padx=5, pady=5)
        
        # Configure log text colors
        self.log_text.tag_configure("info", foreground="black")
        self.log_text.tag_configure("success", foreground="green")
        self.log_text.tag_configure("error", foreground="red")
        self.log_text.tag_configure("warning", foreground="orange")
        
        # Button frame
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(fill='x', pady=5)
        
        # Log control buttons
        ttk.Button(button_frame, text="Clear Log", command=self.clear_log).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Test OSC Connection", command=self.test_osc_connection).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Test WebSocket", command=self.test_websocket).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Add Test Message", command=self.add_test_log_message).pack(side='left', padx=5)
        
        # Add initial log message
        self.log_message("Log tab initialized - ready for activity", "info")
    
    def log_message(self, message, level="info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}\n"
        
        self.root.after(0, self._update_log, log_entry, level)
        print(log_entry.strip())
    
    def _update_log(self, log_entry, level="info"):
        # Insert the log entry
        start_pos = self.log_text.index(tk.END)
        self.log_text.insert(tk.END, log_entry)
        end_pos = self.log_text.index(tk.END)
        
        # Apply color tag based on level
        if level in ["success", "error", "warning", "info"]:
            self.log_text.tag_add(level, start_pos, end_pos)
        
        # Auto-scroll to bottom
        self.log_text.see(tk.END)
    
    def add_test_log_message(self):
        """Add a test message to the log"""
        self.log_message("Test message added to log", "info")
    
    def clear_log(self):
        self.log_text.delete(1.0, tk.END)
    
    def connect_websocket(self):
        """Connect to WebSocket for real-time updates"""
        try:
            self.websocket = websocket.WebSocketApp(
                f"{self.ws_url}/socket.io/?EIO=4&transport=websocket",
                on_open=self.on_ws_open,
                on_message=self.on_ws_message,
                on_error=self.on_ws_error,
                on_close=self.on_ws_close
            )
            
            # Start WebSocket in separate thread
            ws_thread = threading.Thread(target=self.websocket.run_forever, daemon=True)
            ws_thread.start()
            
            self.log_message("WebSocket connection initiated", "info")
        except Exception as e:
            self.log_message(f"WebSocket connection failed: {e}", "error")
            self.ws_status_var.set("Connection failed")
    
    def on_ws_open(self, ws):
        """WebSocket opened"""
        self.ws_connected = True
        self.ws_status_var.set("Connected")
        self.log_message("WebSocket connected", "success")
        
        # Join event room if we have an active event
        if self.current_event_id:
            self.join_event_room(self.current_event_id)
    
    def on_ws_message(self, ws, message):
        """Handle WebSocket messages"""
        try:
            # Parse Socket.IO message
            if message.startswith('42'):
                # Extract JSON data
                json_data = message[2:]
                data = json.loads(json_data)
                
                if isinstance(data, list) and len(data) >= 2:
                    event_type = data[0]
                    event_data = data[1]
                    
                    self.handle_websocket_event(event_type, event_data)
        except Exception as e:
            self.log_message(f"WebSocket message error: {e}")
    
    def on_ws_error(self, ws, error):
        """WebSocket error"""
        self.log_message(f"WebSocket error: {error}", "error")
        self.ws_status_var.set("Error")
    
    def on_ws_close(self, ws, close_status_code, close_msg):
        """WebSocket closed"""
        self.ws_connected = False
        self.ws_status_var.set("Disconnected")
        self.log_message("WebSocket disconnected", "warning")
        
        # Attempt reconnection after 5 seconds
        self.root.after(5000, self.connect_websocket)
    
    def handle_websocket_event(self, event_type, event_data):
        """Handle different WebSocket event types"""
        if event_type == 'timerUpdated':
            self.log_message(f"Timer updated: {event_data}")
        elif event_type == 'activeTimersUpdated':
            self.log_message(f"Active timers updated: {event_data}")
        elif event_type == 'runOfShowDataUpdated':
            self.log_message(f"Schedule data updated: {event_data}")
            # Refresh schedule if it's for our current event
            if event_data.get('event_id') == self.current_event_id:
                self.refresh_current_schedule()
        elif event_type == 'resetAllStates':
            self.log_message("All states reset")
            self.active_item_id = None
    
    def join_event_room(self, event_id):
        """Join WebSocket room for specific event"""
        if self.websocket and self.ws_connected:
            try:
                # Send join room message
                join_message = f'42["joinEventRoom","{event_id}"]'
                self.websocket.send(join_message)
                self.log_message(f"Joined event room: {event_id}")
            except Exception as e:
                self.log_message(f"Failed to join event room: {e}")
    
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
                data, addr = self.osc_server.message_queue.get(timeout=1.0)
                address, args = parse_osc_message(data)
                if address:
                    self.log_message(f"OSC Message: {address} {args}")
                    threading.Thread(target=self._handle_osc_command, 
                                   args=(address, args, addr), daemon=True).start()
            except queue.Empty:
                continue
            except Exception as e:
                self.log_message(f"Error processing message: {e}")
    
    def _handle_osc_command(self, address, args, client_addr):
        """Handle OSC command using API instead of direct database"""
        try:
            parts = address.split('/')[1:]
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
                        self.osc_server.send_response('/timer/reset', ['success'], client_addr)
                        
            elif command == 'subtimer':
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
    
    def load_events(self):
        """Load events via API (Neon database)"""
        try:
            self.log_message("Loading events from API (Neon database)...")
            response = requests.get(f"{self.api_base_url}/api/calendar-events")
            
            if response.status_code == 200:
                self.events = response.json()
                self.populate_events_tree()
                self.log_message(f"Loaded {len(self.events)} events from Neon database")
            else:
                self.log_message(f"Failed to load events: {response.status_code}")
                
        except Exception as e:
            self.log_message(f"Error loading events: {e}")
    
    def populate_events_tree(self):
        """Populate events tree with loaded data"""
        for item in self.events_tree.get_children():
            self.events_tree.delete(item)
        
        for event in self.events:
            event_name = event.get('name', 'Unnamed')
            event_date = event.get('date', 'No date')
            event_location = event.get('location', 'No location')
            
            # Format date
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
            
            # Insert into treeview
            self.events_tree.insert('', 'end', values=(
                formatted_date, event_name, event_location, "1", "Single Day"
            ))
    
    def load_event_data(self, event_id):
        """Load event data via API instead of direct database"""
        try:
            self.log_message(f"Loading event: {event_id}")
            
            # Use API endpoint instead of direct database
            response = requests.get(f"{self.api_base_url}/api/run-of-show/{event_id}")
            
            if response.status_code == 200:
                data = response.json()
                self.schedule_data = data.get('schedule_items', [])
                self.current_event_id = event_id
                
                # Update UI
                self.root.after(0, self.active_event_var.set, f"Event: {event_id}")
                
                self.log_message(f"Event '{event_id}' loaded with {len(self.schedule_data)} schedule items")
                
                # Join WebSocket room for this event
                self.join_event_room(event_id)
                
                # Update day selector
                self.update_day_selector()
            else:
                raise Exception(f"Event not found: {event_id}")
                
        except Exception as e:
            self.log_message(f"Error loading event: {e}")
            raise e
    
    def load_cue(self, cue_name):
        """Load cue via API instead of direct database"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message(f"Loading cue: {cue_name} for day {self.current_day}")
        
        # Find the cue in the schedule for the current day
        item = None
        for schedule_item in self.schedule_data:
            cue_matches = (schedule_item.get('cue') == cue_name or 
                          schedule_item.get('customFields', {}).get('cue') == cue_name or
                          schedule_item.get('customFields', {}).get('cue') == f'CUE{cue_name}')
            
            item_day = schedule_item.get('day', 1)
            day_matches = (item_day == self.current_day)
            
            if cue_matches and day_matches:
                item = schedule_item
                break
        
        if not item:
            raise Exception(f'Cue {cue_name} not found for day {self.current_day}')
        
        # Use API to load cue instead of direct database RPC
        try:
            response = requests.post(f"{self.api_base_url}/api/cues/load", {
                'event_id': self.current_event_id,
                'item_id': str(item['id']),
                'user_id': 'python-osc-server'
            })
            
            if response.status_code == 200:
                self.active_item_id = item['id']
                self.log_message(f"Cue '{cue_name}' loaded successfully (Item ID: {item['id']})")
            else:
                raise Exception(f'Failed to load cue: {response.text}')
                
        except Exception as e:
            self.log_message(f"API Error: {e}")
            raise Exception(f'Failed to load cue: {str(e)}')
    
    def start_timer(self):
        """Start timer via API instead of direct database"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        if not self.active_item_id:
            raise Exception('No active item found for timer start')
        
        self.log_message(f"Starting timer for item: {self.active_item_id}")
        
        try:
            response = requests.post(f"{self.api_base_url}/api/timers/start", {
                'event_id': self.current_event_id,
                'item_id': str(self.active_item_id),
                'user_id': 'python-osc-server'
            })
            
            if response.status_code == 200:
                self.log_message(f"Timer started for item: {self.active_item_id}")
            else:
                raise Exception('Failed to start timer')
                
        except Exception as e:
            self.log_message(f"Error starting timer: {e}")
            raise e
    
    def stop_timer(self):
        """Stop timer via API instead of direct database"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message(f"Stopping timer for item: {self.active_item_id}")
        
        try:
            response = requests.post(f"{self.api_base_url}/api/timers/stop", {
                'event_id': self.current_event_id,
                'item_id': str(self.active_item_id)
            })
            
            if response.status_code == 200:
                self.log_message(f"Timer stopped successfully")
            else:
                self.log_message("Timer stop - no records were updated")
                
        except Exception as e:
            self.log_message(f"Error stopping timer: {e}")
            raise e
    
    def reset_main_timer(self):
        """Reset main timer via API instead of direct database"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message("Performing complete reset via API...")
        
        try:
            # Use API endpoint for reset instead of direct database operations
            response = requests.post(f"{self.api_base_url}/api/timers/reset", {
                'event_id': self.current_event_id
            })
            
            if response.status_code == 200:
                self.active_item_id = None
                self.log_message("Complete reset finished - all highlighting and states cleared")
            else:
                raise Exception('Failed to reset timer')
                
        except Exception as error:
            self.log_message(f"Error during reset: {error}")
            raise error
    
    def handle_sub_timer(self, cue_number, action):
        """Handle sub timer via API instead of direct database"""
        if not self.current_event_id:
            raise Exception('No event loaded. Please set an event first.')
        
        self.log_message(f"Sub-timer {action} for cue: {cue_number} on day {self.current_day}")
        
        # Find the item with the specified cue number for the current day
        item = None
        for schedule_item in self.schedule_data:
            cue_matches = (str(schedule_item.get('cue', '')) == str(cue_number) or
                          str(schedule_item.get('customFields', {}).get('cue', '')) == str(cue_number))
            
            item_day = schedule_item.get('day', 1)
            day_matches = (item_day == self.current_day)
            
            if cue_matches and day_matches:
                item = schedule_item
                break
        
        if not item:
            raise Exception(f'Cue {cue_number} not found for day {self.current_day}')
        
        try:
            if action == 'start':
                response = requests.post(f"{self.api_base_url}/api/sub-timers/start", {
                    'event_id': self.current_event_id,
                    'item_id': str(item['id']),
                    'user_id': 'python-osc-server'
                })
            elif action == 'stop':
                response = requests.post(f"{self.api_base_url}/api/sub-timers/stop", {
                    'event_id': self.current_event_id,
                    'item_id': str(item['id'])
                })
            
            if response.status_code == 200:
                self.log_message(f"Sub-timer {action} for cue '{cue_number}' (Item ID: {item['id']})")
            else:
                raise Exception(f'Failed to {action} sub-timer')
                
        except Exception as e:
            self.log_message(f"API Error: {e}")
            raise Exception(f'Failed to {action} sub-timer: {str(e)}')
    
    def list_events_osc(self, client_addr):
        """List events via OSC"""
        try:
            for i, event in enumerate(self.events):
                event_info = f"{i + 1}. Event ID: {event['id']}\n   Name: {event.get('name', 'Unnamed')}\n   Date: {event.get('date', 'Unknown')}"
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
            day_items = [item for item in self.schedule_data if item.get('day', 1) == self.current_day]
            status_message = (f"Event: {self.current_event_id}, Day: {self.current_day}, "
                            f"Day Items: {len(day_items)}, Total Items: {len(self.schedule_data)}, "
                            f"Active: {self.active_item_id or 'None'}")
        else:
            status_message = 'No event loaded'
        
        self.osc_server.send_response('/status/info', [status_message], client_addr)
        self.log_message("Status sent")
    
    def on_event_tree_select(self, event):
        """Handle event selection from treeview"""
        selection = self.events_tree.selection()
        if selection:
            item = selection[0]
            index = self.events_tree.index(item)
            if index < len(self.events):
                self.current_event = self.events[index]
                
                # Update event details
                details = "📅 EVENT DETAILS\n"
                details += "=" * 50 + "\n\n"
                details += f"🆔 Event ID: {self.current_event['id']}\n"
                details += f"📝 Name: {self.current_event.get('name', 'N/A')}\n"
                details += f"📅 Date: {self.current_event.get('date', 'N/A')}\n"
                details += f"📍 Location: {self.current_event.get('location', 'N/A')}\n"
                details += f"⏰ Created: {self.current_event.get('created_at', 'N/A')}\n"
                
                self.details_text.delete(1.0, tk.END)
                self.details_text.insert(1.0, details)
                
                self.log_message(f"Selected event: {self.current_event['name']}")
    
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
    
    def on_day_change(self, event=None):
        """Handle day selection change"""
        try:
            new_day = int(self.day_var.get())
            self.current_day = new_day
            self.day_status_var.set(f"Day {new_day} selected")
            self.log_message(f"Switched to day {new_day}")
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
                    self.log_message(f"Auto-switched to day {self.current_day}")
                else:
                    self.day_status_var.set(f"Day {self.current_day} selected")
            else:
                self.log_message("No days found in schedule")
        else:
            self.log_message("No schedule data available")
    
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
    
    def test_websocket(self):
        """Test WebSocket connection"""
        if self.ws_connected:
            self.log_message("WebSocket is connected")
        else:
            self.log_message("WebSocket is not connected - attempting reconnection")
            self.connect_websocket()
    
    def check_authentication(self):
        """Check authentication status and load events"""
        try:
            # API server doesn't have authentication endpoints
            # Users are identified by user_id in request body
            self.auth_status_var.set("No authentication required - using user_id in requests")
            self.log_message("No authentication required - using user_id in API requests")
            self.load_events()
        except Exception as e:
            self.log_message(f"Error checking authentication: {e}")
            self.auth_status_var.set("Authentication error")
    
    def sign_in(self):
        """Sign in - simplified for API server without auth endpoints"""
        email = self.email_var.get()
        password = self.password_var.get()
        
        if not email or not password:
            messagebox.showerror("Error", "Please enter both email and password")
            return
        
        try:
            # API server doesn't have authentication endpoints
            # Just set user info locally for OSC commands
            self.user = {"email": email, "id": f"user_{hash(email) % 10000}"}
            self.authenticated = True
            self.auth_status_var.set(f"User set as: {email}")
            self.load_events()
            self.log_message(f"User set as: {email} (no server authentication)")
            messagebox.showinfo("Success", f"User set as: {email}")
        except Exception as e:
            self.log_message(f"Sign in error: {e}")
            messagebox.showerror("Error", f"Sign in failed: {e}")
    
    def sign_up(self):
        """Sign up - simplified for API server without auth endpoints"""
        email = self.email_var.get()
        password = self.password_var.get()
        
        if not email or not password:
            messagebox.showerror("Error", "Please enter both email and password")
            return
        
        try:
            # API server doesn't have authentication endpoints
            # Just set user info locally for OSC commands
            self.user = {"email": email, "id": f"user_{hash(email) % 10000}"}
            self.authenticated = True
            self.auth_status_var.set(f"User set as: {email}")
            self.load_events()
            self.log_message(f"User set as: {email} (no server authentication)")
            messagebox.showinfo("Success", f"User set as: {email}")
        except Exception as e:
            self.log_message(f"Sign up error: {e}")
            messagebox.showerror("Error", f"Sign up failed: {e}")
    
    def sign_out(self):
        """Sign out"""
        try:
            self.user = None
            self.authenticated = False
            self.auth_status_var.set("Not authenticated")
            self.events = []
            self.log_message("Signed out successfully")
            messagebox.showinfo("Success", "Signed out successfully")
        except Exception as e:
            self.log_message(f"Sign out error: {e}")
            messagebox.showerror("Error", f"Sign out failed: {e}")
    
    def load_events_direct(self):
        """Load events via API (Neon database) - same as authenticated load"""
        try:
            self.log_message("Loading events via API (Neon database)...")
            response = requests.get(f"{self.api_base_url}/api/calendar-events")
            
            if response.status_code == 200:
                self.events = response.json()
                self.populate_events_tree()
                self.log_message(f"Loaded {len(self.events)} events from Neon database")
            else:
                self.log_message(f"Failed to load events: {response.status_code}")
                messagebox.showerror("Error", f"Failed to load events: {response.status_code}")
        except Exception as e:
            self.log_message(f"Error loading events: {e}")
            messagebox.showerror("Error", f"Failed to load events: {e}")

    def on_closing(self):
        """Clean shutdown"""
        self.log_message("Shutting down...")
        self.processing_messages = False
        if self.osc_server:
            self.osc_server.stop()
        if self.websocket:
            self.websocket.close()
        self.root.destroy()

def main():
    root = tk.Tk()
    app = WebSocketOSCApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()

if __name__ == "__main__":
    main()
