/**
 * ROS 5.0 – Weekly backup: upcoming run-of-show events → CSV files in Google Drive.
 *
 * Flow: Railway API (reads Neon) → this script → weekly folder (e.g. 2026-W06) with one CSV per event.
 *
 * SETUP:
 * 1. Copy this entire file into script.google.com (New project).
 * 2. Set CONFIG below: API_BASE_URL, API_KEY, and optionally DRIVE_FOLDER_ID.
 * 3. Run testBackupConnection() once to verify the API responds (View → Logs).
 * 4. Run runBackupToDrive() once and authorize Drive when prompted.
 * 5. Triggers (clock icon) → Add Trigger → runBackupToDrive, Time-driven, Week timer, pick day/time.
 */

const CONFIG = {
  API_BASE_URL: 'https://ros-50-production.up.railway.app',  // Your Railway API URL (no trailing slash)
  API_KEY: '1615',
  DRIVE_FOLDER_ID: ''   // Optional: folder ID from drive.google.com/drive/folders/FOLDER_ID — leave '' for My Drive root
};

/**
 * Test only: fetch from API and log event count. Does not write to Drive.
 * Run this first to confirm API_BASE_URL and API_KEY work.
 */
function testBackupConnection() {
  const url = CONFIG.API_BASE_URL + '/api/backup/upcoming-export?key=' + encodeURIComponent(CONFIG.API_KEY);
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = response.getResponseCode();
    const text = response.getContentText();
    if (code !== 200) {
      Logger.log('API returned ' + code + ': ' + text);
      return;
    }
    const data = JSON.parse(text);
    const events = data.events || [];
    Logger.log('OK: API returned ' + events.length + ' upcoming event(s).');
    events.forEach(function(ev, i) {
      Logger.log('  ' + (i + 1) + '. ' + (ev.eventName || ev.eventId) + ' (' + (ev.eventDate || '') + ')');
    });
  } catch (e) {
    Logger.log('Error: ' + e.toString());
  }
}

/**
 * Fetch upcoming events from API and save one CSV per event into a weekly folder in Drive.
 * Call this manually or via a time-driven trigger (e.g. weekly).
 */
function runBackupToDrive() {
  const url = CONFIG.API_BASE_URL + '/api/backup/upcoming-export?key=' + encodeURIComponent(CONFIG.API_KEY);
  let response;
  try {
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    Logger.log('Fetch error: ' + e.toString());
    throw new Error('Could not reach API: ' + e.toString());
  }
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) {
    Logger.log('API error ' + code + ': ' + text);
    throw new Error('API returned ' + code + ': ' + text);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    Logger.log('Invalid JSON: ' + text.substring(0, 200));
    throw new Error('Invalid JSON from API');
  }
  const events = data.events || [];
  if (events.length === 0) {
    Logger.log('No upcoming events — nothing to save.');
    return;
  }
  var folder = CONFIG.DRIVE_FOLDER_ID
    ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID)
    : DriveApp.getRootFolder();
  var weekName = getISOWeekString(new Date());
  var weekFolder;
  var existing = folder.getFoldersByName(weekName);
  if (existing.hasNext()) {
    weekFolder = existing.next();
  } else {
    weekFolder = folder.createFolder(weekName);
  }
  var created = 0;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var safeName = (ev.eventName || 'Event_' + ev.eventId).replace(/[<>:"/\\|?*]/g, '_').slice(0, 100);
    var fileName = safeName + '_' + (ev.eventDate || '') + '.csv';
    var csvContent = ev.csv || '';
    var blob = Utilities.newBlob(csvContent, 'text/csv', fileName);
    blob.setContentType('text/csv; charset=UTF-8');
    weekFolder.createFile(blob);
    created++;
  }
  Logger.log('Created ' + created + ' CSV file(s) in folder "' + weekName + '"');
}

function getISOWeekString(date) {
  var d = new Date(date);
  var day = d.getDay();
  var mon = new Date(d.getTime());
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  var y = mon.getFullYear();
  var jan1 = new Date(y, 0, 1);
  var w = 1 + Math.floor((mon - jan1) / (7 * 24 * 3600 * 1000));
  return y + '-W' + String(w).padStart(2, '0');
}
