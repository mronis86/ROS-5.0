"""
ROS OSC Control - Electron-style Python app.
No sign-in. Upcoming / Past event tabs. Click event to load and control.
"""
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import threading
import json
import socket
import struct
from datetime import datetime
import requests
import socketio
import queue
import os

# API Configuration (same pattern as websocket_osc_app.py)
API_BASE_URL = os.getenv('API_BASE_URL', 'https://ros-50-production.up.railway.app')
# API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:3002')  # Uncomment for local
_osc_port_env = os.getenv('OSC_LISTEN_PORT', '57121')
try:
    OSC_PORT = int(_osc_port_env) if _osc_port_env else 57121
except (ValueError, TypeError):
    OSC_PORT = 57121

WS_URL = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
print(f"Using API: {API_BASE_URL}, OSC port: {OSC_PORT}")


def parse_osc_message(data):
    """Simple OSC message parser."""
    try:
        null_idx = data.find(b'\x00')
        if null_idx == -1:
            return None, []
        address = data[:null_idx].decode('utf-8')
        padded_addr_len = ((null_idx + 1) + 3) // 4 * 4
        if len(data) <= padded_addr_len:
            return address, []
        type_start = padded_addr_len
        if type_start >= len(data) or data[type_start:type_start + 1] != b',':
            return address, []
        type_null = data.find(b'\x00', type_start)
        if type_null == -1:
            return address, []
        type_tags = data[type_start + 1:type_null].decode('utf-8')
        args = []
        padded_type_len = ((type_null + 1) + 3) // 4 * 4
        arg_start = padded_type_len
        for tag in type_tags:
            if arg_start >= len(data):
                break
            if tag == 's':
                str_end = data.find(b'\x00', arg_start)
                if str_end == -1:
                    break
                args.append(data[arg_start:str_end].decode('utf-8'))
                arg_start = ((str_end + 1) + 3) // 4 * 4
            elif tag == 'i':
                if arg_start + 4 > len(data):
                    break
                args.append(struct.unpack('>i', data[arg_start:arg_start + 4])[0])
                arg_start += 4
            elif tag == 'f':
                if arg_start + 4 > len(data):
                    break
                args.append(struct.unpack('>f', data[arg_start:arg_start + 4])[0])
                arg_start += 4
        return address, args
    except Exception:
        return None, []


def create_osc_message(address, args=None):
    """Create OSC message bytes."""
    if args is None:
        args = []
    addr_bytes = address.encode('utf-8') + b'\x00'
    addr_padding = (4 - len(addr_bytes) % 4) % 4
    addr_padded = addr_bytes + (b'\x00' * addr_padding)
    if not args:
        return addr_padded
    type_tag = ',' + ''.join(
        ['s' if isinstance(a, str) else 'i' if isinstance(a, int) else 'f' for a in args]
    )
    type_bytes = type_tag.encode('utf-8') + b'\x00'
    type_padding = (4 - len(type_bytes) % 4) % 4
    type_padded = type_bytes + (b'\x00' * type_padding)
    arg_bytes = b''
    for arg in args:
        if isinstance(arg, str):
            s = arg.encode('utf-8') + b'\x00'
            s += b'\x00' * ((4 - len(s) % 4) % 4)
            arg_bytes += s
        elif isinstance(arg, int):
            arg_bytes += struct.pack('>i', arg)
        elif isinstance(arg, float):
            arg_bytes += struct.pack('>f', arg)
    return addr_padded + type_padded + arg_bytes


class OSCServer:
    def __init__(self, port=57121):
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
        except Exception:
            return False

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
            except Exception:
                pass

    def send_response(self, address, args, client_addr):
        try:
            response = create_osc_message(address, args)
            self.socket.sendto(response, client_addr)
        except Exception:
            pass


