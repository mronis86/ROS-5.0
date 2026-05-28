# Run of Show: Resolume Sync – Help

Experimental module. Use alongside or instead of the standard Run of Show module for Resolume timer tests only.

## Actions

| Action | Purpose |
|--------|---------|
| Arm Resolume sync | Load cue + listen for OSC on configured layer/clip |
| Disarm Resolume sync | Stop listening (does not clear ROS timer) |
| End Resolume sync | Clear `time_source` on the API |
| Manual Resolume align | Test align without OSC |
| Load Cue / Stop Timer | Basic ROS control for the test workflow |
| Start Sub-Cue Timer | Start orange sub-cue timer on an indented schedule row |
| Stop Sub-Cue Timer | Stop one sub-cue or all |
| Set cue duration from Resolume clip | Sample clip length and update main or sub row duration |

## Preset categories

- **Resolume Cues** – Arm + Load per main cue  
- **Resolume Sub-Cues** – Start/stop sub-cue timers (indented rows only)  
- **Resolume Duration** – Set duration from clip (main and sub rows)

## Variables

- `$(ros-resolume:resolume_armed)` – Yes/No  
- `$(ros-resolume:resolume_inferred_duration)` – last inferred clip length in seconds  
- `$(ros-resolume:sub_cue)` – label of running sub-cue  
- `$(ros-resolume:sub_timer_running)` – Yes/No

## Feedback

- **Resolume sync armed** – highlights when arm is active  
- **Sub-cue timer running** – highlights when a sub-cue timer is active (optional per-row filter)
