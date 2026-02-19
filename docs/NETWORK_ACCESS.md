# Accessing the app from another computer on your network

## 1. Use port 3003 (not 3004)

If the app opens on **3004** instead of 3003, something else is already using 3003. The project is set to **strict port 3003**: if 3003 is busy, the dev server will fail instead of switching to 3004.

**Free the ports, then start:**

```bash
npm run free-ports
```

Then in **one terminal**: `npm run api`  
In **another terminal**: `npm start`

You should see the app at **http://localhost:3003** (and in the terminal, a line like “Local: http://192.168.1.233:3003”).

---

## 2. Open from another computer

On the other computer, open in the browser:

**http://192.168.1.233:3003**

(Use your dev PC’s actual IP if different — see step 3.)

Your **.env.local** should have:

```env
VITE_API_BASE_URL=http://192.168.1.233:3001
```

(Again, replace with your dev PC’s IP if needed.) Restart the Vite dev server after changing `.env.local`.

---

## 3. If the other computer can’t connect (“failed to fetch” on login)

The other computer must be able to reach your dev PC’s API on port **3001**. Usually **Windows Firewall** is blocking it.

**Quick test from the other computer:** In the browser open **http://192.168.1.233:3001/health** (use your dev PC’s IP). If you see JSON like `{"status":"healthy"}`, the API is reachable. If the page fails to load, the firewall is blocking port 3001.

**Fix: allow ports 3001 and 3003 (run once as Administrator)**

1. Right-click **PowerShell** → **Run as administrator**.
2. Run:
   ```powershell
   cd "c:\Users\audre\OneDrive\Desktop\ROS-5.0"
   .\scripts\allow-dev-ports-firewall.ps1
   ```
3. Restart the API server if it was already running (`npm run api`).

Or add the rules manually in an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "ROS Dev 3003" -Direction Inbound -LocalPort 3003 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "ROS API 3001" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
```

**Find your PC’s IP:** In PowerShell run `Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' }` and use the LAN address (e.g. 192.168.1.233).
