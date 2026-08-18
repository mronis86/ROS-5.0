"""Blackmagic HyperDeck Ethernet Protocol (TCP 9993)."""
from __future__ import annotations

import socket
import threading
from dataclasses import dataclass, field


class HyperDeckError(Exception):
    pass


@dataclass
class ClipInfo:
    index: int
    name: str
    start: str = ""
    duration: str = ""


@dataclass
class TransportInfo:
    status: str = "unknown"
    speed: str = ""
    slot_id: str = ""
    display_timecode: str = ""
    clip_id: str = ""
    raw: dict[str, str] = field(default_factory=dict)

    @property
    def recording(self) -> bool:
        return self.status.lower() in ("record", "recording")

    @property
    def stopped(self) -> bool:
        return self.status.lower() in ("stopped", "preview", "idle", "")


class HyperDeckClient:
    def __init__(self, host: str, port: int = 9993, timeout: float = 8.0):
        self.host = (host or "").strip()
        self.port = int(port or 9993)
        self.timeout = timeout
        self._sock: socket.socket | None = None
        self._lock = threading.Lock()
        self.model = ""
        self.protocol = ""

    @property
    def connected(self) -> bool:
        return self._sock is not None

    def connect(self) -> str:
        self.disconnect()
        if not self.host:
            raise HyperDeckError("HyperDeck IP is required")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        try:
            sock.connect((self.host, self.port))
        except OSError as exc:
            sock.close()
            raise HyperDeckError(f"Cannot reach HyperDeck at {self.host}:{self.port} — {exc}") from exc
        self._sock = sock
        code, text, body = self._read_response()
        self._parse_connection_info(body or [text])
        self.command("remote: enable: true")
        return self.model or text or "connected"

    def disconnect(self) -> None:
        with self._lock:
            if self._sock:
                try:
                    self._sock.close()
                except OSError:
                    pass
            self._sock = None

    def command(self, cmd: str) -> tuple[int, str, list[str]]:
        with self._lock:
            if not self._sock:
                raise HyperDeckError("HyperDeck is not connected")
            payload = cmd.strip() + "\r\n"
            try:
                self._sock.sendall(payload.encode("ascii", errors="replace"))
            except OSError as exc:
                self._sock = None
                raise HyperDeckError(f"HyperDeck send failed: {exc}") from exc
            return self._read_response()

    def ping(self) -> None:
        code, text, _ = self.command("ping")
        if code >= 400:
            raise HyperDeckError(text or f"ping failed ({code})")

    def record(self, name: str | None = None) -> None:
        cmd = f"record: name: {name}" if name else "record"
        code, text, _ = self.command(cmd)
        if code >= 400:
            raise HyperDeckError(text or f"record failed ({code})")

    def stop(self) -> None:
        code, text, _ = self.command("stop")
        if code >= 400:
            raise HyperDeckError(text or f"stop failed ({code})")

    def transport_info(self) -> TransportInfo:
        code, text, body = self.command("transport info")
        if code >= 400:
            raise HyperDeckError(text or f"transport info failed ({code})")
        fields = _parse_fields(body)
        return TransportInfo(
            status=fields.get("status", "unknown"),
            speed=fields.get("speed", ""),
            slot_id=fields.get("slot id", ""),
            display_timecode=fields.get("display timecode", ""),
            clip_id=fields.get("clip id", ""),
            raw=fields,
        )

    def clips(self) -> list[ClipInfo]:
        code, text, body = self.command("clips get")
        if code >= 400:
            raise HyperDeckError(text or f"clips get failed ({code})")
        clips: list[ClipInfo] = []
        for line in body:
            line = line.strip()
            if not line or line.lower().startswith("clip count"):
                continue
            if ":" not in line:
                continue
            idx_s, rest = line.split(":", 1)
            if not idx_s.strip().isdigit():
                continue
            parts = rest.strip().split()
            name = parts[0] if parts else rest.strip()
            start = parts[1] if len(parts) > 1 else ""
            duration = parts[2] if len(parts) > 2 else ""
            # Names can contain spaces: "name start duration" — last two tokens are times if they look like timecode
            if len(parts) >= 3 and _looks_timecode(parts[-1]) and _looks_timecode(parts[-2]):
                duration = parts[-1]
                start = parts[-2]
                name = " ".join(parts[:-2])
            clips.append(ClipInfo(index=int(idx_s), name=name, start=start, duration=duration))
        return clips

    def _parse_connection_info(self, lines: list[str]) -> None:
        fields = _parse_fields(lines)
        self.protocol = fields.get("protocol version", "")
        self.model = fields.get("model", "")

    def _read_response(self) -> tuple[int, str, list[str]]:
        assert self._sock is not None
        first = self._readline()
        if not first:
            self._sock = None
            raise HyperDeckError("HyperDeck closed the connection")
        try:
            code = int(first[:3])
        except ValueError as exc:
            raise HyperDeckError(f"Bad HyperDeck response: {first!r}") from exc
        text = first[4:].strip() if len(first) > 4 else ""
        body: list[str] = []
        if text.endswith(":"):
            while True:
                line = self._readline()
                if line == "":
                    break
                body.append(line)
        return code, text.rstrip(":"), body

    def _readline(self) -> str:
        assert self._sock is not None
        buf = bytearray()
        while True:
            try:
                chunk = self._sock.recv(1)
            except OSError as exc:
                self._sock = None
                raise HyperDeckError(f"HyperDeck read failed: {exc}") from exc
            if not chunk:
                break
            if chunk == b"\n":
                break
            if chunk != b"\r":
                buf.extend(chunk)
            if len(buf) > 8192:
                break
        return buf.decode("utf-8", errors="replace")


def _parse_fields(lines: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines:
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        out[key.strip().lower()] = val.strip()
    return out


def _looks_timecode(value: str) -> bool:
    parts = value.replace(";", ":").split(":")
    return len(parts) == 4 and all(p.isdigit() for p in parts)
