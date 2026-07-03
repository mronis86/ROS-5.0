#!/usr/bin/env node
/**
 * Fail the build if production output contains absolute paths or source maps.
 * Catches Windows/macOS dev machine paths leaking via source maps or debug artifacts.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');
const scanTargets = [
  path.join(distDir, 'index.html'),
  path.join(distDir, 'assets'),
];
const patterns = [
  /sourceMappingURL\s*=/i,
  /C:\\Users\\/i,
  /C:\/Users\//i,
  /\/Users\/[^/]+\//,
  /OneDrive/i,
  /ROS-5\.0[\\/]/i,
  /src[\\/]pages[\\/]/i,
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function collectAppBundleFiles() {
  const files = [];
  for (const target of scanTargets) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isFile()) files.push(target);
    else files.push(...walk(target));
  }
  return files;
}

if (!fs.existsSync(distDir)) {
  console.error('[verify-dist-privacy] dist/ not found — run vite build first.');
  process.exit(1);
}

const bundleFiles = collectAppBundleFiles();
if (bundleFiles.length === 0) {
  console.error('[verify-dist-privacy] No dist/index.html or dist/assets/ found.');
  process.exit(1);
}

const mapFiles = bundleFiles.filter((f) => f.endsWith('.map'));
if (mapFiles.length > 0) {
  console.error('[verify-dist-privacy] Source map files must not be published in app bundles:');
  for (const file of mapFiles) console.error('  ', path.relative(distDir, file));
  process.exit(1);
}

const textExtensions = new Set(['.js', '.css', '.html']);
const hits = [];

for (const file of bundleFiles) {
  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext)) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      hits.push({ file: path.relative(distDir, file), pattern: pattern.toString() });
      break;
    }
  }
}

if (hits.length > 0) {
  console.error('[verify-dist-privacy] Sensitive paths or source map references found in dist/:');
  for (const hit of hits) console.error(`  ${hit.file} (${hit.pattern})`);
  process.exit(1);
}

console.log('[verify-dist-privacy] OK — no source maps or absolute paths in dist/');
