# Google Drive backup setup

The Admin backup feature uploads **upcoming** run-of-show events (event date ≥ today) to a Google Drive folder, in **weekly subfolders** (e.g. `2026-W06`). You can run it manually with **Run backup now** (works with or without "Enable weekly backup" checked) or enable weekly backups for automatic runs.

**Alternative (no Drive API from webapp):** If you hit errors (e.g. "File not found") with the in-app backup, use **[Backup via Google Apps Script](BACKUP-VIA-GOOGLE-APPS-SCRIPT.md)** instead: a scheduled script fetches from your API and writes CSVs to your Drive using your own Google account.

## What you need

1. **Google Cloud project** with Drive API enabled  
2. **Service account** and its JSON key  
3. **Drive folder** shared with the service account  
4. **API env var** and **Admin folder ID** set

---

## 1. Google Cloud project and Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com/).  
2. Create a project or select an existing one.  
3. **APIs & Services** → **Library** → search for **Google Drive API** → **Enable**.

---

## 2. Service account and JSON key

1. **APIs & Services** → **Credentials** → **Create credentials** → **Service account**.  
2. Name it (e.g. "ROS Backup"), optional role (e.g. Editor), then **Done**.  
3. Open the new service account → **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**.  
   - A JSON file downloads. **Keep it private**; this is your service account key.  
4. In the JSON, note the **client_email** (e.g. `something@project-id.iam.gserviceaccount.com`). You’ll share your Drive folder with this email.

---

## 3. Drive folder and sharing

1. In [Google Drive](https://drive.google.com), create a folder for backups (e.g. "ROS Backups") or use an existing one.  
2. Open the folder → **Share**.  
3. Add the **service account email** (from the JSON `client_email`) as a **Editor** (or at least "Viewer" if you only want uploads; Editor is safer for create/upload).  
4. Get the **Folder ID**:  
   - Open the folder in Drive.  
   - The URL is: `https://drive.google.com/drive/folders/FOLDER_ID`  
   - Copy the `FOLDER_ID` part (long string of letters/numbers).

---

## 4. Credentials: Admin page or API env

**Option A – Admin page (recommended)**  
1. In the app, go to **Admin** → **Google Drive weekly backup**.  
2. Paste the **entire contents** of the service account JSON file into **Service account JSON**.  
3. Click **Save settings**. The key is stored in the database and never shown again (only “set” is indicated).  
4. You can clear it later with **Clear stored credentials**; backup will then use the API env var if set.

**Option B – API environment variable**  
1. Where your API runs (e.g. **Railway**): open the project → **Variables**.  
2. Add **`GOOGLE_SERVICE_ACCOUNT_JSON`** with the full JSON key contents (one line is fine).  
3. Save and redeploy. The API uses this when no key is stored in Admin.

---

## 5. Admin page: folder ID and Run backup

1. In the app, go to **Admin** → **Google Drive weekly backup**.  
2. Paste the **Drive folder ID** (from step 3) into **Drive folder ID**.  
3. If you didn’t set credentials via env var, paste the **service account JSON** and click **Save settings**.  
4. Click **Save settings**.  
5. **Run backup now** works as soon as folder ID and credentials are set (from Admin or `GOOGLE_SERVICE_ACCOUNT_JSON`)—**with or without** "Enable weekly backup" checked.  
   - **Enable weekly backup** only controls whether a weekly cron (if you set one) should run; it does not block manual runs.

---

## Summary checklist

| Step | Where | What |
|------|--------|------|
| Enable Drive API | Google Cloud Console | APIs & Services → Library → Google Drive API → Enable |
| Create service account | Google Cloud Console | Credentials → Create credentials → Service account → Create key (JSON) |
| Share folder | Google Drive | Share folder with `client_email` from JSON (e.g. Editor) |
| Folder ID | Admin page | From URL: `drive.google.com/drive/folders/`**FOLDER_ID** |
| Credentials | Admin page or Railway | Paste JSON in Admin **Service account JSON** and Save, or set env `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Save folder | Admin page | Paste folder ID → Save settings → Run backup now (optional: enable weekly) |

---

## Troubleshooting

- **"GOOGLE_SERVICE_ACCOUNT_JSON not set"** → Add the env var in Railway (or your API host) with the full JSON and redeploy.  
- **"Folder ID not set"** → Enter the folder ID on the Admin page and click **Save settings**.  
- **Drive error / 404 / permission** → Ensure the folder is shared with the **service account email** (from the JSON) with at least Editor (or Viewer if uploads work for your setup).  
- **"relation admin_backup_config does not exist"** → Run the migration (see Admin page blue box) or use **Create table now** so the API’s database has the table.
