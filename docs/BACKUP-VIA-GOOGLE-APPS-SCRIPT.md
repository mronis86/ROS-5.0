# Backup to Google Drive via Google Apps Script (scheduled)

This approach **avoids the Drive API from the webapp**. Instead:

1. Your **Railway API** exposes a simple endpoint that returns upcoming run-of-show data (JSON with CSV per event).
2. A **Google Apps Script** runs on a schedule (e.g. weekly), calls that endpoint with an **Integration API token**, and creates CSV files in **your** Google Drive using your own account (no service account, no Shared Drive required).

**Flow:** Neon (DB) → Railway API (reads Neon, returns JSON) → Google Apps Script (fetches JSON, writes files to Drive).

---

## 1. API endpoint (already added)

- **URL:** `GET https://YOUR-RAILWAY-API-URL/api/backup/upcoming-export`
- **Auth:** Header `Authorization: Bearer YOUR_INTEGRATION_TOKEN`  
  Create the token in **Admin → Integration API tokens** with scope **`backup:export`** (or `admin`).
- **Response:** `{ "events": [ { "eventId", "eventName", "eventDate", "csv" }, ... ] }`  
  Each `csv` is the full CSV string for that event (same format as the in-app backup).

Replace `YOUR-RAILWAY-API-URL` with your real API base (e.g. `https://ros-50-production.up.railway.app`).

---

## 2. Google Apps Script (paste and configure)

**Script file in repo:** [`docs/ros-weekly-backup-to-drive.gs`](ros-weekly-backup-to-drive.gs) — open and copy the whole file into Apps Script. (Admin page also has a copy-paste block that stays in sync.)

1. In the ROS app: **Admin → Integration API tokens** → create a token named e.g. `drive-backup` with scopes: **`backup:export`**. Copy the `ros_itok_…` value once.
2. Go to [script.google.com](https://script.google.com) and create a **New project** (or update your existing backup project).
3. Delete the default code and paste in the contents of **`ros-weekly-backup-to-drive.gs`**.
4. At the top of the script, set **CONFIG**:
   - **API_BASE_URL** – your Railway API base (no trailing slash), e.g. `https://ros-50-production.up.railway.app`
   - **API_TOKEN** – the integration token from step 1 (`ros_itok_…`)
   - **DRIVE_FOLDER_ID** – (optional) Leave `''` to use **My Drive** root. To use a specific folder: open the folder in Drive, copy the ID from the URL: `drive.google.com/drive/folders/**FOLDER_ID**
5. **Test the API:** Run **`testBackupConnection`**. Check **View → Logs**. You should see e.g. `OK: API returned N upcoming event(s).`
6. **First backup run:** Run **`runBackupToDrive`** once. When prompted, **Authorize** the script (Drive and external URL access). Check Drive for a weekly folder (e.g. `2026-W29`) with CSVs.
7. **Schedule weekly:** Triggers → Add Trigger → `runBackupToDrive`, Time-driven, Week timer.

---

## 3. How it communicates with Neon

- **Neon** is your Postgres database. Nothing talks to Neon directly from the internet for security.
- **Railway** runs your API server, which is connected to Neon. The API has an endpoint that runs a SQL query on Neon (upcoming events) and returns the result as JSON.
- **Google Apps Script** only talks to the **Railway API** over HTTPS (`UrlFetchApp.fetch`). It never sees or touches Neon. So: **Neon → (Railway API) → Apps Script → Drive**.

---

## 4. Summary

| Step | Where | What |
|------|--------|------|
| 1 | Admin | Create Integration API token with scope `backup:export` |
| 2 | Railway | API live; `REQUIRE_API_AUTH` can stay enabled — token auth is required |
| 3 | script.google.com | Paste **ros-weekly-backup-to-drive.gs**, set `API_BASE_URL` + `API_TOKEN` |
| 4 | Script | Run **testBackupConnection**, then **runBackupToDrive** |
| 5 | Triggers | Optional weekly trigger for **runBackupToDrive** |

No service account, no Shared Drive, no auth exemption on the export route — just a scoped integration token and your Google account for Drive writes.
