"""Copy a closed HyperDeck clip to the editor folder (FTP or local folder)."""
from __future__ import annotations

import os
import shutil
import time
from ftplib import FTP, error_perm
from typing import Callable

LogFn = Callable[[str], None]


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
        names = []
        try:
            names = ftp.nlst()
        except error_perm:
            ftp.retrlines("LIST", names.append)
        remote = _match_remote_name(names, clip_name)
        if not remote:
            raise CopyError(f"No FTP file matching “{clip_name}” (saw {len(names)} file(s))")
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
    cleaned = []
    for line in listing:
        token = line.strip().split()[-1] if line.strip() else ""
        if token and token not in (".", ".."):
            cleaned.append(token)
        elif line.strip() and " " not in line.strip():
            cleaned.append(line.strip())
    want = _norm(clip_name)
    for name in cleaned:
        if _norm(name) == want:
            return name
    for name in cleaned:
        if _norm(name).startswith(want) or want.startswith(_norm(name)):
            return name
    return None
