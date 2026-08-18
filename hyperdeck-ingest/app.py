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
FG = "#e2e8f0"
MUTED = "#94a3b8"
ACCENT = "#2563eb"
OK = "#34d399"
ERR = "#f87171"


class HyperDeckIngestApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("ROS HyperDeck Ingest")
        self.root.geometry("980x720")
        self.root.minsize(860, 620)
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
        style.configure(".", background=BG, foreground=FG, fieldbackground=CARD)
        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=CARD)
        style.configure("TLabel", background=BG, foreground=FG)
        style.configure("Card.TLabel", background=CARD, foreground=FG)
        style.configure("Muted.TLabel", background=BG, foreground=MUTED)
        style.configure("CardMuted.TLabel", background=CARD, foreground=MUTED)
        style.configure("TLabelframe", background=CARD, foreground=FG)
        style.configure("TLabelframe.Label", background=CARD, foreground=FG)
        style.configure("TButton", background="#334155", foreground=FG, padding=6)
        style.configure("Accent.TButton", background=ACCENT, foreground="#fff")
        style.configure("TCheckbutton", background=CARD, foreground=FG)
        style.configure("TEntry", fieldbackground="#0b1220", foreground=FG)
        style.configure("TCombobox", fieldbackground="#0b1220", foreground=FG)
        style.configure("Treeview", background="#0b1220", foreground=FG, fieldbackground="#0b1220")
        style.configure("Treeview.Heading", background="#334155", foreground=FG)
        style.map("TButton", background=[("active", "#475569")])
        style.map("Accent.TButton", background=[("active", "#1d4ed8")])

    def _build_ui(self) -> None:
        pad = {"padx": 8, "pady": 6}
        top = ttk.Frame(self.root)
        top.pack(fill="x", **pad)
        ttk.Label(top, text="ROS HyperDeck Ingest", font=("Segoe UI", 14, "bold")).pack(side="left")
        self.follow_pill = ttk.Label(top, text="Stopped", style="Muted.TLabel")
        self.follow_pill.pack(side="left", padx=(12, 0))
        ttk.Button(top, text="Save", command=self._save).pack(side="right")
        ttk.Button(top, text="Stop follow", command=self.stop_follow).pack(side="right", padx=(0, 6))
        ttk.Button(top, text="Start follow", style="Accent.TButton", command=self.start_follow).pack(
            side="right", padx=(0, 6)
        )

        body = ttk.Frame(self.root)
        body.pack(fill="both", expand=True, **pad)
        left = ttk.Frame(body)
        left.pack(side="left", fill="both", expand=True)
        right = ttk.Frame(body)
        right.pack(side="right", fill="both", expand=True, padx=(8, 0))

        ros = ttk.LabelFrame(left, text="ROS (Railway)", padding=8)
        ros.pack(fill="x")
        self.api_url_var = tk.StringVar()
        self.api_token_var = tk.StringVar()
        self.event_id_var = tk.StringVar()
        self._labeled_entry(ros, "API base URL", self.api_url_var)
        ttk.Label(ros, text="Admin → Integration tokens · ros_itok_… · read scope", style="CardMuted.TLabel").pack(
            anchor="w"
        )
        self._labeled_entry(ros, "API token", self.api_token_var, show="*")
        row = ttk.Frame(ros, style="Card.TFrame")
        row.pack(fill="x", pady=(6, 0))
        ttk.Button(row, text="Test API", command=self._test_api).pack(side="left")
        ttk.Button(row, text="Load events", command=self._load_events).pack(side="left", padx=6)
        self.event_combo = ttk.Combobox(ros, state="readonly")
        self.event_combo.pack(fill="x", pady=(8, 0))
        self.event_combo.bind("<<ComboboxSelected>>", self._on_event_chosen)
        ttk.Label(ros, text="Event ID", style="Card.TLabel").pack(anchor="w", pady=(6, 0))
        ttk.Entry(ros, textvariable=self.event_id_var).pack(fill="x")

        deck = ttk.LabelFrame(left, text="HyperDeck", padding=8)
        deck.pack(fill="x", pady=(8, 0))
        host_row = ttk.Frame(deck, style="Card.TFrame")
        host_row.pack(fill="x")
        self.deck_host_var = tk.StringVar()
        self.deck_port_var = tk.StringVar()
        ttk.Label(host_row, text="IP", style="Card.TLabel").pack(side="left")
        ttk.Entry(host_row, textvariable=self.deck_host_var, width=22).pack(side="left", padx=6)
        ttk.Label(host_row, text="Port", style="Card.TLabel").pack(side="left")
        ttk.Entry(host_row, textvariable=self.deck_port_var, width=8).pack(side="left", padx=6)
        ttk.Button(host_row, text="Connect", command=self._connect_deck).pack(side="left", padx=(8, 0))
        ttk.Button(host_row, text="Refresh clips", command=self._refresh_clips).pack(side="left", padx=6)
        man = ttk.Frame(deck, style="Card.TFrame")
        man.pack(fill="x", pady=(8, 0))
        ttk.Button(man, text="Record", command=self._manual_record).pack(side="left")
        ttk.Button(man, text="Stop", command=self._manual_stop).pack(side="left", padx=6)
        ttk.Button(man, text="Copy last clip", command=self._copy_last).pack(side="left")

        dest = ttk.LabelFrame(left, text="Copy after stop", padding=8)
        dest.pack(fill="x", pady=(8, 0))
        self.copy_method_var = tk.StringVar(value="ftp")
        self.ftp_port_var = tk.StringVar()
        self.ftp_user_var = tk.StringVar()
        self.ftp_pass_var = tk.StringVar()
        self.source_folder_var = tk.StringVar()
        self.target_folder_var = tk.StringVar()
        self.pattern_var = tk.StringVar()
        self.only_marked_var = tk.BooleanVar(value=True)
        self.auto_copy_var = tk.BooleanVar(value=True)
        method = ttk.Frame(dest, style="Card.TFrame")
        method.pack(fill="x")
        ttk.Radiobutton(method, text="FTP from HyperDeck", variable=self.copy_method_var, value="ftp").pack(
            side="left"
        )
        ttk.Radiobutton(method, text="Folder on this PC", variable=self.copy_method_var, value="folder").pack(
            side="left", padx=12
        )
        ftp_row = ttk.Frame(dest, style="Card.TFrame")
        ftp_row.pack(fill="x", pady=(6, 0))
        ttk.Label(ftp_row, text="FTP port", style="Card.TLabel").pack(side="left")
        ttk.Entry(ftp_row, textvariable=self.ftp_port_var, width=6).pack(side="left", padx=6)
        ttk.Label(ftp_row, text="User", style="Card.TLabel").pack(side="left")
        ttk.Entry(ftp_row, textvariable=self.ftp_user_var, width=12).pack(side="left", padx=6)
        ttk.Label(ftp_row, text="Password", style="Card.TLabel").pack(side="left")
        ttk.Entry(ftp_row, textvariable=self.ftp_pass_var, show="*", width=12).pack(side="left", padx=6)
        src_row = ttk.Frame(dest, style="Card.TFrame")
        src_row.pack(fill="x", pady=(6, 0))
        ttk.Label(src_row, text="Source folder", style="Card.TLabel").pack(side="left")
        ttk.Entry(src_row, textvariable=self.source_folder_var).pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(src_row, text="Browse", command=lambda: self._browse(self.source_folder_var)).pack(side="left")
        tgt_row = ttk.Frame(dest, style="Card.TFrame")
        tgt_row.pack(fill="x", pady=(6, 0))
        ttk.Label(tgt_row, text="Target folder", style="Card.TLabel").pack(side="left")
        ttk.Entry(tgt_row, textvariable=self.target_folder_var).pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(tgt_row, text="Browse", command=lambda: self._browse(self.target_folder_var)).pack(side="left")
        ttk.Label(dest, text="File name pattern  e.g. {date} {event} - {segment}", style="CardMuted.TLabel").pack(
            anchor="w", pady=(8, 0)
        )
        ttk.Entry(dest, textvariable=self.pattern_var).pack(fill="x")
        ttk.Label(
            dest,
            text="Tokens: {date} {event} {segment} {cue}   ·  date is event YYMMDD (260512)",
            style="CardMuted.TLabel",
        ).pack(anchor="w")
        flags = ttk.Frame(dest, style="Card.TFrame")
        flags.pack(fill="x", pady=(6, 0))
        ttk.Checkbutton(flags, text="Only record cues marked Record", variable=self.only_marked_var).pack(
            side="left"
        )
        ttk.Checkbutton(flags, text="Auto-copy after stop", variable=self.auto_copy_var).pack(side="left", padx=12)

        live = ttk.LabelFrame(right, text="Live", padding=8)
        live.pack(fill="x")
        self.status_ros = tk.StringVar(value="ROS: not tested")
        self.status_deck = tk.StringVar(value="Deck: disconnected")
        self.status_cue = tk.StringVar(value="Cue: —")
        self.status_copy = tk.StringVar(value="Copy: —")
        ttk.Label(live, textvariable=self.status_ros, style="Card.TLabel").pack(anchor="w")
        ttk.Label(live, textvariable=self.status_deck, style="Card.TLabel").pack(anchor="w")
        ttk.Label(live, textvariable=self.status_cue, style="Card.TLabel").pack(anchor="w")
        ttk.Label(live, textvariable=self.status_copy, style="Card.TLabel").pack(anchor="w")

        clips = ttk.LabelFrame(right, text="HyperDeck clips", padding=8)
        clips.pack(fill="both", expand=True, pady=(8, 0))
        cols = ("idx", "name", "duration", "copied")
        self.clip_tree = ttk.Treeview(clips, columns=cols, show="headings", height=10, selectmode="browse")
        self.clip_tree.heading("idx", text="#")
        self.clip_tree.heading("name", text="Clip name")
        self.clip_tree.heading("duration", text="Duration")
        self.clip_tree.heading("copied", text="Copied")
        self.clip_tree.column("idx", width=40, stretch=False)
        self.clip_tree.column("name", width=260)
        self.clip_tree.column("duration", width=90, stretch=False)
        self.clip_tree.column("copied", width=70, stretch=False)
        scroll = ttk.Scrollbar(clips, orient="vertical", command=self.clip_tree.yview)
        self.clip_tree.configure(yscrollcommand=scroll.set)
        self.clip_tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        log_frame = ttk.LabelFrame(self.root, text="Log", padding=6)
        log_frame.pack(fill="both", expand=False, padx=8, pady=(0, 8))
        self.log_text = tk.Text(
            log_frame, height=8, bg="#0b1220", fg=FG, insertbackground=FG, relief="flat", wrap="word"
        )
        self.log_text.pack(fill="both", expand=True)
        self.log_text.tag_config("error", foreground=ERR)
        self.log_text.tag_config("ok", foreground=OK)

    def _labeled_entry(self, parent, label: str, var: tk.StringVar, show: str | None = None) -> None:
        ttk.Label(parent, text=label, style="Card.TLabel").pack(anchor="w", pady=(4, 0))
        ttk.Entry(parent, textvariable=var, show=show or "").pack(fill="x")

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
            self.root.after(0, lambda: self.status_ros.set(f"ROS: {msg}"))

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
                self.status_ros.set(f"ROS: loaded {len(events)} event(s)")
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
            self.root.after(0, lambda: self.status_deck.set(f"Deck: {model or 'connected'}"))
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
        self.root.after(0, lambda: self.status_copy.set(f"Copy: {os.path.basename(path)}"))
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
            self.root.after(0, lambda: self.status_deck.set(f"Deck: recording {name}"))

        self._bg(work)

    def _manual_stop(self) -> None:
        self._bg(self._stop_and_maybe_copy)

    def _stop_and_maybe_copy(self) -> None:
        self.deck.stop()
        self.log("HyperDeck stop")
        self.root.after(0, lambda: self.status_deck.set("Deck: stopped"))
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
                self.status_deck.set(f"Deck: {model or 'connected'}")
                self.log(f"HyperDeck connected: {model or self.deck.host}", "ok")
            self._refresh_schedule()
        except Exception as exc:
            messagebox.showerror("Cannot start", str(exc))
            return
        self._save()
        self.following = True
        self.follow_pill.configure(text="Following")
        self.log("Follow started — polling active-timers", "ok")
        self._follow_thread = threading.Thread(target=self._follow_loop, daemon=True)
        self._follow_thread.start()

    def stop_follow(self) -> None:
        self.following = False
        self.follow_pill.configure(text="Stopped")
        self.log("Follow stopped")

    def _follow_loop(self) -> None:
        poll = max(1, int(self.cfg.get("poll_seconds") or 1))
        while self.following:
            try:
                self._follow_tick()
            except Exception as exc:
                self.log(str(exc), "error")
                self.root.after(0, lambda m=str(exc): self.status_ros.set(f"ROS: {m}"))
            time.sleep(poll)

    def _follow_tick(self) -> None:
        eid = self.event_id_var.get().strip()
        timer = self.api.get_active_timer(eid)
        if not timer:
            self.root.after(0, lambda: self.status_cue.set("Cue: none"))
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
            lambda: self.status_cue.set(f"Cue: {cue or item_id}  {segment}  [{state}]  mark:{rec}"),
        )
        self.root.after(0, lambda: self.status_ros.set("ROS: polling OK"))

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
            self.root.after(0, lambda: self.status_deck.set(f"Deck: recording {name}"))


def main() -> None:
    root = tk.Tk()
    HyperDeckIngestApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
