#!/usr/bin/env bash
# Netlify full build script. Runs on every deploy so the site is always rebuilt.
# This file is run by netlify.toml [build] command. Do not skip steps.

set -e

echo "========== Netlify build started =========="
echo "COMMIT_REF=${COMMIT_REF:-unknown}"
echo "NODE_VERSION=$(node -v 2>/dev/null || echo 'n/a')"

# Write a unique build marker into public/ so the deployed site has new content every time.
# This ensures the publish dir (dist) is replaced, not served from cache.
BUILD_INFO_DIR="public"
mkdir -p "$BUILD_INFO_DIR"
echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BUILD_INFO_DIR/build-info.txt"
echo "commit=${COMMIT_REF:-unknown}" >> "$BUILD_INFO_DIR/build-info.txt"
echo "Wrote $BUILD_INFO_DIR/build-info.txt"

# Clear local caches so we get a full rebuild (optional but helps avoid stale artifacts)
rm -rf node_modules/.cache 2>/dev/null || true
rm -rf dist 2>/dev/null || true

# Step 1: Build the portable Electron app (Windows .exe) in ros-osc-control.
# This creates ros-osc-control/dist/ which prebuild will zip into public/.
echo "========== Building portable Electron app (ros-osc-control) =========="
cd ros-osc-control
npm ci
npm run build:portable
cd ..

# Step 2: Install root deps (needed for archiver in zip script).
echo "========== Installing root deps =========="
npm ci

# Step 3: Full Companion module zip (with node_modules, ~18MB) for OSC modal download.
echo "========== Building full Companion module zip =========="
node scripts/zip-companion-module-full.js

# Step 4: Vite build. prebuild zips companion (slim) + python app; Vite copies public/ (including full zip) to dist.
echo "========== Building Vite app =========="
npm run build

echo "========== Netlify build finished =========="
