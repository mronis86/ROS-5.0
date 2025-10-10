# Netlify Environment Variables Setup

## 🚨 Current Issue
Your Netlify deployment is trying to connect to `localhost:3001` instead of your Railway backend, causing connection refused errors.

## ✅ Solution: Set Environment Variables

### **Required Environment Variable:**

1. **Go to Netlify Dashboard:**
   - Visit: https://app.netlify.com/
   - Select your deployed site

2. **Navigate to Environment Variables:**
   - Site Settings → Environment Variables
   - Click "Add variable"

3. **Add this variable:**
   ```
   Key: VITE_API_BASE_URL
   Value: https://ros-50-production.up.railway.app
   ```

4. **Save and Redeploy:**
   - Click "Save"
   - Go to "Deploys" tab
   - Click "Trigger deploy" → "Deploy site"

## 🔍 **Verify the Fix:**

After redeploying, check the browser console. You should see:
```
🔗 API Base URL: https://ros-50-production.up.railway.app
🌍 Environment: production
⚙️ VITE_API_BASE_URL: https://ros-50-production.up.railway.app
```

Instead of:
```
🔗 API Base URL: http://localhost:3001
```

## 🛠️ **Alternative: Manual Configuration**

If you prefer to set the Railway URL as the default, you can modify the code:

```typescript
// In src/services/database.ts and socket-client.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  'https://ros-50-production.up.railway.app'; // Always use Railway by default
```

## 🚀 **After Setting Environment Variable:**

1. **Redeploy your site**
2. **Check browser console** for the correct API URL
3. **Test functionality** - events should load from Railway/Neon
4. **Verify real-time features** work properly

## 📞 **Troubleshooting:**

- **Still showing localhost?** → Environment variable not set correctly
- **Connection refused?** → Check Railway URL is correct
- **CORS errors?** → Railway backend needs CORS configuration
- **No events loading?** → Check Railway backend is running and connected to Neon
