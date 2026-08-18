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
    "ftp_user": "",
    "ftp_password": "",
    "copy_method": "ftp",  # ftp | folder
    "source_folder": "",
    "target_folder": "",
    "name_pattern": DEFAULT_PATTERN,
    "record_only_marked": True,
    "auto_copy": True,
    "poll_seconds": 1,
    "copied_keys": [],
}


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
    return data


def save_config(data: dict[str, Any]) -> dict[str, Any]:
    merged = dict(DEFAULTS)
    merged.update(data or {})
    merged["api_base_url"] = normalize_base_url(str(merged.get("api_base_url") or ""))
    merged["api_token"] = normalize_api_token(str(merged.get("api_token") or ""))
    merged.pop("last_event_id", None)
    path = config_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2)
    os.replace(tmp, path)
    return merged
