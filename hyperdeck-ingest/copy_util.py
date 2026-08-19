"""Copy a closed HyperDeck clip to the editor folder (FTP or local folder)."""
from __future__ import annotations

import os
import shutil
import time
from datetime import datetime
from ftplib import FTP, error_perm
from typing import Callable

LogFn = Callable[[str], None]
MEDIA_EXTS = {".mov", ".mp4", ".mxf", ".m4v"}


class CopyError(Exception):
    pass


def unique_dest(folder: str, filename: str) -> str:
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, filename)
    if not os.path.exists(dest):
        return dest
    stem, ext = os.path.splitext(filename)
    n = 2
    while True:
        candidate = os.path.join(folder, f"{stem} ({n}){ext}")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def copy_from_folder(source_folder: str, clip_name: str, dest_stem_path: str, log: LogFn | None = None) -> str:
    folder = (source_folder or "").strip()
    if not folder or not os.path.isdir(folder):
        raise CopyError(f"Source folder not found: {folder}")
    match = _find_local_file(folder, clip_name)
    if not match:
        raise CopyError(f"No file matching “{clip_name}” in {folder}")
    dest_path = _with_source_ext(dest_stem_path, match)
    if log:
        log(f"Copy {os.path.basename(match)} → {dest_path}")
    shutil.copy2(match, dest_path)
    return dest_path


def copy_from_ftp(
    host: str,
    clip_name: str,
    dest_path: str,
    *,
    port: int = 21,
    user: str = "",
    password: str = "",
    retries: int = 6,
    log: LogFn | None = None,
) -> str:
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return _ftp_get(host, clip_name, dest_path, port=port, user=user, password=password, log=log)
        except CopyError as exc:
            last_err = exc
            if log:
                log(f"FTP attempt {attempt}/{retries}: {exc}")
            time.sleep(1.2 * attempt)
    raise CopyError(str(last_err) if last_err else "FTP copy failed")


def _ftp_get(
    host: str,
    clip_name: str,
    dest_path: str,
    *,
    port: int,
    user: str,
    password: str,
    log: LogFn | None,
) -> str:
    ftp = FTP()
    try:
        ftp.connect(host, int(port or 21), timeout=20)
        ftp.login(user or "anonymous", password or "")
        ftp.set_pasv(True)
        names = _list_remote_files(ftp)
        if not any(_is_media_file_name(n) for n in names):
            switched = _switch_to_media_subdir(ftp, log=log)
            if switched:
                names = _list_remote_files(ftp)
        remote = _match_remote_name(names, clip_name)
        if not remote:
            fallback = _pick_latest_remote_name(ftp, names)
            if fallback:
                if log:
                    log(
                        f"FTP fallback: no exact match for “{clip_name}”; using latest file “{fallback}”."
                    )
                remote = fallback
        if not remote:
            sample = ", ".join(sorted(names)[:6])
            extra = f" Seen: {sample}" if sample else ""
            raise CopyError(f"No FTP file matching “{clip_name}” (saw {len(names)} file(s)).{extra}")
        dest_path = _with_source_ext(dest_path, remote)
        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
        if log:
            log(f"FTP GET {remote} → {dest_path}")
        with open(dest_path, "wb") as fh:
            ftp.retrbinary(f"RETR {remote}", fh.write)
        return dest_path
    except CopyError:
        raise
    except Exception as exc:
        raise CopyError(f"FTP error: {exc}") from exc
    finally:
        try:
            ftp.quit()
        except Exception:
            try:
                ftp.close()
            except Exception:
                pass


def _with_source_ext(dest_stem_path: str, source_name: str) -> str:
    ext = os.path.splitext(source_name)[1]
    if not ext:
        return dest_stem_path
    root, _old = os.path.splitext(dest_stem_path)
    return root + ext


def _norm(name: str) -> str:
    return os.path.splitext(os.path.basename(name))[0].strip().lower()


def _find_local_file(folder: str, clip_name: str) -> str | None:
    want = _norm(clip_name)
    files = []
    for name in os.listdir(folder):
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            files.append(path)
    exact = [p for p in files if _norm(p) == want]
    if exact:
        return max(exact, key=os.path.getmtime)
    prefix = [p for p in files if _norm(p).startswith(want) or want.startswith(_norm(p))]
    if prefix:
        return max(prefix, key=os.path.getmtime)
    return None


