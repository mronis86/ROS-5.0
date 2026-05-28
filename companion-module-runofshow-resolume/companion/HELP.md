# Run of Show: Resolume Sync – Help

Experimental module. Use alongside or instead of the standard Run of Show module for Resolume timer tests only.

## Actions

| Action | Purpose |
|--------|---------|
| Arm Resolume sync | Load main cue + listen for OSC on configured layer/clip |
| Arm Resolume sync (sub-cue) | Load **parent** main cue, arm OSC for sub-cue row layer/clip |
| Disarm Resolume sync | Stop listening (does not clear ROS timer) |
| End Resolume sync | Clear `time_source` on the API |
| Manual Resolume align | Test align without OSC |
| Load Cue / Stop Timer | Basic ROS control for the test workflow |
| Set main cue duration from Resolume clip | Sample clip length and update a **main** schedule row |
| Set sub-cue duration from Resolume clip | Sample clip length and update an **indented** sub-cue row |

## Preset categories

- **Resolume Cues** – Arm + Load per main cue  
- **Resolume Sub-Cues** – Arm + Load per indented sub-cue (loads parent breakout, watches sub clip)  
- **Resolume Duration** – Set duration from clip (main cues only)  
- **Resolume Sub-Cue Duration** – Set duration from clip (indented sub-cues only)

Sub-cues are schedule rows marked **indented** in Run of Show (e.g. breakout rooms under a breakout session). Configure each preset’s layer/clip to match the Resolume column for that room.

## Variables

- `$(ros-resolume:resolume_armed)` – Yes/No  
- `$(ros-resolume:resolume_inferred_duration)` – last inferred clip length in seconds

## Feedback

- **Resolume sync armed** – highlights when arm is active  
- **Resolume sync aligned** – timer locked to Resolume  
- **Resolume sync pulse** – brief flash after each sync