class ROSOSCPythonApp:
    """Electron-style: no sign-in, Upcoming/Past events, click to load."""

    def __init__(self, root):
        self.root = root
        self.root.title("ROS OSC Control")
        self.root.geometry("880x560")
        self.root.minsize(720, 440)

        self.api_base_url = API_BASE_URL
        self.osc_server = OSCServer(port=OSC_PORT)
        self.current_event = None
        self.current_event_id = None
        self.schedule_data = []
        self.active_item_id = None
        self.timer_progress = {}   # item_id -> { elapsed, total, started_at } (like Electron)
        self.active_timers = {}    # item_id -> True/False is_running (like Electron)
        self._timer_tick_id = None  # after() id for 1s tick
        self._tick_count = 0       # throttle full schedule redraw (every 5s)
        self._last_schedule_fetch_time = 0.0  # throttle socket-triggered fetches (avoid lots of API calls)
        self.auto_refresh_interval_sec = 30  # 0 = off; used when auto-refresh is enabled
        self._auto_refresh_after_id = None
        self.start_cue_id = None  # item_id of row marked as SHOW START (STAR)
        self.all_events = []
        self.filtered_events = []
        self.current_filter = 'upcoming'
        self.current_day = 1
        self.sio = None
        self.ws_connected = False
        self.processing_messages = False

        # Build UI (same order as working websocket_osc_app: setup_ui then start services)
        self.container = ttk.Frame(self.root, padding=6)
        self.container.pack(fill='both', expand=True)
        self.event_list_frame = ttk.Frame(self.container)
        self.run_of_show_frame = ttk.Frame(self.container)
        self._build_event_list_page()
        self._build_run_of_show_page()
        self._show_page('event_list')

        self.start_osc_server()
        self.start_message_processor()
        self.connect_websocket()
        self.load_events()

    def _show_page(self, page):
        if page == 'event_list':
            self.event_list_frame.pack(fill='both', expand=True)
            self.run_of_show_frame.pack_forget()
        else:
            self.event_list_frame.pack_forget()
            self.run_of_show_frame.pack(fill='both', expand=True)

    def _build_event_list_page(self):
        # Single header row: title + tabs + refresh
        header = ttk.Frame(self.event_list_frame)
        header.pack(fill='x', pady=(0, 6))
        ttk.Label(header, text="Select Event", font=('Arial', 11, 'bold')).pack(side='left')
        self.event_filter_var = tk.StringVar(value='upcoming')
        ttk.Radiobutton(header, text="Upcoming", variable=self.event_filter_var, value='upcoming', command=lambda: self._set_event_filter('upcoming')).pack(side='left', padx=(16, 8))
        ttk.Radiobutton(header, text="Past", variable=self.event_filter_var, value='past', command=lambda: self._set_event_filter('past')).pack(side='left', padx=(0, 12))
        ttk.Label(header, text=f"API: {self.api_base_url}", font=('Arial', 9), foreground='gray').pack(side='left', padx=(0, 8))
        ttk.Button(header, text="Refresh", command=self.load_events).pack(side='right')

        # Event list (Treeview) – compact
        list_frame = ttk.LabelFrame(self.event_list_frame, text="Events", padding=5)
        list_frame.pack(fill='both', expand=True, pady=(0, 4))
        columns = ('date', 'name', 'location', 'days')
        self.events_tree = ttk.Treeview(list_frame, columns=columns, show='headings', height=10, selectmode='browse')
        self.events_tree.heading('date', text='Date')
        self.events_tree.heading('name', text='Event Name')
        self.events_tree.heading('location', text='Location')
        self.events_tree.heading('days', text='Days')
        self.events_tree.column('date', width=88)
        self.events_tree.column('name', width=280)
        self.events_tree.column('location', width=140)
        self.events_tree.column('days', width=44)
        scrollbar = ttk.Scrollbar(list_frame, orient='vertical', command=self.events_tree.yview)
        self.events_tree.configure(yscrollcommand=scrollbar.set)
        self.events_tree.pack(side='left', fill='both', expand=True, padx=(0, 4))
        scrollbar.pack(side='right', fill='y')
        self.events_tree.bind('<<TreeviewSelect>>', self._on_event_list_select)
        self.events_tree.bind('<Double-1>', self._on_event_double_click)

        # Load button row
        action_frame = ttk.Frame(self.event_list_frame)
        action_frame.pack(fill='x', pady=(2, 0))
        ttk.Label(action_frame, text="Double-click or select and Load", font=('Arial', 9), foreground='gray').pack(side='left')
        ttk.Button(action_frame, text="Load Event", command=self._load_selected_event).pack(side='right')

    def _set_event_filter(self, filter_name):
        self.current_filter = filter_name
        self.event_filter_var.set(filter_name)
        self._filter_and_show_events()

    def _filter_and_show_events(self):
        today = datetime.now().date()
        self.filtered_events = []
        for ev in self.all_events:
            d = ev.get('date')
            if not d:
                continue
            if isinstance(d, str) and 'T' in d:
                d = d.split('T')[0]
            try:
                parts = d.split('-')
                if len(parts) != 3:
                    continue
                y, m, day = int(parts[0]), int(parts[1]), int(parts[2])
                event_date = datetime(y, m, day).date()
                if self.current_filter == 'upcoming' and event_date >= today:
                    self.filtered_events.append(ev)
                elif self.current_filter == 'past' and event_date < today:
                    self.filtered_events.append(ev)
            except (ValueError, IndexError):
                continue
        self._populate_events_tree()

    def _populate_events_tree(self):
        for item in self.events_tree.get_children():
            self.events_tree.delete(item)
        for ev in self.filtered_events:
            name = ev.get('name', 'Unnamed')
            date_str = ev.get('date', '')
            if isinstance(date_str, str) and 'T' in date_str:
                date_str = date_str.split('T')[0]
            try:
                parts = date_str.split('-')
                if len(parts) == 3:
                    y, m, d = map(int, parts)
                    date_display = f"{m}/{d}/{y}"
                else:
                    date_display = date_str
            except (ValueError, IndexError):
                date_display = date_str
            location = ev.get('location', '—')
            num_days = 1
            if ev.get('schedule_data'):
                sd = ev['schedule_data']
                if isinstance(sd, str):
                    try:
                        sd = json.loads(sd)
                    except Exception:
                        pass
                if isinstance(sd, dict):
                    num_days = sd.get('numberOfDays', 1)
            self.events_tree.insert('', 'end', values=(date_display, name, location, str(num_days)))

    def _on_event_list_select(self, event=None):
        pass  # Selection tracked for Load button

    def _on_event_double_click(self, event=None):
        self._load_selected_event()

    def _load_selected_event(self):
        sel = self.events_tree.selection()
        if not sel:
            messagebox.showinfo("Select Event", "Select an event from the list first (or double-click one).")
            return
        item = sel[0]
        idx = self.events_tree.index(item)
        if idx < 0 or idx >= len(self.filtered_events):
            return
        ev = self.filtered_events[idx]
        event_id = ev.get('id')
        if not event_id:
            messagebox.showerror("Error", "Event has no ID.")
            return
        self._open_event(event_id, ev)

    def _open_event(self, event_id, ev=None):
        """Load event in background so GUI stays responsive."""
        self.log_message(f"Loading event: {event_id}", "info")
        api_base = self.api_base_url
        root = self.root
        ev_ref = ev or next(
            (e for e in (self.all_events or []) if str(e.get('id')) == str(event_id)),
            None
        )
        if not ev_ref:
            ev_ref = {'id': event_id, 'name': 'Event', 'date': '', 'location': ''}

        def do_load():
            r1 = r2 = r3 = None
            try:
                r1 = requests.get(f"{api_base}/api/run-of-show-data/{event_id}", timeout=15)
                if r1.status_code != 200:
                    root.after(0, lambda: self.log_message(f"Event not found: {event_id}", "error"))
                    root.after(0, lambda: messagebox.showerror("Error", f"Event not found: {event_id}"))
                    return
                r2 = requests.get(f"{api_base}/api/active-timers/{event_id}", timeout=10)
                r3 = requests.get(f"{api_base}/api/start-cue-selection/{event_id}", timeout=10)
            except Exception as e:
                root.after(0, lambda: self.log_message(f"Error loading event: {e}", "error"))
                root.after(0, lambda: messagebox.showerror("Error", str(e)))
                return
            root.after(0, lambda: self._apply_event_loaded(r1, r2, r3, event_id, ev_ref))

        threading.Thread(target=do_load, daemon=True).start()

    def _apply_event_loaded(self, r1, r2, r3, event_id, ev_ref):
        """Apply loaded event data on main thread (no blocking)."""
        try:
            data = r1.json()
            self.schedule_data = data.get('schedule_items', []) or []
            self.current_event_id = event_id
            self.current_event = ev_ref
            self.active_item_id = None
            self.active_timers = {}
            self.timer_progress = {}
            self._stop_timer_tick()
            self.start_cue_id = None

            days_set = set()
            for item in self.schedule_data:
                days_set.add(item.get('day', 1))
            sorted_days = sorted(days_set) if days_set else [1]
            self.day_combo['values'] = [str(d) for d in sorted_days]
            self.current_day = sorted_days[0]
            self.day_combo.set(str(self.current_day))

            self.event_name_var.set(self.current_event.get('name', 'Event'))
            self.event_date_var.set(self.current_event.get('date', '')[:10] if self.current_event.get('date') else '')
            self.active_event_var.set(f"Event: {self.current_event.get('name', event_id)}")
            self._show_page('run_of_show')

            # Apply timer state from r2 (same logic as _apply_refresh_results)
            if r2 and r2.status_code == 200:
                rows = r2.json()
                record = (rows[0] if rows else None) if isinstance(rows, list) else rows
                if not record or not (record.get('is_active') or record.get('isActive')):
                    self.active_item_id = None
                    self.active_timers = {}
                    self.timer_progress = {}
                    self._stop_timer_tick()
                else:
                    item_id_raw = record.get('item_id') if record.get('item_id') is not None else record.get('itemId')
                    item_id = int(item_id_raw) if item_id_raw is not None else None
                    if item_id is not None:
                        self.active_item_id = item_id
                        started_at_val = record.get('started_at') or record.get('startedAt')
                        is_running = (
                            record.get('is_running', record.get('isRunning', False))
                            or (record.get('timer_state') == 'running')
                            or (record.get('timerState') == 'running')
                            or (started_at_val and str(started_at_val)[:4] != '2099')
                        )
                        self.active_timers = {item_id: bool(is_running)}
                        duration_seconds = record.get('duration_seconds') or record.get('durationSeconds') or 0
                        started_at = started_at_val
                        if is_running and started_at and str(started_at)[:4] != '2099':
                            try:
                                from datetime import datetime as dt
                                started = dt.fromisoformat(started_at.replace('Z', '+00:00')) if isinstance(started_at, str) else started_at
                                elapsed = max(0, int(dt.now().timestamp() - (started.timestamp() if hasattr(started, 'timestamp') else 0)))
                            except Exception:
                                elapsed = 0
                            self.timer_progress = {item_id: {'elapsed': elapsed, 'total': duration_seconds, 'started_at': started_at}}
                        else:
                            self.timer_progress = {item_id: {'elapsed': 0, 'total': duration_seconds, 'started_at': None}}
                        self._start_timer_tick()

            # Apply STAR from r3
            if r3 and r3.status_code == 200:
                data3 = r3.json()
                if data3 is not None and data3.get('itemId') is not None:
                    self.start_cue_id = int(data3['itemId']) if not isinstance(data3['itemId'], int) else data3['itemId']
                else:
                    self.start_cue_id = None
            self._update_star_label()
            self._render_schedule()
            self.join_event_room(event_id)
            if self.auto_refresh_var.get():
                self.auto_refresh_interval_sec = self._get_auto_refresh_interval_sec()
                self._start_auto_refresh()
            self.log_message(f"Event loaded: {len(self.schedule_data)} schedule items", "success")
        except Exception as e:
            self.log_message(f"Error loading event: {e}", "error")
            messagebox.showerror("Error", str(e))

    def _build_run_of_show_page(self):
        # Top row: Back + event name + date + Day
        top = ttk.Frame(self.run_of_show_frame)
        top.pack(fill='x', pady=(0, 4))
        ttk.Button(top, text="← Back", command=self._back_to_events).pack(side='left', padx=(0, 10))
        self.event_name_var = tk.StringVar(value="Event Name")
        self.event_date_var = tk.StringVar(value="")
        ttk.Label(top, textvariable=self.event_name_var, font=('Arial', 11, 'bold')).pack(side='left', padx=(0, 8))
        ttk.Label(top, textvariable=self.event_date_var, font=('Arial', 9), foreground='gray').pack(side='left', padx=(0, 12))
        ttk.Label(top, text="Day:").pack(side='left', padx=(0, 4))
        self.day_combo = ttk.Combobox(top, width=6, state='readonly')
        self.day_combo.pack(side='left', padx=(0, 8))
        self.day_combo.bind('<<ComboboxSelected>>', self._on_day_change)
        self.active_event_var = tk.StringVar(value="—")
        ttk.Label(top, textvariable=self.active_event_var, font=('Arial', 9, 'bold')).pack(side='left', padx=(12, 0))
        ttk.Button(top, text="Refresh", command=self._refresh_schedule).pack(side='right', padx=(0, 8))
        # Auto-refresh: off by default; user can enable and set interval
        self.auto_refresh_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text="Auto-refresh every", variable=self.auto_refresh_var, command=self._on_auto_refresh_change).pack(side='right', padx=(0, 4))
        self.auto_refresh_interval_combo = ttk.Combobox(top, width=5, state='readonly', values=('15 s', '30 s', '60 s', '120 s', '300 s'))
        self.auto_refresh_interval_combo.set('30 s')
        self.auto_refresh_interval_combo.pack(side='right', padx=(0, 4))
        self.auto_refresh_interval_combo.bind('<<ComboboxSelected>>', self._on_auto_refresh_interval_change)
        if not self.auto_refresh_var.get():
            self.auto_refresh_interval_combo.config(state='disabled')

        # Current cue / row tracking (loaded or running)
        self.current_cue_var = tk.StringVar(value="Current: —")
        cue_bar = ttk.Frame(self.run_of_show_frame)
        cue_bar.pack(fill='x', pady=(0, 2))
        ttk.Label(cue_bar, textvariable=self.current_cue_var, font=('Arial', 9, 'bold')).pack(anchor='w')
        # SHOW START (STAR) indicator – which row is marked as show start
        self.star_label_var = tk.StringVar(value="")
        star_bar = ttk.Frame(self.run_of_show_frame)
        star_bar.pack(fill='x', pady=(0, 2))
        ttk.Label(star_bar, text="SHOW START:", font=('Arial', 9, 'bold')).pack(side='left', padx=(0, 4))
        self.star_label = ttk.Label(star_bar, textvariable=self.star_label_var, font=('Arial', 9))
        self.star_label.pack(side='left')

        # Schedule table – compact (rows tagged for loaded/running)
        sched_frame = ttk.LabelFrame(self.run_of_show_frame, text="Schedule", padding=4)
        sched_frame.pack(fill='both', expand=True, pady=(0, 4))
        columns = ('cue', 'segment', 'duration', 'status')
        self.schedule_tree = ttk.Treeview(sched_frame, columns=columns, show='headings', height=8)
        self.schedule_tree.heading('cue', text='CUE')
        self.schedule_tree.heading('segment', text='Segment')
        self.schedule_tree.heading('duration', text='Duration')
        self.schedule_tree.heading('status', text='Status')
        self.schedule_tree.column('cue', width=56)
        self.schedule_tree.column('segment', width=240)
        self.schedule_tree.column('duration', width=56)
        self.schedule_tree.column('status', width=56)
        try:
            self.schedule_tree.tag_configure('running', background='#c8e6c9')
            self.schedule_tree.tag_configure('loaded', background='#fff9c4')
            self.schedule_tree.tag_configure('star', background='#fff3e0')
        except Exception:
            pass
        scrollbar_s = ttk.Scrollbar(sched_frame, orient='vertical', command=self.schedule_tree.yview)
        self.schedule_tree.configure(yscrollcommand=scrollbar_s.set)
        self.schedule_tree.pack(side='left', fill='both', expand=True, padx=(0, 4))
        scrollbar_s.pack(side='right', fill='y')
        self.schedule_tree.bind('<Double-1>', self._on_schedule_row_double_click)

        # Bottom: OSC/WS status + OSC Commands + Log (one row, compact)
        bottom = ttk.Frame(self.run_of_show_frame)
        bottom.pack(fill='both', expand=True)
        left_b = ttk.Frame(bottom)
        left_b.pack(side='left', fill='y', padx=(0, 8))
        self.osc_status_var = tk.StringVar(value="—")
        self.ws_status_var = tk.StringVar(value="—")
        ttk.Label(left_b, text="OSC:", font=('Arial', 9, 'bold')).pack(anchor='w')
        ttk.Label(left_b, textvariable=self.osc_status_var, font=('Arial', 9)).pack(anchor='w')
        ttk.Label(left_b, text="WS:", font=('Arial', 9, 'bold')).pack(anchor='w', pady=(2, 0))
        ttk.Label(left_b, textvariable=self.ws_status_var, font=('Arial', 9)).pack(anchor='w')

        # OSC Commands reference (read-only)
        osc_cmd_frame = ttk.LabelFrame(bottom, text="OSC Commands", padding=4)
        osc_cmd_frame.pack(side='left', fill='both', expand=False, padx=(0, 8))
        osc_commands_text = """Port: 57121 (same as Electron)

/set-event <id>     Set event
/list-events        List events
/cue/<name>/load    Load cue
/timer/start        Start timer
/timer/stop         Stop timer
/timer/reset        Reset timer
/set-day <1-7>      Set day
/get-day            Get day
/status             Status"""
        self.osc_cmd_text = scrolledtext.ScrolledText(osc_cmd_frame, height=5, width=28, wrap=tk.WORD, state='disabled')
        self.osc_cmd_text.pack(fill='both', expand=True)
        self.osc_cmd_text.config(state='normal')
        self.osc_cmd_text.insert('1.0', osc_commands_text)
        self.osc_cmd_text.config(state='disabled')

        right_b = ttk.LabelFrame(bottom, text="Log", padding=4)
        right_b.pack(side='left', fill='both', expand=True)
        self.log_text = scrolledtext.ScrolledText(right_b, height=5, wrap=tk.WORD)
        self.log_text.pack(fill='both', expand=True)
        self.log_text.tag_configure("info", foreground="black")
        self.log_text.tag_configure("success", foreground="green")
        self.log_text.tag_configure("error", foreground="red")
        self.log_text.tag_configure("warning", foreground="orange")
        ttk.Button(right_b, text="Clear", command=lambda: self.log_text.delete(1.0, tk.END)).pack(anchor='e', pady=(2, 0))

    def _on_day_change(self, event=None):
        try:
            self.current_day = int(self.day_combo.get())
            self._render_schedule()
        except (ValueError, TypeError):
            pass

    def _get_auto_refresh_interval_sec(self):
        """Parse interval from combo (e.g. '30 s' -> 30)."""
        try:
            s = self.auto_refresh_interval_combo.get().strip().replace(' ', '')
            if s.endswith('s'):
                s = s[:-1]
            return max(5, int(s))
        except (ValueError, TypeError, AttributeError):
            return 30

    def _on_auto_refresh_change(self):
        if self.auto_refresh_var.get():
            self.auto_refresh_interval_sec = self._get_auto_refresh_interval_sec()
            if hasattr(self, 'auto_refresh_interval_combo'):
                self.auto_refresh_interval_combo.config(state='readonly')
            if self.current_event_id:
                self._start_auto_refresh()
        else:
            self.auto_refresh_interval_sec = 0
            self._stop_auto_refresh()
            if hasattr(self, 'auto_refresh_interval_combo'):
                self.auto_refresh_interval_combo.config(state='disabled')

    def _on_auto_refresh_interval_change(self, event=None):
        """When user changes interval and auto-refresh is on, restart with new interval."""
        if self.auto_refresh_var.get() and self.current_event_id:
            self.auto_refresh_interval_sec = self._get_auto_refresh_interval_sec()
            self._start_auto_refresh()

    def _start_auto_refresh(self):
        """Only fetch on the chosen interval; _refresh_schedule does run-of-show + active-timers + start-cue (no extra _sync_timer_status)."""
        self._stop_auto_refresh()
        if not self.current_event_id or self.auto_refresh_interval_sec <= 0:
            return
        def tick():
            if not self.current_event_id or self.auto_refresh_interval_sec <= 0:
                return
            try:
                self._refresh_schedule()  # 3 API calls only, at this interval
            except Exception:
                pass
            self._auto_refresh_after_id = self.root.after(self.auto_refresh_interval_sec * 1000, tick)
        self._auto_refresh_after_id = self.root.after(self.auto_refresh_interval_sec * 1000, tick)

    def _stop_auto_refresh(self):
        if self._auto_refresh_after_id is not None:
            try:
                self.root.after_cancel(self._auto_refresh_after_id)
            except Exception:
                pass
            self._auto_refresh_after_id = None

    def _update_current_cue_display(self):
        """Update the 'Current cue' bar and return (cue, seg, status, time_str) for row tracking."""
        if not self.active_item_id:
            self.current_cue_var.set("Current: —")
            return
        day_items = [i for i in self.schedule_data if (i.get('day', 1)) == self.current_day]
        item = next((i for i in day_items if i.get('id') == self.active_item_id), None)
        if not item:
            self.current_cue_var.set(f"Current: (row {self.active_item_id}) —")
            return
        cue = item.get('cue') or item.get('customFields', {}).get('cue') or '—'
        seg = item.get('segmentName', '—')
        is_running = self.active_timers.get(self.active_item_id)
        status = "RUNNING" if is_running else "LOADED"
        prog = self.timer_progress.get(self.active_item_id)
        if prog and prog.get('total'):
            rem = max(0, prog['total'] - prog.get('elapsed', 0))
            m, s = divmod(rem, 60)
            h, m = divmod(m, 60)
            time_str = f"{h:02d}:{m:02d}:{s:02d}"
        else:
            time_str = "—"
        self.current_cue_var.set(f"Current: {cue} | {seg} | {status} | {time_str}")

    def _update_start_cue_id(self):
        """Set start_cue_id from schedule when present; do not clear if only in API."""
        for it in (self.schedule_data or []):
            if it.get('isStartCue') is True:
                self.start_cue_id = it.get('id')
                return
        # If no schedule item has isStartCue, leave start_cue_id unchanged (API may have it)

    def _update_star_label(self):
        """Update the SHOW START label to show which row is marked (so user can see the STAR row)."""
        if not hasattr(self, 'star_label_var'):
            return
        if self.start_cue_id is None:
            self.star_label_var.set("—")
            return
        # Find cue/segment name for start_cue_id in current day
        day_items = [i for i in (self.schedule_data or []) if (i.get('day', 1)) == self.current_day]
        item = next((i for i in day_items if i.get('id') == self.start_cue_id), None)
        if item:
            cue = item.get('cue') or item.get('customFields', {}).get('cue') or f"Item {self.start_cue_id}"
            seg = item.get('segmentName', '—')
            self.star_label_var.set(f"⭐ {cue} — {seg}")
        else:
            self.star_label_var.set(f"⭐ Item {self.start_cue_id} (not in current day)")

    def _fetch_start_cue_selection(self):
        """Fetch which cue is marked as START from API and set start_cue_id."""
        if not self.current_event_id:
            return
        try:
            r = requests.get(f"{self.api_base_url}/api/start-cue-selection/{self.current_event_id}")
            if r.status_code == 200:
                data = r.json()
                if data is not None and data.get('itemId') is not None:
                    self.start_cue_id = int(data['itemId']) if not isinstance(data['itemId'], int) else data['itemId']
                    self.log_message(f"STAR row from API: item {self.start_cue_id}", "info")
                else:
                    self.start_cue_id = None
                self._update_star_label()
                self._render_schedule()
        except Exception as e:
            self.log_message(f"Could not fetch start-cue-selection: {e}", "warning")

    def _on_schedule_row_double_click(self, event=None):
        """Double-click on a schedule row: toggle that row as SHOW START (STAR)."""
        sel = self.schedule_tree.selection()
        if not sel or not self.current_event_id:
            return
        iid = sel[0]
        if not isinstance(iid, str) or not iid.startswith("row_"):
            return
        try:
            item_id = int(iid.replace("row_", "", 1))
        except ValueError:
            return
        self._toggle_start_cue(item_id)

    def _toggle_start_cue(self, item_id):
        """Set or unset the STAR row via API."""
        if not self.current_event_id:
            return
        is_currently_star = self.start_cue_id == item_id
        try:
            if is_currently_star:
                r = requests.delete(
                    f"{self.api_base_url}/api/start-cue-selection",
                    json={"event_id": self.current_event_id, "item_id": item_id},
                )
                if r.status_code in (200, 404):
                    self.start_cue_id = None
                    self.log_message("SHOW START unmarked", "info")
            else:
                r = requests.post(
                    f"{self.api_base_url}/api/start-cue-selection",
                    json={"event_id": self.current_event_id, "item_id": item_id},
                )
                if r.status_code == 200:
                    self.start_cue_id = item_id
                    self.log_message(f"Marked as SHOW START (item {item_id})", "success")
            self._update_star_label()
            self._render_schedule()
        except Exception as e:
            self.log_message(f"Failed to update SHOW START: {e}", "error")

    def _render_schedule(self):
        self._update_start_cue_id()
        for item in self.schedule_tree.get_children():
            self.schedule_tree.delete(item)
        day_items = [i for i in self.schedule_data if (i.get('day', 1)) == self.current_day]
        for it in day_items:
            cue = it.get('cue') or it.get('customFields', {}).get('cue') or '—'
            seg = it.get('segmentName', '—')
            h, m, s = it.get('durationHours', 0), it.get('durationMinutes', 0), it.get('durationSeconds', 0)
            dur = f"{h:02d}:{m:02d}:{s:02d}"
            it_id = it.get('id')
            is_star = (it_id == self.start_cue_id) or (it.get('isStartCue') is True)
            if is_star:
                cue_display = f"⭐ {cue}"
            else:
                cue_display = cue
            # Only the single active cue can be RUNNING or LOADED (one row at a time)
            if it_id == self.active_item_id and self.active_timers.get(it_id):
                status = "RUNNING"
                tag = 'running'
            elif it_id == self.active_item_id:
                status = "LOADED"
                tag = 'loaded'
            elif is_star:
                status = "—"
                tag = 'star'
            else:
                status = "—"
                tag = ''
            iid = f"row_{it_id}"
            try:
                self.schedule_tree.insert('', 'end', iid=iid, values=(cue_display, seg, dur, status), tags=(tag,) if tag else ())
            except Exception:
                self.schedule_tree.insert('', 'end', values=(cue_display, seg, dur, status))
        self._update_star_label()
        self._update_current_cue_display()

    def _refresh_schedule(self):
        """Refetch schedule and sync timer state in a background thread so UI/log don't hang. Counts as a fetch for throttle."""
        if not self.current_event_id:
            return
        import time
        self._last_schedule_fetch_time = time.time()
        self.log_message("Refreshing...", "info")

        event_id = self.current_event_id
        api_base = self.api_base_url
        root = self.root

        def do_refresh():
            r1 = r2 = r3 = None
            try:
                r1 = requests.get(f"{api_base}/api/run-of-show-data/{event_id}", timeout=15)
                r2 = requests.get(f"{api_base}/api/active-timers/{event_id}", timeout=10)
                r3 = requests.get(f"{api_base}/api/start-cue-selection/{event_id}", timeout=10)
            except Exception as e:
                root.after(0, lambda: self.log_message(f"Refresh failed: {e}", "error"))
                return
            root.after(0, lambda: self._apply_refresh_results(r1, r2, r3))

        threading.Thread(target=do_refresh, daemon=True).start()

    def _apply_refresh_results(self, r1, r2, r3):
        """Apply refresh API results on the main thread and update log (loaded/running)."""
        try:
            if r1 and r1.status_code == 200:
                data = r1.json()
                self.schedule_data = data.get("schedule_items", []) or []

            # Apply timer state from active-timers response (same logic as _sync_timer_status)
            if r2 and r2.status_code == 200:
                rows = r2.json()
                record = (rows[0] if rows else None) if isinstance(rows, list) else rows
                if not record or not (record.get("is_active") or record.get("isActive")):
                    self.active_item_id = None
                    self.active_timers = {}
                    self.timer_progress = {}
                    self._stop_timer_tick()
                else:
                    item_id_raw = record.get("item_id") if record.get("item_id") is not None else record.get("itemId")
                    item_id = int(item_id_raw) if item_id_raw is not None else None
                    if item_id is not None:
                        self.active_item_id = item_id
                        started_at_val = record.get("started_at") or record.get("startedAt")
                        is_running = (
                            record.get("is_running", record.get("isRunning", False))
                            or (record.get("timer_state") == "running")
                            or (record.get("timerState") == "running")
                            or (started_at_val and str(started_at_val)[:4] != "2099")
                        )
                        self.active_timers = {item_id: bool(is_running)}  # only one active cue
                        duration_seconds = record.get("duration_seconds") or record.get("durationSeconds") or 0
                        started_at = started_at_val
                        if is_running and started_at and str(started_at)[:4] != "2099":
                            try:
                                from datetime import datetime as dt
                                started = dt.fromisoformat(started_at.replace("Z", "+00:00")) if isinstance(started_at, str) else started_at
                                elapsed = max(0, int(dt.now().timestamp() - (started.timestamp() if hasattr(started, "timestamp") else 0)))
                            except Exception:
                                elapsed = 0
                            self.timer_progress = {item_id: {"elapsed": elapsed, "total": duration_seconds, "started_at": started_at}}
                        else:
                            self.timer_progress = {item_id: {"elapsed": 0, "total": duration_seconds, "started_at": None}}
                        self._start_timer_tick()
            else:
                self.active_item_id = None
                self.active_timers = {}
                self.timer_progress = {}
                self._stop_timer_tick()

            # Apply STAR row from start-cue-selection response
            if r3 and r3.status_code == 200:
                data = r3.json()
                if data is not None and data.get("itemId") is not None:
                    self.start_cue_id = int(data["itemId"]) if not isinstance(data["itemId"], int) else data["itemId"]
                else:
                    self.start_cue_id = None
            # else leave start_cue_id unchanged

            self._update_star_label()
            self._render_schedule()

            # Log so user always sees refresh + loaded/running state in event log
            self.log_message("Schedule refreshed", "success")
            if self.active_item_id is not None:
                state = "RUNNING" if self.active_timers.get(self.active_item_id) else "LOADED"
                self.log_message(f"Current cue: {state}", "info")
        except Exception as e:
            self.log_message(f"Refresh failed: {e}", "error")

    def _back_to_events(self):
        self.current_event = None
        self.current_event_id = None
        self.schedule_data = []
        self.active_item_id = None
        self.active_timers = {}
        self.timer_progress = {}
        self._stop_timer_tick()
        self._stop_auto_refresh()
        if self.sio and self.ws_connected:
            try:
                self.sio.disconnect()
            except Exception:
                pass
            self.ws_connected = False
        self._show_page('event_list')

    def load_events(self):
        try:
            self.log_message("Loading events...")
            response = requests.get(f"{self.api_base_url}/api/calendar-events")
            if response.status_code != 200:
                self.log_message(f"Failed to load events: {response.status_code}", "error")
                return
            self.all_events = response.json()
            self.current_filter = self.event_filter_var.get() if hasattr(self, 'event_filter_var') else 'upcoming'
            self._filter_and_show_events()
            self.log_message(f"Loaded {len(self.all_events)} events")
        except Exception as e:
            self.log_message(f"Error loading events: {e}", "error")

    def log_message(self, message, level="info"):
        ts = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{ts}] {message}\n"
        self.root.after(0, self._update_log, log_entry, level)
        print(log_entry.strip())

    def _update_log(self, log_entry, level="info"):
        try:
            start_pos = self.log_text.index(tk.END)
            self.log_text.insert(tk.END, log_entry)
            end_pos = self.log_text.index(tk.END)
            if level in ("success", "error", "warning", "info"):
                self.log_text.tag_add(level, start_pos, end_pos)
            self.log_text.see(tk.END)
        except (tk.TclError, AttributeError):
            pass

    def connect_websocket(self):
        """Connect to Socket.IO and listen for real-time updates (like Electron app)."""
        try:
            if self.sio:
                try:
                    self.sio.disconnect()
                except Exception:
                    pass
            self.sio = socketio.Client()
            root = self.root

            @self.sio.event
            def connect():
                self.ws_connected = True
                root.after(0, lambda: self.ws_status_var.set("Connected"))
                self.log_message("Socket.IO connected", "success")
                if self.current_event_id:
                    self.sio.emit('joinEvent', str(self.current_event_id))

            @self.sio.event
            def disconnect():
                self.ws_connected = False
                root.after(0, lambda: self.ws_status_var.set("Disconnected"))

            @self.sio.on('update')
            def on_update(message):
                """Handle real-time updates from server (timer, schedule, reset) - same as Electron."""
                try:
                    msg = message or {}
                    msg_type = msg.get('type')
                    data = msg.get('data')
                    event_id = msg.get('eventId') or (data or {}).get('event_id')
                    if event_id is not None and str(event_id) != str(self.current_event_id):
                        return
                    if msg_type == 'timerUpdated':
                        root.after(0, lambda: self._handle_timer_updated(data))
                    elif msg_type == 'timerStopped':
                        root.after(0, lambda: self._handle_timer_stopped(data))
                    # Do NOT refetch on scheduleUpdated/runOfShowDataUpdated (main Run of Show 20s sync).
                    # Python app only refreshes schedule on manual Refresh or its own auto-refresh interval.
                    elif msg_type == 'resetAllStates':
                        root.after(0, self._handle_reset_states)
                except Exception as e:
                    root.after(0, lambda: self.log_message(f"WS update error: {e}", "error"))

            @self.sio.on('startCueSelectionUpdate')
            def on_start_cue_selection(data):
                """When another client marks/unmarks the STAR row."""
                try:
                    if not data or str(data.get('event_id')) != str(self.current_event_id):
                        return
                    item_id = data.get('item_id')
                    self.start_cue_id = int(item_id) if item_id is not None else None
                    root.after(0, self._render_schedule)
                except Exception:
                    pass

            self.ws_status_var.set("Connecting...")
            self.sio.connect(self.api_base_url)
        except Exception as e:
            self.ws_status_var.set("Connection failed")
            self.log_message(f"WebSocket: {e}", "error")

    def _handle_timer_updated(self, data):
        """Update timer state from broadcast (same as Electron handleTimerUpdate)."""
        if not data or str(data.get('event_id')) != str(self.current_event_id):
            return
        item_id = data.get('item_id')
        if item_id is None:
            return
        item_id = int(item_id) if isinstance(item_id, (int, float)) else item_id
        self.active_item_id = item_id
        started_at = data.get('started_at') or data.get('startedAt')
        # RUNNING if is_running true, timer_state is 'running', or started_at is real (not 2099 placeholder)
        is_running = (
            data.get('is_running', data.get('isRunning', False))
            or (data.get('timer_state') == 'running')
            or (data.get('timerState') == 'running')
            or (started_at and str(started_at)[:4] != '2099')
        )
        duration_seconds = data.get('duration_seconds') or data.get('durationSeconds') or 0
        self.active_timers = {item_id: bool(is_running)}  # only one active cue
        if is_running and started_at and str(started_at)[:4] != '2099':
            try:
                from datetime import datetime as dt
                started = dt.fromisoformat(started_at.replace('Z', '+00:00')) if isinstance(started_at, str) else started_at
                started_ts = started.timestamp() if hasattr(started, 'timestamp') else 0
                now_ts = dt.now().timestamp()
                elapsed_sec = max(0, int(now_ts - started_ts))
            except Exception:
                elapsed_sec = 0
            self.timer_progress = {item_id: {'elapsed': elapsed_sec, 'total': duration_seconds, 'started_at': started_at}}
        else:
            self.timer_progress = {item_id: {'elapsed': 0, 'total': duration_seconds, 'started_at': None}}
        self._start_timer_tick()
        self.root.after(0, self._render_schedule)
        self.log_message("Timer/cue update (live)", "info")

    def _handle_timer_stopped(self, data):
        """Clear timer state when stop is broadcast (same as Electron handleTimerStopped)."""
        if data and str(data.get('event_id')) != str(self.current_event_id):
            return
        self.active_item_id = None
        self.active_timers = {}
        self.timer_progress = {}
        self._stop_timer_tick()
        self.root.after(0, self._render_schedule)
        self.log_message("Timer stopped (live)", "info")

    def _handle_schedule_updated(self):
        """Reload schedule from API (not used by socket anymore; Python only refreshes on manual Refresh or auto-refresh interval). Kept for possible future use."""
        if not self.current_event_id:
            return
        import time
        now = time.time()
        throttle_sec = 30  # min seconds between socket-triggered fetches (avoid lots of calls when server broadcasts often)
        if now - self._last_schedule_fetch_time < throttle_sec:
            return  # skip this broadcast; we'll get schedule on next manual Refresh or auto-refresh
        self._last_schedule_fetch_time = now

        event_id = self.current_event_id
        api_base = self.api_base_url
        root = self.root

        def do_fetch():
            try:
                r1 = requests.get(f"{api_base}/api/run-of-show-data/{event_id}", timeout=10)
                r2 = requests.get(f"{api_base}/api/active-timers/{event_id}", timeout=8)
                root.after(0, lambda: self._apply_schedule_updated(r1, r2))
            except Exception as e:
                root.after(0, lambda: self.log_message(f"Live schedule refresh failed: {e}", "error"))

        threading.Thread(target=do_fetch, daemon=True).start()

    def _apply_schedule_updated(self, r1, r2):
        """Apply schedule/timer from live update on main thread."""
        try:
            if r1 and r1.status_code == 200:
                self.schedule_data = r1.json().get('schedule_items', []) or []
            if r2 and r2.status_code == 200:
                rows = r2.json()
                record = (rows[0] if rows else None) if isinstance(rows, list) else rows
                if not record or not (record.get('is_active') or record.get('isActive')):
                    self.active_item_id = None
                    self.active_timers = {}
                    self.timer_progress = {}
                    self._stop_timer_tick()
                else:
                    item_id_raw = record.get('item_id') if record.get('item_id') is not None else record.get('itemId')
                    item_id = int(item_id_raw) if item_id_raw is not None else None
                    if item_id is not None:
                        self.active_item_id = item_id
                        started_at_val = record.get('started_at') or record.get('startedAt')
                        is_running = (
                            record.get('is_running', record.get('isRunning', False))
                            or (record.get('timer_state') == 'running')
                            or (record.get('timerState') == 'running')
                            or (started_at_val and str(started_at_val)[:4] != '2099')
                        )
                        self.active_timers = {item_id: bool(is_running)}
                        duration_seconds = record.get('duration_seconds') or record.get('durationSeconds') or 0
                        started_at = started_at_val
                        if is_running and started_at and str(started_at)[:4] != '2099':
                            try:
                                from datetime import datetime as dt
                                started = dt.fromisoformat(started_at.replace('Z', '+00:00')) if isinstance(started_at, str) else started_at
                                elapsed = max(0, int(dt.now().timestamp() - (started.timestamp() if hasattr(started, 'timestamp') else 0)))
                            except Exception:
                                elapsed = 0
                            self.timer_progress = {item_id: {'elapsed': elapsed, 'total': duration_seconds, 'started_at': started_at}}
                        else:
                            self.timer_progress = {item_id: {'elapsed': 0, 'total': duration_seconds, 'started_at': None}}
                        self._start_timer_tick()
            self._render_schedule()
            self.log_message("Schedule updated (live)", "success")
        except Exception as e:
            self.log_message(f"Live schedule refresh failed: {e}", "error")

    def _handle_reset_states(self):
        """Clear timer state when reset is broadcast (same as Electron handleResetAllStates)."""
        self.active_item_id = None
        self.active_timers = {}
        self.timer_progress = {}
        self._stop_timer_tick()
        self.root.after(0, self._render_schedule)
        self.log_message("Reset (live)", "info")

    def _start_timer_tick(self):
        """Run every 1s: update elapsed from local started_at (no API calls). Current-cue bar every 1s; full schedule redraw every 5s."""
        self._stop_timer_tick()
        self._tick_count = 0

        def tick():
            if not self.current_event_id:
                return
            from datetime import datetime as dt
            now_ts = dt.now().timestamp()
            for item_id, running in list(self.active_timers.items()):
                if running and self.timer_progress.get(item_id) and self.timer_progress[item_id].get('started_at'):
                    try:
                        st = self.timer_progress[item_id]['started_at']
                        started = dt.fromisoformat(st.replace('Z', '+00:00')) if isinstance(st, str) else st
                        elapsed = max(0, int(now_ts - (started.timestamp() if hasattr(started, 'timestamp') else 0)))
                        self.timer_progress[item_id]['elapsed'] = elapsed
                    except Exception:
                        pass
            # Lightweight: update current-cue bar every second
            self._update_current_cue_display()
            self._tick_count += 1
            # Full schedule redraw every 5s to avoid GUI stutter
            if self._tick_count % 5 == 0:
                self.root.after(0, self._render_schedule)
            self._timer_tick_id = self.root.after(1000, tick)
        self._timer_tick_id = self.root.after(1000, tick)

    def _stop_timer_tick(self):
        if self._timer_tick_id is not None:
            try:
                self.root.after_cancel(self._timer_tick_id)
            except Exception:
                pass
            self._timer_tick_id = None

    def _sync_timer_status(self):
        """Fetch current timer state from API (same as Electron syncTimerStatus)."""
        if not self.current_event_id:
            return
        try:
            r = requests.get(f"{self.api_base_url}/api/active-timers/{self.current_event_id}")
            if r.status_code != 200:
                return
            rows = r.json()
            record = (rows[0] if rows else None) if isinstance(rows, list) else rows
            if not record or not (record.get('is_active') or record.get('isActive')):
                self.active_item_id = None
                self.active_timers = {}
                self.timer_progress = {}
                self._stop_timer_tick()
                self.root.after(0, self._render_schedule)
                return
            item_id_raw = record.get('item_id') if record.get('item_id') is not None else record.get('itemId')
            item_id = int(item_id_raw) if item_id_raw is not None else None
            if item_id is None:
                return
            self.active_item_id = item_id
            # RUNNING if is_running true, timer_state is 'running', or started_at is real (not 2099 placeholder)
            started_at_val = record.get('started_at') or record.get('startedAt')
            is_running = (
                record.get('is_running', record.get('isRunning', False))
                or (record.get('timer_state') == 'running')
                or (record.get('timerState') == 'running')
                or (started_at_val and str(started_at_val)[:4] != '2099')
            )
            self.active_timers = {item_id: bool(is_running)}  # only one active cue
            duration_seconds = record.get('duration_seconds') or record.get('durationSeconds') or 0
            started_at = started_at_val
            if is_running and started_at and str(started_at)[:4] != '2099':
                try:
                    from datetime import datetime as dt
                    started = dt.fromisoformat(started_at.replace('Z', '+00:00')) if isinstance(started_at, str) else started_at
                    elapsed = max(0, int(dt.now().timestamp() - (started.timestamp() if hasattr(started, 'timestamp') else 0)))
                except Exception:
                    elapsed = 0
                self.timer_progress = {item_id: {'elapsed': elapsed, 'total': duration_seconds, 'started_at': started_at}}
            else:
                self.timer_progress = {item_id: {'elapsed': 0, 'total': duration_seconds, 'started_at': None}}
            self._start_timer_tick()
            self.root.after(0, self._render_schedule)
        except Exception as e:
            self.log_message(f"Sync timer: {e}", "warning")

    def join_event_room(self, event_id):
        """Join server event room so we receive real-time updates (server expects 'joinEvent', eventId)."""
        if self.sio and self.ws_connected:
            try:
                self.sio.emit('joinEvent', str(event_id))
                self.log_message(f"Joined event room: {event_id}", "info")
            except Exception as e:
                self.log_message(f"Join room: {e}", "warning")

    def start_osc_server(self):
        if self.osc_server.start():
            if hasattr(self, 'osc_status_var'):
                self.osc_status_var.set(f"OSC running on port {self.osc_server.port}")
        else:
            if hasattr(self, 'osc_status_var'):
                self.osc_status_var.set("OSC failed to start")

    def start_message_processor(self):
        self.processing_messages = True
        threading.Thread(target=self._process_messages, daemon=True).start()

    def _process_messages(self):
        while self.processing_messages:
            try:
                data, addr = self.osc_server.message_queue.get(timeout=1.0)
                address, args = parse_osc_message(data)
                if address:
                    self.log_message(f"OSC: {address} {args}")
                    threading.Thread(target=self._handle_osc, args=(address, args, addr), daemon=True).start()
            except queue.Empty:
                continue
            except Exception as e:
                self.log_message(f"OSC error: {e}", "error")

    def _handle_osc(self, address, args, client_addr):
        try:
            parts = address.strip('/').split('/')
            if not parts:
                return
            cmd = parts[0]
            if cmd == 'set-event' and args:
                self.root.after(0, lambda: self._open_event(str(args[0])))
                self.osc_server.send_response('/event/set', [str(args[0])], client_addr)
            elif cmd == 'list-events':
                for ev in self.filtered_events[:10]:
                    self.osc_server.send_response('/events/list', [f"{ev.get('name')} ({ev.get('id')})"], client_addr)
            elif cmd == 'cue' and len(parts) >= 3 and parts[2] == 'load':
                cue_name = parts[1]
                self._load_cue(cue_name)
                self.osc_server.send_response('/cue/loaded', [cue_name], client_addr)
            elif cmd == 'timer' and len(parts) >= 2:
                action = parts[1]
                if action == 'start':
                    self._start_timer()
                    self.osc_server.send_response('/timer/started', ['ok'], client_addr)
                elif action == 'stop':
                    self._stop_timer()
                    self.osc_server.send_response('/timer/stopped', ['ok'], client_addr)
                elif action == 'reset':
                    self._reset_timer()
                    self.osc_server.send_response('/timer/reset', ['ok'], client_addr)
            elif cmd == 'set-day' and args:
                try:
                    d = int(args[0])
                    self.current_day = d
                    if hasattr(self, 'day_combo'):
                        self.root.after(0, lambda: self.day_combo.set(str(d)))
                        self.root.after(0, self._render_schedule)
                    self.osc_server.send_response('/day/set', [f'Day {d}'], client_addr)
                except (ValueError, TypeError):
                    pass
            elif cmd == 'get-day':
                self.osc_server.send_response('/day/current', [f'Day {self.current_day}'], client_addr)
            elif cmd == 'status':
                msg = f"Event: {self.current_event_id}, Day: {self.current_day}, Active: {self.active_item_id or 'None'}"
                self.osc_server.send_response('/status/info', [msg], client_addr)
        except Exception as e:
            self.log_message(f"OSC command error: {e}", "error")
            try:
                self.osc_server.send_response('/error', [str(e)], client_addr)
            except Exception:
                pass

    def _load_cue(self, cue_name):
        """Load cue via API with duration and metadata (same as Electron loadCueById)."""
        if not self.current_event_id:
            raise RuntimeError("No event loaded")
        for item in self.schedule_data:
            if (item.get('day', 1)) != self.current_day:
                continue
            c = item.get('cue') or item.get('customFields', {}).get('cue')
            if str(c) == str(cue_name):
                break
        else:
            raise RuntimeError(f"Cue {cue_name} not found")
        item_id = item['id']
        # Calculate duration in seconds (same as Electron)
        h = item.get('durationHours', 0) or 0
        m = item.get('durationMinutes', 0) or 0
        s = item.get('durationSeconds', 0) or 0
        duration_seconds = h * 3600 + m * 60 + s
        if duration_seconds <= 0:
            duration_seconds = 300
        # Row number (1-based index in full schedule, like Electron)
        row_number = 1
        for i, sch in enumerate(self.schedule_data):
            if sch.get('id') == item_id:
                row_number = i + 1
                break
        cue_is = item.get('customFields', {}).get('cue') or item.get('timerId') or f'CUE {item_id}'
        timer_id = item.get('timerId') or f'TMR{item_id}'
        requests.post(f"{self.api_base_url}/api/cues/load", json={
            'event_id': self.current_event_id,
            'item_id': item_id,
            'user_id': 'python-osc-app',
            'duration_seconds': duration_seconds,
            'row_is': row_number,
            'cue_is': cue_is,
            'timer_id': timer_id,
        })
        self.active_item_id = item_id
        self.active_timers = {item_id: False}  # only one active cue (LOADED, not running)
        self.timer_progress = {item_id: {'elapsed': 0, 'total': duration_seconds, 'started_at': None}}
        self._start_timer_tick()
        self.root.after(0, self._render_schedule)

    def _start_timer(self):
        if not self.current_event_id or not self.active_item_id:
            return
        requests.post(f"{self.api_base_url}/api/timers/start", json={
            'event_id': self.current_event_id,
            'item_id': str(self.active_item_id),
            'user_id': 'python-osc-app'
        })

    def _stop_timer(self):
        if not self.current_event_id:
            return
        requests.post(f"{self.api_base_url}/api/timers/stop", json={
            'event_id': self.current_event_id,
            'item_id': str(self.active_item_id)
        })

    def _reset_timer(self):
        if not self.current_event_id:
            return
        requests.post(f"{self.api_base_url}/api/timers/reset", json={'event_id': self.current_event_id})
        self.active_item_id = None
        self.active_timers = {}
        self.timer_progress = {}
        self._stop_timer_tick()
        self.root.after(0, self._render_schedule)

    def on_closing(self):
        self.processing_messages = False
        self.osc_server.stop()
        if self.sio:
            try:
                self.sio.disconnect()
            except Exception:
                pass
        self.root.destroy()


def main():
    root = tk.Tk()
    app = ROSOSCPythonApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()


if __name__ == "__main__":
    main()
