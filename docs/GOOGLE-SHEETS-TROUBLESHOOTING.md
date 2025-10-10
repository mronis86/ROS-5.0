# Google Sheets VMIX Integration - Troubleshooting Guide

## 🚨 **Common Issues & Solutions:**

### **1. Route Not Found Error**
**Problem:** `No routes matched location "/google-sheets-vmix"`
**Solution:** ✅ **FIXED** - Route indentation corrected in App.tsx

### **2. Invalid Spreadsheet ID**
**Problem:** `https://sheets.googleapis.com/v4/spreadsheets/https://comfy-jelly-7b3f97.netlify.app/...`
**Solution:** ✅ **FIXED** - Added validation to prevent Netlify URLs

**Correct Format:**
```
✅ GOOD: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
❌ BAD: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
❌ BAD: https://comfy-jelly-7b3f97.netlify.app/.netlify/functions/vmix-lower-thirds-csv
```

### **3. CORS Errors**
**Problem:** `Access to fetch at 'https://sheets.googleapis.com/v4/...' has been blocked by CORS`
**Solution:** This is expected - Google Sheets API calls from browser are restricted

---

## 📋 **Correct Setup Process:**

### **Step 1: Create Google Sheet**
1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Make it publicly viewable:
   - Click "Share" → "Change to anyone with the link" → "Viewer"

### **Step 2: Get Spreadsheet ID**
From URL: `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`
Copy only: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

### **Step 3: Get API Key**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create/select a project
3. Enable Google Sheets API
4. Create credentials → API Key
5. Copy the API key

### **Step 4: Use the Page**
1. Go to `/google-sheets-vmix?eventId=YOUR_EVENT_ID`
2. Enter the Spreadsheet ID (not full URL)
3. Enter the API Key
4. Click "Load Data" first
5. Then click "Update Google Sheets"

---

## 🎯 **Expected VMIX URLs:**

After successful setup, you'll get:
```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/gviz/tq?tqx=out:csv&sheet=Sheet1
```

This URL can be used directly in VMIX for CSV data import.

---

## ✅ **Fixed in Latest Version:**

1. **Route fixed** - Google Sheets page now accessible
2. **Validation added** - Prevents invalid spreadsheet IDs
3. **Better instructions** - Clear setup guide on the page
4. **Error handling** - Helpful error messages

**Updated Package:** `netlify-deploy-final-v3-fixed.zip`
