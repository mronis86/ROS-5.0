# Netlify + Railway checklist

Use this when you deploy the frontend to Netlify and want to confirm everything works with the Railway API.

## 1. Netlify

- **Build command:** Same as in `netlify.toml` (e.g. `bash netlify/build.sh` or `npm run build`).
- **Publish directory:** `dist`
- **Environment variables (optional but recommended):**
  - `VITE_API_BASE_URL` = `https://ros-50-production.up.railway.app`  
  If you don’t set this, the app uses Railway whenever the hostname is not localhost (so Netlify domain → Railway). Setting it explicitly avoids surprises.

## 2. Railway (API)

- **CORS:** In production, `api-server.js` only allows specific origins for Socket.IO. Update the list to include your real Netlify URL, e.g.:
  - `https://your-site-name.netlify.app`
  - Or your custom domain
- **Env:** Ensure Railway has the same env vars as local (e.g. `NEON_DATABASE_URL`, `UPSTASH_*`, `GOOGLE_SERVICE_ACCOUNT_JSON` if used).

## 3. After deploy – quick checks

1. Open your Netlify app URL (e.g. `https://your-site.netlify.app`).
2. **Health:** Open `https://ros-50-production.up.railway.app/health` in a new tab; you should see `{"status":"healthy",...}`.
3. **Login:** Sign in with an email whose domain is approved (or with an empty approved list). Should succeed without “failed to fetch”.
4. **Event list:** Events should load from Neon via Railway.
5. **Run of Show:** Open an event; timers and real-time updates should work (Socket.IO to Railway).

## 4. If something fails

- **Failed to fetch / CORS:** Add your exact Netlify origin to the Socket.IO `cors.origin` array in `api-server.js` (production list) and redeploy the API on Railway.
- **Auth domain:** Use the Admin page (on Railway or local) to add approved domains; then try login again from Netlify.
