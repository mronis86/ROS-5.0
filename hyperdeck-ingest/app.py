"""ROS HyperDeck Ingest — local sidecar (auth like the vMix bridge).

Watches the loaded/running cue via REST /api/active-timers, records marked
cues on a HyperDeck, then copies the closed clip to an editor folder.
"""
from __future__ import annotations

import os
import threading
import time
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk

from config_store import load_config, save_config
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
        self.root.geometry("1040x700")
        self.root.minsize(920, 620)
        self.root.configure(bg=BG)

        self.cfg = load_config()
        self.api = RosApi(self.cfg.get("api_base_url") or "", self.cfg.get("api_token") or "")
        self.deck = HyperDeckClient(
            str(self.cfg.get("hyperdeck_host") or ""),
            int(self.cfg.get("hyperdeck_port") or 9993),
        )
        self.events: list[dict] = []
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
        actions = tk.Frame(header, bg=BG)
        actions.pack(side="right")
        ttk.Button(actions, text="Start follow", style="Accent.TButton", command=self.start_follow).pack(
            side="left"
        )
        ttk.Button(actions, text="Stop", command=self.stop_follow).pack(side="left", padx=(6, 0))
        ttk.Button(actions, text="Save", command=self._save).pack(side="left", padx=(6, 0))

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
        self.event_combo = ttk.Combobox(ros, state="readonly")
        self.event_combo.grid(row=4, column=1, sticky="ew", pady=4)
        self.event_combo.bind("<<ComboboxSelected>>", self._on_event_chosen)
        self.event_id_hint = ttk.Label(ros, text="", style="CardMuted.TLabel")
        self.event_id_hint.grid(row=5, column=1, sticky="w")
        self.event_id_var.trace_add("write", lambda *_: self._refresh_event_hint())

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
        self._grid_label(dest, 0, "Method")
        method = tk.Frame(dest, bg=CARD)
        method.grid(row=0, column=1, sticky="w", pady=4)
        ttk.Radiobutton(method, text="FTP from deck", variable=self.copy_method_var, value="ftp").pack(side="left")
        ttk.Radiobutton(method, text="Folder on this PC", variable=self.copy_method_var, value="folder").pack(
            side="left", padx=(14, 0)
        )

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

        self.src_row = tk.Frame(dest, bg=CARD)
        self.src_row.grid(row=1, column=0, columnspan=2, sticky="ew", pady=4)
        self.src_row.columnconfigure(1, weight=1)
        ttk.Label(self.src_row, text="Source", style="CardMuted.TLabel").grid(
            row=0, column=0, sticky="w", padx=(0, 10)
        )
        src_fields = tk.Frame(self.src_row, bg=CARD)
        src_fields.grid(row=0, column=1, sticky="ew")
        ttk.Entry(src_fields, textvariable=self.source_folder_var).pack(side="left", fill="x", expand=True)
        ttk.Button(src_fields, text="Browse", command=lambda: self._browse(self.source_folder_var)).pack(
            side="left", padx=(6, 0)
        )

        self._grid_label(dest, 2, "Target")
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

    def _refresh_event_hint(self) -> None:
        eid = self.event_id_var.get().strip()
        self.event_id_hint.configure(text=f"ID  {eid}" if eid else "Load events, then pick one")

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
        self._refresh_event_hint()

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
            labels = []
            for ev in events:
                date = str(ev.get("date") or "")
                if "T" in date:
                    date = date.split("T", 1)[0]
                labels.append(f"{date}  {ev.get('name') or 'Untitled'}  ({ev.get('id')})")
            current = self.event_id_var.get().strip()

            def apply():
                self.event_combo["values"] = labels
                if current:
                    for i, ev in enumerate(events):
                        if str(ev.get("id")) == current:
                            self.event_combo.current(i)
                            break
                self.status_ros.set(f"Loaded {len(events)} event(s)")
                self.log(f"Loaded {len(events)} events", "ok")

            self.root.after(0, apply)

        self._bg(work)

    def _on_event_chosen(self, _evt=None) -> None:
        idx = self.event_combo.current()
        if idx < 0 or idx >= len(self.events):
            return
        ev = self.events[idx]
        self.event_id_var.set(str(ev.get("id") or ""))
        self._bg(self._refresh_schedule)

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
        try:
            self._apply_api_from_fields()
            if not self.event_id_var.get().strip():
                messagebox.showinfo("Event", "Load events and select one first.")
                return
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
        self._save()
        self.following = True
        self._set_pill("following")
        self.log("Follow started — polling active-timers", "ok")
        self._follow_thread = threading.Thread(target=self._follow_loop, daemon=True)
        self._follow_thread.start()

    def stop_follow(self) -> None:
        self.following = False
        self._set_pill("stopped")
        self.log("Follow stopped")

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
