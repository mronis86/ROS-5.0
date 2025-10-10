# Netlify Deployment with Functions

This deployment includes **Netlify Functions** for CSV/XML API endpoints, making the app fully functional on Netlify without requiring a separate Node.js server.

## 🚀 What's New

### ✅ Netlify Functions Added
- **Lower Thirds XML/CSV**: `/.netlify/functions/lower-thirds-xml` and `/.netlify/functions/lower-thirds-csv`
- **Schedule XML/CSV**: `/.netlify/functions/schedule-xml` and `/.netlify/functions/schedule-csv`
- **Custom Columns XML/CSV**: `/.netlify/functions/custom-columns-xml` and `/.netlify/functions/custom-columns-csv`

### ✅ Updated React App
- **Smart URL Detection**: Automatically uses Netlify Functions when deployed
- **Enhanced VMIX Instructions**: Shows both local and Netlify URLs
- **Direct Link Options**: Users can copy direct Netlify Function URLs

## 📁 File Structure

```
netlify-deploy-with-functions/
├── index.html                    # Main React app
├── assets/                      # React build assets
├── _redirects                   # SPA redirect rules
├── netlify.toml                 # Netlify configuration
├── netlify/
│   └── functions/              # Netlify Functions
│       ├── lower-thirds-xml.js
│       ├── lower-thirds-csv.js
│       ├── schedule-xml.js
│       ├── schedule-csv.js
│       ├── custom-columns-xml.js
│       ├── custom-columns-csv.js
│       └── package.json
└── README-Netlify-Functions.md  # This file
```

## 🔧 How It Works

### Local Development
- React app: `http://localhost:3003`
- Node.js server: `http://localhost:3002` (for API endpoints)
- API URLs: `http://localhost:3002/api/lower-thirds.xml?eventId=123`

### Netlify Deployment
- React app: `https://your-app.netlify.app`
- Netlify Functions: `https://your-app.netlify.app/.netlify/functions/lower-thirds-xml?eventId=123`
- **No Node.js server needed!**

## 🎯 VMIX Integration

### For VMIX Users:
1. **XML Data Source**: `https://your-app.netlify.app/.netlify/functions/lower-thirds-xml?eventId=YOUR_EVENT_ID`
2. **CSV Data Source**: `https://your-app.netlify.app/.netlify/functions/lower-thirds-csv?eventId=YOUR_EVENT_ID`
3. **Schedule XML**: `https://your-app.netlify.app/.netlify/functions/schedule-xml?eventId=YOUR_EVENT_ID`
4. **Schedule CSV**: `https://your-app.netlify.app/.netlify/functions/schedule-csv?eventId=YOUR_EVENT_ID`

### VMIX Setup:
1. Open VMIX and go to Data Sources
2. Add a new Data Source
3. Choose "XML" or "CSV" as the data type
4. Paste one of the URLs above
5. Set refresh interval to 10 seconds
6. Click "Add" to create the data source

## 🚀 Deployment Instructions

### Option 1: Netlify CLI
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=netlify-deploy-with-functions
```

### Option 2: Netlify Web Interface
1. Go to [netlify.com](https://netlify.com)
2. Create a new site
3. Drag and drop the `netlify-deploy-with-functions` folder
4. Deploy!

### Option 3: Git Integration
1. Push to GitHub/GitLab
2. Connect repository to Netlify
3. Set build directory to `netlify-deploy-with-functions`
4. Deploy!

## 🔍 Testing

### Test Netlify Functions Locally:
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Start local development server
netlify dev --dir=netlify-deploy-with-functions

# Test endpoints:
# http://localhost:8888/.netlify/functions/lower-thirds-xml?eventId=123
# http://localhost:8888/.netlify/functions/lower-thirds-csv?eventId=123
```

### Test on Deployed Site:
1. Deploy to Netlify
2. Visit: `https://your-app.netlify.app/.netlify/functions/lower-thirds-xml?eventId=YOUR_EVENT_ID`
3. Should return XML data
4. Test CSV: `https://your-app.netlify.app/.netlify/functions/lower-thirds-csv?eventId=YOUR_EVENT_ID`

## 🎉 Benefits

- ✅ **No Server Required**: Works entirely on Netlify
- ✅ **VMIX Ready**: Direct API endpoints for VMIX integration
- ✅ **Auto-scaling**: Netlify Functions scale automatically
- ✅ **Cost Effective**: Pay only for function execution time
- ✅ **Easy Deployment**: Just drag and drop to Netlify
- ✅ **Global CDN**: Fast access worldwide

## 🔧 Troubleshooting

### Functions Not Working?
1. Check Netlify Functions logs in the Netlify dashboard
2. Ensure `netlify/functions/` directory is included in deployment
3. Verify `package.json` dependencies are correct

### VMIX Not Connecting?
1. Test the URL directly in a browser
2. Check CORS headers (should be handled automatically)
3. Verify the event ID is correct
4. Check Netlify Function logs for errors

### Build Issues?
1. Ensure all files are in the correct directory structure
2. Check `netlify.toml` configuration
3. Verify `_redirects` file is present

## 📞 Support

If you encounter issues:
1. Check Netlify Function logs
2. Test endpoints directly in browser
3. Verify event ID parameter
4. Check Supabase connection in function logs

---

**Ready to deploy!** 🚀
