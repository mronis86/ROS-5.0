/**
 * Clean full backup zip of a git branch (default: master).
 * Includes all tracked production source; excludes tests, junk, and demo-only files.
 *
 * Output: ROS-5.0-master-backup-YYYY-MM-DD.zip
 *   └── ROS-5.0-master-backup-YYYY-MM-DD/
 *
 * Usage: node scripts/zip-master-backup.js
 *        node scripts/zip-master-backup.js --branch master
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const branch = process.argv.includes('--branch')
  ? process.argv[process.argv.indexOf('--branch') + 1]
  : 'master';

const dateStr = new Date().toISOString().slice(0, 10);
const folderName = `ROS-5.0-master-backup-${dateStr}`;
const zipName = `${folderName}.zip`;
const zipPath = path.join(projectRoot, zipName);

/** Relative paths (dirs) removed entirely. */
const EXCLUDE_DIRS = [
  'src/showcase',
  'public/showcase',
  'public/electron-osc-app',
];

/** Exact relative file paths removed. */
const EXCLUDE_FILES = new Set([
  'check-data-recovery.js',
  'check-server.js',
  'test-change-log.js',
  'test-csv-endpoint.js',
  'test-local-server.js',
  'test-netlify-functions.html',
  'start-local-test.bat',
  'start-local-test.ps1',
  'src/App.tsx.backup',
  'src/components/DriftDetectorTest.tsx',
  'src/services/backupService.ts.disabled',
  'public/electron-osc-app.zip',
  'public/ROS-Local-Server.zip',
  'public/ROS-Local-Server-NodeJS.zip',
  'public/ROS-Local-Server-Python.zip',
  'ros-osc-control/TEST-NOW.md',
  'ros-osc-control/TESTING-INSTRUCTIONS.md',
  'ros-osc-control/test-osc-commands.js',
  'docs/LOCAL-TESTING-GUIDE.md',
  'docs/TEST-PRESENCE-ON-RAILWAY.md',
  'sql/check-tables.sql',
  'sql/check-timer-state.sql',
  'sql/quick-test-completed-cues.sql',
  'sql/test-completed-cues.sql',
  'sql/test-schema.sql',
]);

function normalizeRel(p) {
  return p.split(path.sep).join('/');
}

function shouldExclude(relPath) {
  const rel = normalizeRel(relPath);

  for (const dir of EXCLUDE_DIRS) {
    if (rel === dir || rel.startsWith(`${dir}/`)) return true;
  }
  if (EXCLUDE_FILES.has(rel)) return true;

  const base = path.basename(rel);
  if (/^test-/i.test(base) && /\.(js|html|ts|tsx)$/i.test(base)) return true;
  if (/^check-/i.test(base) && rel.endsWith('.js') && !rel.includes('/')) return true;
  if (base.includes('date=format') || rel.startsWith('how ')) return true;

  return false;
}

function rmRecursive(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function cleanStaging(stagingDir, removed) {
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const full = path.join(currentDir, entry.name);
      const rel = normalizeRel(path.relative(stagingDir, full));

      if (entry.isDirectory()) {
        if (shouldExclude(rel)) {
          rmRecursive(full);
          removed.push(rel + '/');
        } else {
          walk(full);
        }
      } else if (shouldExclude(rel)) {
        fs.unlinkSync(full);
        removed.push(rel);
      }
    }
  }
  walk(stagingDir);
}

/** Local WIP paths — never overlay into backup. */
const OVERLAY_SKIP = [
  'src/components/dashboard',
  'src/pages/DashboardPage.tsx',
  'src/types/dashboard.ts',
  'src/lib/buildDashboardSummary.ts',
  'src/lib/dashboardUtils.ts',
];

function shouldSkipOverlay(relPath) {
  const rel = normalizeRel(relPath);
  for (const skip of OVERLAY_SKIP) {
    if (rel === skip || rel.startsWith(`${skip}/`)) return true;
  }
  return shouldExclude(rel);
}

