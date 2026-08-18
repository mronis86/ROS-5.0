"""ROS HTTP client — same auth as the vMix DataSource Bridge.

Uses Admin → Integration tokens (ros_itok_…) on /api/* routes.
Cue follow is REST poll of /api/active-timers (Companion / vMix pattern).
"""
from __future__ import annotations

import json
import re
from typing import Any

import requests

INTEGRATION_PREFIX = "ros_itok_"


def normalize_base_url(url: str) -> str:
    s = (url or "").strip()
    if not s:
        return ""
    s = re.sub(r"^(https?):/(?!/)", r"\1://", s, flags=re.I)
    if not re.match(r"^https?://", s, flags=re.I):
        s = f"http://{s}" if re.search(r"localhost|127\.0\.0\.1", s, flags=re.I) else f"https://{s}"
    s = s.rstrip("/")
    if s.lower().endswith("/api"):
        s = s[:-4]
    return s


def normalize_api_token(token: str) -> str:
    t = (token or "").strip()
    if not t:
        return ""
    t = re.sub(r"^Bearer\s+", "", t, flags=re.I).strip()
    t = t.strip("\"'")
    t = re.sub(r"\s+", "", t)
    return t


class RosApiError(Exception):
    pass


class RosApi:
    def __init__(self, base_url: str, token: str = "", timeout: float = 15.0):
        self.base_url = normalize_base_url(base_url)
        self.token = normalize_api_token(token)
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _get(self, path: str) -> Any:
        if not self.base_url:
            raise RosApiError("API base URL is required")
        url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        try:
            res = requests.get(url, headers=self._headers(), timeout=self.timeout)
        except requests.RequestException as exc:
            raise RosApiError(f"Cannot reach API: {exc}") from exc
        if res.status_code == 401:
            raise RosApiError(
                "Unauthorized — paste an Integration token from Admin → Integration tokens "
                f"(must start with {INTEGRATION_PREFIX}, read scope)."
            )
        if res.status_code == 403:
            raise RosApiError("Forbidden — token needs at least the read scope.")
        if not res.ok:
            raise RosApiError(f"HTTP {res.status_code} for {path}")
        try:
            return res.json()
        except Exception as exc:
            raise RosApiError("API did not return JSON") from exc

    def health(self) -> None:
        url = f"{self.base_url}/health"
        try:
            res = requests.get(url, timeout=self.timeout)
        except requests.RequestException as exc:
            raise RosApiError(f"Cannot reach API: {exc}") from exc
        if not res.ok:
            raise RosApiError(f"Health check failed ({res.status_code})")

    def validate(self) -> str:
        """Health + token + calendar list. Returns a short status string."""
        if not self.base_url:
            raise RosApiError("API base URL is required (e.g. https://ros-50-production.up.railway.app)")
        self.health()
        if not self.token:
            raise RosApiError(
                "API reachable, but no token — protected routes will 401. "
                f"Admin → Integration tokens ({INTEGRATION_PREFIX}…, read scope)."
            )
        if not (
            self.token.startswith(INTEGRATION_PREFIX)
            or self.token.startswith("ros_sess_")
            or self.token.startswith("ros_nsess_")
        ):
            raise RosApiError(
                f"Token does not look like an Integration token (expected {INTEGRATION_PREFIX})."
            )
        events = self.list_events()
        return f"API + token OK — {len(events)} calendar event(s)"

    def list_events(self) -> list[dict]:
        data = self._get("/api/calendar-events")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("events", "value"):
                if isinstance(data.get(key), list):
                    return data[key]
        return []

    def get_run_of_show(self, event_id: str) -> dict:
        data = self._get(f"/api/run-of-show-data/{event_id}")
        return data if isinstance(data, dict) else {}

    def get_active_timer(self, event_id: str) -> dict | None:
        data = self._get(f"/api/active-timers/{event_id}")
        rows = data if isinstance(data, list) else []
        if not rows:
            return None
        row = rows[0]
        if not isinstance(row, dict) or row.get("item_id") is None:
            return None
        return row

    def schedule_items(self, event_id: str) -> list[dict]:
        data = self.get_run_of_show(event_id)
        items = data.get("schedule_items")
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except Exception:
                items = []
        return items if isinstance(items, list) else []
