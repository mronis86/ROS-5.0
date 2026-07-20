# Companion setup — Mitti Sync

1. In Companion: **Settings → Developer → Module path** → parent of this folder (e.g. `ROS-5.0`).
2. `cd companion-module-runofshow-mitti && npm install`
3. Restart Companion; add connection **Run of Show: Mitti Sync**.
4. Configure Event ID, API URL, OSC listen port (51001), Mitti host/port (51000).
5. In Mitti: enable OSC Controls + OSC Feedback to the Companion PC.
