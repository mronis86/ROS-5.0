# Netlify Deployment - Railway API Edition

## 🎉 What's Included

This package includes everything you need for a complete Netlify deployment with low-egress VMIX integration!

### ✅ Features

1. **Full React App** - Complete Run of Show management interface
2. **Netlify XML Pages** - React pages that show Railway API data
3. **Static HTML Pages for VMIX** - Low egress WebSocket-based pages
4. **Python Graphics App** - Optimized version for download

---

## 📦 Files Included

- `index.html` - Main React app
- `assets/` - React app bundles
- `_redirects` - SPA routing
- `vmix-lower-thirds-live.html` - Static page for VMIX (Low Egress)
- `vmix-schedule-live.html` - Static page for VMIX (Low Egress)
- `vmix-custom-columns-live.html` - Static page for VMIX (Low Egress)
- `OptimizedGraphicsGenerator-Python.zip` - Python app download

---

## 🚀 Deployment

1. Drag the **`netlify-deploy-railway`** folder to Netlify
2. Wait for deployment to complete
3. Done! No environment variables needed for the React app

---

## 🎬 VMIX Integration (LOW EGRESS)

### **Use These URLs in VMIX:**

**Lower Thirds XML:**
```
https://your-site.netlify.app/vmix-lower-thirds-live.html?eventId=YOUR_EVENT_ID&format=xml
```

**Lower Thirds CSV:**
```
https://your-site.netlify.app/vmix-lower-thirds-live.html?eventId=YOUR_EVENT_ID&format=csv
```

**Schedule XML:**
```
https://your-site.netlify.app/vmix-schedule-live.html?eventId=YOUR_EVENT_ID&format=xml
```

**Schedule CSV:**
```
https://your-site.netlify.app/vmix-schedule-live.html?eventId=YOUR_EVENT_ID&format=csv
```

**Custom Columns XML:**
```
https://your-site.netlify.app/vmix-custom-columns-live.html?eventId=YOUR_EVENT_ID&format=xml
```

**Custom Columns CSV:**
```
https://your-site.netlify.app/vmix-custom-columns-live.html?eventId=YOUR_EVENT_ID&format=csv
```

---

## ✅ Why These URLs Are Better

- ✅ **Low egress** - WebSocket updates only when data changes
- ✅ **Free bandwidth** - Netlify serves the HTML
- ✅ **Real-time** - Updates via Railway WebSocket
- ✅ **Always online** - No local server needed
- ✅ **VMIX compatible** - Works perfectly with VMIX polling

---

## 📊 Egress Comparison

### **Direct Railway API:**
- VMIX polls every 10 seconds
- ~4.7 GB/month from Railway
- ❌ Exceeds free tier

### **Static HTML + WebSocket:**
- VMIX polls Netlify (free)
- WebSocket updates from Railway
- ~10-50 MB/month from Railway
- ✅ Stays within free tier

---

## 🧪 Testing

### Test the Static Pages:
Open in your browser to see live data:
```
https://your-site.netlify.app/vmix-lower-thirds-live.html?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85&format=xml
```

You should see:
- Connection status
- Live XML/CSV data
- Auto-updates via WebSocket

---

## 🎯 Architecture

- **Netlify** = React app + Static HTML pages for VMIX
- **Railway** = WebSocket server + Database API
- **Neon** = PostgreSQL database
- **VMIX** = Polls Netlify HTML (free bandwidth)

---

**This is the optimal setup for production!** 🚀
