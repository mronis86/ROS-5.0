"""Multi-day event helpers for HyperDeck ingest (upcoming filter + show-day picker)."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any


def parse_event_date(raw: str | None) -> date | None:
    text = str(raw or "").strip()
    if "T" in text:
        text = text.split("T", 1)[0]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime_strptime(text)
    except ValueError:
        return None


def datetime_strptime(text: str) -> date:
    from datetime import datetime

    return datetime.strptime(text, "%Y-%m-%d").date()


def event_date_str(ev: dict | None) -> str:
    raw = str((ev or {}).get("date") or (ev or {}).get("event_date") or "")
    if "T" in raw:
        raw = raw.split("T", 1)[0]
    return raw.strip()


def item_day_number(item: dict | None) -> int:
    if not item:
        return 1
    try:
        day = int(item.get("day") or 1)
    except (TypeError, ValueError):
        return 1
    return day if day > 0 else 1


def _positive_int(value: Any) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def event_number_of_days(
    ev: dict | None,
    schedule: list | None = None,
    settings: dict | None = None,
) -> int:
    n = 1
    sd = (ev or {}).get("schedule_data") or (ev or {}).get("scheduleData") or {}
    if not isinstance(sd, dict):
        sd = {}
    settings = settings if isinstance(settings, dict) else {}
    for raw in (
        (ev or {}).get("numberOfDays"),
        (ev or {}).get("number_of_days"),
        sd.get("numberOfDays"),
        sd.get("number_of_days"),
        settings.get("numberOfDays"),
        settings.get("number_of_days"),
    ):
        parsed = _positive_int(raw)
        if parsed and parsed > n:
            n = parsed
    if schedule:
        for item in schedule:
            day = item_day_number(item)
            if day > n:
                n = day
    return n


def last_calendar_day(start: date, days: int) -> date:
    span = max(1, int(days or 1))
    return start + timedelta(days=span - 1)


def date_for_day(start: date | None, day: int) -> date | None:
    if start is None:
        return None
    return start + timedelta(days=max(1, int(day or 1)) - 1)


def is_event_upcoming(ev: dict | None, today: date | None = None) -> bool:
    today = today or date.today()
    start = parse_event_date(event_date_str(ev))
    if start is None:
        return True
    return last_calendar_day(start, event_number_of_days(ev)) >= today


def is_event_past(ev: dict | None, today: date | None = None) -> bool:
    today = today or date.today()
    start = parse_event_date(event_date_str(ev))
    if start is None:
        return False
    return last_calendar_day(start, event_number_of_days(ev)) < today


def calendar_day_number(ev: dict | None, today: date | None = None, days: int | None = None) -> int | None:
    """1-based show day if today falls in the event, else None."""
    today = today or date.today()
    start = parse_event_date(event_date_str(ev))
    if start is None:
        return 1
    span = max(1, int(days if days is not None else event_number_of_days(ev)))
    last = last_calendar_day(start, span)
    if today < start or today > last:
        return None
    return (today - start).days + 1


def default_show_day(ev: dict | None, days: int | None = None, today: date | None = None) -> int:
    span = max(1, int(days if days is not None else event_number_of_days(ev)))
    current = calendar_day_number(ev, today=today, days=span)
    if current is not None:
        return current
    return 1


def format_day_choice(day: int, start: date | None) -> str:
    when = date_for_day(start, day)
    if when is None:
        return f"Day {day}"
    return f"Day {day}  ·  {when.isoformat()}"


def parse_day_choice(value: str, fallback: int = 1) -> int:
    text = str(value or "").strip()
    if text.lower().startswith("day "):
        token = text[4:].split("·", 1)[0].strip()
        parsed = _positive_int(token)
        if parsed:
            return parsed
    parsed = _positive_int(text)
    return parsed or max(1, fallback)
