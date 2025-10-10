# 🌐 Local Network Access Setup

## ✅ **Network Access Enabled**

Both the API server and React dev server are now configured to accept connections from other devices on your local network!

## 🔧 **What Was Changed:**

### **1. Vite Dev Server (React App)**
```typescript
// vite.config.ts
server: {
  host: '0.0.0.0', // Listen on all network interfaces ✅
  port: 3003,
  open: true
}
```

### **2. API Server**
```javascript
// api-server.js
server.listen(PORT, '0.0.0.0', () => {
  // Now accessible from network ✅
});
```

## 📱 **How to Access from Other Devices:**

### **Step 1: Find Your Computer's IP Address**

**Windows:**
```bash
# Run the helper script
get-network-ip.bat

# Or manually:
ipconfig
# Look for "IPv4 Address" under your active network adapter
# Example: 192.168.1.100
```

**Mac/Linux:**
```bash
ifconfig
# Look for "inet" under your active network adapter
# Example: 192.168.1.100
```

### **Step 2: Access from Other Devices**

**On the same WiFi network:**

| Service | URL Format | Example |
|---------|------------|---------|
| **React App** | `http://YOUR-IP:3003` | `http://192.168.1.100:3003` |
| **API Server** | `http://YOUR-IP:3001` | `http://192.168.1.100:3001` |
| **Health Check** | `http://YOUR-IP:3001/health` | `http://192.168.1.100:3001/health` |

### **Step 3: Configure Devices**

**On Tablets/Phones:**
1. Open browser
2. Go to `http://YOUR-IP:3003`
3. App should load and connect to API automatically

**On Other Computers:**
1. Open browser
2. Go to `http://YOUR-IP:3003`
3. Full functionality available

## 🎮 **Use Cases:**

### **1. Tablet Control**
- Run Electron app on main computer for OSC
- Use tablet for visual monitoring
- Both stay in sync via WebSocket

### **2. Multi-Operator Setup**
- Operator 1: Main computer with Electron app
- Operator 2: Laptop/tablet for monitoring
- Both see real-time updates

### **3. Remote Monitoring**
- Control room: Main computer
- Stage: Tablet showing current cue
- Green room: Another device showing schedule

## 🔒 **Security Notes:**

### **Firewall:**
You may need to allow these ports through Windows Firewall:
- **Port 3001** - API Server
- **Port 3003** - React Dev Server

**To allow in Windows Firewall:**
1. Open Windows Defender Firewall
2. Click "Advanced settings"
3. Click "Inbound Rules" → "New Rule"
4. Select "Port" → Next
5. Enter port numbers: `3001, 3003`
6. Allow the connection
7. Apply to all profiles (Domain, Private, Public)

### **Network Security:**
- ⚠️ Only accessible on your **local network** (WiFi/LAN)
- ⚠️ Not accessible from the internet (safe)
- ⚠️ Anyone on your WiFi can access (trust your network)

## 🧪 **Testing Network Access:**

### **Test 1: From Your Computer**
```bash
# Should work (localhost)
http://localhost:3001/health
http://localhost:3003
```

### **Test 2: From Another Device**
```bash
# Replace 192.168.1.100 with YOUR IP
http://192.168.1.100:3001/health
http://192.168.1.100:3003
```

**Expected Result:**
- Health check returns: `{"status":"ok","timestamp":"..."}`
- React app loads normally
- Full functionality available

## 🚀 **Quick Start:**

1. **Find your IP:**
   ```bash
   get-network-ip.bat
   ```

2. **Start servers:**
   ```bash
   # Terminal 1: API Server
   node api-server.js
   
   # Terminal 2: React App
   npm start
   ```

3. **Access from other device:**
   ```
   http://YOUR-IP:3003
   ```

## 📊 **Restart Required:**

After making these changes, you need to **restart both servers**:

1. **Stop current servers** (Ctrl+C in terminals)
2. **Restart API server:** `node api-server.js`
3. **Restart React app:** `npm start`
4. **Check console** for network access message

You should see:
```
🚀 API Server running on port 3001
🌐 Network access: http://<your-ip>:3001/health
```

And for Vite:
```
➜  Local:   http://localhost:3003/
➜  Network: http://192.168.1.100:3003/  ← Your network IP!
```

Your local servers are now accessible across your network! 🎉