def _match_remote_name(listing: list[str], clip_name: str) -> str | None:
    cleaned = _normalize_remote_names(listing)
    want = _norm(clip_name)
    for name in cleaned:
        if _norm(name) == want:
            return name
    for name in cleaned:
        if _norm(name).startswith(want) or want.startswith(_norm(name)):
            return name
    return None


def _is_media_file_name(name: str) -> bool:
    return os.path.splitext(str(name))[1].lower() in MEDIA_EXTS


def _switch_to_media_subdir(ftp: FTP, log: LogFn | None = None) -> bool:
    """
    Some HyperDeck FTP servers expose a root folder like `usb` and store clips inside it.
    If root has no media files, try common/visible subdirs and stay in the one that contains media.
    """
    original = ftp.pwd()
    preferred = ["usb", "sd", "media", "disk1", "disk2", "slot1", "slot2"]
    discovered = _list_remote_dirs(ftp)
    candidates = []
    seen = set()
    for d in preferred + discovered:
        key = d.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append(d.strip())

    for dirname in candidates:
        try:
            ftp.cwd(original)
            ftp.cwd(dirname)
        except Exception:
            continue
        names = _list_remote_files(ftp)
        if any(_is_media_file_name(n) for n in names):
            if log:
                log(f"FTP media directory detected: /{dirname}")
            return True

    try:
        ftp.cwd(original)
    except Exception:
        pass
    return False


def _list_remote_dirs(ftp: FTP) -> list[str]:
    dirs: list[str] = []
    try:
        for name, facts in ftp.mlsd():
            if str(facts.get("type", "")).lower() == "dir":
                dirs.append(name)
        if dirs:
            return _normalize_remote_names(dirs)
    except Exception:
        pass
    try:
        for token in ftp.nlst():
            name = str(token).strip()
            if not name or name in (".", ".."):
                continue
            try:
                cur = ftp.pwd()
                ftp.cwd(name)
                ftp.cwd(cur)
                dirs.append(name)
            except Exception:
                continue
    except Exception:
        pass
    return _normalize_remote_names(dirs)


def _normalize_remote_names(listing: list[str]) -> list[str]:
    cleaned: list[str] = []
    for line in listing:
        token = line.strip()
        if not token:
            continue
        # LIST fallback line: permissions/date/size filename -> filename is the final token.
        if " " in token:
            token = token.split()[-1]
        if token and token not in (".", ".."):
            cleaned.append(os.path.basename(token))
    # Preserve order and uniqueness.
    seen = set()
    out: list[str] = []
    for name in cleaned:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def _list_remote_files(ftp: FTP) -> list[str]:
    # Prefer MLSD when available (reliable filenames, no LIST parsing).
    try:
        names = []
        for name, facts in ftp.mlsd():
            if str(facts.get("type", "")).lower() == "file":
                names.append(name)
        if names:
            return _normalize_remote_names(names)
    except Exception:
        pass

    names: list[str] = []
    try:
        names = ftp.nlst()
    except error_perm:
        names = []
        ftp.retrlines("LIST", names.append)
    return _normalize_remote_names(names)


def _parse_mdtm(value: str) -> datetime | None:
    # RFC3659 MDTM replies: "213 YYYYMMDDHHMMSS"
    raw = value.strip()
    if raw.startswith("213 "):
        raw = raw[4:].strip()
    if len(raw) < 14 or not raw[:14].isdigit():
        return None
    try:
        return datetime.strptime(raw[:14], "%Y%m%d%H%M%S")
    except ValueError:
        return None


def _pick_latest_remote_name(ftp: FTP, names: list[str]) -> str | None:
    if not names:
        return None
    candidates = [n for n in names if _is_media_file_name(n)]
    if not candidates:
        return None

    dated: list[tuple[datetime, str]] = []
    for name in candidates:
        try:
            dt = _parse_mdtm(ftp.sendcmd(f"MDTM {name}"))
            if dt is not None:
                dated.append((dt, name))
        except Exception:
            continue
    if dated:
        dated.sort(key=lambda item: item[0])
        return dated[-1][1]

    # Last resort: lexical sort (many HyperDeck files are timestamped in name).
    return sorted(candidates)[-1]
