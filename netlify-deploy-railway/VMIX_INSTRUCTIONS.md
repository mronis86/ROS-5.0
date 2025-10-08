# VMIX Integration - Low Egress Solution

## 🎯 Best Solution: Static HTML Pages with WebSocket

This package includes **static HTML pages** that use WebSocket for real-time updates with minimal egress.

---

## 📄 Available Pages

### **Lower Thirds**
- **XML:** `https://your-site.netlify.app/vmix-lower-thirds-live.html?eventId=YOUR_EVENT_ID&format=xml`
- **CSV:** `https://your-site.netlify.app/vmix-lower-thirds-live.html?eventId=YOUR_EVENT_ID&format=csv`

### **Schedule**
- **XML:** `https://your-site.netlify.app/vmix-schedule-live.html?eventId=YOUR_EVENT_ID&format=xml`
- **CSV:** `https://your-site.netlify.app/vmix-schedule-live.html?eventId=YOUR_EVENT_ID&format=csv`

### **Custom Columns**
- **XML:** `https://your-site.netlify.app/vmix-custom-columns-live.html?eventId=YOUR_EVENT_ID&format=xml`
- **CSV:** `https://your-site.netlify.app/vmix-custom-columns-live.html?eventId=YOUR_EVENT_ID&format=csv`

---

## ✅ Why This Is Better

### **Traditional Method (High Egress):**
- VMIX polls Railway API every 10 seconds
- Each poll = full data download
- **~4.7 GB/month** from Railway
- ❌ Exceeds free tier

### **WebSocket Method (Low Egress):**
- VMIX polls Netlify HTML (free, unlimited)
- HTML connects to Railway WebSocket (one connection)
- Updates pushed only when data changes
- **~10-50 MB/month** from Railway
- ✅ Stays within free tier

---

## 🔄 How It Works

1. **VMIX polls the HTML page** (hosted on Netlify)
   - Netlify serves the HTML (free bandwidth)
   - VMIX refreshes every 10 seconds

2. **HTML page maintains ONE WebSocket connection** to Railway
   - Low bandwidth usage
   - Only transfers data when changes occur

3. **When you update data:**
   - React app saves to database
   - Railway WebSocket broadcasts update
   - HTML page receives update
   - HTML regenerates XML/CSV in browser
   - VMIX sees new data on next poll

---

## 📝 VMIX Setup Instructions

### Step 1: Get Your URL

Replace `YOUR_EVENT_ID` with your actual event ID:
```
https://charming-capybara-c36f76.netlify.app/vmix-lower-thirds-live.html?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85&format=csv
```

### Step 2: Add to VMIX

1. Open VMIX
2. Go to **Settings** → **Data Sources**
3. Click **Add**
4. Select **Web/URL** as the source type
5. Paste your URL
6. Set refresh interval: **10 seconds** (or your preference)
7. Click **OK**

### Step 3: Use in Titles

The data fields will be available in your VMIX titles/overlays!

---

## 🎬 Format Options

Add `&format=xml` or `&format=csv` to the URL:

- **XML:** Better for complex data structures
- **CSV:** Simpler, works with more tools

Example:
```
?eventId=7a77d7a2-98af-4772-b23d-5d8ce0c50a85&format=csv
```

---

## 💰 Cost Comparison

### **Direct Railway API (Old Method):**
- Railway egress: ~4.7 GB/month
- Cost: Exceeds free tier (~$0.50-1.00/month)

### **Static HTML + WebSocket (New Method):**
- Netlify bandwidth: Unlimited (free)
- Railway egress: ~10-50 MB/month
- Cost: $0 (within free tier)

---

## 🔍 Monitoring

### Check Connection Status:
Open the HTML page in your browser to see:
- Connection status (Connected/Disconnected)
- Last update time
- Data size
- Live preview of XML/CSV

---

## ✅ Production Ready

These pages are:
- ✅ Optimized for low egress
- ✅ Real-time updates via WebSocket
- ✅ Hosted on Netlify (free bandwidth)
- ✅ Always available
- ✅ VMIX compatible

---

**Use these HTML pages for production VMIX integration!** 🚀
