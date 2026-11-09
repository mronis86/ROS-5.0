# Bundled engines

Engines that ship with Offline Kiosk V2 so a show PC can run from this folder alone.

| Folder | Role |
|--------|------|
| `offline-show/` | Offline Show LAN engine (`:3004`) — copy of repo `offline-show/` |
| `weblinked/` | Sinor WebLinked runtime (SDI/NDI) — synced from `Desktop\WebLinked-SDI\build\Release` |

Left untouched as references:
- `ROS-5.0/offline-show/`
- `Desktop/WebLinked-SDI/` (source + docs)

## Refresh

```bat
cd offline-kiosk-v2
npm run sync:offline-show
npm run sync:weblinked
```
