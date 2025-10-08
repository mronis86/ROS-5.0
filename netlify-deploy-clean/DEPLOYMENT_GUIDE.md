# Netlify Deployment Guide

## ✅ Fixed Issues

The following issues have been resolved for Netlify deployment:

1. **ES Module Configuration** - Updated package.json with `"type": "module"`
2. **Simplified Dependencies** - Removed server-side dependencies that aren't needed for frontend
3. **PostCSS Configuration** - Fixed ES module compatibility
4. **Build Optimization** - Added code splitting and chunk optimization
5. **Netlify Configuration** - Updated netlify.toml with proper build commands
6. **Terser Dependency** - Added terser as devDependency for Vite minification

## 🚀 Deployment Steps

### Option 1: Netlify Deploy Button
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/your-repo/run-of-show-timer)

### Option 2: Manual Deployment

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial Netlify deployment"
   git remote add origin https://github.com/your-username/your-repo.git
   git push -u origin main
   ```

2. **Connect to Netlify:**
   - Go to [netlify.com](https://netlify.com)
   - Click "New site from Git"
   - Connect your GitHub repository
   - Use these settings:
     - **Build command:** `npm ci && npm run build`
     - **Publish directory:** `dist`
     - **Node version:** `18`

3. **Configure Environment Variables:**
   ```
   VITE_DATABASE_URL=your_database_url
   VITE_DATABASE_API_KEY=your_api_key
   VITE_AUTH_ENABLED=true
   VITE_WS_URL=wss://your-websocket-url
   ```

### Option 3: Drag & Drop Deployment

1. Run `npm run build` locally
2. Drag the `dist` folder to Netlify's deploy area

## 🔧 Build Configuration

- **Framework:** Vite + React
- **Node Version:** 18
- **Build Command:** `npm ci && npm run build`
- **Publish Directory:** `dist`
- **Package Manager:** npm

## 📦 Optimizations Applied

- ✅ Code splitting for vendor and utility libraries
- ✅ Terser minification
- ✅ Asset optimization
- ✅ ES module compatibility
- ✅ Simplified dependency tree

## 🌐 Features Included

- Event Management
- Run of Show Timer
- Real-time WebSocket updates
- Display modes (Fullscreen Timer, Clock)
- Graphics integration
- Reports and printing
- Green Room management
- Photo View
- OSC Control
- Backup system

## 🐛 Troubleshooting

If deployment fails:

1. Check Node.js version is set to 18
2. Verify build command: `npm ci && npm run build`
3. Ensure publish directory is set to `dist`
4. Check environment variables are configured
5. Review build logs in Netlify dashboard

### Common Issues:

**Terser Error:**
```
terser not found. Since Vite v3, terser has become an optional dependency.
```
- ✅ **Fixed:** terser is now included in devDependencies
- **Alternative:** Use `vite.config.esbuild.js` with esbuild minification

**ES Module Errors:**
```
module is not defined in ES module scope
```
- ✅ **Fixed:** Updated PostCSS config to use ES module syntax

**Build Size Warnings:**
```
Some chunks are larger than 500 kB after minification
```
- **Note:** This is a warning, not an error. The build will still succeed.

## 📞 Support

For deployment issues, check:
- Netlify build logs
- Browser console for runtime errors
- Network tab for API connectivity issues
