"""Clip / destination file naming for HyperDeck ingest."""
from __future__ import annotations

import re
from datetime import datetime

WINDOWS_BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
SPACES = re.compile(r"\s+")
HYPERDECK_BAD = re.compile(r"[^A-Za-z0-9 _\-]")

DEFAULT_PATTERN = "{date} {event} - {segment}"
HYPERDECK_NAME_MAX = 56


def event_yymmdd(event_date: str | None, fallback: datetime | None = None) -> str:
    """YYMMDD from event date (e.g. 2026-05-12 → 260512)."""
    raw = (event_date or "").strip()
    if "T" in raw:
        raw = raw.split("T", 1)[0]
    parts = raw.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        yy = parts[0][-2:]
        return f"{yy}{parts[1].zfill(2)}{parts[2].zfill(2)}"
    dt = fallback or datetime.now()
    return dt.strftime("%y%m%d")


def cue_label(item: dict | None) -> str:
    if not item:
        return ""
    fields = item.get("customFields") or {}
    if isinstance(fields, str):
        fields = {}
    cue = str(fields.get("cue") or "").strip()
    if cue:
        return cue
    item_id = item.get("id")
    return f"CUE {item_id}" if item_id is not None else ""


def item_needs_recording(item: dict | None) -> bool:
    if not item:
        return False
    return item.get("needsRecording") is True or item.get("needs_recording") is True


def sanitize_filename(value: str, max_len: int = 120) -> str:
    text = WINDOWS_BAD.sub(" ", value or "")
    text = SPACES.sub(" ", text).strip(" .")
    text = text[:max_len].rstrip(" .")
    return text or "clip"


def sanitize_hyperdeck_name(value: str) -> str:
    text = HYPERDECK_BAD.sub(" ", value or "")
    text = SPACES.sub(" ", text).strip(" -_")
    if len(text) > HYPERDECK_NAME_MAX:
        text = text[:HYPERDECK_NAME_MAX].rstrip(" -_")
    return text or "clip"


def apply_pattern(
    pattern: str,
    *,
    event_name: str,
    event_date: str | None,
    segment: str,
    cue: str = "",
    clip: str = "",
) -> str:
    values = {
        "date": event_yymmdd(event_date),
        "event": (event_name or "Event").strip(),
        "segment": (segment or "Segment").strip(),
        "cue": (cue or "").strip(),
        "clip": (clip or "").strip(),
    }
    out = pattern or DEFAULT_PATTERN
    for key, val in values.items():
        out = out.replace("{" + key + "}", val)
    return sanitize_filename(out)


def hyperdeck_record_name(*, cue: str, segment: str) -> str:
    cue_compact = SPACES.sub("", cue or "")
    if cue_compact and segment:
        raw = f"{cue_compact} {segment}"
    else:
        raw = segment or cue or "clip"
    return sanitize_hyperdeck_name(raw)
