# Green Room Client (portable tray app)

Tiny **standby agent** for a Green Room laptop/PC. It is **not** the Green Room webpage.

What it does:

1. Lives in the **Windows system tray** (by the clock).
2. Checks in to ROS cloud every ~20s (same Integration token as the Offline Kiosk).
3. Shows up on kiosk **Status -> Green Room clients**.
4. When you hit **Start** on the kiosk, this PC opens Green Room in the browser.
5. **Standby** puts it back to waiting (close the browser tab manually for now).

## Windows - portable, no install

1. Download **Green Room Client Portable** from Graphics Links / OSC.
2. Unzip and double-click **`Start Green Room Client.bat`**.
3. First run: paste an Integration token (`ros_itok_...`). It can be its **own** token —
   it only needs to be created by the **same Admin** as the Offline Kiosk token.
4. Find the green icon by the clock. Right-click -> Exit to stop.

Rebuild + upload:

```bash
node green-room-client/scripts/pack-portable.js
node scripts/upload-app-download.js public/ros-green-room-client-portable.zip
```

## Node (Mac / Linux)

```bash
cp config.example.json config.json
node client.js
```
