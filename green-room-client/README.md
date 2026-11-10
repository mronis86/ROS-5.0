# Green Room display client (MVP)

Standby agent that checks in to ROS cloud so the Offline Kiosk can see it and push **start / stop / assign**.

## Run (test)

1. Copy `config.example.json` → `config.json` and paste an Integration token (`ros_itok_…`) that the kiosk also uses.
2. `node client.js` (or `npm start`)
3. You should see heartbeats every ~20s.

## From another machine / curl

List clients (same token):

```bash
curl -s -H "Authorization: Bearer ros_itok_…" ^
  https://ros-50-production.up.railway.app/api/display-clients?kind=green-room
```

Start Green Room on an event:

```bash
curl -s -X POST -H "Authorization: Bearer ros_itok_…" -H "Content-Type: application/json" ^
  -d "{\"action\":\"start\",\"eventId\":\"YOUR_EVENT_ID\"}" ^
  https://ros-50-production.up.railway.app/api/display-clients/gr-test-laptop-1/command
```

Stop (back to standby):

```bash
curl -s -X POST -H "Authorization: Bearer ros_itok_…" -H "Content-Type: application/json" ^
  -d "{\"action\":\"stop\"}" ^
  https://ros-50-production.up.railway.app/api/display-clients/gr-test-laptop-1/command
```

## Next

- Optional auto-start on Windows login
- Later: dedicated window instead of system browser

Kiosk **Status** lists these clients and can Start / Standby against the selected event (same Integration token).
