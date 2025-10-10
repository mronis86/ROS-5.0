# Simple Netlify Deployment

This is a **simplified deployment** that focuses on the React app with client-side CSV/XML generation.

## 🚀 What's Included

- ✅ **React App** - Full-featured web application
- ✅ **Client-side CSV/XML** - Download and copy functionality
- ✅ **VMIX Integration** - Static HTML pages for VMIX
- ✅ **No Server Required** - Pure static deployment

## 📁 File Structure

```
netlify-deploy-simple/
├── index.html                    # Main React app
├── assets/                      # React build assets
├── _redirects                   # SPA redirect rules
├── lower-thirds-live.html      # VMIX integration pages
├── schedule-live.html          # VMIX integration pages
├── custom-graphics-live.html   # VMIX integration pages
└── README-Simple-Deployment.md # This file
```

## 🎯 How It Works

### CSV/XML Generation
- **Client-side only** - No server needed
- **Download files** - Direct browser download
- **Copy to clipboard** - Browser API
- **VMIX integration** - Static HTML pages

### VMIX Integration
The app includes static HTML pages that work with VMIX:
- `lower-thirds-live.html` - Lower thirds data
- `schedule-live.html` - Schedule data  
- `custom-graphics-live.html` - Custom graphics data

## 🚀 Deployment

### Option 1: Drag & Drop (Recommended)
1. Go to [netlify.com](https://netlify.com)
2. Drag the `netlify-deploy-simple` folder
3. Deploy!

### Option 2: Zip Upload
1. Create a zip of the `netlify-deploy-simple` folder
2. Upload to Netlify
3. Deploy!

## 🎉 Benefits

- ✅ **No Build Errors** - Pure static files
- ✅ **Fast Deployment** - No dependencies to install
- ✅ **Reliable** - No server-side complexity
- ✅ **VMIX Ready** - Static HTML pages included
- ✅ **Client-side CSV/XML** - Full functionality

## 🔧 VMIX Usage

### For VMIX Users:
1. Deploy the app to Netlify
2. Use the static HTML pages:
   - `https://your-app.netlify.app/lower-thirds-live.html?eventId=YOUR_EVENT_ID`
   - `https://your-app.netlify.app/schedule-live.html?eventId=YOUR_EVENT_ID`
   - `https://your-app.netlify.app/custom-graphics-live.html?eventId=YOUR_EVENT_ID`

### VMIX Setup:
1. Open VMIX and go to Data Sources
2. Add a new Data Source
3. Choose "Web Page" as the data type
4. Paste one of the URLs above
5. Set refresh interval to 10 seconds
6. Click "Add" to create the data source

## 📱 React App Features

- ✅ **Event Management** - Create, edit, delete events
- ✅ **Run of Show** - Full schedule management
- ✅ **Timer Controls** - OSC integration
- ✅ **Reports** - Generate and print reports
- ✅ **CSV/XML Export** - Download and copy functionality
- ✅ **VMIX Integration** - Direct links and instructions

## 🎯 Next Steps

1. **Deploy this simple version first** to get the app working
2. **Test all functionality** to ensure everything works
3. **Add Netlify Functions later** if you need server-side API endpoints

---

**This deployment will work immediately without any build errors!** 🚀
