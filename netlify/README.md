# Netlify build configuration

This folder contains the **Netlify build script** used when deploying. The main config file is **`netlify.toml`** at the **repository root** (Netlify reads it from there).

## What runs on deploy

1. **`netlify.toml`** – Netlify reads this at the repo root. It sets:
   - **ignore** – Command that decides whether to skip the build. We use `exit 1` so the build **never** skips.
   - **command** – Runs `bash netlify/build.sh` (this folder’s script).
   - **publish** – Output directory: `dist` (Vite output).

2. **`netlify/build.sh`** – Full build script that:
   - Writes `public/build-info.txt` with build date and commit so each deploy has new content.
   - Builds the portable Electron app in `ros-osc-control` (creates the zip for the OSC modal).
   - Runs `npm ci` and `npm run build` at repo root (Vite build; prebuild zips portable into `public`).

## If Netlify still skips the build

- In Netlify: **Site → Build & deploy → Continuous deployment → Build settings**
  - Ensure **Build command** is set (or leave blank to use `netlify.toml`).
  - Ensure **Skip build** (or “Deploy only”) is **off**.
- Use **Trigger deploy → Clear cache and deploy site** once to clear caches.
- Confirm `netlify.toml` at the **root** of the repo is the one being used (no duplicate in a subdirectory).

## Editing the build

- Change the **command** or **ignore** logic in **`netlify.toml`** (repo root).
- Change the **steps** (order, env, scripts) in **`netlify/build.sh`** (this file).
