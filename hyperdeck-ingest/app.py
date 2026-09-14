"""ROS HyperDeck Ingest — local sidecar (auth like the vMix bridge).

Watches the loaded/running cue via REST /api/active-timers, records marked
cues on a HyperDeck, then copies the closed clip to an editor folder.
"""
from __future__ import annotations

import os
import threading
import time
import tkinter as tk
from datetime import date, datetime
from tkinter import filedialog, messagebox, ttk

from config_store import AUTO_STOP_MINUTES, _clamp_auto_stop_hours, _clamp_auto_stop_minutes, load_config, save_config
from copy_util import CopyError, copy_from_ftp, unique_dest
from hyperdeck_client import ClipInfo, HyperDeckClient, HyperDeckError
from names import (
    DEFAULT_PATTERN,
    apply_pattern,
    cue_label,
    hyperdeck_record_name,
    item_needs_recording,
)
from ros_api import RosApi, RosApiError

BG = "#0f172a"
CARD = "#1e293b"
LINE = "#334155"
FG = "#e2e8f0"
MUTED = "#94a3b8"
ACCENT = "#2563eb"
OK = "#34d399"
ERR = "#f87171"
PILL_STOP = "#334155"
PILL_FOLLOW = "#065f46"
PILL_REC = "#dc2626"
REC_BANNER = "#7f1d1d"
REC_BANNER_FG = "#fecaca"
HEADER_REC = "#450a0a"


class HyperDeckIngestApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("ROS HyperDeck Ingest")
        self.root.geometry("1100x820")
        self.root.minsize(960, 720)
        self.root.configure(bg=BG)

        self.cfg = load_config()
        self.api = RosApi(self.cfg.get("api_base_url") or "", self.cfg.get("api_token") or "")
        self.deck = HyperDeckClient(
            str(self.cfg.get("hyperdeck_host") or ""),
            int(self.cfg.get("hyperdeck_port") or 9993),
        )
        self.events: list[dict] = []
        self.filtered_events: list[dict] = []
        self.event_list_rows: list[dict | None] = []
        self._event_list_updating = False
        self.schedule: list[dict] = []
        self.clips: list[ClipInfo] = []
        self.following = False
        self._follow_thread: threading.Thread | None = None
        self._busy = False
        self._last_item_id = None
        self._last_running = False
        self._recording_item_id = None
        self._recording_clip_name = ""
        self._recording_meta: dict = {}
        self._recording_seen_running = False
        self._completed_record_item_ids: set[str] = set()
        self._last_schedule_refresh = 0.0
        self._last_show_mode_refresh = 0.0
        self._last_marked_count: int | None = None
        self._show_mode = "rehearsal"
        self._last_mode_block_log = 0.0
        self._ui_kind = "stopped"
        self._session_timer_configured = False
        self.copied_keys = set(str(x) for x in (self.cfg.get("copied_keys") or []))
        self._auto_stop_never = False
        self._auto_stop_ends_at: float | None = None
        self._auto_stop_label = ""
        self._auto_stop_tick = None
        self._auto_stop_notice = ""
        self._end_lock = threading.Lock()

        self._build_style()
        self._build_ui()
        self._load_fields_from_config()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(300, self._prompt_startup_session)

    def _build_style(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        field = "#0b1220"
        style.configure(".", background=BG, foreground=FG, fieldbackground=field)
        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=CARD)
        style.configure("TLabel", background=BG, foreground=FG)
        style.configure("Card.TLabel", background=CARD, foreground=FG)
        style.configure("Muted.TLabel", background=BG, foreground=MUTED)
        style.configure("CardMuted.TLabel", background=CARD, foreground=MUTED)
        style.configure("TButton", background=LINE, foreground=FG, padding=(10, 5))
        style.configure("Accent.TButton", background=ACCENT, foreground="#fff", padding=(12, 6))
        style.configure("TCheckbutton", background=CARD, foreground=FG)
        style.configure("TRadiobutton", background=CARD, foreground=FG)
        style.configure("TEntry", fieldbackground=field, foreground=FG, insertcolor=FG, padding=4)
        style.configure("TCombobox", fieldbackground=field, foreground=FG, padding=4)
        style.configure(
            "Treeview",
            background=field,
            foreground=FG,
            fieldbackground=field,
            rowheight=24,
            borderwidth=0,
        )
        style.configure("Treeview.Heading", background=LINE, foreground=FG, relief="flat", padding=4)
        style.map("TButton", background=[("active", "#475569")])
        style.map("Accent.TButton", background=[("active", "#1d4ed8")])
        style.map("TCheckbutton", background=[("active", CARD)], foreground=[("active", FG)])
        style.map("TRadiobutton", background=[("active", CARD)], foreground=[("active", FG)])
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", field)],
            foreground=[("readonly", FG)],
            background=[("readonly", field)],
        )
        style.map("Treeview", background=[("selected", "#1d4ed8")], foreground=[("selected", "#fff")])
        self.root.option_add("*TCombobox*Listbox.background", field)
        self.root.option_add("*TCombobox*Listbox.foreground", FG)
        self.root.option_add("*TCombobox*Listbox.selectBackground", ACCENT)

    def _card(self, parent: tk.Widget, title: str, fill: str = "x") -> tk.Frame:
        wrap = tk.Frame(parent, bg=BG)
        wrap.pack(fill=fill, expand=(fill == "both"), pady=(0, 10))
        tk.Label(
            wrap,
            text=title.upper(),
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 8, "bold"),
            anchor="w",
        ).pack(fill="x", pady=(0, 6))
        inner = tk.Frame(wrap, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        inner.pack(fill="both", expand=True)
        pad = tk.Frame(inner, bg=CARD)
        pad.pack(fill="both", expand=True, padx=12, pady=10)
        return pad

    def _grid_label(self, parent: tk.Widget, row: int, text: str) -> None:
        ttk.Label(parent, text=text, style="CardMuted.TLabel").grid(
            row=row, column=0, sticky="w", padx=(0, 10), pady=4
        )

    def _build_ui(self) -> None:
        self.api_url_var = tk.StringVar()
        self.api_token_var = tk.StringVar()
        self.event_id_var = tk.StringVar()
        self.deck_host_var = tk.StringVar()
        self.deck_port_var = tk.StringVar()
        self.ftp_port_var = tk.StringVar()
        self.ftp_user_var = tk.StringVar()
        self.ftp_pass_var = tk.StringVar()
        self.target_folder_var = tk.StringVar()
        self.pattern_var = tk.StringVar()
        self.only_marked_var = tk.BooleanVar(value=True)
        self.auto_copy_var = tk.BooleanVar(value=True)
        self.record_gate_var = tk.StringVar(value="in-show")
        self.status_ros = tk.StringVar(value="Not tested")
        self.status_deck = tk.StringVar(value="Disconnected")
        self.status_cue = tk.StringVar(value="—")
        self.status_mode = tk.StringVar(value="—")
        self.status_copy = tk.StringVar(value="—")
        self.auto_stop_default_var = tk.StringVar(value="")
        self.event_locked_var = tk.BooleanVar(value=False)
        self.event_rec_summary_var = tk.StringVar(value="Record-marked cues: —")
        self.cue_list_summary_var = tk.StringVar(value="No Record-marked cues yet")

        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=14, pady=(12, 8))
        self.header = header
        self.header_brand = tk.Frame(header, bg=BG)
        self.header_brand.pack(side="left")
        self.header_title = tk.Label(
            self.header_brand,
            text="ROS HyperDeck Ingest",
            bg=BG,
            fg=FG,
            font=("Segoe UI", 15, "bold"),
        )
        self.header_title.pack(side="left")
        self.follow_pill = tk.Label(
            self.header_brand,
            text="Stopped",
            bg=PILL_STOP,
            fg="#e2e8f0",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=3,
        )
        self.follow_pill.pack(side="left", padx=(12, 0))
        self.auto_stop_pill = tk.Label(
            self.header_brand,
            text="",
            bg="#1e3a5f",
            fg="#e2e8f0",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=3,
        )
        self.auto_stop_default_label = tk.Label(
            self.header_brand,
            textvariable=self.auto_stop_default_var,
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 9),
            padx=10,
            pady=3,
        )
        self.auto_stop_default_label.pack(side="left", padx=(8, 0))
        self.header_actions = tk.Frame(header, bg=BG)
        self.header_actions.pack(side="right")
        ttk.Button(self.header_actions, text="Start follow", style="Accent.TButton", command=self.start_follow).pack(
            side="left"
        )
        ttk.Button(self.header_actions, text="Stop", command=self.stop_follow).pack(side="left", padx=(6, 0))
        ttk.Button(self.header_actions, text="Set timer", command=self.configure_auto_stop_defaults).pack(
            side="left", padx=(6, 0)
        )
        ttk.Button(self.header_actions, text="Save", command=self._save).pack(side="left", padx=(6, 0))

        self.rec_banner = tk.Frame(self.root, bg=REC_BANNER, highlightbackground="#f87171", highlightthickness=1)
        rec_inner = tk.Frame(self.rec_banner, bg=REC_BANNER)
        rec_inner.pack(fill="x", padx=12, pady=8)
        self.rec_banner_label = tk.Label(
            rec_inner,
            text="RECORDING",
            bg=REC_BANNER,
            fg=REC_BANNER_FG,
            font=("Segoe UI", 12, "bold"),
            anchor="w",
        )
        self.rec_banner_label.pack(fill="x")

        self.notice_frame = tk.Frame(self.root, bg="#78350f", highlightbackground="#f59e0b", highlightthickness=1)
        notice_inner = tk.Frame(self.notice_frame, bg="#78350f")
        notice_inner.pack(fill="x", padx=12, pady=8)
        self.notice_label = tk.Label(
            notice_inner,
            text="",
            bg="#78350f",
            fg="#fde68a",
            font=("Segoe UI", 10),
            anchor="w",
            justify="left",
            wraplength=760,
        )
        self.notice_label.pack(side="left", fill="x", expand=True)
        ttk.Button(notice_inner, text="Start again", command=self.start_follow).pack(side="right", padx=(8, 0))

        status = tk.Frame(self.root, bg=BG)
        status.pack(fill="x", padx=10, pady=(0, 8))
        self.status_row = status
        tiles = (
            ("ROS", self.status_ros),
            ("Deck", self.status_deck),
            ("Cue", self.status_cue),
            ("Show mode", self.status_mode),
            ("Copy", self.status_copy),
        )
        self._status_cells: dict[str, dict] = {}
        for i, (title, var) in enumerate(tiles):
            cell = tk.Frame(status, bg=CARD, highlightbackground=LINE, highlightthickness=1)
            cell.grid(row=0, column=i, sticky="nsew", padx=4)
            status.columnconfigure(i, weight=1, uniform="stat")
            title_lbl = tk.Label(cell, text=title, bg=CARD, fg=MUTED, font=("Segoe UI", 8, "bold"), anchor="w")
            title_lbl.pack(fill="x", padx=10, pady=(8, 0))
            value_lbl = tk.Label(
                cell,
                textvariable=var,
                bg=CARD,
                fg=FG,
                font=("Segoe UI", 10),
                anchor="w",
                wraplength=180,
                justify="left",
            )
            value_lbl.pack(fill="x", padx=10, pady=(2, 8))
            self._status_cells[title] = {"cell": cell, "title": title_lbl, "value": value_lbl}

        # Pack log first (bottom) so the middle body never eats it.
        log_wrap = tk.Frame(self.root, bg=BG)
        log_wrap.pack(side="bottom", fill="x", padx=14, pady=(0, 12))
        tk.Label(
            log_wrap, text="LOG", bg=BG, fg=MUTED, font=("Segoe UI", 8, "bold"), anchor="w"
        ).pack(fill="x", pady=(0, 6))
        log_card = tk.Frame(log_wrap, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        log_card.pack(fill="x")
        log_inner = tk.Frame(log_card, bg="#0b1220")
        log_inner.pack(fill="both", expand=True)
        self.log_text = tk.Text(
            log_inner,
            height=8,
            bg="#0b1220",
            fg=FG,
            insertbackground=FG,
            relief="flat",
            wrap="word",
            borderwidth=0,
            padx=8,
            pady=6,
            font=("Consolas", 9),
        )
        log_scroll = ttk.Scrollbar(log_inner, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=log_scroll.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")
        self.log_text.tag_config("error", foreground=ERR)
        self.log_text.tag_config("ok", foreground=OK)

        body = tk.Frame(self.root, bg=BG)
        body.pack(fill="both", expand=True, padx=14, pady=(0, 8))
        left_shell = tk.Frame(body, bg=BG, width=470)
        left_shell.pack(side="left", fill="y")
        left_shell.pack_propagate(False)
        left_canvas = tk.Canvas(left_shell, bg=BG, highlightthickness=0, width=452)
        left_scroll = ttk.Scrollbar(left_shell, orient="vertical", command=left_canvas.yview)
        left = tk.Frame(left_canvas, bg=BG)
        left.bind(
            "<Configure>",
            lambda e: left_canvas.configure(scrollregion=left_canvas.bbox("all")),
        )
        left_canvas.create_window((0, 0), window=left, anchor="nw", width=452)
        left_canvas.configure(yscrollcommand=left_scroll.set)
        left_canvas.pack(side="left", fill="both", expand=True)
        left_scroll.pack(side="right", fill="y")

        def _wheel(event):
            left_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        def _bind_wheel(_event=None):
            left_canvas.bind_all("<MouseWheel>", _wheel)

        def _unbind_wheel(_event=None):
            left_canvas.unbind_all("<MouseWheel>")

        left_canvas.bind("<Enter>", _bind_wheel)
        left_canvas.bind("<Leave>", _unbind_wheel)
        right = tk.Frame(body, bg=BG)
        right.pack(side="left", fill="both", expand=True, padx=(12, 0))

        ros = self._card(left, "ROS")
        ros.columnconfigure(1, weight=1)
        self._grid_label(ros, 0, "API URL")
        ttk.Entry(ros, textvariable=self.api_url_var).grid(row=0, column=1, sticky="ew", pady=4)
        ttk.Label(
            ros,
            text="Admin → Integration tokens · ros_itok_… · read",
            style="CardMuted.TLabel",
        ).grid(row=1, column=1, sticky="w")
        self._grid_label(ros, 2, "Token")
        ttk.Entry(ros, textvariable=self.api_token_var, show="*").grid(row=2, column=1, sticky="ew", pady=4)
        btn_row = tk.Frame(ros, bg=CARD)
        btn_row.grid(row=3, column=1, sticky="w", pady=(4, 2))
        ttk.Button(btn_row, text="Test API", command=self._test_api).pack(side="left")
        ttk.Button(btn_row, text="Load events", command=self._load_events).pack(side="left", padx=(6, 0))
        self._grid_label(ros, 4, "Event")
        event_pick = tk.Frame(ros, bg=CARD)
        event_pick.grid(row=4, column=1, sticky="ew", pady=4)
        event_pick.columnconfigure(0, weight=1)
        ttk.Label(
            event_pick,
            text="Search by name, date, or event ID",
            style="CardMuted.TLabel",
        ).grid(row=0, column=0, sticky="w")
        self.event_search_var = tk.StringVar()
        search_row = tk.Frame(event_pick, bg=CARD)
        search_row.grid(row=1, column=0, sticky="ew", pady=(2, 0))
        search_row.columnconfigure(0, weight=1)
        self.event_search_entry = ttk.Entry(
            search_row,
            textvariable=self.event_search_var,
        )
        self.event_search_entry.grid(row=0, column=0, sticky="ew")
        self.event_search_entry.bind("<KeyRelease>", self._on_event_search)
        self.event_search_entry.bind("<Return>", self._on_event_search_enter)
        ttk.Button(search_row, text="Clear", width=7, command=self._clear_event_search).grid(
            row=0, column=1, padx=(6, 0)
        )
        self.event_range_var = tk.StringVar(value="upcoming")
        filter_row = tk.Frame(event_pick, bg=CARD)
        filter_row.grid(row=2, column=0, sticky="w", pady=(8, 0))
        for label, value in (("Upcoming", "upcoming"), ("Past", "past"), ("All", "all")):
            ttk.Radiobutton(
                filter_row,
                text=label,
                variable=self.event_range_var,
                value=value,
                command=self._render_event_list,
            ).pack(side="left", padx=(0, 12))
        list_wrap = tk.Frame(event_pick, bg=LINE)
        list_wrap.grid(row=3, column=0, sticky="ew", pady=(6, 0))
        list_wrap.columnconfigure(0, weight=1)
        self.event_list = tk.Listbox(
            list_wrap,
            height=7,
            activestyle="none",
            bg="#0b1220",
            fg=FG,
            selectbackground=ACCENT,
            selectforeground="#fff",
            highlightthickness=0,
            borderwidth=0,
            exportselection=False,
            font=("Segoe UI", 10),
        )
        self.event_list.grid(row=0, column=0, sticky="ew")
        event_scroll = ttk.Scrollbar(list_wrap, orient="vertical", command=self.event_list.yview)
        self.event_list.configure(yscrollcommand=event_scroll.set)
        event_scroll.grid(row=0, column=1, sticky="ns")
        self.event_list.bind("<<ListboxSelect>>", self._on_event_list_select)
        self.event_list.bind("<Double-Button-1>", self._on_event_list_select)
        self.event_count_label = ttk.Label(event_pick, text="Load events to browse", style="CardMuted.TLabel")
        self.event_count_label.grid(row=4, column=0, sticky="w", pady=(6, 0))
        self.event_selected_label = ttk.Label(event_pick, text="", style="Card.TLabel", wraplength=360)
        self.event_selected_label.grid(row=5, column=0, sticky="w", pady=(2, 0))
        lock_row = tk.Frame(event_pick, bg=CARD)
        lock_row.grid(row=6, column=0, sticky="w", pady=(6, 0))
        ttk.Checkbutton(
            lock_row,
            text="Lock selected event",
            variable=self.event_locked_var,
            command=self._on_event_lock_toggled,
        ).pack(side="left")
        ttk.Button(lock_row, text="Confirm event", command=self._confirm_event_selection).pack(side="left", padx=(8, 0))
        ttk.Button(lock_row, text="Refresh marks", command=self._refresh_marks_clicked).pack(side="left", padx=(8, 0))
        ttk.Label(event_pick, textvariable=self.event_rec_summary_var, style="CardMuted.TLabel").grid(
            row=7, column=0, sticky="w", pady=(4, 0)
        )
        gate = tk.Frame(event_pick, bg=CARD)
        gate.grid(row=8, column=0, sticky="ew", pady=(10, 0))
        ttk.Label(
            gate,
            text="After this event is confirmed — auto-record when:",
            style="Card.TLabel",
        ).pack(anchor="w")
        ttk.Radiobutton(
            gate,
            text="In Show only (show day)",
            variable=self.record_gate_var,
            value="in-show",
            command=self._on_record_gate_changed,
        ).pack(anchor="w", pady=(4, 0))
        ttk.Radiobutton(
            gate,
            text="Rehearsal or In Show (testing)",
            variable=self.record_gate_var,
            value="rehearsal",
            command=self._on_record_gate_changed,
        ).pack(anchor="w", pady=(2, 0))
        ttk.Label(
            gate,
            text="Default is In Show only. Pick Rehearsal if you are testing before the show.",
            style="CardMuted.TLabel",
            wraplength=360,
        ).pack(anchor="w", pady=(4, 0))
        self.event_id_var.trace_add("write", lambda *_: self._refresh_event_selection_label())

        deck = self._card(left, "HyperDeck")
        deck.columnconfigure(1, weight=1)
        self._grid_label(deck, 0, "IP")
        host_row = tk.Frame(deck, bg=CARD)
        host_row.grid(row=0, column=1, sticky="ew", pady=4)
        ttk.Entry(host_row, textvariable=self.deck_host_var).pack(side="left", fill="x", expand=True)
        ttk.Label(host_row, text="Port", style="CardMuted.TLabel").pack(side="left", padx=(10, 6))
        ttk.Entry(host_row, textvariable=self.deck_port_var, width=7).pack(side="left")
        ttk.Button(host_row, text="Connect", command=self._connect_deck).pack(side="left", padx=(8, 0))
        man = tk.Frame(deck, bg=CARD)
        man.grid(row=1, column=1, sticky="w", pady=(6, 0))
        ttk.Button(man, text="Record", command=self._manual_record).pack(side="left")
        ttk.Button(man, text="Stop", command=self._manual_stop).pack(side="left", padx=(6, 0))
        ttk.Button(man, text="Copy last", command=self._copy_last).pack(side="left", padx=(6, 0))
        ttk.Button(man, text="Refresh clips", command=self._refresh_clips).pack(side="left", padx=(6, 0))

        dest = self._card(left, "Copy after stop")
        dest.columnconfigure(1, weight=1)
        self._grid_label(dest, 0, "Source")
        ttk.Label(
            dest,
            text="FTP from HyperDeck. Typical default login is user 'anonymous' with blank password.",
            style="CardMuted.TLabel",
        ).grid(row=0, column=1, sticky="w")

        self.ftp_row = tk.Frame(dest, bg=CARD)
        self.ftp_row.grid(row=1, column=0, columnspan=2, sticky="ew", pady=4)
        self.ftp_row.columnconfigure(1, weight=1)
        ttk.Label(self.ftp_row, text="FTP", style="CardMuted.TLabel").grid(row=0, column=0, sticky="nw", padx=(0, 10), pady=4)
        ftp_fields = tk.Frame(self.ftp_row, bg=CARD)
        ftp_fields.grid(row=0, column=1, sticky="ew")
        ftp_fields.columnconfigure(1, weight=1)
        ftp_fields.columnconfigure(3, weight=1)
        ttk.Label(ftp_fields, text="Port", style="CardMuted.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Entry(ftp_fields, textvariable=self.ftp_port_var, width=6).grid(row=0, column=1, sticky="w", padx=(6, 12), pady=2)
        ttk.Label(ftp_fields, text="User", style="CardMuted.TLabel").grid(row=0, column=2, sticky="w")
        ttk.Entry(ftp_fields, textvariable=self.ftp_user_var).grid(row=0, column=3, sticky="ew", padx=(6, 0), pady=2)
        ttk.Label(ftp_fields, text="Password", style="CardMuted.TLabel").grid(row=1, column=0, sticky="w")
        ttk.Entry(ftp_fields, textvariable=self.ftp_pass_var, show="*").grid(
            row=1, column=1, columnspan=3, sticky="ew", padx=(6, 0), pady=2
        )

        self._grid_label(dest, 2, "Target copy folder")
        tgt = tk.Frame(dest, bg=CARD)
        tgt.grid(row=2, column=1, sticky="ew", pady=4)
        ttk.Entry(tgt, textvariable=self.target_folder_var).pack(side="left", fill="x", expand=True)
        ttk.Button(tgt, text="Browse", command=lambda: self._browse(self.target_folder_var)).pack(
            side="left", padx=(6, 0)
        )
        self._grid_label(dest, 3, "Name")
        ttk.Entry(dest, textvariable=self.pattern_var).grid(row=3, column=1, sticky="ew", pady=4)
        ttk.Label(
            dest,
            text="{date} {event} {segment} {cue}  ·  date is event YYMMDD",
            style="CardMuted.TLabel",
        ).grid(row=4, column=1, sticky="w")
        flags = tk.Frame(dest, bg=CARD)
        flags.grid(row=5, column=1, sticky="w", pady=(8, 0))
        ttk.Checkbutton(flags, text="Only Record-marked cues (required)", variable=self.only_marked_var, state="disabled").pack(anchor="w")
        ttk.Checkbutton(flags, text="Auto-copy after stop", variable=self.auto_copy_var).pack(anchor="w", pady=(4, 0))

        cues = self._card(right, "Record cues", fill="both")
        ttk.Label(cues, textvariable=self.cue_list_summary_var, style="CardMuted.TLabel").pack(anchor="w", pady=(0, 6))
        cue_wrap = tk.Frame(cues, bg=CARD)
        cue_wrap.pack(fill="both", expand=True)
        cue_cols = ("done", "cue", "segment", "status")
        self.cue_tree = ttk.Treeview(cue_wrap, columns=cue_cols, show="headings", selectmode="browse", height=8)
        self.cue_tree.heading("done", text="")
        self.cue_tree.heading("cue", text="Cue")
        self.cue_tree.heading("segment", text="Segment")
        self.cue_tree.heading("status", text="Status")
        self.cue_tree.column("done", width=36, stretch=False, anchor="center")
        self.cue_tree.column("cue", width=88, stretch=False)
        self.cue_tree.column("segment", width=180)
        self.cue_tree.column("status", width=90, stretch=False, anchor="center")
        cue_scroll = ttk.Scrollbar(cue_wrap, orient="vertical", command=self.cue_tree.yview)
        self.cue_tree.configure(yscrollcommand=cue_scroll.set)
        self.cue_tree.pack(side="left", fill="both", expand=True)
        cue_scroll.pack(side="right", fill="y")
        self.cue_tree.tag_configure("done", foreground=OK)
        self.cue_tree.tag_configure("recording", foreground="#fca5a5")
        self.cue_tree.tag_configure("pending", foreground=FG)

        clips = self._card(right, "HyperDeck clips", fill="both")
        tree_wrap = tk.Frame(clips, bg=CARD)
        tree_wrap.pack(fill="both", expand=True)
        cols = ("idx", "name", "duration", "copied")
        self.clip_tree = ttk.Treeview(tree_wrap, columns=cols, show="headings", selectmode="browse", height=7)
        self.clip_tree.heading("idx", text="#")
        self.clip_tree.heading("name", text="Clip")
        self.clip_tree.heading("duration", text="Duration")
        self.clip_tree.heading("copied", text="Copied")
        self.clip_tree.column("idx", width=44, stretch=False, anchor="center")
        self.clip_tree.column("name", width=240)
        self.clip_tree.column("duration", width=88, stretch=False, anchor="center")
        self.clip_tree.column("copied", width=72, stretch=False, anchor="center")
        scroll = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.clip_tree.yview)
        self.clip_tree.configure(yscrollcommand=scroll.set)
        self.clip_tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

    @staticmethod
    def _event_date_str(ev: dict) -> str:
        date = str(ev.get("date") or "")
        if "T" in date:
            date = date.split("T", 1)[0]
        return date.strip()

    @classmethod
    def _parse_event_date(cls, ev: dict) -> date | None:
        raw = cls._event_date_str(ev)
        if not raw:
            return None
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None

    @classmethod
    def _event_sort_key(cls, ev: dict) -> str:
        return cls._event_date_str(ev) or "9999-99-99"

    def _split_events(self) -> tuple[list[dict], list[dict], list[dict]]:
        today = date.today()
        upcoming: list[dict] = []
        past: list[dict] = []
        undated: list[dict] = []
        for ev in self.events:
            when = self._parse_event_date(ev)
            if when is None:
                undated.append(ev)
            elif when >= today:
                upcoming.append(ev)
            else:
                past.append(ev)
        upcoming.sort(key=self._event_sort_key)
        past.sort(key=self._event_sort_key, reverse=True)
        undated.sort(key=lambda ev: str(ev.get("name") or "").lower())
        return upcoming, past, undated

    def _matches_event_search(self, ev: dict, query: str) -> bool:
        return not query or query in self._event_search_blob(ev)

    def _events_for_view(self) -> list[tuple[str, dict | str]]:
        query = self.event_search_var.get().strip().lower()
        upcoming, past, undated = self._split_events()
        mode = self.event_range_var.get()

        def filt(items: list[dict]) -> list[dict]:
            return [ev for ev in items if self._matches_event_search(ev, query)]

        def grouped(u: list[dict], n: list[dict], p: list[dict]) -> list[tuple[str, dict | str]]:
            rows: list[tuple[str, dict | str]] = []
            if u:
                rows.append(("header", f"Upcoming ({len(u)})"))
                rows.extend(("event", ev) for ev in u)
            if n:
                rows.append(("header", f"No date ({len(n)})"))
                rows.extend(("event", ev) for ev in n)
            if p:
                rows.append(("header", f"Past ({len(p)})"))
                rows.extend(("event", ev) for ev in p)
            return rows

        u = filt(upcoming)
        n = filt(undated)
        p = filt(past)

        if query:
            return grouped(u, n, p)

        rows: list[tuple[str, dict | str]] = []
        if mode == "upcoming":
            for ev in u + n:
                rows.append(("event", ev))
        elif mode == "past":
            for ev in p:
                rows.append(("event", ev))
        else:
            rows = grouped(u, n, p)
        return rows

    def _auto_range_for_event(self, eid: str) -> None:
        ev = next((e for e in self.events if str(e.get("id")) == eid), None)
        if not ev:
            return
        when = self._parse_event_date(ev)
        if when is None:
            if self.event_range_var.get() == "past":
                self.event_range_var.set("upcoming")
            return
        if when >= date.today():
            if self.event_range_var.get() == "past":
                self.event_range_var.set("upcoming")
        elif self.event_range_var.get() == "upcoming":
            self.event_range_var.set("past")

    def _event_count_text(self) -> str:
        if not self.events:
            return "Load events to browse"
        query = self.event_search_var.get().strip().lower()
        upcoming, past, undated = self._split_events()
        u = len([ev for ev in upcoming if self._matches_event_search(ev, query)])
        p = len([ev for ev in past if self._matches_event_search(ev, query)])
        n = len([ev for ev in undated if self._matches_event_search(ev, query)])
        shown = len(self.filtered_events)
        total = len(self.events)
        mode = self.event_range_var.get()
        if query:
            return f"{shown} match(es)  ·  {u} upcoming · {p} past · {n} undated"
        if mode == "upcoming":
            return f"{shown} upcoming  ·  {p} past · {n} undated"
        if mode == "past":
            return f"{shown} past  ·  {u} upcoming · {n} undated"
        return f"{total} total  ·  {u} upcoming · {p} past · {n} undated"

    @classmethod
    def _event_label(cls, ev: dict) -> str:
        name = str(ev.get("name") or "Untitled")
        date = cls._event_date_str(ev)
        return f"{date}  ·  {name}" if date else name

    @classmethod
    def _event_search_blob(cls, ev: dict) -> str:
        eid = str(ev.get("id") or "")
        return " ".join(
            [
                cls._event_date_str(ev),
                str(ev.get("name") or ""),
                eid,
                eid.replace("-", ""),
            ]
        ).lower()

    def _refresh_event_selection_label(self) -> None:
        eid = self.event_id_var.get().strip()
        if not eid:
            self.event_selected_label.configure(text="")
            return
        ev = next((e for e in self.events if str(e.get("id")) == eid), None)
        if ev:
            short = eid[:8] + "…" if len(eid) > 8 else eid
            self.event_selected_label.configure(
                text=f"Selected: {ev.get('name') or 'Untitled'}  ·  {short}"
            )
        else:
            self.event_selected_label.configure(text=f"Selected ID: {eid}")

    def _render_event_list(self, select_id: str | None = None) -> None:
        rows = self._events_for_view()
        self.filtered_events = []
        self.event_list_rows = []
        self.event_list.delete(0, "end")
        for kind, payload in rows:
            if kind == "header":
                self.event_list.insert("end", f"— {payload} —")
                idx = self.event_list.size() - 1
                self.event_list.itemconfig(idx, fg=MUTED)
                self.event_list_rows.append(None)
            else:
                self.event_list.insert("end", self._event_label(payload))
                self.event_list_rows.append(payload)
                self.filtered_events.append(payload)

        self.event_count_label.configure(text=self._event_count_text())

        pick = select_id or self.event_id_var.get().strip()
        self._event_list_updating = True
        try:
            if pick:
                for i, ev in enumerate(self.event_list_rows):
                    if ev is not None and str(ev.get("id")) == pick:
                        self.event_list.selection_set(i)
                        self.event_list.see(i)
                        break
        finally:
            self._event_list_updating = False
        self._refresh_event_selection_label()

    def _on_event_search(self, _evt=None) -> None:
        self._render_event_list()

    def _on_event_search_enter(self, _evt=None) -> None:
        if not self.filtered_events:
            return
        ev = self.filtered_events[0]
        for i, row in enumerate(self.event_list_rows):
            if row is ev:
                self._event_list_updating = True
                try:
                    self.event_list.selection_clear(0, "end")
                    self.event_list.selection_set(i)
                    self.event_list.see(i)
                finally:
                    self._event_list_updating = False
                break
        self._choose_event(ev)

    def _clear_event_search(self) -> None:
        self.event_search_var.set("")
        self._render_event_list()

    def _on_event_lock_toggled(self) -> None:
        if self.event_locked_var.get():
            eid = self.event_id_var.get().strip()
            if not eid:
                self.event_locked_var.set(False)
                messagebox.showinfo("Event lock", "Select an event first, then lock it.")
                return
            self.log(f"Event locked: {eid}", "ok")
        else:
            self.log("Event unlocked")

    def _confirm_event_selection(self) -> None:
        eid = self.event_id_var.get().strip()
        if not eid:
            messagebox.showinfo("Event", "Select an event first.")
            return
        self.event_locked_var.set(True)
        self.log(f"Event confirmed and locked: {eid}", "ok")

        def work():
            try:
                self._refresh_schedule()
                ev = self._current_event()
                marked = sum(1 for item in self.schedule if item_needs_recording(item))
                gate = (
                    "Auto-record: Rehearsal or In Show (testing)"
                    if self._wants_rehearsal_record()
                    else "Auto-record: In Show only"
                )
                self.root.after(
                    0,
                    lambda: messagebox.showinfo(
                        "Event locked",
                        f"{ev.get('name') or 'Event'}\n\n"
                        f"Record-marked cues: {marked}\n"
                        f"{gate}\n\n"
                        "Adjust the auto-record option under the event if needed, then "
                        "Start follow. The app records when a Record-marked cue is loaded "
                        "and stops when that cue's timer stops.",
                    ),
                )
            except Exception as exc:
                self.root.after(0, lambda: messagebox.showerror("Event", str(exc)))

        self._bg(work)

    def _choose_event(self, ev: dict) -> None:
        eid = str(ev.get("id") or "")
        if self.event_locked_var.get() and self.event_id_var.get().strip() and self.event_id_var.get().strip() != eid:
            self.log(f"Ignored event switch to {eid} (event is locked)")
            messagebox.showinfo("Event locked", "Unlock the selected event before switching.")
            self._render_event_list(select_id=self.event_id_var.get().strip())
            return
        if self.event_id_var.get().strip() == eid:
            self._refresh_event_selection_label()
            return
        self.event_id_var.set(eid)
        self._bg(self._refresh_schedule)

    def _on_event_list_select(self, _evt=None) -> None:
        if self._event_list_updating:
            return
        sel = self.event_list.curselection()
        if not sel:
            return
        idx = int(sel[0])
        if idx < 0 or idx >= len(self.event_list_rows):
            return
        ev = self.event_list_rows[idx]
        if ev is None:
            self._event_list_updating = True
            try:
                self.event_list.selection_clear(0, "end")
            finally:
                self._event_list_updating = False
            return
        self._choose_event(ev)

    def _set_pill(self, kind: str) -> None:
        styles = {
            "stopped": ("Stopped", PILL_STOP),
            "following": ("Following", PILL_FOLLOW),
            "recording": ("● RECORDING", PILL_REC),
        }
        text, bg = styles.get(kind, styles["stopped"])
        self._ui_kind = kind if kind in styles else "stopped"

        def apply():
            self.follow_pill.configure(text=text, bg=bg, fg="#fff" if kind == "recording" else "#e2e8f0")
            self._apply_recording_chrome(kind == "recording")

        self.root.after(0, apply)

    def _apply_recording_chrome(self, recording: bool) -> None:
        header_bg = HEADER_REC if recording else BG
        title_fg = "#fecaca" if recording else FG
        self.root.title("● RECORDING — ROS HyperDeck Ingest" if recording else "ROS HyperDeck Ingest")
        self.header.configure(bg=header_bg)
        self.header_brand.configure(bg=header_bg)
        self.header_actions.configure(bg=header_bg)
        self.header_title.configure(bg=header_bg, fg=title_fg)
        self.auto_stop_default_label.configure(bg=header_bg)
        deck = self._status_cells.get("Deck") or {}
        if recording:
            clip = self._recording_clip_name or "HyperDeck"
            self.rec_banner_label.configure(text=f"● RECORDING  —  {clip}")
            if not self.rec_banner.winfo_ismapped():
                self.rec_banner.pack(fill="x", padx=14, pady=(0, 8), after=self.header)
            for key in ("cell", "title", "value"):
                widget = deck.get(key)
                if widget is not None:
                    widget.configure(bg=REC_BANNER)
            if deck.get("title") is not None:
                deck["title"].configure(fg=REC_BANNER_FG)
            if deck.get("value") is not None:
                deck["value"].configure(fg="#fff")
            if deck.get("cell") is not None:
                deck["cell"].configure(highlightbackground="#f87171")
        else:
            if self.rec_banner.winfo_ismapped():
                self.rec_banner.pack_forget()
            for key in ("cell", "title", "value"):
                widget = deck.get(key)
                if widget is not None:
                    widget.configure(bg=CARD)
            if deck.get("title") is not None:
                deck["title"].configure(fg=MUTED)
            if deck.get("value") is not None:
                deck["value"].configure(fg=FG)
            if deck.get("cell") is not None:
                deck["cell"].configure(highlightbackground=LINE)

    def _format_duration(self, seconds: int) -> str:
        total = max(0, int(seconds))
        hours, rem = divmod(total, 3600)
        minutes, secs = divmod(rem, 60)
        if hours:
            return f"{hours}h {minutes:02d}m"
        return f"{minutes}m {secs:02d}s"

    def _auto_stop_label_text(self, hours: int, minutes: int) -> str:
        parts = []
        if hours:
            parts.append(f"{hours}h")
        if minutes:
            parts.append(f"{minutes}m")
        return " ".join(parts) or "0m"

    def _default_auto_stop_text(self) -> str:
        if bool(self.cfg.get("auto_stop_never")):
            return "Session timer: Never"
        hours = int(self.cfg.get("auto_stop_hours") or 0)
        minutes = int(self.cfg.get("auto_stop_minutes") or 0)
        return f"Session timer: {self._auto_stop_label_text(hours, minutes)}"

    def _refresh_auto_stop_default_label(self) -> None:
        self.auto_stop_default_var.set(self._default_auto_stop_text())

    def _clear_auto_stop_timer(self) -> None:
        if self._auto_stop_tick is not None:
            try:
                self.root.after_cancel(self._auto_stop_tick)
            except tk.TclError:
                pass
            self._auto_stop_tick = None
        self._auto_stop_ends_at = None
        self._auto_stop_label = ""
        self._auto_stop_never = False
        self.auto_stop_pill.pack_forget()
        self.auto_stop_pill.configure(text="")

    def _update_auto_stop_pill(self) -> None:
        if self._auto_stop_never:
            self.auto_stop_pill.configure(text="No auto-stop", bg="#334155")
            if not self.auto_stop_pill.winfo_ismapped():
                self.auto_stop_pill.pack(side="left", padx=(8, 0))
            return
        if not self._auto_stop_ends_at:
            self.auto_stop_pill.pack_forget()
            return
        left_ms = self._auto_stop_ends_at - (time.time() * 1000)
        if left_ms <= 0:
            self.auto_stop_pill.configure(text="Stopping…", bg="#92400e")
        else:
            self.auto_stop_pill.configure(
                text=f"Session {self._format_duration(int(left_ms / 1000))}",
                bg="#1e3a5f",
            )
        if not self.auto_stop_pill.winfo_ismapped():
            self.auto_stop_pill.pack(side="left", padx=(8, 0))

    def _tick_auto_stop_pill(self) -> None:
        if not self._auto_stop_never and self._auto_stop_ends_at and time.time() * 1000 >= self._auto_stop_ends_at:
            self.auto_stop_pill.configure(text="Stopping…", bg="#92400e")
            self._bg(self._session_expire)
            return
        self._update_auto_stop_pill()
        self._auto_stop_tick = self.root.after(1000, self._tick_auto_stop_pill)

    def _schedule_auto_stop(self, hours: int, minutes: int, never: bool) -> None:
        self._clear_auto_stop_timer()
        self._auto_stop_never = never
        if never:
            self._update_auto_stop_pill()
            self._auto_stop_tick = self.root.after(1000, self._tick_auto_stop_pill)
            return
        ms = (max(0, hours) * 60 + max(0, minutes)) * 60 * 1000
        if ms <= 0:
            return
        self._auto_stop_label = self._auto_stop_label_text(hours, minutes)
        self._auto_stop_ends_at = time.time() * 1000 + ms
        self._update_auto_stop_pill()
        self._auto_stop_tick = self.root.after(1000, self._tick_auto_stop_pill)

    def _show_auto_stop_notice(self, text: str) -> None:
        self._auto_stop_notice = text
        self.notice_label.configure(text=text)
        if not self.notice_frame.winfo_ismapped():
            self.notice_frame.pack(fill="x", padx=14, pady=(0, 8), after=self.header)

    def _hide_auto_stop_notice(self) -> None:
        self._auto_stop_notice = ""
        self.notice_frame.pack_forget()

    def _ask_auto_stop(
        self,
        *,
        title: str = "Auto-stop timer",
        subtitle: str = "Limits Railway polling if this PC is left running after the show.",
    ) -> dict | None:
        hours = int(self.cfg.get("auto_stop_hours") or 2)
        minutes = int(self.cfg.get("auto_stop_minutes") or 0)
        if hours == 0 and minutes == 0:
            hours = 2
        result: dict | None = None

        dlg = tk.Toplevel(self.root)
        dlg.title(title)
        dlg.configure(bg=CARD)
        dlg.transient(self.root)
        dlg.resizable(False, False)
        dlg.grab_set()

        tk.Label(
            dlg,
            text=title,
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 12, "bold"),
        ).pack(anchor="w", padx=16, pady=(16, 4))
        tk.Label(
            dlg,
            text=subtitle,
            bg=CARD,
            fg=MUTED,
            wraplength=360,
            justify="left",
        ).pack(anchor="w", padx=16)

        pick = tk.Frame(dlg, bg=CARD)
        pick.pack(fill="x", padx=16, pady=12)
        field = "#0b1220"
        hours_var = tk.StringVar(value=str(hours))
        minutes_var = tk.StringVar(value=str(_clamp_auto_stop_minutes(minutes)))
        tk.Label(pick, text="Hours", bg=CARD, fg=MUTED, font=("Segoe UI", 9)).grid(row=0, column=0, sticky="w")
        hours_spin = tk.Spinbox(
            pick,
            from_=0,
            to=24,
            width=5,
            textvariable=hours_var,
            bg=field,
            fg=FG,
            buttonbackground=LINE,
            readonlybackground=field,
            highlightthickness=1,
            highlightbackground=LINE,
            insertbackground=FG,
            font=("Segoe UI", 11),
        )
        hours_spin.grid(row=1, column=0, sticky="w", padx=(0, 12), pady=2)
        tk.Label(pick, text="Minutes", bg=CARD, fg=MUTED, font=("Segoe UI", 9)).grid(row=0, column=1, sticky="w")
        minutes_menu = tk.OptionMenu(
            pick,
            minutes_var,
            *[str(m) for m in AUTO_STOP_MINUTES],
        )
        minutes_menu.configure(
            bg=field,
            fg=FG,
            activebackground=ACCENT,
            activeforeground="#ffffff",
            highlightthickness=0,
            relief="flat",
            font=("Segoe UI", 11),
            width=6,
        )
        minutes_menu["menu"].configure(
            bg=field,
            fg=FG,
            activebackground=ACCENT,
            activeforeground="#ffffff",
            relief="flat",
            font=("Segoe UI", 11),
        )
        minutes_menu.grid(row=1, column=1, sticky="w", pady=2)

        def finish(choice: dict | None) -> None:
            nonlocal result
            result = choice
            dlg.destroy()

        def confirm() -> None:
            h = _clamp_auto_stop_hours(hours_var.get())
            m = _clamp_auto_stop_minutes(minutes_var.get())
            if h >= 24:
                h, m = 24, 0
            if h == 0 and m == 0:
                messagebox.showinfo("Auto-stop", "Pick a time greater than 0, or choose Never auto-stop.", parent=dlg)
                return
            finish({"never": False, "hours": h, "minutes": m})

        btns = tk.Frame(dlg, bg=CARD)
        btns.pack(fill="x", padx=16, pady=(4, 16))
        ttk.Button(btns, text="Never auto-stop", command=lambda: finish({"never": True, "hours": hours, "minutes": minutes})).pack(
            side="left"
        )
        ttk.Button(btns, text="Save timer", style="Accent.TButton", command=confirm).pack(side="right")
        ttk.Button(btns, text="Cancel", command=lambda: finish(None)).pack(side="right", padx=(0, 6))
        dlg.protocol("WM_DELETE_WINDOW", lambda: finish(None))
        dlg.update_idletasks()
        x = self.root.winfo_rootx() + (self.root.winfo_width() - dlg.winfo_reqwidth()) // 2
        y = self.root.winfo_rooty() + 80
        dlg.geometry(f"+{x}+{y}")
        self.root.wait_window(dlg)
        return result

    def _apply_auto_stop_choice(self, choice: dict) -> None:
        if choice.get("never"):
            self.cfg["auto_stop_never"] = True
        else:
            self.cfg["auto_stop_never"] = False
            self.cfg["auto_stop_hours"] = _clamp_auto_stop_hours(choice.get("hours"))
            self.cfg["auto_stop_minutes"] = _clamp_auto_stop_minutes(choice.get("minutes"))
        self._session_timer_configured = True
        self._save()
        self._refresh_auto_stop_default_label()
        self._start_session_timer()

    def _start_session_timer(self) -> None:
        hours = int(self.cfg.get("auto_stop_hours") or 2)
        minutes = int(self.cfg.get("auto_stop_minutes") or 0)
        never = bool(self.cfg.get("auto_stop_never"))
        self._schedule_auto_stop(hours, minutes, never)
        if never:
            self.log("Session timer: no auto-stop until app restart", "ok")
        else:
            self.log(f"Session timer started: {self._auto_stop_label_text(hours, minutes)}", "ok")

    def _prompt_startup_session(self) -> None:
        choice = self._ask_auto_stop(
            title="Railway session timer",
            subtitle=(
                "Set how long this app should keep polling Railway before it disconnects. "
                "You can change this later with Set timer."
            ),
        )
        if choice is None:
            self._session_timer_configured = True
            self._refresh_auto_stop_default_label()
            self.log("Using saved Railway session timer from settings.")
            self._start_session_timer()
            return
        self._apply_auto_stop_choice(choice)

    def configure_auto_stop_defaults(self) -> None:
        choice = self._ask_auto_stop(
            title="Railway session timer",
            subtitle="How long should this app keep polling Railway before disconnecting?",
        )
        if choice is None:
            return
        self._apply_auto_stop_choice(choice)

    def _browse(self, var: tk.StringVar) -> None:
        path = filedialog.askdirectory()
        if path:
            var.set(path)

    def _load_fields_from_config(self) -> None:
        c = self.cfg
        self.api_url_var.set(c.get("api_base_url") or "")
        self.api_token_var.set(c.get("api_token") or "")
        self.event_id_var.set(c.get("event_id") or "")
        self.deck_host_var.set(c.get("hyperdeck_host") or "")
        self.deck_port_var.set(str(c.get("hyperdeck_port") or 9993))
        self.ftp_port_var.set(str(c.get("ftp_port") or 21))
        self.ftp_user_var.set(c.get("ftp_user") or "anonymous")
        self.ftp_pass_var.set(c.get("ftp_password") or "")
        self.target_folder_var.set(c.get("target_folder") or "")
        self.pattern_var.set(c.get("name_pattern") or DEFAULT_PATTERN)
        self.only_marked_var.set(c.get("record_only_marked") is not False)
        self.auto_copy_var.set(c.get("auto_copy") is not False)
        self.record_gate_var.set("rehearsal" if c.get("record_during_rehearsal") else "in-show")
        self.event_locked_var.set(False)
        self.event_rec_summary_var.set("Record-marked cues: —")
        self.cue_list_summary_var.set("No Record-marked cues yet")
        self.status_mode.set("—")
        self._refresh_auto_stop_default_label()
        self._refresh_event_selection_label()

    def _snapshot_config(self) -> dict:
        return {
            "api_base_url": self.api_url_var.get(),
            "api_token": self.api_token_var.get(),
            "event_id": self.event_id_var.get().strip(),
            "hyperdeck_host": self.deck_host_var.get().strip(),
            "hyperdeck_port": int(self.deck_port_var.get() or 9993),
            "ftp_port": int(self.ftp_port_var.get() or 21),
            "ftp_user": (self.ftp_user_var.get() or "anonymous").strip(),
            "ftp_password": self.ftp_pass_var.get(),
            "copy_method": "ftp",
            "source_folder": "",
            "target_folder": self.target_folder_var.get(),
            "name_pattern": self.pattern_var.get().strip() or DEFAULT_PATTERN,
            "record_only_marked": bool(self.only_marked_var.get()),
            "record_during_rehearsal": self._wants_rehearsal_record(),
            "auto_copy": bool(self.auto_copy_var.get()),
            "poll_seconds": int(self.cfg.get("poll_seconds") or 1),
            "auto_stop_hours": int(self.cfg.get("auto_stop_hours") or 2),
            "auto_stop_minutes": int(self.cfg.get("auto_stop_minutes") or 0),
            "auto_stop_never": bool(self.cfg.get("auto_stop_never")),
            "copied_keys": sorted(self.copied_keys),
        }

    def _apply_api_from_fields(self) -> RosApi:
        self.api = RosApi(self.api_url_var.get(), self.api_token_var.get())
        return self.api

    def _save(self) -> None:
        self.cfg = save_config(self._snapshot_config())
        self.log("Settings saved")

    def log(self, message: str, level: str = "info") -> None:
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}\n"

        def _write():
            self.log_text.insert("end", line, "ok" if level == "ok" else "error" if level == "error" else "")
            self.log_text.see("end")

        self.root.after(0, _write)

    def _on_close(self) -> None:
        self.following = False
        self._clear_auto_stop_timer()
        try:
            save_config(self._snapshot_config())
        except Exception:
            pass
        self.deck.disconnect()
        self.root.destroy()

    def _bg(self, fn, *args) -> None:
        def wrap():
            try:
                fn(*args)
            except Exception as exc:
                self.log(str(exc), "error")

        threading.Thread(target=wrap, daemon=True).start()

    def _test_api(self) -> None:
        def work():
            api = self._apply_api_from_fields()
            msg = api.validate()
            self.log(msg, "ok")
            self.root.after(0, lambda: self.status_ros.set(msg))

        self._bg(work)

    def _load_events(self) -> None:
        def work():
            api = self._apply_api_from_fields()
            events = api.list_events()
            self.events = events
            current = self.event_id_var.get().strip()

            def apply():
                if current:
                    self._auto_range_for_event(current)
                self._render_event_list(select_id=current or None)
                self.status_ros.set(f"Loaded {len(events)} event(s)")
                self.log(f"Loaded {len(events)} events", "ok")

            self.root.after(0, apply)

        self._bg(work)

    def _current_event(self) -> dict:
        eid = self.event_id_var.get().strip()
        for ev in self.events:
            if str(ev.get("id")) == eid:
                return ev
        return {"id": eid, "name": "", "date": ""}

    def _refresh_marks_clicked(self) -> None:
        eid = self.event_id_var.get().strip()
        if not eid:
            messagebox.showinfo("Event", "Select an event first.")
            return

        def work():
            try:
                prev = self._last_marked_count
                self._refresh_schedule(force=True)
                marked = sum(1 for item in self.schedule if item_needs_recording(item))
                note = f"Record marks refreshed: {marked} marked"
                if prev is not None and prev != marked:
                    note += f" (was {prev})"
                self.log(note, "ok")
            except Exception as exc:
                self.log(str(exc), "error")
                self.root.after(0, lambda: messagebox.showerror("Refresh marks", str(exc)))

        self._bg(work)

    def _update_record_cue_summary(self) -> None:
        total = len(self.schedule)
        marked = sum(1 for item in self.schedule if item_needs_recording(item))
        done = sum(
            1
            for item in self.schedule
            if item_needs_recording(item) and str(item.get("id")) in self._completed_record_item_ids
        )
        self._last_marked_count = marked
        self.event_rec_summary_var.set(f"Record-marked cues: {marked} / {total} · done {done}")
        self.root.after(0, self._render_cue_checklist)

    def _render_cue_checklist(self) -> None:
        if not hasattr(self, "cue_tree"):
            return
        for row in self.cue_tree.get_children():
            self.cue_tree.delete(row)
        marked_items = [item for item in self.schedule if item_needs_recording(item)]
        done_n = 0
        for item in marked_items:
            item_id = str(item.get("id") or "")
            is_recording = self._recording_item_id is not None and str(self._recording_item_id) == item_id
            is_done = item_id in self._completed_record_item_ids
            if is_done:
                done_n += 1
            if is_recording:
                mark, status, tag = "●", "recording", "recording"
            elif is_done:
                mark, status, tag = "✓", "done", "done"
            else:
                mark, status, tag = "○", "pending", "pending"
            self.cue_tree.insert(
                "",
                "end",
                iid=item_id or None,
                values=(mark, cue_label(item) or item_id, str(item.get("segmentName") or ""), status),
                tags=(tag,),
            )
        if not marked_items:
            self.cue_list_summary_var.set("No Record-marked cues yet — mark REC in ROS, then Refresh marks")
        else:
            self.cue_list_summary_var.set(f"{done_n} of {len(marked_items)} recorded this follow session")

    def _mode_label(self) -> str:
        mode = self._show_mode if self._show_mode == "in-show" else "rehearsal"
        if self._wants_rehearsal_record():
            return f"{mode} · record OK"
        if mode == "in-show":
            return "in-show · record OK"
        return "rehearsal · waiting for show"

    def _wants_rehearsal_record(self) -> bool:
        return self.record_gate_var.get() == "rehearsal"

    def _on_record_gate_changed(self) -> None:
        self.status_mode.set(self._mode_label())
        if self._wants_rehearsal_record():
            self.log("Auto-record gate: Rehearsal or In Show")
        else:
            self.log("Auto-record gate: In Show only")

    def _recording_allowed_for_show_mode(self) -> bool:
        if self._wants_rehearsal_record():
            return True
        return self._show_mode == "in-show"

    def _refresh_show_mode(self, force: bool = False) -> None:
        eid = self.event_id_var.get().strip()
        if not eid:
            return
        now = time.time()
        if not force and self._last_show_mode_refresh and (now - self._last_show_mode_refresh) < 5:
            return
        api = self._apply_api_from_fields()
        prev = self._show_mode
        self._show_mode = api.get_show_mode(eid)
        self._last_show_mode_refresh = time.time()
        label = self._mode_label()
        self.root.after(0, lambda: self.status_mode.set(label))
        if prev != self._show_mode:
            self.log(f"Show mode: {self._show_mode}", "ok")

    def _refresh_schedule(self, force: bool = False) -> None:
        eid = self.event_id_var.get().strip()
        if not eid:
            raise RosApiError("Select an event first")
        now = time.time()
        # Full run-of-show payload is expensive — keep this throttled (default 20s).
        refresh_every = max(5, int(self.cfg.get("schedule_refresh_seconds") or 20))
        if (
            not force
            and self.schedule
            and self._last_schedule_refresh
            and (now - self._last_schedule_refresh) < refresh_every
        ):
            return
        api = self._apply_api_from_fields()
        prev_len = len(self.schedule)
        prev_marked = {
            str(item.get("id"))
            for item in self.schedule
            if item_needs_recording(item) and item.get("id") is not None
        }
        self.schedule = api.schedule_items(eid)
        self._last_schedule_refresh = time.time()
        marked_ids = {
            str(item.get("id"))
            for item in self.schedule
            if item_needs_recording(item) and item.get("id") is not None
        }
        marked = len(marked_ids)
        marks_changed = marked_ids != prev_marked
        size_changed = len(self.schedule) != prev_len
        # Avoid log spam — only announce first load, forced refresh, or real changes.
        if force or prev_len == 0 or marks_changed or size_changed:
            self.log(f"Schedule: {len(self.schedule)} cues · Record-marked: {marked}")
        if prev_marked and marks_changed:
            added = sorted(marked_ids - prev_marked)
            removed = sorted(prev_marked - marked_ids)
            if added:
                self.log(f"New Record marks: {', '.join(added)}", "ok")
            if removed:
                self.log(f"Cleared Record marks: {', '.join(removed)}")
        try:
            # Don't force show-mode here — follow tick already polls it on a short throttle.
            self._refresh_show_mode(force=False)
        except Exception as exc:
            self.log(f"Show mode refresh failed: {exc}", "error")
        self.root.after(0, self._update_record_cue_summary)

    def _item_by_id(self, item_id) -> dict | None:
        sid = str(item_id)
        for item in self.schedule:
            if str(item.get("id")) == sid:
                return item
        return None

    def _connect_deck(self) -> None:
        def work():
            self.deck.host = self.deck_host_var.get().strip()
            self.deck.port = int(self.deck_port_var.get() or 9993)
            model = self.deck.connect()
            self.log(f"HyperDeck connected: {model or self.deck.host}", "ok")
            self.root.after(0, lambda: self.status_deck.set(model or "Connected"))
            self._refresh_clips_sync()

        self._bg(work)

    def _refresh_clips(self) -> None:
        self._bg(self._refresh_clips_sync)

    def _refresh_clips_sync(self) -> None:
        clips = self.deck.clips()
        self.clips = clips
        self.root.after(0, self._render_clips)

    def _clip_key(self, clip: ClipInfo) -> str:
        return f"{clip.index}:{clip.name}"

    def _render_clips(self) -> None:
        for row in self.clip_tree.get_children():
            self.clip_tree.delete(row)
        for clip in self.clips:
            copied = "yes" if self._clip_key(clip) in self.copied_keys else ""
            self.clip_tree.insert(
                "", "end", values=(clip.index, clip.name, clip.duration, copied)
            )

    def _dest_name(self, item: dict | None, clip_name: str) -> str:
        ev = self._current_event()
        pattern = self.pattern_var.get().strip() or DEFAULT_PATTERN
        base = apply_pattern(
            pattern,
            event_name=str(ev.get("name") or "Event"),
            event_date=str(ev.get("date") or ""),
            segment=str((item or {}).get("segmentName") or clip_name or "Segment"),
            cue=cue_label(item),
            clip=clip_name,
        )
        return base

    def _copy_clip(self, clip: ClipInfo, item: dict | None) -> str:
        target = self.target_folder_var.get().strip()
        if not target:
            raise CopyError("Set a target folder")
        stem = self._dest_name(item, clip.name)
        dest = unique_dest(target, stem + ".mov")
        path = copy_from_ftp(
            self.deck_host_var.get().strip(),
            clip.name,
            dest,
            port=int(self.ftp_port_var.get() or 21),
            user=(self.ftp_user_var.get() or "anonymous").strip(),
            password=self.ftp_pass_var.get(),
            log=self.log,
        )
        self.copied_keys.add(self._clip_key(clip))
        save_config(self._snapshot_config())
        self.root.after(0, lambda: self.status_copy.set(os.path.basename(path)))
        self.root.after(0, self._render_clips)
        self.log(f"Copied → {path}", "ok")
        return path

    def _copy_last(self) -> None:
        def work():
            self._refresh_clips_sync()
            if not self.clips:
                raise CopyError("No clips on the HyperDeck")
            clip = self.clips[-1]
            item = self._item_by_id(self._recording_item_id or self._last_item_id)
            self._copy_clip(clip, item)

        self._bg(work)

    def _manual_record(self) -> None:
        def work():
            item = self._item_by_id(self._last_item_id)
            name = hyperdeck_record_name(
                cue=cue_label(item),
                segment=str((item or {}).get("segmentName") or "clip"),
            )
            self.deck.record(name)
            self._recording_item_id = (item or {}).get("id")
            self._recording_clip_name = name
            self._recording_meta = item or {}
            self.log(f"Recording as {name}", "ok")
            self.root.after(0, lambda: self.status_deck.set(f"Recording {name}"))
            self._set_pill("recording")
            self.root.after(0, self._render_cue_checklist)

        self._bg(work)

    def _manual_stop(self) -> None:
        self._bg(self._stop_and_maybe_copy)

    def _stop_and_maybe_copy(self) -> None:
        self.deck.stop()
        self.log("HyperDeck stop")
        self.root.after(0, lambda: self.status_deck.set("Stopped"))
        self._set_pill("following" if self.following else "stopped")
        item = self._recording_meta or self._item_by_id(self._recording_item_id)
        finished_item_id = str(self._recording_item_id) if self._recording_item_id is not None else ""
        self._recording_item_id = None
        if finished_item_id:
            self._completed_record_item_ids.add(finished_item_id)
        self._recording_seen_running = False
        self.root.after(0, self._update_record_cue_summary)
        if not self.auto_copy_var.get():
            self._refresh_clips_sync()
            return
        time.sleep(3.5)
        self._refresh_clips_sync()
        if not self.clips:
            raise CopyError("Stopped, but no clips listed yet")
        clip = self.clips[-1]
        if self._recording_clip_name:
            match = next((c for c in reversed(self.clips) if c.name == self._recording_clip_name), None)
            if match:
                clip = match
        self._copy_clip(clip, item)
        self._recording_clip_name = ""
        self._recording_meta = {}

    def start_follow(self) -> None:
        if self.following:
            return
        if not self.event_id_var.get().strip():
            messagebox.showinfo("Event", "Load events and select one first.")
            return
        if not self.event_locked_var.get():
            messagebox.showinfo(
                "Event",
                "Confirm and lock the event first (Confirm event button), then Start follow.",
            )
            return
        try:
            self._apply_api_from_fields()
            if not self.deck.connected:
                self.deck.host = self.deck_host_var.get().strip()
                self.deck.port = int(self.deck_port_var.get() or 9993)
                model = self.deck.connect()
                self.status_deck.set(model or "Connected")
                self.log(f"HyperDeck connected: {model or self.deck.host}", "ok")
            self._refresh_schedule(force=True)
        except Exception as exc:
            messagebox.showerror("Cannot start", str(exc))
            return
        self._hide_auto_stop_notice()
        self._save()
        self._completed_record_item_ids = set()
        self._recording_seen_running = False
        self.following = True
        self._set_pill("following")
        self.root.after(0, self._update_record_cue_summary)
        marked = sum(1 for item in self.schedule if item_needs_recording(item))
        gate = (
            "recording allowed in Rehearsal and In Show"
            if self._wants_rehearsal_record()
            else "recording only when event is In Show"
        )
        self.log(f"Follow started with {marked} Record-marked cue(s) · {gate}", "ok")
        self.log(f"Show mode now: {self._show_mode}", "ok")
        if self._auto_stop_never:
            self.log("Polling until session timer expires or you click Stop", "ok")
        elif self._auto_stop_ends_at:
            left = max(0, int((self._auto_stop_ends_at - time.time() * 1000) / 1000))
            self.log(f"Session timer {self._format_duration(left)} remaining", "ok")
        else:
            self.log("Follow started", "ok")
        self._follow_thread = threading.Thread(target=self._follow_loop, daemon=True)
        self._follow_thread.start()

    def stop_follow(self) -> None:
        self._bg(lambda: self._end_follow(auto=False))

    def _session_expire(self) -> None:
        self._end_follow(auto=True, session_expired=True)

    def _end_follow(self, auto: bool = False, session_expired: bool = False) -> None:
        if not self._end_lock.acquire(blocking=False):
            return
        try:
            was_following = self.following
            was_recording = self._recording_item_id is not None
            label = self._auto_stop_label
            self.following = False
            if was_recording:
                try:
                    self._stop_and_maybe_copy()
                except Exception as exc:
                    self.log(str(exc), "error")
            if session_expired or auto:
                try:
                    self.deck.disconnect()
                except Exception:
                    pass
                self.root.after(0, lambda: self.status_deck.set("Disconnected"))
                notice = (
                    f"Railway session ended after {label}. Restart the app to poll again."
                    if label
                    else "Railway session ended. Restart the app to poll again."
                )
                self.log(notice)
                self.root.after(0, lambda: self._show_auto_stop_notice(notice))
                self.root.after(0, self._clear_auto_stop_timer)
            elif was_following:
                self.log("Follow stopped")
            self.root.after(0, lambda: self._set_pill("stopped"))
            self.root.after(0, lambda: self.status_ros.set("Follow stopped" if was_following else "Session ended"))
        finally:
            self._end_lock.release()

    def _follow_loop(self) -> None:
        poll = max(1, int(self.cfg.get("poll_seconds") or 1))
        while self.following:
            try:
                self._follow_tick()
            except Exception as exc:
                self.log(str(exc), "error")
                self.root.after(0, lambda m=str(exc): self.status_ros.set(m))
            time.sleep(poll)

    def _cue_timer_stopped(self, timer: dict | None, item_id) -> bool:
        """True when the given cue's timer has stopped/completed."""
        if timer is None:
            return True
        if str(timer.get("item_id")) != str(item_id):
            # Jump/load replaced the active cue — previous cue is done for recording.
            return True
        state = str(timer.get("timer_state") or "").lower()
        running = timer.get("is_running") is True or state == "running"
        if state in ("stopped", "done", "ended", "completed"):
            return True
        if self._recording_seen_running and not running:
            return True
        return False

    def _follow_tick(self) -> None:
        eid = self.event_id_var.get().strip()
        try:
            self._refresh_schedule(force=False)
        except Exception as exc:
            self.log(f"Schedule refresh failed: {exc}", "error")
        try:
            self._refresh_show_mode(force=False)
        except Exception as exc:
            self.log(f"Show mode refresh failed: {exc}", "error")

        timer = self.api.get_active_timer(eid)

        # Stop HyperDeck when the recorded cue ends OR when ROS jump-loads another cue
        # (active_timers row is replaced — we never see timer_state=stopped for the old id).
        if self._recording_item_id is not None:
            rec_id = self._recording_item_id
            if timer is None:
                self.log("Active timer cleared — stopping HyperDeck", "ok")
                self._stop_and_maybe_copy()
                self._last_running = False
                self._last_item_id = None
                self.root.after(0, lambda: self.status_cue.set("None"))
                return
            timer_item = timer.get("item_id")
            if str(timer_item) != str(rec_id):
                self.log(
                    f"Cue jump while recording — stop clip for {rec_id}, now loaded {timer_item}",
                    "ok",
                )
                self._stop_and_maybe_copy()
            elif self._cue_timer_stopped(timer, rec_id):
                self.log("Recorded cue timer stopped — stopping HyperDeck", "ok")
                self._stop_and_maybe_copy()

        if not timer:
            self.root.after(0, lambda: self.status_cue.set("None"))
            self._last_running = False
            self._last_item_id = None
            return

        item_id = timer.get("item_id")
        state = str(timer.get("timer_state") or "").lower()
        running = timer.get("is_running") is True or state == "running"
        item = self._item_by_id(item_id)
        # Missing cue id in cache: allow a throttled schedule refresh (never force every poll).
        # Unmarked loaded cues do NOT force a full schedule fetch — that was spamming Railway.
        if item is None:
            try:
                self._refresh_schedule(force=False)
                item = self._item_by_id(item_id)
            except Exception as exc:
                self.log(f"Schedule refresh failed: {exc}", "error")
        marked = item_needs_recording(item)
        cue = cue_label(item)
        segment = str((item or {}).get("segmentName") or "")
        rec = "REC" if marked else "—"
        state_label = "running" if running else (state or "loaded")
        if self._recording_item_id is not None and str(self._recording_item_id) == str(item_id):
            state_label = f"{state_label} · recording"
            if running:
                self._recording_seen_running = True
        self.root.after(
            0,
            lambda: self.status_cue.set(f"{cue or item_id}  {segment}  [{state_label}]  {rec}"),
        )
        self.root.after(0, lambda: self.status_ros.set("Polling OK"))
        self.root.after(0, lambda: self.status_mode.set(self._mode_label()))

        if (
            marked
            and self._recording_item_id is None
            and state in ("loaded", "running")
            and str(item_id) not in self._completed_record_item_ids
        ):
            if not self._recording_allowed_for_show_mode():
                now = time.time()
                if now - self._last_mode_block_log > 20:
                    self._last_mode_block_log = now
                    self.log(
                        "Skipping auto-record — event is in Rehearsal "
                        "(enable “Record during Rehearsal” to test, or switch ROS to In Show)",
                    )
                    self.root.after(
                        0,
                        lambda: self.status_mode.set("rehearsal · blocked"),
                    )
            else:
                name = hyperdeck_record_name(cue=cue, segment=segment or "clip")
                self.deck.record(name)
                self._recording_item_id = item_id
                self._recording_clip_name = name
                self._recording_meta = item or {}
                self._recording_seen_running = running
                self.log(f"Auto-record on load: {name}", "ok")
                self.root.after(0, lambda: self.status_deck.set(f"Recording {name}"))
                self._set_pill("recording")
                self.root.after(0, self._render_cue_checklist)

        self._last_item_id = item_id
        self._last_running = running


def main() -> None:
    root = tk.Tk()
    HyperDeckIngestApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
