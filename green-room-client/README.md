# Green Room display client (portable)

Tiny **standby agent** for a Green Room laptop/PC. It is **not** the Green Room webpage.

What it does:

1. Checks in to ROS cloud every ~20s (same Integration token as the Offline Kiosk).
2. Shows up on kiosk **Status → Green Room clients**.
3. When you hit **Start** on the kiosk (with an event selected), this PC opens Green Room in the browser.
4. **Standby** puts it back to waiting (close the browser tab manually for now).

## Windows — portable, no install

No Node, no npm, no installer. PowerShell is already on the PC.

1. Copy this whole `green-room-client` folder (USB / network share is fine).
2. Double-click **`Start Green Room Client.bat`**.
3. First run: paste `ros_itok_…` and optionally a display name → saves `config.json`.
4. Leave the black window open while you want the PC discoverable.

## Download (hosted)

Operators download **Green Room Client Portable** from Graphics Links / OSC downloads
(`ros-green-room-client-portable.zip`).

Rebuild + upload from repo:

```bash
node green-room-client/scripts/pack-portable.js
node scripts/upload-app-download.js public/ros-green-room-client-portable.zip
```

## Node (Mac / Linux / already have Node)

```bash
cp config.example.json config.json   # edit token
node client.js
```

## Curl smoke test

```bash
curl -s -H "Authorization: Bearer ros_itok_…" ^
  https://ros-50-production.up.railway.app/api/display-clients?kind=green-room
```

## Next

- Optional auto-start on Windows login (Startup folder shortcut to the `.bat`)
- Later: dedicated window instead of system browser
