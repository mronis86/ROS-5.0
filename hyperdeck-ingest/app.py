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

from config_store import AUTO_STOP_MINUTES, load_config, save_config
from copy_util import CopyError, copy_from_folder, copy_from_ftp, unique_dest
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
PILL_REC = "#991b1b"


class HyperDeckIngestApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("ROS HyperDeck Ingest")
        self.root.geometry("1040x760")
        self.root.minsize(920, 660)
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
        self.copy_method_var = tk.StringVar(value="ftp")
        self.ftp_port_var = tk.StringVar()
        self.ftp_user_var = tk.StringVar()
        self.ftp_pass_var = tk.StringVar()
        self.source_folder_var = tk.StringVar()
        self.target_folder_var = tk.StringVar()
        self.pattern_var = tk.StringVar()
        self.only_marked_var = tk.BooleanVar(value=True)
        self.auto_copy_var = tk.BooleanVar(value=True)
        self.status_ros = tk.StringVar(value="Not tested")
        self.status_deck = tk.StringVar(value="Disconnected")
        self.status_cue = tk.StringVar(value="—")
        self.status_copy = tk.StringVar(value="—")

        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=14, pady=(12, 8))
        self.header = header
        brand = tk.Frame(header, bg=BG)
        brand.pack(side="left")
        tk.Label(
            brand,
            text="ROS HyperDeck Ingest",
            bg=BG,
            fg=FG,
            font=("Segoe UI", 15, "bold"),
        ).pack(side="left")
        self.follow_pill = tk.Label(
            brand,
            text="Stopped",
            bg=PILL_STOP,
            fg="#e2e8f0",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=3,
        )
        self.follow_pill.pack(side="left", padx=(12, 0))
        self.auto_stop_pill = tk.Label(
            brand,
            text="",
            bg="#1e3a5f",
            fg="#e2e8f0",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=3,
        )
        actions = tk.Frame(header, bg=BG)
        actions.pack(side="right")
        ttk.Button(actions, text="Start follow", style="Accent.TButton", command=self.start_follow).pack(
            side="left"
        )
        ttk.Button(actions, text="Stop", command=self.stop_follow).pack(side="left", padx=(6, 0))
        ttk.Button(actions, text="Save", command=self._save).pack(side="left", padx=(6, 0))

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
        tiles = (
            ("ROS", self.status_ros),
            ("Deck", self.status_deck),
            ("Cue", self.status_cue),
            ("Copy", self.status_copy),
        )
        for i, (title, var) in enumerate(tiles):
            cell = tk.Frame(status, bg=CARD, highlightbackground=LINE, highlightthickness=1)
            cell.grid(row=0, column=i, sticky="nsew", padx=4)
            status.columnconfigure(i, weight=1, uniform="stat")
            tk.Label(cell, text=title, bg=CARD, fg=MUTED, font=("Segoe UI", 8, "bold"), anchor="w").pack(
                fill="x", padx=10, pady=(8, 0)
            )
            tk.Label(
                cell,
                textvariable=var,
                bg=CARD,
                fg=FG,
                font=("Segoe UI", 10),
                anchor="w",
                wraplength=230,
                justify="left",
            ).pack(fill="x", padx=10, pady=(2, 8))

        body = tk.Frame(self.root, bg=BG)
        body.pack(fill="both", expand=True, padx=14)
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
        self._grid_label(dest, 0, "Source mode")
        method = tk.Frame(dest, bg=CARD)
        method.grid(row=0, column=1, sticky="w", pady=4)
        ttk.Radiobutton(method, text="FTP from HyperDeck", variable=self.copy_method_var, value="ftp").pack(side="left")
        ttk.Radiobutton(method, text="Mounted deck folder", variable=self.copy_method_var, value="folder").pack(
            side="left", padx=(14, 0)
        )
        ttk.Label(
            dest,
            text="FTP mode reads from the connected deck. Mounted mode is only for SSD/network shares already mapped on this PC.",
            style="CardMuted.TLabel",
        ).grid(row=1, column=1, sticky="w")

        self.ftp_row = tk.Frame(dest, bg=CARD)
        self.ftp_row.grid(row=2, column=0, columnspan=2, sticky="ew", pady=4)
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

        self.src_row = tk.Frame(dest, bg=CARD)
        self.src_row.grid(row=2, column=0, columnspan=2, sticky="ew", pady=4)
        self.src_row.columnconfigure(1, weight=1)
        ttk.Label(self.src_row, text="Mounted source folder", style="CardMuted.TLabel").grid(
            row=0, column=0, sticky="w", padx=(0, 10)
        )
        src_fields = tk.Frame(self.src_row, bg=CARD)
        src_fields.grid(row=0, column=1, sticky="ew")
        ttk.Entry(src_fields, textvariable=self.source_folder_var).pack(side="left", fill="x", expand=True)
        ttk.Button(src_fields, text="Browse", command=lambda: self._browse(self.source_folder_var)).pack(
            side="left", padx=(6, 0)
        )

        self._grid_label(dest, 3, "Target copy folder")
        tgt = tk.Frame(dest, bg=CARD)
        tgt.grid(row=3, column=1, sticky="ew", pady=4)
        ttk.Entry(tgt, textvariable=self.target_folder_var).pack(side="left", fill="x", expand=True)
        ttk.Button(tgt, text="Browse", command=lambda: self._browse(self.target_folder_var)).pack(
            side="left", padx=(6, 0)
        )
        self._grid_label(dest, 4, "Name")
        ttk.Entry(dest, textvariable=self.pattern_var).grid(row=4, column=1, sticky="ew", pady=4)
        ttk.Label(
            dest,
            text="{date} {event} {segment} {cue}  ·  date is event YYMMDD",
            style="CardMuted.TLabel",
        ).grid(row=5, column=1, sticky="w")
        flags = tk.Frame(dest, bg=CARD)
        flags.grid(row=6, column=1, sticky="w", pady=(8, 0))
        ttk.Checkbutton(flags, text="Only marked Record cues", variable=self.only_marked_var).pack(anchor="w")
        ttk.Checkbutton(flags, text="Auto-copy after stop", variable=self.auto_copy_var).pack(anchor="w", pady=(4, 0))
        self.copy_method_var.trace_add("write", lambda *_: self._sync_copy_method_ui())

        clips = self._card(right, "HyperDeck clips", fill="both")
        tree_wrap = tk.Frame(clips, bg=CARD)
        tree_wrap.pack(fill="both", expand=True)
        cols = ("idx", "name", "duration", "copied")
        self.clip_tree = ttk.Treeview(tree_wrap, columns=cols, show="headings", selectmode="browse")
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

        log_wrap = tk.Frame(self.root, bg=BG)
        log_wrap.pack(fill="x", padx=14, pady=(0, 12))
        tk.Label(
            log_wrap, text="LOG", bg=BG, fg=MUTED, font=("Segoe UI", 8, "bold"), anchor="w"
        ).pack(fill="x", pady=(0, 6))
        log_card = tk.Frame(log_wrap, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        log_card.pack(fill="x")
        self.log_text = tk.Text(
            log_card,
            height=6,
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
        self.log_text.pack(fill="x")
        self.log_text.tag_config("error", foreground=ERR)
        self.log_text.tag_config("ok", foreground=OK)

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

    def _choose_event(self, ev: dict) -> None:
        eid = str(ev.get("id") or "")
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

    def _sync_copy_method_ui(self) -> None:
        if self.copy_method_var.get() == "folder":
            self.ftp_row.grid_remove()
            self.src_row.grid()
        else:
            self.src_row.grid_remove()
            self.ftp_row.grid()

    def _set_pill(self, kind: str) -> None:
        styles = {
            "stopped": ("Stopped", PILL_STOP),
            "following": ("Following", PILL_FOLLOW),
            "recording": ("Recording", PILL_REC),
        }
        text, bg = styles.get(kind, styles["stopped"])

        def apply():
            self.follow_pill.configure(text=text, bg=bg)

        self.root.after(0, apply)

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
                text=f"Auto-stop {self._format_duration(int(left_ms / 1000))}",
                bg="#1e3a5f",
            )
        if not self.auto_stop_pill.winfo_ismapped():
            self.auto_stop_pill.pack(side="left", padx=(8, 0))

    def _tick_auto_stop_pill(self) -> None:
        if not self.following:
            return
        if not self._auto_stop_never and self._auto_stop_ends_at and time.time() * 1000 >= self._auto_stop_ends_at:
            self.auto_stop_pill.configure(text="Stopping…", bg="#92400e")
            self._bg(self._auto_stop_now)
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

    def _ask_auto_stop(self) -> dict | None:
        hours = int(self.cfg.get("auto_stop_hours") or 2)
        minutes = int(self.cfg.get("auto_stop_minutes") or 0)
        if hours == 0 and minutes == 0:
            hours = 2
        result: dict | None = None

        dlg = tk.Toplevel(self.root)
        dlg.title("Auto-stop timer")
        dlg.configure(bg=CARD)
        dlg.transient(self.root)
        dlg.resizable(False, False)
        dlg.grab_set()

        tk.Label(
            dlg,
            text="Stop follow after",
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 12, "bold"),
        ).pack(anchor="w", padx=16, pady=(16, 4))
        tk.Label(
            dlg,
            text="Limits Railway polling if this PC is left running after the show.",
            bg=CARD,
            fg=MUTED,
            wraplength=360,
            justify="left",
        ).pack(anchor="w", padx=16)

        pick = tk.Frame(dlg, bg=CARD)
        pick.pack(fill="x", padx=16, pady=12)
        hours_var = tk.StringVar(value=str(hours))
        minutes_var = tk.StringVar(value=str(minutes))
        ttk.Label(pick, text="Hours", style="CardMuted.TLabel").grid(row=0, column=0, sticky="w")
        hours_box = ttk.Combobox(
            pick, textvariable=hours_var, values=[str(i) for i in range(25)], state="readonly", width=6
        )
        hours_box.grid(row=1, column=0, sticky="w", padx=(0, 12))
        ttk.Label(pick, text="Minutes", style="CardMuted.TLabel").grid(row=0, column=1, sticky="w")
        minutes_box = ttk.Combobox(
            pick,
            textvariable=minutes_var,
            values=[str(m) for m in AUTO_STOP_MINUTES],
            state="readonly",
            width=6,
        )
        minutes_box.grid(row=1, column=1, sticky="w")

        def finish(choice: dict | None) -> None:
            nonlocal result
            result = choice
            dlg.destroy()

        def confirm() -> None:
            h = int(hours_var.get() or 0)
            m = int(minutes_var.get() or 0)
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
        ttk.Button(btns, text="Start with timer", style="Accent.TButton", command=confirm).pack(side="right")
        ttk.Button(btns, text="Cancel", command=lambda: finish(None)).pack(side="right", padx=(0, 6))
        dlg.protocol("WM_DELETE_WINDOW", lambda: finish(None))
        dlg.update_idletasks()
        x = self.root.winfo_rootx() + (self.root.winfo_width() - dlg.winfo_reqwidth()) // 2
        y = self.root.winfo_rooty() + 80
        dlg.geometry(f"+{x}+{y}")
        self.root.wait_window(dlg)
        return result

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
        self.copy_method_var.set(c.get("copy_method") or "ftp")
        self.ftp_port_var.set(str(c.get("ftp_port") or 21))
        self.ftp_user_var.set(c.get("ftp_user") or "")
        self.ftp_pass_var.set(c.get("ftp_password") or "")
        self.source_folder_var.set(c.get("source_folder") or "")
        self.target_folder_var.set(c.get("target_folder") or "")
        self.pattern_var.set(c.get("name_pattern") or DEFAULT_PATTERN)
        self.only_marked_var.set(c.get("record_only_marked") is not False)
        self.auto_copy_var.set(c.get("auto_copy") is not False)
        self._sync_copy_method_ui()
        self._refresh_event_selection_label()

    def _snapshot_config(self) -> dict:
        return {
            "api_base_url": self.api_url_var.get(),
            "api_token": self.api_token_var.get(),
            "event_id": self.event_id_var.get().strip(),
            "hyperdeck_host": self.deck_host_var.get().strip(),
            "hyperdeck_port": int(self.deck_port_var.get() or 9993),
            "ftp_port": int(self.ftp_port_var.get() or 21),
            "ftp_user": self.ftp_user_var.get(),
            "ftp_password": self.ftp_pass_var.get(),
            "copy_method": self.copy_method_var.get(),
            "source_folder": self.source_folder_var.get(),
            "target_folder": self.target_folder_var.get(),
            "name_pattern": self.pattern_var.get().strip() or DEFAULT_PATTERN,
            "record_only_marked": bool(self.only_marked_var.get()),
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

    def _refresh_schedule(self) -> None:
        eid = self.event_id_var.get().strip()
        if not eid:
            raise RosApiError("Select an event first")
        api = self._apply_api_from_fields()
        self.schedule = api.schedule_items(eid)
        self.log(f"Schedule: {len(self.schedule)} cues")

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
        method = self.copy_method_var.get()
        if method == "folder":
            path = copy_from_folder(self.source_folder_var.get(), clip.name, dest, log=self.log)
        else:
            path = copy_from_ftp(
                self.deck_host_var.get().strip(),
                clip.name,
                dest,
                port=int(self.ftp_port_var.get() or 21),
                user=self.ftp_user_var.get(),
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

        self._bg(work)

    def _manual_stop(self) -> None:
        self._bg(self._stop_and_maybe_copy)

    def _stop_and_maybe_copy(self) -> None:
        self.deck.stop()
        self.log("HyperDeck stop")
        self.root.after(0, lambda: self.status_deck.set("Stopped"))
        self._set_pill("following" if self.following else "stopped")
        item = self._recording_meta or self._item_by_id(self._recording_item_id)
        self._recording_item_id = None
        if not self.auto_copy_var.get():
            self._refresh_clips_sync()
            return
        time.sleep(1.5)
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
        choice = self._ask_auto_stop()
        if choice is None:
            return
        self.cfg["auto_stop_hours"] = int(choice.get("hours") or self.cfg.get("auto_stop_hours") or 2)
        self.cfg["auto_stop_minutes"] = int(choice.get("minutes") or 0)
        self.cfg["auto_stop_never"] = bool(choice.get("never"))
        try:
            self._apply_api_from_fields()
            if not self.deck.connected:
                self.deck.host = self.deck_host_var.get().strip()
                self.deck.port = int(self.deck_port_var.get() or 9993)
                model = self.deck.connect()
                self.status_deck.set(model or "Connected")
                self.log(f"HyperDeck connected: {model or self.deck.host}", "ok")
            self._refresh_schedule()
        except Exception as exc:
            messagebox.showerror("Cannot start", str(exc))
            return
        self._hide_auto_stop_notice()
        self._save()
        self.following = True
        self._set_pill("following")
        self._schedule_auto_stop(
            int(self.cfg.get("auto_stop_hours") or 2),
            int(self.cfg.get("auto_stop_minutes") or 0),
            bool(self.cfg.get("auto_stop_never")),
        )
        if self._auto_stop_never:
            self.log("Follow started — polling until you click Stop", "ok")
        else:
            self.log(f"Follow started — auto-stop in {self._auto_stop_label}", "ok")
        self._follow_thread = threading.Thread(target=self._follow_loop, daemon=True)
        self._follow_thread.start()

    def stop_follow(self) -> None:
        self._bg(lambda: self._end_follow(auto=False))

    def _auto_stop_now(self) -> None:
        self._end_follow(auto=True)

    def _end_follow(self, auto: bool = False) -> None:
        if not self._end_lock.acquire(blocking=False):
            return
        try:
            was_following = self.following
            was_recording = self._recording_item_id is not None
            label = self._auto_stop_label
            self.following = False
            self.root.after(0, self._clear_auto_stop_timer)
            if was_recording:
                try:
                    self._stop_and_maybe_copy()
                except Exception as exc:
                    self.log(str(exc), "error")
            if auto:
                try:
                    self.deck.disconnect()
                except Exception:
                    pass
                self.root.after(0, lambda: self.status_deck.set("Disconnected"))
                notice = (
                    f"Follow stopped after {label} to limit Railway polling. HyperDeck disconnected."
                    if label
                    else "Follow stopped after the auto-stop timer. HyperDeck disconnected."
                )
                self.log(notice)
                self.root.after(0, lambda: self._show_auto_stop_notice(notice))
            elif was_following:
                self.log("Follow stopped")
            self.root.after(0, lambda: self._set_pill("stopped"))
            self.root.after(0, lambda: self.status_ros.set("Follow stopped"))
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

    def _follow_tick(self) -> None:
        eid = self.event_id_var.get().strip()
        timer = self.api.get_active_timer(eid)
        if not timer:
            self.root.after(0, lambda: self.status_cue.set("None"))
            if self._recording_item_id is not None:
                self._stop_and_maybe_copy()
            self._last_running = False
            self._last_item_id = None
            return

        item_id = timer.get("item_id")
        running = timer.get("is_running") is True or str(timer.get("timer_state") or "") == "running"
        item = self._item_by_id(item_id)
        if item is None:
            try:
                self._refresh_schedule()
                item = self._item_by_id(item_id)
            except Exception:
                pass
        marked = item_needs_recording(item)
        should = running and (marked or not self.only_marked_var.get())
        cue = cue_label(item)
        segment = str((item or {}).get("segmentName") or "")
        rec = "REC" if marked else "—"
        state = "running" if running else str(timer.get("timer_state") or "loaded")
        self.root.after(
            0,
            lambda: self.status_cue.set(f"{cue or item_id}  {segment}  [{state}]  {rec}"),
        )
        self.root.after(0, lambda: self.status_ros.set("Polling OK"))

        changed = str(item_id) != str(self._last_item_id)
        stopped = self._last_running and not running
        self._last_item_id = item_id
        self._last_running = running

        if self._recording_item_id is not None and (stopped or (changed and running)):
            self._stop_and_maybe_copy()

        if should and self._recording_item_id is None:
            name = hyperdeck_record_name(cue=cue, segment=segment or "clip")
            self.deck.record(name)
            self._recording_item_id = item_id
            self._recording_clip_name = name
            self._recording_meta = item or {}
            self.log(f"Auto-record {name}", "ok")
            self.root.after(0, lambda: self.status_deck.set(f"Recording {name}"))
            self._set_pill("recording")


def main() -> None:
    root = tk.Tk()
    HyperDeckIngestApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
