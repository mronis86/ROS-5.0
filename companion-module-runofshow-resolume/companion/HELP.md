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

## Variables

- `$(ros-resolume:resolume_armed)` – Yes/No  
- `$(ros-resolume:resolume_inferred_duration)` – last inferred clip length in seconds

## Feedback

- **Resolume sync armed** – highlights when arm is active
