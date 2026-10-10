# ROS Civics vMix Bridge

Parallel to the everyday **vMix DataSource Bridge** (cue → schedule CSV).

This app watches the **Civics graphics student selection** from Extend Event Controls and calls vMix `DataSourceSelectRow` on the matching **Name** in your Top 25 / Top 10 / Top 5 Data Sources.

## Setup

1. In ROS → Extend Event Controls → Civics, copy live CSV URLs into three vMix Data Sources (Top 25 / 10 / 5).
2. Download / unzip this bridge on the vMix PC; run `START.bat` (or the `.exe`).
3. Set Event ID, API URL, and the exact Data Source names.
4. Click **Start**.
5. Open ROS **Top 25 / 10 / 5 buttons** pages and tap a student — vMix selects that Name row.

Does **not** load ROS cues and does not conflict with the schedule cue bridge.

## Companion Top 10 buttons

Optional. In the bridge, enable **Companion buttons**, set the page and the top-left button (row 0, column 0 is the corner), then Start.

1. In Companion, turn on **Settings → HTTP API** (port 8000 unless you changed it).
2. Draw the buttons first (10 in a row, or fewer per row if the grid is narrower).
3. The bridge fills each button with **State** and **Name** as the Top 10 is filled in.
4. After at least one student is marked Top 5, anyone who did not move on gets a grey background. The name stays on the button so you can see who is out.
5. The bridge reads the row vMix is on. The button whose Name and State match that row turns green.
6. To make a button move vMix to that student, add an HTTP GET on the button press:
   `http://127.0.0.1:3921/top10/0` for the first button, `/top10/1` for the second, and so on.
   That address only works on the PC running the bridge. The bridge then calls `DataSourceSelectRow` for that Name/State.

Still-in buttons are blue. Grey means eliminated. Green means that row is the one vMix is showing.
