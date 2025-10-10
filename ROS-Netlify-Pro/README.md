# 🚀 ROS-Netlify-Pro - Deployment Package

**Ready-to-deploy** Netlify package for Run of Show 5.0 application.

---

## 📦 What's Included

- ✅ Pre-built production files in `dist/` folder
- ✅ Netlify configuration (`netlify.toml`)
- ✅ SPA routing with `_redirects` file
- ✅ Optimized caching headers
- ✅ Security headers configured
- ✅ All static assets and media files

---

## 🎯 Quick Deploy to Netlify

### **Option 1: Drag & Drop (Easiest)**

1. Go to [Netlify](https://app.netlify.com/)
2. Click **"Add new site"** → **"Deploy manually"**
3. **Drag the entire `ROS-Netlify-Pro` folder** into the drop zone
4. Wait for deployment to complete
5. Done! Your site is live

### **Option 2: Netlify CLI**

```bash
# Install Netlify CLI (one time only)
npm install -g netlify-cli

# Deploy
cd ROS-Netlify-Pro
netlify deploy --prod --dir=dist
```

### **Option 3: GitHub Integration**

1. Push this folder to a GitHub repository
2. Connect the repository to Netlify
3. Set build settings:
   - **Build command:** Leave empty (pre-built)
   - **Publish directory:** `dist`
4. Deploy!

---

## ⚙️ Configuration Details

### **Build Settings:**
- **Publish directory:** `dist`
- **Node version:** 18
- **No build command needed** (files are pre-built)

### **Redirects:**
- All routes redirect to `index.html` for React Router SPA support
- Returns 200 status to prevent 404 errors

### **Caching:**
- Assets cached for 1 year (immutable)
- HTML revalidated on every request
- Optimal performance and freshness

### **Security Headers:**
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- X-XSS-Protection enabled
- Strict referrer policy

---

## 🔌 Environment Variables (Optional)

If you need to configure the API endpoint, add these in Netlify:

1. Go to **Site settings** → **Environment variables**
2. Add:
   - `VITE_API_BASE_URL` = Your Railway API URL (e.g., `https://ros-50-production.up.railway.app`)

---

## 📁 Folder Structure

```
ROS-Netlify-Pro/
├── dist/                    # Production build files
│   ├── index.html          # Main HTML file
│   ├── assets/             # JS and CSS bundles
│   ├── _redirects          # SPA routing config
│   ├── *.html              # Static pages (VMIX, etc.)
│   ├── *.webm              # Video backgrounds
│   └── *.zip               # Downloadable packages
├── netlify.toml            # Netlify configuration
└── README.md               # This file
```

---

## ✅ Deployment Checklist

Before deploying, ensure:

- [ ] Railway API is running and accessible
- [ ] Neon database is configured
- [ ] CORS is enabled on Railway API for your Netlify domain
- [ ] Environment variables are set (if needed)
- [ ] Custom domain configured (optional)

---

## 🌐 Post-Deployment

After deployment:

1. **Test the site:** Visit your Netlify URL
2. **Check console:** Look for API connection errors
3. **Update CORS:** Add your Netlify domain to Railway's allowed origins
4. **Custom domain:** Configure in Netlify settings if needed

---

## 📞 Support

For issues:
- Check browser console for errors
- Verify Railway API is responding
- Check Netlify deploy logs
- Ensure environment variables are set correctly

---

## 🎉 Features Included

- ✨ Run of Show timer management
- 📅 Calendar/Event list
- 🎨 Graphics pages (Lower Thirds, Custom, Schedule)
- 📊 VMIX integration pages
- 🖼️ Photo View display
- 🟢 Green Room display
- 📡 OSC control support
- 💾 Neon database integration
- 🔄 Real-time WebSocket updates

---

**Built on:** ${new Date().toLocaleString()}
**Version:** ROS 5.0 - Netlify Pro Edition

