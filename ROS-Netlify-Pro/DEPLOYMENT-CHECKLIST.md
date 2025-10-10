# ✅ Netlify Deployment Checklist

## 📦 What's in This Package

**Essential Files:**
- ✅ `index.html` - Main React app
- ✅ `assets/` - Optimized JS and CSS bundles
- ✅ `_redirects` - SPA routing configuration
- ✅ `netlify.toml` - Netlify configuration

**Static Pages:**
- ✅ Graphics pages (Lower Thirds, Custom, Schedule)
- ✅ VMIX integration pages (CSV and XML)
- ✅ Live data endpoints

**Media & Downloads:**
- ✅ `pointed_crop_loop.webm` - Video background
- ✅ `electron-osc-app.zip` - Electron OSC app (OSC Modal)
- ✅ `OSC_WebSocket_App.zip` - Python OSC app (OSC Modal)
- ✅ `OptimizedGraphicsGenerator-Python.zip` - Python graphics (Graphics Links)
- ✅ `ROS-Local-Server-NodeJS.zip` - Local server (Graphics Links)

**Documentation:**
- ✅ `google-sheets-vmix-setup.md` - VMIX setup guide

---

## 🚀 Deploy Steps

### **Method 1: Drag & Drop (Recommended)**

1. Go to https://app.netlify.com/
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag the **entire `ROS-Netlify-Pro` folder** into the drop zone
4. Wait 30-60 seconds
5. ✅ Done! Click your site URL

### **Method 2: Netlify CLI**

```bash
# Install CLI (once)
npm install -g netlify-cli

# Deploy
cd ROS-Netlify-Pro
netlify deploy --prod --dir=dist
```

---

## 🔧 Post-Deployment Configuration

### **1. Verify Deployment**
- Visit your Netlify URL
- Check that the app loads
- Open browser console (F12) - look for errors

### **2. Configure CORS on Railway**

Your Railway API needs to allow requests from your Netlify domain:

1. Go to Railway dashboard
2. Select your ROS API project
3. Add environment variable:
   ```
   ALLOWED_ORIGINS=https://your-site-name.netlify.app
   ```
4. Redeploy Railway

### **3. Test Key Features**

- [ ] Calendar/Event list loads
- [ ] Run of Show page loads schedule
- [ ] Timer buttons work (LOAD/START/STOP)
- [ ] Graphics pages load data
- [ ] VMIX pages generate XML/CSV
- [ ] Download buttons work (OSC apps)

---

## 🌐 Custom Domain (Optional)

1. In Netlify: **Site settings** → **Domain management**
2. Click **"Add custom domain"**
3. Enter your domain
4. Follow DNS configuration instructions
5. Wait for SSL certificate (auto-provisioned)

---

## 📊 File Sizes

Total package: ~2MB (optimized for fast deployment)
- JS bundle: ~1.6MB (includes React, routing, UI components)
- CSS bundle: ~41KB
- Video: ~varies by compression
- Zip files: ~varies

---

## 🔐 Security & Performance

**Configured:**
- ✅ Security headers (XSS, frame, content-type protection)
- ✅ Long-term caching for assets (1 year)
- ✅ Fresh HTML on every request
- ✅ Gzip compression enabled
- ✅ SPA routing (no 404 errors)

---

## ⚠️ Common Issues

**Issue:** App loads but can't fetch data
**Fix:** Check Railway CORS configuration, ensure API URL is correct

**Issue:** 404 on page refresh
**Fix:** Verify `_redirects` file is in dist folder (it is!)

**Issue:** Download buttons don't work
**Fix:** Verify zip files are in dist folder (they are!)

**Issue:** Video background doesn't load
**Fix:** Check that `pointed_crop_loop.webm` is in dist folder (it is!)

---

## 🎯 Quick Test Checklist

After deployment, test these URLs:

- [ ] `/` - Home/Calendar page
- [ ] `/run-of-show?eventId=xxx` - Run of Show
- [ ] `/graphics-links?eventId=xxx` - Graphics Links
- [ ] `/green-room?eventId=xxx` - Green Room display
- [ ] `/photo-view?eventId=xxx` - Photo View display
- [ ] `/lower-thirds-live` - Lower Thirds (VMIX)
- [ ] `/schedule-live` - Schedule (VMIX)

---

## 📞 Need Help?

Check the main README.md for detailed deployment instructions.

---

**Package Created:** ${new Date().toLocaleString()}
**Ready to Deploy:** YES ✅

