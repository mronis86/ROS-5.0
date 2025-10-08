# 🧪 Local Testing Guide

This guide will help you test the Neon database integration locally before deploying to Netlify.

## 📋 Prerequisites

1. **Neon Database URL** - Get from [Neon Console](https://console.neon.tech)
2. **Node.js** installed
3. **PostgreSQL `pg` package** installed: `npm install pg`

## 🔧 Step 1: Set Environment Variable

You need to set the `NEON_DATABASE_URL` environment variable. Choose one method:

### Option A: PowerShell (Windows - Recommended)
```powershell
# Set for current session
$env:NEON_DATABASE_URL="postgresql://username:password@ep-xyz.us-east-1.aws.neon.tech/neondb?sslmode=require"

# Verify it's set
echo $env:NEON_DATABASE_URL

# Start server
node server.js
```

### Option B: Command Prompt (Windows)
```cmd
# Set for current session
set NEON_DATABASE_URL=postgresql://username:password@ep-xyz.us-east-1.aws.neon.tech/neondb?sslmode=require

# Verify it's set
echo %NEON_DATABASE_URL%

# Start server
node server.js
```

### Option C: Create .env.local file (Any OS)
Create a file called `.env.local` in the project root:
```env
NEON_DATABASE_URL=postgresql://username:password@ep-xyz.us-east-1.aws.neon.tech/neondb?sslmode=require
```

Then install dotenv and update server.js:
```bash
npm install dotenv
```

Add to the top of `server.js`:
```javascript
require('dotenv').config({ path: '.env.local' });
```

## 🚀 Step 2: Start the Local Server

```bash
node server.js
```

You should see:
```
✅ Connected to Neon database
🌐 Database host: ep-xyz.us-east-1.aws.neon.tech
🚀 Server running on http://localhost:3002
```

If you see an error about missing database URL:
```
❌ Database connection string not found! Please set NEON_DATABASE_URL or DATABASE_URL environment variable.
```
Go back to Step 1 and set the environment variable.

## 🧪 Step 3: Run Tests

In a **new terminal window** (keep server running), run the test script:

```bash
node test-local-server.js
```

This will test all endpoints:
- ✅ Main API endpoint
- ✅ Lower Thirds XML
- ✅ Schedule XML  
- ✅ Custom Columns XML
- ✅ Lower Thirds CSV
- ✅ Schedule CSV
- ✅ Custom Columns CSV

### What to Look For:
- All tests should show `✅ SUCCESS (200)`
- Response lengths should be > 0 bytes
- No timeout or connection errors

## 🔍 Step 4: Manual Testing

### Test in Browser:
Replace `YOUR_EVENT_ID` with your actual event ID from the database:

1. **Main API**: http://localhost:3002/api/run-of-show-data/YOUR_EVENT_ID
   - Should return JSON with schedule_items

2. **Lower Thirds XML**: http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID
   - Should return XML with speaker data

3. **Schedule XML**: http://localhost:3002/api/schedule.xml?eventId=YOUR_EVENT_ID
   - Should return XML with schedule times

4. **Custom Columns XML**: http://localhost:3002/api/custom-columns.xml?eventId=YOUR_EVENT_ID
   - Should return XML with custom field data

### Test with VMIX (Optional):
1. Open VMIX
2. Go to **Settings** → **Data Sources**
3. Add new data source:
   - **Type**: XML or CSV
   - **URL**: `http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID`
   - **Refresh**: 10 seconds
4. Click **Add** and verify data appears

## ✅ Step 5: Verify Results

### Success Indicators:
- ✅ Server starts without errors
- ✅ Database connection confirmed
- ✅ All test endpoints return 200 status
- ✅ XML/CSV data contains actual schedule items
- ✅ VMIX can import the data (if testing)

### Common Issues:

#### Issue: "Database connection string not found"
**Solution**: Environment variable not set. Go back to Step 1.

#### Issue: Connection timeout or ECONNREFUSED
**Solution**: 
- Check if server is running on port 3002
- Verify firewall isn't blocking the port
- Try a different port in server.js

#### Issue: "Data not found" or empty results
**Solution**:
- Verify your event ID exists in the Neon database
- Check database has `run_of_show_data` table
- Verify schedule_items column has data

#### Issue: SSL connection error
**Solution**: Add `?sslmode=require` to your database URL

## 🎯 Next Steps

If all tests pass:

1. **Deploy to Netlify**:
   - Upload `netlify-deploy-neon-complete.zip`
   - Set `NEON_DATABASE_URL` environment variable in Netlify dashboard
   - Deploy!

2. **Update Netlify URLs**:
   - Replace `localhost:3002` with your Netlify URL
   - Test live VMIX import with Netlify Functions

3. **Monitor**:
   - Check Netlify Functions logs
   - Verify VMIX updates are working
   - Test real-time data updates

## 📚 Additional Resources

- **Neon Console**: https://console.neon.tech
- **Netlify Dashboard**: https://app.netlify.com
- **Railway Dashboard**: https://railway.app

## 🆘 Need Help?

If you encounter issues:
1. Check server.js console for error messages
2. Verify database URL format is correct
3. Ensure pg package is installed: `npm list pg`
4. Check Neon dashboard for database status
5. Verify your IP is allowed in Neon firewall (if enabled)

