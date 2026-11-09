"""Session length planning for HyperDeck Ingest auto-stop (same rules as PPT / vMix bridges)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


MODES = ("testing", "live", "everyday")


def clamp_live_hours(raw: Any) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = 4
    return min(24, max(1, n))


def next_local_midnight(now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return day + timedelta(days=1)


def today_at_hour(hour: int, now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    return now.replace(hour=hour, minute=0, second=0, microsecond=0)


def plan_session(*, mode: str, hours: Any = 4, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now()
    mode_key = str(mode or "").strip().lower()

    if mode_key == "testing":
        ends_at = now + timedelta(hours=2)
        return {
            "ok": True,
            "mode": "testing",
            "hours": 2,
            "ends_at": ends_at,
            "label": "Testing · 2 hours",
        }

    if mode_key == "live":
        live_hours = clamp_live_hours(hours)
        timed = now + timedelta(hours=live_hours)
        midnight = next_local_midnight(now)
        ends_at = timed if timed <= midnight else midnight
        hit_midnight = ends_at == midnight and timed > midnight
        return {
            "ok": True,
            "mode": "live",
            "hours": live_hours,
            "ends_at": ends_at,
            "label": (
                f"Live event · {live_hours}h (stops at midnight)"
                if hit_midnight
                else f"Live event · {live_hours} hour{'s' if live_hours != 1 else ''}"
            ),
        }

    if mode_key == "everyday":
        start = today_at_hour(7, now)
        end = today_at_hour(21, now)
        if now >= end:
            return {
                "ok": False,
                "error": (
                    "Everyday mode runs 7:00 AM–9:00 PM. It is past 9:00 PM — "
                    "pick Testing or Live Event, or wait until 7:00 AM."
                ),
            }
        if now < start:
            return {
                "ok": False,
                "error": (
                    "Everyday mode runs 7:00 AM–9:00 PM. It is before 7:00 AM — "
                    "pick Testing or Live Event, or wait until 7:00 AM."
                ),
            }
        return {
            "ok": True,
            "mode": "everyday",
            "hours": None,
            "ends_at": end,
            "label": "Everyday · until 9:00 PM",
        }

    return {"ok": False, "error": "Pick Testing, Live Event, or Everyday."}


def session_is_active(ends_at: Any, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    if isinstance(ends_at, datetime):
        return ends_at > now
    if not ends_at:
        return False
    try:
        parsed = datetime.fromisoformat(str(ends_at).replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed > now
    except Exception:
        return False


def format_remaining(ends_at: Any, now: datetime | None = None) -> str:
    now = now or datetime.now()
    if isinstance(ends_at, datetime):
        end = ends_at
    else:
        try:
            end = datetime.fromisoformat(str(ends_at).replace("Z", "+00:00"))
            if end.tzinfo is not None:
                end = end.astimezone().replace(tzinfo=None)
        except Exception:
            return ""
    ms = max(0, (end - now).total_seconds())
    total_min = int((ms + 59) // 60)
    if total_min <= 0:
        return "ending…"
    h, m = divmod(total_min, 60)
    if h <= 0:
        return f"{m}m left"
    return f"{h}h {m}m left"
