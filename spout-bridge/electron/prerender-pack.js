const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function loadManifest(packPath) {
  const root = path.resolve(String(packPath || '').trim());
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${root}`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { root, manifest: raw, manifestPath };
}

/** Prefer enter clip; fall back to older hold packs. */
function resolvePlayFileUrl(packRoot, cueEntry) {
  const rel = cueEntry?.files?.enter || cueEntry?.files?.hold;
  if (!rel) return null;
  const abs = path.resolve(packRoot, rel);
  if (!fs.existsSync(abs)) return null;
  return pathToFileURL(abs).href;
}

function resolveHoldFileUrl(packRoot, cueEntry) {
  return resolvePlayFileUrl(packRoot, cueEntry);
}

function resolveStillFileUrl(packRoot, cueEntry) {
  const rel = cueEntry?.files?.last;
  if (!rel) return null;
  const abs = path.resolve(packRoot, rel);
  if (!fs.existsSync(abs)) return null;
  return pathToFileURL(abs).href;
}

function findCue(manifest, itemId) {
  const key = String(itemId);
  return manifest?.cues?.[key] || null;
}

module.exports = {
  loadManifest,
  resolvePlayFileUrl,
  resolveHoldFileUrl,
  resolveStillFileUrl,
  findCue,
};
