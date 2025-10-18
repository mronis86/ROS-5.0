# Testing Instructions for ROS OSC Control

## Prerequisites

1. **API Server Running**
   ```bash
   cd C:\Users\audre\OneDrive\Desktop\ROS-5.0
   node api-server.js
   ```
   ✅ Should show: "Server running on port 3001"

2. **Database Connected**
   - api-server.js should connect to your Neon PostgreSQL database
   - Should have events in `calendar_events` table
   - Should have schedule data in `run_of_show_data` table

## Test 1: Basic App Launch

### Steps:
1. Navigate to `ros-osc-control` folder
2. Run: `npm install` (first time only)
3. Run: `npm start` or double-click `start-ros-osc-control.bat`

### Expected Results:
✅ App window opens  
✅ Header shows "ROS OSC Control"  
✅ OSC status indicator shows green "OSC Listening on 0.0.0.0:57121"  
✅ Event list loads and displays event cards  
✅ OSC Log sidebar shows "OSC Server started on port 57121"  

### If It Fails:
- Check that `node_modules` folder exists
- Check that port 57121 is not in use
- Check console for errors (Ctrl+Shift+I)

---

## Test 2: Event Loading

### Steps:
1. Click on any event card in the event list

### Expected Results:
✅ Page switches to Run of Show view  
✅ Event name and date appear at top  
✅ Schedule table loads with all cues  
✅ Table shows: CUE numbers, Segment names, Durations, Status  
✅ Current cue display shows "No CUE Selected"  

### If It Fails:
- Check that api-server.js is running
- Check API mode is set to LOCAL in dropdown
- Check console for API errors

---

## Test 3: OSC Message Reception (Automated Test)

### Steps:
1. Keep the app open with an event loaded
2. Open a NEW terminal/PowerShell window
3. Navigate to `ros-osc-control` folder
4. Run: `node test-osc-commands.js`

### Expected Results:
✅ Test script outputs: "OSC Test Client Ready"  
✅ App's OSC Log shows received messages:
   - `/ros/load` with value 1
   - `/ros/load_by_cue` with value "1.0"
   - `/ros/start`
   - `/ros/stop`
   - `/ros/next`
   - `/ros/prev`
   - `/ros/goto` with value 3

✅ Each log entry shows:
   - Timestamp
   - OSC address
   - Arguments (if any)

### If It Fails:
- Check that port 57121 is open
- Check Windows Firewall settings
- Try running test script as Administrator
- Check that OSC status indicator is green

---

## Test 4: Load Cue Command

### Manual Test:
1. Make sure you have an event loaded
2. Note the ID of the first cue in the schedule (look at row 1)
3. In test-osc-commands.js, modify the first test to use that ID
4. Run the test script

### Expected Results:
✅ OSC Log shows: "RECEIVED /ros/load [id]"  
✅ Current cue display updates to show:
   - Status: "LOADED" (yellow)
   - Cue number from that row
   - Segment name from that row
   - Timer shows the cue's duration (not counting down)
   - Progress bar at 0%

✅ Schedule table highlights the loaded row (blue background)  
✅ Status column for that row shows "LOADED"  

### If It Fails:
- Check that the item ID exists in your schedule
- Check console for API errors
- Verify api-server.js shows "OSC: Loading cue" message
- Check that `/api/cues/load` endpoint is working

---

## Test 5: Start Timer Command

### Prerequisites:
- A cue must be loaded (run Test 4 first)

### Steps:
1. Send OSC command: `/ros/start`
2. Watch the timer display

### Expected Results:
✅ Status changes from "LOADED" to "RUNNING" (green)  
✅ Timer starts counting down  
✅ Progress bar fills from left to right  
✅ Schedule table row shows "RUNNING" status  

### If It Fails:
- Make sure a cue is loaded first
- Check api-server.js console for errors
- Verify `/api/timers/start` endpoint exists

---

## Test 6: Stop Timer Command

### Prerequisites:
- A timer must be running (run Test 5 first)

### Steps:
1. Send OSC command: `/ros/stop`
2. Watch the display

### Expected Results:
✅ Timer stops counting  
✅ Status changes to idle  
✅ Progress bar stops moving  
✅ Schedule table updates  

### If It Fails:
- Check that a timer was actually running
- Check api-server.js for errors

---

## Test 7: Load by Cue Number

### Steps:
1. Note a cue number from your schedule (e.g., "1.0", "A", "VID-1")
2. Send: `/ros/load_by_cue "1.0"` (with your cue number)

