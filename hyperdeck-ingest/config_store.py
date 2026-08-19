"""Persist ingest settings under %LOCALAPPDATA%/ros-hyperdeck-ingest."""
from __future__ import annotations

import json
import os
from typing import Any

from names import DEFAULT_PATTERN
from ros_api import normalize_api_token, normalize_base_url

APP_DIR_NAME = "ros-hyperdeck-ingest"
CONFIG_NAME = "config.json"

DEFAULTS: dict[str, Any] = {
    "api_base_url": "https://ros-50-production.up.railway.app",
    "api_token": "",
    "event_id": "",
    "hyperdeck_host": "192.168.1.50",
    "hyperdeck_port": 9993,
    "ftp_port": 21,
    "ftp_user": "anonymous",
    "ftp_password": "",
    "copy_method": "ftp",
    "source_folder": "",
    "target_folder": "",
    "name_pattern": DEFAULT_PATTERN,
    "record_only_marked": True,
    "auto_copy": True,
    "poll_seconds": 1,
    "auto_stop_hours": 2,
    "auto_stop_minutes": 0,
    "auto_stop_never": False,
    "copied_keys": [],
}

AUTO_STOP_MINUTES = (0, 5, 10, 15, 20, 25, 30, 45)


def config_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    path = os.path.join(base, APP_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def config_path() -> str:
    return os.path.join(config_dir(), CONFIG_NAME)


def load_config() -> dict[str, Any]:
    data = dict(DEFAULTS)
    path = config_path()
    if not os.path.isfile(path):
        return data
    try:
        with open(path, "r", encoding="utf-8") as fh:
            saved = json.load(fh)
        if isinstance(saved, dict):
            data.update(saved)
    except Exception:
        pass
    data["api_base_url"] = normalize_base_url(str(data.get("api_base_url") or DEFAULTS["api_base_url"]))
    data["api_token"] = normalize_api_token(str(data.get("api_token") or ""))
    if "last_event_id" in data and not data.get("event_id"):
        data["event_id"] = data.get("last_event_id") or ""
    if not isinstance(data.get("copied_keys"), list):
        data["copied_keys"] = []
    try:
        data["poll_seconds"] = min(60, max(1, int(data.get("poll_seconds") or 1)))
    except (TypeError, ValueError):
        data["poll_seconds"] = 1
    data["auto_stop_hours"] = _clamp_auto_stop_hours(data.get("auto_stop_hours"))
    data["auto_stop_minutes"] = _clamp_auto_stop_minutes(data.get("auto_stop_minutes"))
    data["auto_stop_never"] = data.get("auto_stop_never") is True
    data["copy_method"] = "ftp"
    data["source_folder"] = ""
    if not str(data.get("ftp_user") or "").strip():
        data["ftp_user"] = "anonymous"
    return data


def save_config(data: dict[str, Any]) -> dict[str, Any]:
    merged = dict(DEFAULTS)
    merged.update(data or {})
    merged["api_base_url"] = normalize_base_url(str(merged.get("api_base_url") or ""))
    merged["api_token"] = normalize_api_token(str(merged.get("api_token") or ""))
    merged.pop("last_event_id", None)
    try:
        merged["poll_seconds"] = min(60, max(1, int(merged.get("poll_seconds") or 1)))
    except (TypeError, ValueError):
        merged["poll_seconds"] = 1
    merged["auto_stop_hours"] = _clamp_auto_stop_hours(merged.get("auto_stop_hours"))
    merged["auto_stop_minutes"] = _clamp_auto_stop_minutes(merged.get("auto_stop_minutes"))
    merged["auto_stop_never"] = merged.get("auto_stop_never") is True
    merged["copy_method"] = "ftp"
    merged["source_folder"] = ""
    if not str(merged.get("ftp_user") or "").strip():
        merged["ftp_user"] = "anonymous"
    path = config_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2)
    os.replace(tmp, path)
    return merged


def _clamp_auto_stop_hours(value: Any) -> int:
    try:
        hours = int(value)
    except (TypeError, ValueError):
        hours = 2
    return min(24, max(0, hours))


def _clamp_auto_stop_minutes(value: Any) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = 0
    if minutes in AUTO_STOP_MINUTES:
        return minutes
    return min(AUTO_STOP_MINUTES, key=lambda m: abs(m - minutes))
