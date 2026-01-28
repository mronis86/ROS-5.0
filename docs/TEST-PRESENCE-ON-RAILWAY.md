# Testing Real Presence on Railway

To test the **Viewers** (presence) feature on the **real Railway server** (and production frontend), you need both the **API** and the **frontend** running the new code.

---

## 1. What Gets Deployed Where

| Piece | Where it runs | What to deploy |
|-------|----------------|----------------|
| **API (Socket.IO + presence)** | **Railway** (`api-server.js`) | Push `api-server.js` with presence logic |
| **Frontend (React)** | **Netlify** (or similar) | Push `src/` changes (socket-client, RunOfShowPage) |

Railway runs **only** the API (`node api-server.js`). The React app is built and served by Netlify. Both use the same repo; each has its own deploy.

---

## 2. Push Your Changes

Commit and push **all presence-related changes** to the branch that **Railway** and **Netlify** deploy from (usually `main`):

```bash
git add api-server.js src/services/socket-client.ts src/pages/RunOfShowPage.tsx
git status   # confirm only intended files
git commit -m "Add real presence (viewers) for Run of Show"
git push origin main
```

Include any other modified files if you’ve touched them (e.g. `docs/`, icon tweaks). The important ones for presence are:

- **`api-server.js`** – presence maps, `presenceJoin`, `broadcastPresence`, disconnect cleanup  
- **`src/services/socket-client.ts`** – `sendPresence`, `onPresenceUpdated`  
- **`src/pages/RunOfShowPage.tsx`** – real presence wiring, no mock data  

---

## 3. Wait for Deploys

1. **Railway**  
   - Triggered by the push (if it’s connected to this repo/branch).  
   - Wait until the deployment shows as **success** (often a few minutes).  
   - No new env vars are needed for presence.

2. **Netlify**  
   - Same push triggers a new build/deploy.  
   - Wait until the build finishes and the site is **live**.

---

## 4. Confirm API + Frontend Use Railway

- **Railway API:**  
  - Health check: `https://ros-50-production.up.railway.app/api/health`  
  - Should return `{"status":"ok",...}`.

- **Frontend:**  
  - Your **production** app URL (e.g. `https://your-app.netlify.app`) must use the **Railway** API.  
  - That happens when `VITE_API_BASE_URL` is set to your Railway URL **at build time** (e.g. in Netlify env vars).  
  - The socket-client already defaults to `https://ros-50-production.up.railway.app` in production when `VITE_API_BASE_URL` is not set.

If you’re unsure, check Netlify → Site → Build & deploy → Environment. You want something like:

```bash
VITE_API_BASE_URL=https://ros-50-production.up.railway.app
```

(Use your actual Railway URL if it’s different.)

---

## 5. Local vs Netlify Must Use the **Same** Backend

Presence is **in-memory per API server**. If local dev uses **localhost:3001** and Netlify uses **Railway**, they connect to **different** backends and **will never see each other** in Viewers.

- **To have local + Netlify see each other:** Run local React with **Railway** as the API:
  - Create `.env.local` (or set env before `npm run dev`):
    ```bash
    VITE_API_BASE_URL=https://ros-50-production.up.railway.app
    ```
  - Restart `npm run dev`. Both local and Netlify will hit Railway; presence is shared.
- **Local-only testing:** Use local api-server (`node api-server.js` on 3001). Only clients pointing at localhost will see each other.

---

## 6. How to Test Presence

1. Open your **production** site (Netlify URL) in a browser.  
2. Sign in (email + name).  
3. Go to **Run of Show** and open an event.  
4. Open **Menu (☰) → Viewers (N)**.  
   - With only you: **Viewers (1)** and your name/role in the modal.  
5. In a **second browser** (or incognito):  
   - Sign in as a **different** user (different email/name).  
   - Open the **same** Run of Show event.  
6. In **both** browsers, open **Menu → Viewers (N)** again.  
   - You should see **Viewers (2)** and both users in the list.  
7. Close one tab (or navigate away from Run of Show).  
   - In the other browser, **Viewers** should update to **1** and the list should drop the user who left.

---

## 7. If It Doesn’t Work

- **Viewers always 0 or only you**  
  - Confirm both frontend and API are **deployed** (Railway + Netlify both successful).  
  - Confirm the **production** app is using the **Railway** API (`VITE_API_BASE_URL` and socket default).  
  - **Local + Netlify:** If testing both, **local must use Railway** too (see §5). Otherwise they use different backends and won't see each other.  
  - Try a **hard refresh** (or incognito) to avoid old JS.

- **Socket / connection errors**  
  - Check Railway logs for the API.  
  - Ensure the Railway URL is correct and not blocked by firewall/proxy.

- **CORS / mixed content**  
  - Production site should be **HTTPS**; API should be **HTTPS** as well (Railway provides this).

---

## Summary

1. **Push** presence changes to the branch Railway and Netlify use.  
2. **Wait** for both Railway and Netlify deploys to finish.  
3. **Test** on the **production** frontend (Netlify URL) with two signed-in users on the same Run of Show event, using **Menu → Viewers**.

No new environment variables or config are required beyond what you already use for Railway + Netlify.
