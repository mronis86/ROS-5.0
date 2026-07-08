#!/usr/bin/env node
/**
 * @deprecated Use scripts/test-admin-notify-email.js --ops instead.
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'test-admin-notify-email.js');
const result = spawnSync(process.execPath, [script, '--ops'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
