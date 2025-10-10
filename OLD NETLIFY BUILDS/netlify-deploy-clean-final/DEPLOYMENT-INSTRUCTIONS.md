# Netlify Deployment Instructions

## 📦 **Package Contents:**
- `index.html` - React app entry point
- `assets/` - CSS and JavaScript files
- `.netlify/functions/` - 6 Netlify functions (CSV/XML)
- `netlify.toml` - MIME type configuration
- `test-netlify-functions.html` - Function testing page

## 🚀 **Deployment Steps:**

### **1. Upload to Netlify**
- Drag and drop `netlify-deploy-clean-final-fixed.zip` to Netlify
- Or use Netlify CLI: `netlify deploy --prod`

### **2. Set Environment Variable**
In Netlify Dashboard → Site Settings → Environment Variables:
```
NEON_DATABASE_URL=postgresql://neondb_owner:npg_lxfHkb60SjMi@ep-noisy-salad-adtczvk3-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

### **3. Test Functions**
After deployment, open: `https://your-site.netlify.app/test-netlify-functions.html`
- Enter your site URL and Event ID
- Test each function to verify they return proper CSV/XML data

## 🎯 **Function URLs:**

### **CSV Endpoints:**
```
https://your-site.netlify.app/.netlify/functions/lower-thirds-csv?eventId=YOUR_EVENT_ID
https://your-site.netlify.app/.netlify/functions/schedule-csv?eventId=YOUR_EVENT_ID
https://your-site.netlify.app/.netlify/functions/custom-columns-csv?eventId=YOUR_EVENT_ID
```

### **XML Endpoints:**
```
https://your-site.netlify.app/.netlify/functions/lower-thirds-xml?eventId=YOUR_EVENT_ID
https://your-site.netlify.app/.netlify/functions/schedule-xml?eventId=YOUR_EVENT_ID
https://your-site.netlify.app/.netlify/functions/custom-columns-xml?eventId=YOUR_EVENT_ID
```

## ✅ **Expected Results:**
- CSV functions return: `text/csv` content
- XML functions return: `application/xml` content
- React app loads correctly
- No MIME type errors

## 🔧 **Troubleshooting:**
- If functions return HTML: Check environment variable
- If React app doesn't load: Check browser console for errors
- If MIME type errors: The `netlify.toml` file should fix this by setting correct headers
- If still having issues: Try deploying without any redirects first
