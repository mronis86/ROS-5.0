# Building a Standalone Executable

This guide explains how to build a standalone executable that can run on corporate networks without requiring npm install or Node.js.

## Why Build Standalone?

✅ **No npm install required** - All dependencies are bundled  
✅ **No Node.js required** - Everything is included in the .exe  
✅ **Works on corporate networks** - No need to download packages  
✅ **Portable** - Single .exe file that can be copied anywhere  
✅ **No admin rights needed** - Portable version doesn't require installation

## Building the Standalone Executable

### Option 1: Using the Build Script (Recommended)

1. **Run the build script:**
   ```bash
   build-standalone.bat
   ```

2. **Wait for the build to complete** (this may take a few minutes)

3. **Find your executable:**
   - Location: `dist\ROS-OSC-Control-1.0.0-portable.exe`
   - This is a single file that contains everything!

### Option 2: Using npm Commands

1. **Install dependencies (one time only):**
   ```bash
   npm install
   ```

2. **Build portable executable:**
   ```bash
   npm run build:portable
   ```

3. **Or build installer:**
   ```bash
   npm run build:win
   ```

## Using the Standalone Executable

### Portable Version (Recommended for Corporate Networks)

- **File:** `ROS-OSC-Control-1.0.0-portable.exe`
- **Location:** `dist` folder
- **Usage:** Just double-click to run!
- **No installation needed** - Perfect for corporate environments
- **No admin rights required**

### Installer Version

- **File:** `ROS-OSC-Control Setup 1.0.0.exe`
- **Location:** `dist` folder
- **Usage:** Run the installer to install the app
- **Requires:** Admin rights for installation

## Distributing to Corporate Networks

1. **Build the portable version** using `build-standalone.bat`
2. **Copy the .exe file** from the `dist` folder
3. **Distribute the single .exe file** - that's all you need!
4. **Users can run it directly** - no installation or dependencies required

## Troubleshooting

### Build fails with network errors
- Make sure you have internet access for the initial build
- Once built, the .exe doesn't need internet (except for API calls)

### The .exe is large
- This is normal! It includes Electron runtime (~100-150MB)
- All dependencies are bundled inside

### Antivirus flags the .exe
- This is common with Electron apps
- You may need to whitelist it in corporate antivirus
- Consider code signing for production use

## Notes

- The portable version stores settings in the same folder as the .exe
- The installer version stores settings in AppData
- Both versions work identically - choose based on your deployment needs
