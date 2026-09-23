#!/usr/bin/env node
/**
 * Bump ROS calendar version: V{YY}.{M}.{D}.{Letter}{Cycle}
 * Same calendar day → next letter (A1→B1…Z1→A2). New day → reset to A1.
 *
 * Usage: npm run version:bump
 * Optional: node scripts/bump-ros-version.mjs --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'src', 'ros-version.json');

function todayLocalYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { ymd: `${y}-${m}-${day}`, date: d };
}

function suffix(seq) {
  const n = Math.max(1, Math.floor(seq));
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  const cycle = Math.floor((n - 1) / 26) + 1;
  return `${letter}${cycle}`;
}

function formatVersion(date, seq) {
  const yy = String(date.getFullYear()).slice(-2);
  const m = date.getMonth() + 1;
  const day = date.getDate();
  return `V${yy}.${m}.${day}.${suffix(seq)}`;
}

const dryRun = process.argv.includes('--dry-run');
const { ymd, date } = todayLocalYmd();

let prev = { version: '', date: '', seq: 0 };
if (fs.existsSync(filePath)) {
  try {
    prev = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    /* start fresh */
  }
}

let seq;
if (prev.date === ymd && Number(prev.seq) >= 1) {
  seq = Number(prev.seq) + 1;
} else {
  seq = 1;
}

const next = {
  version: formatVersion(date, seq),
  date: ymd,
  seq,
  note: 'YY.M.D + letter/cycle: A1=1st push that day, Z1=26th, A2=27th. Bump with: npm run version:bump',
};

console.log(`ROS version: ${prev.version || '(none)'} → ${next.version}`);

if (dryRun) {
  console.log('(dry-run — not written)');
  process.exit(0);
}

fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, filePath)}`);