function copyPathToStaging(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    rmRecursive(dest);
    fs.cpSync(src, dest, { recursive: true, filter: (p) => {
      const base = path.basename(p);
      if (PRUNE_DIR_NAMES.has(base)) return false;
      return true;
    }});
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/** Apply uncommitted disk changes on top of git archive (launcher fixes, etc.). */
function overlayWorkingTree(stagingDir) {
  const paths = new Set();
  for (const line of execSync('git ls-files', { cwd: projectRoot, encoding: 'utf8' }).split('\n')) {
    if (line) paths.add(line);
  }
  for (const line of execSync('git ls-files --others --exclude-standard', {
    cwd: projectRoot,
    encoding: 'utf8',
  }).split('\n')) {
    if (line) paths.add(line);
  }

  let count = 0;
  for (const rel of paths) {
    if (shouldSkipOverlay(rel)) continue;
    const src = path.join(projectRoot, rel);
    if (!fs.existsSync(src)) continue;
    copyPathToStaging(src, path.join(stagingDir, rel));
    count++;
  }
  return count;
}

function writeManifest(stagingDir, commit, removed, overlayCount) {
  const manifest = `# ROS 5.0 backup — ${dateStr}

Branch: ${branch}
Commit: ${commit}
Generated: ${new Date().toISOString()}

## What this backup contains

A clean snapshot of the repository: application source, API server, migrations,
SQL schemas, docs, Netlify config, Companion modules, offline-show, and tooling.

Same as GitHub master, minus test scripts, demo showcase UI, legacy duplicates,
and accidental junk files.

Includes ${overlayCount} path(s) from your working folder (e.g. uncommitted fixes not yet on ${branch}).

## Cleaned out (${removed.length} paths)

${removed.sort().map((p) => `- ${p}`).join('\n')}

## Not included (never stored in git)

These are not in any git backup. After restoring, you may need to recreate them:

| Item | Why | Restore how |
|------|-----|-------------|
| node_modules/ | Dependencies (gitignored) | npm ci (root, ros-osc-control, companion modules, offline-show/ui) |
| dist/, build/ | Build output (gitignored) | npm run build |
| .env, .env.local | Secrets (gitignored) | Copy from your password manager / Railway / Neon |
| Uncommitted local changes | Dashboard WIP excluded; other fixes overlaid from disk |
| netlify-*-V2/ folders | Local deploy artifacts (gitignored) | Run create-netlify-deploy.bat |
| *.exe | Binary builds (gitignored) | Build ros-osc-control locally |

## Restore

1. Unzip this folder anywhere.
2. npm ci
3. Copy .env from your secrets store.
4. For API: node api-server.js — for app: npm run dev
`;
  fs.writeFileSync(path.join(stagingDir, 'BACKUP-README.txt'), manifest, 'utf8');
}

function zipDirectory(sourceDir, destZip, rootFolderInZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, rootFolderInZip);
    archive.finalize();
  });
}

async function main() {
  let commit = 'unknown';
  try {
    commit = execSync(`git rev-parse --short ${branch}`, {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    console.error(`Branch "${branch}" not found.`);
    process.exit(1);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ros-master-backup-'));
  const extractDir = path.join(staging, 'content');
  fs.mkdirSync(extractDir, { recursive: true });
  const tarPath = path.join(staging, 'archive.tar');

  console.log(`Archiving "${branch}" (${commit})...`);
  execSync(`git archive "${branch}" -o "${tarPath}"`, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  console.log('Extracting...');
  execSync(`tar -xf "${tarPath}" -C "${extractDir}"`, { stdio: 'inherit' });

  const removed = [];
  console.log('Removing tests, showcase demos, junk, and legacy duplicates...');
  cleanStaging(extractDir, removed);

  console.log('Overlaying uncommitted fixes from working folder...');
  const overlayCount = overlayWorkingTree(extractDir);
  cleanStaging(extractDir, removed);

  writeManifest(extractDir, commit, removed, overlayCount);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  console.log(`Creating ${zipName}...`);
  const bytes = await zipDirectory(extractDir, zipPath, folderName);
  rmRecursive(staging);

  const sizeMb = (bytes / (1024 * 1024)).toFixed(2);
  console.log('');
  console.log('========== Done ==========');
  console.log(`File:    ${zipPath}`);
  console.log(`Size:    ${sizeMb} MB`);
  console.log(`Removed: ${removed.length} test/junk paths`);
  console.log(`Overlay: ${overlayCount} paths from working folder`);
  console.log(`Branch:  ${branch} @ ${commit}`);
  console.log('See BACKUP-README.txt inside the zip for full details.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