### Expected Results:
✅ App finds the matching cue by cue number  
✅ Loads that cue (same as Test 4)  

### If It Fails:
- Check that the cue number exactly matches what's in the schedule
- Cue numbers are case-sensitive
- Check the customFields.cue property exists

---

## Test 8: Next/Previous Navigation

### Steps:
1. Load cue at row 5: `/ros/goto 5`
2. Wait 1 second
3. Send: `/ros/next`
4. Wait 1 second
5. Send: `/ros/prev`

### Expected Results:
✅ After goto: Row 5 is loaded  
✅ After next: Row 6 is loaded  
✅ After prev: Row 5 is loaded again  

### If It Fails:
- Make sure you have at least 6 rows in schedule
- Check that activeItemId is being tracked correctly

---

## Test 9: Power Save Blocking

### Steps:
1. Start the app
2. Check DevTools console (Ctrl+Shift+I)
3. Look for: "🔋 Power save blocker enabled"
4. Minimize the app window
5. Wait 5 minutes
6. Send an OSC command

### Expected Results:
✅ Console shows "Power save blocker enabled"  
✅ Shows "Is preventing sleep: true"  
✅ After 5 minutes minimized, OSC command still works  
✅ App does not go to sleep  

### If It Fails:
- Check Electron version is up to date
- Check that powerSaveBlocker.start() returned valid ID

---

## Test 10: API Mode Switching

### Steps:
1. In the header dropdown, select "RAILWAY"
2. Watch the event list reload

### Expected Results:
✅ Dropdown changes to RAILWAY  
✅ App attempts to load from RAILWAY_API_URL  
✅ If Railway URL not set, shows error  

### If It Fails:
- Set a valid RAILWAY_API_URL in .env
- Make sure Railway backend is deployed and running

---

## Test 11: Multi-Client Sync

### Prerequisites:
- ROS OSC Control app running
- Web browser with RunOfShowPage open (same event)

### Steps:
1. Send OSC command to load a cue: `/ros/load 1`
2. Watch both the Electron app AND the web browser

### Expected Results:
✅ Electron app loads the cue immediately  
✅ Web browser updates within 1-2 seconds via WebSocket  
✅ Both show same cue as "LOADED"  
✅ Both show same timer value  

### If It Fails:
- Check that Socket.IO is working in api-server.js
- Verify browser is connected to WebSocket
- Check that event_id matches between app and browser

---

## Test 12: OSC Log Accumulation

### Steps:
1. Send 100+ OSC commands rapidly
2. Watch the OSC Log sidebar

### Expected Results:
✅ Log shows all messages (up to 100)  
✅ Older messages are removed (keeps last 100)  
✅ No memory leaks  
✅ App remains responsive  

### If It Fails:
- Check that log entries are being removed after 100
- Monitor memory usage in Task Manager

---

## Common Issues & Solutions

### Issue: OSC messages not received
**Solution**: 
- Check firewall allows UDP on port 57121
- Verify OSC sender is configured for UDP (not TCP)
- Try binding to 127.0.0.1 instead of 0.0.0.0

### Issue: API calls fail
**Solution**:
- Verify api-server.js is running
- Check API_MODE matches your setup
- Check console for CORS errors
- Verify DATABASE_URL environment variable is set

### Issue: Events don't load
**Solution**:
- Check database has data in calendar_events table
- Verify run_of_show_data table has schedule_items
- Check api-server.js database connection

### Issue: Timer doesn't sync
**Solution**:
- Check that started_at timestamp is being set
- Verify elapsed time calculation is correct
- Check that timerInterval is running

---

## Performance Benchmarks

### Expected Performance:
- **OSC message latency**: < 50ms
- **Timer update rate**: 1 second (1 Hz)
- **API sync interval**: 5 seconds
- **Memory usage**: < 200 MB
- **CPU usage (idle)**: < 1%
- **CPU usage (timer running)**: < 3%

---

## Success Criteria

All tests pass = ✅ Ready for production use!

The app should:
1. ✅ Never sleep when minimized
2. ✅ Receive all OSC commands reliably
3. ✅ Sync with API and web interface
4. ✅ Show accurate timer countdowns
5. ✅ Handle errors gracefully
6. ✅ Log all OSC activity
7. ✅ Remain responsive under load

---

## Next Steps After Testing

1. **Configure for your OSC controller** (QLab, TouchOSC, etc.)
2. **Set up firewall rules** for remote control
3. **Configure Railway deployment** if needed
4. **Create QLab cue templates** for common operations
5. **Document your specific cue numbering system**

Happy testing! 🎬

