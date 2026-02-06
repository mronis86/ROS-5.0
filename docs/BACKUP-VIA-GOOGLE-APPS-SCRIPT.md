# Backup to Google Drive via Google Apps Script (scheduled)

This approach **avoids the Drive API from the webapp**. Instead:

1. Your **Railway API** exposes a simple endpoint that returns upcoming run-of-show data (JSON with CSV per event).
2. A **Google Apps Script** runs on a schedule (e.g. weekly), calls that endpoint, and creates CSV files in **your** Google Drive using your own account (no service account, no folder sharing).

**Flow:** Neon (DB) → Railway API (reads Neon, returns JSON) → Google Apps Script (fetches JSON, writes files to Drive).

---

## 1. API endpoint (already added)

- **URL:** `GET https://YOUR-RAILWAY-API-URL/api/backup/upcoming-export?key=1615`
- **Auth:** Query param `key=1615` (same as Admin).
- **Response:** `{ "events": [ { "eventId", "eventName", "eventDate", "csv" }, ... ] }`  
  Each `csv` is the full CSV string for that event (same format as the in-app backup).

Replace `YOUR-RAILWAY-API-URL` with your real API base (e.g. `https://ros-50-production.up.railway.app`).

---

## 2. Google Apps Script (paste and configure)

**Script file in repo:** [`docs/ros-weekly-backup-to-drive.gs`](ros-weekly-backup-to-drive.gs) — open and copy the whole file into Apps Script.

1. Go to [script.google.com](https://script.google.com) and create a **New project**.
2. Delete the default code and paste in the contents of **`ros-weekly-backup-to-drive.gs`** (from this repo’s `docs/` folder).
3. At the top of the script, set **CONFIG**:
   - **API_BASE_URL** – your Railway API base (no trailing slash), e.g. `https://ros-50-production.up.railway.app`
   - **API_KEY** – `1615` (or your admin key)
   - **DRIVE_FOLDER_ID** – (optional) Leave `''` to use **My Drive** root. To use a specific folder: open the folder in Drive, copy the ID from the URL: `drive.google.com/drive/folders/**FOLDER_ID**
4. **Test the API:** Run the function **`testBackupConnection`** (dropdown → `testBackupConnection` → Run). Check **View → Logs** (or **Execution log**). You should see e.g. `OK: API returned N upcoming event(s).` If you see an error, fix the URL or key and try again.
5. **First backup run:** Run **`runBackupToDrive`** once. When prompted, **Authorize** the script (Drive and external app access). Check your Drive for a new folder like `2026-W06` with one CSV per event.
6. **Schedule weekly:** Click the **Triggers** (clock) icon → **Add Trigger** → Function: `runBackupToDrive`, Event: **Time-driven**, Type: **Week timer**, then choose the day and time (e.g. Monday 6am).

---

## 3. How it communicates with Neon

- **Neon** is your Postgres database. Nothing talks to Neon directly from the internet for security.
- **Railway** runs your API server, which is connected to Neon. The API has an endpoint that runs a SQL query on Neon (upcoming events) and returns the result as JSON.
- **Google Apps Script** only talks to the **Railway API** over HTTPS (`UrlFetchApp.fetch`). It never sees or touches Neon. So: **Neon → (Railway API) → Apps Script → Drive**.

---

## 4. Summary

| Step | Where | What |
|------|--------|------|
| 1 | Railway | API is live; endpoint `GET /api/backup/upcoming-export?key=1615` returns JSON. |
| 2 | script.google.com | New project, paste **ros-weekly-backup-to-drive.gs**, set CONFIG (API_BASE_URL, API_KEY, optional DRIVE_FOLDER_ID). |
| 3 | Script | Run **testBackupConnection** once; check logs to confirm API returns events. |
| 4 | Script | Run **runBackupToDrive** once; authorize Drive. Check Drive for weekly folder (e.g. 2026-W06) and CSVs. |
| 5 | Triggers | Add weekly (or daily) trigger for **runBackupToDrive**. |

No service account, no Drive API from the webapp, no folder sharing with a bot—just your API and your Google account.
