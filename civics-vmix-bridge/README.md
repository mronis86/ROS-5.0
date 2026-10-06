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
