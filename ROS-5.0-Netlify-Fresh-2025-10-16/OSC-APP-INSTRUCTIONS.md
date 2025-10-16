# OSC Electron App - Setup Instructions

## 📦 What You Need

The OSC Electron App requires **Node.js** to be installed on your computer before you can run it.

---

## 🚀 Step 1: Download and Install Node.js

### Windows Users:
1. Go to the official Node.js website: **https://nodejs.org/**
2. Download the **LTS (Long Term Support)** version - this is the recommended stable version
3. Run the installer (`.msi` file)
4. Follow the installation wizard:
   - ✅ Accept the license agreement
   - ✅ Keep the default installation location
   - ✅ Make sure "Add to PATH" is checked (this is usually automatic)
   - ✅ Install the recommended tools when prompted
5. Click **Install** and wait for it to complete
6. Restart your computer to ensure Node.js is properly configured

### Mac Users:
1. Go to **https://nodejs.org/**
2. Download the **LTS version** for macOS
3. Run the `.pkg` installer
4. Follow the installation prompts
5. Restart your computer

### Verify Installation:
After installing Node.js, open a **Command Prompt** or **Terminal** and type:
```bash
node --version
```
You should see something like `v20.x.x` or similar. This confirms Node.js is installed!

---

## 📥 Step 2: Download the OSC Electron App

1. Download the **electron-osc-app.zip** file from this website
2. Extract the ZIP file to a folder on your computer (e.g., `Documents/OSC-App`)
3. Remember where you saved it!

---

## ▶️ Step 3: Run the OSC Electron App

### Windows:
1. Open **File Explorer** and navigate to the folder where you extracted the app
2. Look for a file called **`start-osc-app.bat`** or **`index.html`**
3. Double-click the batch file to start the app

**OR** use Command Prompt:
1. Press **Windows Key + R**, type `cmd`, and press Enter
2. Navigate to your app folder:
   ```bash
   cd "C:\Path\To\Your\OSC-App"
   ```
3. Run the app:
   ```bash
   node index.js
   ```

### Mac:
1. Open **Terminal** (Applications > Utilities > Terminal)
2. Navigate to your app folder:
   ```bash
   cd ~/Documents/OSC-App
   ```
3. Run the app:
   ```bash
   node index.js
   ```

---

## 🔧 Troubleshooting

### "node is not recognized as an internal or external command"
- **Solution**: Node.js is not installed or not added to your PATH. Reinstall Node.js and make sure "Add to PATH" is checked during installation.

### "Cannot find module"
- **Solution**: You may need to install dependencies. In the app folder, run:
  ```bash
  npm install
  ```

### App won't start
- **Solution**: Make sure you extracted the ZIP file completely and didn't just open it. Right-click > Extract All.

---

## 💡 Need More Help?

- **Node.js Documentation**: https://nodejs.org/docs/
- **Download Node.js**: https://nodejs.org/
- **Video Tutorials**: Search YouTube for "How to install Node.js"

---

## 📋 Quick Checklist

- [ ] Downloaded and installed Node.js from nodejs.org
- [ ] Restarted computer after Node.js installation
- [ ] Verified Node.js installation with `node --version`
- [ ] Downloaded and extracted electron-osc-app.zip
- [ ] Ran the app using the batch file or command prompt

---

**Ready to go!** Once Node.js is installed and the app is extracted, you're all set to run the OSC Electron App. 🎉

