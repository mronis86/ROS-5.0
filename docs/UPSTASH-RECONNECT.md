# Reconnect to a Different Upstash Redis Database

The app uses **Upstash Redis** (REST API) to cache graphics data (lower thirds XML/CSV, schedule XML/CSV, custom columns) for fast access by vMix, Singular.Live, etc. If your current Upstash database has stopped working, follow these steps to switch to a new one.

---

## 1. Create a new Upstash Redis database

1. Go to **[Upstash Console](https://console.upstash.com/)** and sign in.
2. Click **Create Database** (or go to Redis → Create).
3. Choose:
   - **Name:** e.g. `ros-graphics-cache` (any name you like).
   - **Region:** Pick one close to your API server (e.g. same region as Railway).
   - **Type:** Redis (standard).
4. Click **Create**.
5. On the database detail page, open the **REST API** section (or **.env** tab).
6. Copy:
   - **UPSTASH_REDIS_REST_URL** — e.g. `https://xxxxx.upstash.io`
   - **UPSTASH_REDIS_REST_TOKEN** — long token string

---

## 2. Set environment variables where the API runs

The API server reads **only these two variables** (see `api-server.js`):

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | REST API URL for your Upstash Redis database |
| `UPSTASH_REDIS_REST_TOKEN` | REST API token (Bearer auth) |

### If the API runs on **Railway**

1. Open your project in [Railway](https://railway.app/).
2. Select the service that runs the API (e.g. `api-server` or your Node app).
3. Go to **Variables**.
4. Add or update:
   - `UPSTASH_REDIS_REST_URL` = paste the new URL (e.g. `https://xxxxx.upstash.io`).
   - `UPSTASH_REDIS_REST_TOKEN` = paste the new token.
5. Save; Railway will redeploy. Wait for the deploy to finish.

### If you run the API **locally**

1. In the project root (or wherever you start `api-server.js`), edit your env file (e.g. `.env` or `.env.local`).
2. Set or replace:
   ```env
   UPSTASH_REDIS_REST_URL=https://your-new-db.upstash.io
   UPSTASH_REDIS_REST_TOKEN=your_new_token_here
   ```
3. Restart the API server.

### If the API runs elsewhere (e.g. Netlify, VPS)

Set the same two variables in that platform’s environment / config so they are available when `api-server.js` runs.

---

## 3. Confirm it’s working

1. After redeploy/restart, open:
   - **`https://YOUR_API_URL/api/test-upstash`**
   - Example: `https://ros-50-production.up.railway.app/api/test-upstash`
2. You should see a JSON response like:
   ```json
   { "ok": true, "message": "Upstash is working correctly!" }
   ```
3. In the app, **Admin** (or status page) should show **Upstash** as configured/OK.

---

## 4. Refill the cache (after switching database)

A **new** Upstash database is empty. The cache is filled when:

- Someone **saves Run of Show** for an event (regenerates lower thirds, schedule, custom columns for that event), or
- You use any flow that writes to Upstash (e.g. lower thirds generation).

So after reconnecting:

- Open an event’s **Run of Show**, make a small edit (or just open and save), or trigger the graphics endpoints; the server will write the new cache keys to the new Upstash DB.
- Then the **Upstash-cached URLs** (shown on Netlify Lower Thirds / Schedule / Custom Columns XML pages) will work for that event.

No code changes are required—only the two environment variables need to point to the new Upstash database.
