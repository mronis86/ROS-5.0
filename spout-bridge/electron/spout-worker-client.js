const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveWorkerSpawn() {
  const workerPath = path.join(__dirname, 'spout-worker.js');
  const nodeCandidates = [
    process.env.npm_node_execpath,
    path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'node.cmd' : 'node'),
    'node',
  ].filter(Boolean);

  for (const bin of nodeCandidates) {
    try {
      if (bin === 'node' || fs.existsSync(bin)) {
        return { bin, args: [workerPath], env: process.env };
      }
    } catch {
      /* try next */
    }
  }

  return {
    bin: process.execPath,
    args: [workerPath],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  };
}

class SpoutWorkerClient {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.initFailed = false;
    this.lastError = null;
    this.isPublishing = false;
    this.sendOkCount = 0;
    this.sendFailCount = 0;
    this._stdoutBuf = '';
    this._latestFrame = null;
    this._writerBusy = false;
    this._frameDropped = 0;
  }

  get statusMessage() {
    if (this.initFailed) return this.lastError || 'Spout worker failed';
    if (this.lastError) return this.lastError;
    if (this.ready && this.isPublishing) return 'Spout sender publishing';
    if (this.ready) return 'Spout ready (waiting for first frame)';
    return 'Spout worker starting…';
  }

  _handleLine(line) {
    const parts = line.split('\t');
    const kind = parts[0];
    const cmd = parts[1];
    if (kind === 'OK' && cmd === 'INIT') {
      this.ready = true;
      this.initFailed = false;
      this.lastError = null;
      return;
    }
    if (kind === 'ERR' && cmd === 'INIT') {
      this.initFailed = true;
      this.lastError = parts.slice(2).join('\t') || 'Init failed';
      return;
    }
    if (kind === 'OK' && cmd === 'FRAME') {
      this.sendOkCount += 1;
      this.isPublishing = true;
      this.lastError = null;
      return;
    }
    if (kind === 'ERR' && cmd === 'FRAME') {
      this.sendFailCount += 1;
      this.lastError = parts.slice(2).join('\t') || 'Frame send failed';
    }
  }

  _onStdout(chunk) {
    this._stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = this._stdoutBuf.indexOf('\n')) >= 0) {
      const line = this._stdoutBuf.slice(0, idx).trim();
      this._stdoutBuf = this._stdoutBuf.slice(idx + 1);
      if (line) this._handleLine(line);
    }
  }

  start(senderName) {
    return new Promise((resolve, reject) => {
      if (this.proc) {
        resolve(this.ready);
        return;
      }

      const launch = resolveWorkerSpawn();
      this.proc = spawn(launch.bin, launch.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: launch.env,
      });

      this.proc.stdout.on('data', (d) => this._onStdout(d));
      this.proc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.warn('[spout-worker]', msg);
      });
      this.proc.on('error', (err) => {
        this.initFailed = true;
        this.lastError = err.message;
        reject(err);
      });
      this.proc.on('exit', (code) => {
        if (code && code !== 0) {
          this.lastError = `Spout worker exited (${code})`;
        }
        this.proc = null;
        this.ready = false;
      });

      const name = String(senderName || 'ROS LED').trim() || 'ROS LED';
      this.proc.stdin.write(`INIT\t${name}\n`);

      const deadline = Date.now() + 8000;
      const waitInit = () => {
        if (this.ready) {
          resolve(true);
          return;
        }
        if (this.initFailed) {
          resolve(false);
          return;
        }
        if (Date.now() > deadline) {
          this.initFailed = true;
          this.lastError = 'Spout worker init timeout';
          resolve(false);
          return;
        }
        setTimeout(waitInit, 50);
      };
      waitInit();
    });
  }

  sendBitmap(buffer, width, height) {
    if (!this.proc || !this.ready) return false;
    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));
    const expected = w * h * 4;
    const src = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (!w || !h || src.length < expected) {
      this.lastError = `Invalid frame ${w}x${h} (${src.length} bytes)`;
      return false;
    }

    if (this._writerBusy) {
      this._frameDropped += 1;
    }

    if (!this._latestFrame || this._latestFrame.data.length !== expected) {
      this._latestFrame = { width: w, height: h, data: Buffer.alloc(expected), dirty: false };
    }

    src.copy(this._latestFrame.data, 0, 0, expected);
    this._latestFrame.width = w;
    this._latestFrame.height = h;
    this._latestFrame.dirty = true;
    this._kickWriter();
    return true;
  }

  _kickWriter() {
    if (this._writerBusy || !this.proc || !this._latestFrame?.dirty) return;

    this._writerBusy = true;
    const frame = this._latestFrame;
    frame.dirty = false;

    const header = `FRAME\t${frame.width}\t${frame.height}\n`;
    const headerOk = this.proc.stdin.write(header);
    const bodyOk = this.proc.stdin.write(frame.data);

    const release = () => {
      this._writerBusy = false;
      if (this._latestFrame?.dirty) {
        this._kickWriter();
      }
    };

    if (!headerOk || !bodyOk) {
      this.proc.stdin.once('drain', release);
    } else {
      setImmediate(release);
    }
  }

  async stop() {
    if (this.proc?.stdin) {
      try {
        this.proc.stdin.write('SHUTDOWN\n');
      } catch {
        /* ignore */
      }
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.ready = false;
    this.isPublishing = false;
    this._latestFrame = null;
    this._writerBusy = false;
    this._frameDropped = 0;
  }
}

module.exports = { SpoutWorkerClient };
