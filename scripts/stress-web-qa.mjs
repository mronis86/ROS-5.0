#!/usr/bin/env node
/**
 * Fake audience submissions against the public Web Q&A endpoint.
 *
 * Usage:
 *   node scripts/stress-web-qa.mjs --token <publicToken> [--count 200] [--concurrency 10] [--api https://ros-50-production.up.railway.app]
 *
 * Q&A must be open (a Q&A cue loaded in ROS). Results print ok/fail + elapsed.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    token: { type: 'string' },
    count: { type: 'string', default: '100' },
    concurrency: { type: 'string', default: '8' },
    api: { type: 'string', default: 'https://ros-50-production.up.railway.app' },
    prefix: { type: 'string', default: 'stress' },
  },
});

const token = String(values.token || '').trim();
if (!token) {
  console.error('Missing --token (public Q&A token from /qa/<token>)');
  process.exit(1);
}

const total = Math.max(1, Number(values.count) || 100);
const concurrency = Math.max(1, Math.min(50, Number(values.concurrency) || 8));
const api = String(values.api || '').replace(/\/$/, '');
const prefix = String(values.prefix || 'stress');
const url = `${api}/api/web-qa/public/${encodeURIComponent(token)}/questions`;

let ok = 0;
let fail = 0;
const errors = new Map();
let nextIndex = 0;

async function one(i) {
  const body = {
    author_name: `${prefix}-${i}`,
    body: `Stress test question #${i} at ${new Date().toISOString()} — can the room hear this?`,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      ok += 1;
      return;
    }
    fail += 1;
    const text = await res.text().catch(() => '');
    const key = `${res.status} ${text.slice(0, 120)}`;
    errors.set(key, (errors.get(key) || 0) + 1);
  } catch (err) {
    fail += 1;
    const key = err instanceof Error ? err.message : String(err);
    errors.set(key, (errors.get(key) || 0) + 1);
  }
}

async function worker() {
  while (true) {
    const i = nextIndex;
    nextIndex += 1;
    if (i >= total) return;
    await one(i + 1);
  }
}

const started = Date.now();
console.log(
  `Posting ${total} questions (concurrency ${concurrency}) → ${url}`
);
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const ms = Date.now() - started;
console.log(`Done in ${(ms / 1000).toFixed(2)}s — ok=${ok} fail=${fail} (~${((ok / ms) * 1000).toFixed(1)} ok/s)`);
if (errors.size) {
  console.log('Errors:');
  for (const [msg, n] of errors) console.log(`  ${n}× ${msg}`);
}
process.exit(fail ? 2 : 0);
