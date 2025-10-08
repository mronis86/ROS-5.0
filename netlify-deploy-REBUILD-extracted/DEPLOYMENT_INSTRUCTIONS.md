# Netlify Deployment Instructions - UPDATED

This guide will help you deploy the updated `netlify-deploy-final-updated` package to Netlify with all the latest fixes for VMIX integration.

---

## 🔧 What's Been Fixed

### Recent Updates (Latest)
- ✅ Fixed event ID handling - Functions now properly parse event IDs from localStorage
- ✅ Enhanced API headers - Added proper charset, cache control, and CORS headers
- ✅ Improved error handling - Better error messages for debugging
- ✅ Fixed VMIX integration - Functions now return direct API data instead of HTML

### Previous Fixes
- ✅ Migrated from Supabase to Neon PostgreSQL database
- ✅ WebSocket-based real-time updates for low egress
- ✅ Local and Netlify environment detection
- ✅ Updated Python graphics apps (optimized version included)

---

## 📦 Deployment Steps

### Step 1: Deploy to Netlify

Choose one of the following methods:

#### **Option A: Drag and Drop (Recommended)**
1. Go to your [Netlify dashboard](https://app.netlify.com)
2. Navigate to **Sites**
3. Drag the entire `netlify-deploy-final-updated/` folder (or the `netlify-deploy-final-updated-fixed.zip` file) into the Netlify UI where it says "Drag and drop your site folder here"
4. Wait for the deployment to complete

#### **Option B: Manual Upload**
1. Go to your [Netlify dashboard](https://app.netlify.com)
2. Navigate to **Sites**
3. Click **"Add new site"** → **"Deploy manually"**
4. Upload the `netlify-deploy-final-updated-fixed.zip` file
5. Wait for the deployment to complete

---

### Step 2: Configure Environment Variables ⚠️ CRITICAL

**This is ESSENTIAL for Netlify Functions to work!**

1. In your Netlify dashboard, go to **Site Settings** for your deployed site
2. Navigate to **Build & deploy** → **Environment variables** (or **Site configuration** → **Environment variables**)
3. Click **"Add a variable"** or **"Add environment variable"**
4. Add the following environment variable:

   **Key:** `NEON_DATABASE_URL`
   
   **Value:** 
   ```
   postgresql://neondb_owner:npg_lxfHkb60SjMi@ep-noisy-salad-adtczvk3-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

5. Click **"Save"**
6. **Trigger a redeploy** (go to **Deploys** → Click **"Trigger deploy"** → **"Deploy site"**)

> ⚠️ **Important:** After adding environment variables, you MUST trigger a new deploy for the changes to take effect!

---

## 🧪 Testing Your Deployment

### Test 1: Verify the Debug Page

1. Once deployed, navigate to:
   ```
   https://YOUR_SITE_NAME.netlify.app/debug-netlify.html
   ```
   (Replace `YOUR_SITE_NAME` with your actual Netlify site name)

2. The page will auto-detect your event ID from localStorage
   - If you see a malformed event ID (JSON array), the page will automatically extract the correct ID
   - You can also manually enter an event ID: `7a77d7a2-98af-4772-b23d-5d8ce0c50a85`

3. Click the **"Test All Functions"** button

4. You should see **SUCCESS** messages for all 6 functions:
   - Lower Thirds XML ✅
   - Lower Thirds CSV ✅
   - Schedule XML ✅
   - Schedule CSV ✅
   - Custom Columns XML ✅
   - Custom Columns CSV ✅

5. Each function should display:
   - ✅ Status: 200
   - 📏 Data Length: [number] characters
   - 📄 Preview: [raw data]

---

### Test 2: Verify XML/CSV Pages in React App

1. Navigate to your deployed React app's XML/CSV pages:
   - Lower Thirds: `https://YOUR_SITE_NAME.netlify.app/lower-thirds-xml?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85`
   - Schedule: `https://YOUR_SITE_NAME.netlify.app/schedule-xml?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85`
   - Custom Columns: `https://YOUR_SITE_NAME.netlify.app/custom-columns-xml?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85`

2. On these pages, you'll see VMIX integration instructions with URLs like:
   ```
   https://YOUR_SITE_NAME.netlify.app/.netlify/functions/lower-thirds-csv?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85
   ```

3. Click or copy these URLs and open them in a new browser tab

4. You should see **raw CSV or XML data** (NOT HTML or a web page)

---

### Test 3: Test VMIX Integration

1. Copy one of the CSV URLs from the VMIX instruction page:
   ```
   https://YOUR_SITE_NAME.netlify.app/.netlify/functions/lower-thirds-csv?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85
   ```

2. Open VMIX and add a new **Data Source** → **Web/URL**

3. Paste the URL and click **OK**

4. VMIX should now:
   - ✅ Successfully connect to the URL
   - ✅ Display the CSV data in a table format
   - ✅ Update in real-time as you make changes in the Run of Show app

---

## 🔍 Troubleshooting

### Problem: "No routes matched location..." error in console

**Cause:** You're trying to access Netlify function URLs locally.

**Solution:** 
- Netlify functions only work when deployed to Netlify
- For local testing, use: `http://localhost:3002/api/lower-thirds-csv?eventId=...`
- Make sure your local Node.js server (`server.js`) is running: `node server.js`

---

### Problem: Netlify function returns 500 error

**Cause:** Database connection issue or environment variable not set.

**Solution:**
1. Check your Netlify function logs in the Netlify dashboard:
   - Go to **Functions** → Click on the function → View **Function log**
2. Verify the `NEON_DATABASE_URL` environment variable is correctly set
3. Trigger a new deploy after setting environment variables

---

### Problem: Netlify function returns "Event ID is required" (400 error)

**Cause:** Missing or invalid `eventId` parameter.

**Solution:**
- Make sure you're passing `eventId` in the URL query parameters
- Example: `?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85`
- To find valid event IDs, run `node check-event-ids.js` locally

---

### Problem: VMIX shows HTML instead of CSV data

**Cause:** The function is returning an error page or the URL is incorrect.

**Solution:**
1. Open the URL directly in your browser to see what's being returned
2. Check that the URL includes `/.netlify/functions/` in the path
3. Verify the event ID exists in the database
4. Check Netlify function logs for errors

---

### Problem: Empty data returned (Status 200 but no content)

**Cause:** The event ID doesn't exist or has no schedule items.

**Solution:**
1. Run `node check-event-ids.js` locally to see available event IDs
2. Use the React app to create schedule items for your event
3. Verify the event has `isPublic` schedule items (if filtering is enabled)

---

## 📋 Local Development vs. Netlify

### Local Development (for testing before deployment)
- **React App:** `npm run dev` (runs on http://localhost:5173)
- **API Server:** `node server.js` (runs on http://localhost:3002)
- **API URLs:** `http://localhost:3002/api/lower-thirds-csv?eventId=...`
- **Requirements:**
  - `.env` file with `NEON_DATABASE_URL`
  - Node.js and npm installed
  - `node_modules` installed (`npm install`)

### Netlify Production
- **React App:** `https://YOUR_SITE_NAME.netlify.app`
- **API Functions:** `https://YOUR_SITE_NAME.netlify.app/.netlify/functions/...`
- **Requirements:**
  - `NEON_DATABASE_URL` set in Netlify environment variables
  - Deployed build files (`dist/` folder)
  - Netlify Functions (`netlify/functions/` folder)

---

## 📚 Additional Resources

### Key Files in This Package
- **`index.html`** - Main React app entry point
- **`assets/`** - React app JavaScript and CSS bundles
- **`.netlify/functions/`** - Serverless API functions for VMIX integration
- **`_redirects`** - Netlify routing configuration for SPA
- **`debug-netlify.html`** - Debugging tool for testing functions
- **`OptimizedGraphicsGenerator-Python.zip`** - Python graphics app download
- **`NETLIFY_FUNCTION_FIXES.md`** - Technical details on recent fixes

### Getting Event IDs
Run this locally to see available event IDs in your database:
```bash
node check-event-ids.js
```

### Python Graphics App
The optimized Python graphics app is included in this package:
- Download link: `/OptimizedGraphicsGenerator-Python.zip`
- Uses WebSocket for real-time updates
- Connects to Neon database via Railway API
- Low egress, high performance

---

## ✅ Deployment Checklist

Before deploying, make sure:
- [ ] Package is complete (`netlify-deploy-final-updated-fixed.zip` or folder)
- [ ] Netlify site is created or ready for update
- [ ] `NEON_DATABASE_URL` environment variable is ready to add
- [ ] You have a valid event ID for testing

After deploying:
- [ ] Environment variable `NEON_DATABASE_URL` is set in Netlify
- [ ] New deploy triggered after setting environment variables
- [ ] Debug page tested (`/debug-netlify.html`)
- [ ] React XML/CSV pages tested
- [ ] VMIX URLs return raw data (not HTML)
- [ ] VMIX integration tested

---

## 🎉 Success!

If all tests pass, your deployment is complete! You can now:
- Use the React app for Run of Show management
- Export live CSV/XML data to VMIX
- Download and use the Python graphics app
- Enjoy real-time updates via WebSocket
- Monitor low egress usage on Railway

**Need Help?** Check the function logs in Netlify dashboard or review the `NETLIFY_FUNCTION_FIXES.md` file for technical details.

