import zipfile
from pathlib import Path

root = Path("civics-bridge-v2/dist-ready/win-unpacked")
out = Path("Civics-Bridge-V2.zip")
prefix = "Civics Bridge V2"
if out.exists():
    out.unlink()

start = """@echo off
setlocal
cd /d "%~dp0"
echo Starting Civics Bridge V2...
start "" "%~dp0Civics Bridge V2.exe"
endlocal
"""
readme = """Civics Bridge V2

1. Unzip and run START.bat
2. Set the Event ID and the folder Companion imports pictures from.
3. Start.
4. On the website, open Extend Event Controls, Companion buttons, and click Push pictures to bridge.

This app does not talk to vMix. It writes 01.png through 10.png into the folder you chose.
The website API must be deployed before a push can be seen.
"""

with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in root.rglob("*"):
        if path.is_file():
            archive.write(path, prefix + "/" + path.relative_to(root).as_posix())
    archive.writestr(prefix + "/START.bat", start)
    archive.writestr(prefix + "/README.txt", readme)

print(f"{out.resolve()} {out.stat().st_size / 1048576:.1f} MB")
