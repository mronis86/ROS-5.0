/**
 * Standalone Spout publisher (no Electron). Reads commands on stdin:
 *   INIT\t<senderName>\n
 *   FRAME\t<width>\t<height>\n  + exactly width*height*4 bytes
 * Writes status lines to stdout:
 *   OK\tINIT\n  ERR\t<message>\n  OK\tFRAME\n  ERR\tFRAME\t<message>\n
 */
const { SpoutSender } = require('./spout-sender');

const spout = new SpoutSender();
let buffer = Buffer.alloc(0);
let pendingFrame = null;

function reply(line) {
  process.stdout.write(`${line}\n`);
}

function tryInit(name) {
  const ok = spout.init(String(name || 'ROS LED').trim() || 'ROS LED');
  if (!ok) {
    reply(`ERR\tINIT\t${spout.statusMessage}`);
    return;
  }
  reply('OK\tINIT');
}

function tryFrame(width, height, data) {
  const ok = spout.sendBitmap(data, width, height);
  if (!ok) {
    reply(`ERR\tFRAME\t${spout.lastError || 'send failed'}`);
    return;
  }
  reply('OK\tFRAME');
}

function consume() {
  while (true) {
    if (pendingFrame) {
      const { width, height, byteLen } = pendingFrame;
      if (buffer.length < byteLen) return;
      const data = buffer.subarray(0, byteLen);
      buffer = buffer.subarray(byteLen);
      pendingFrame = null;
      tryFrame(width, height, data);
      continue;
    }

    const nl = buffer.indexOf(0x0a);
    if (nl < 0) return;

    const line = buffer.subarray(0, nl).toString('utf8').trim();
    buffer = buffer.subarray(nl + 1);
    if (!line) continue;

    const parts = line.split('\t');
    const cmd = parts[0];

    if (cmd === 'INIT') {
      tryInit(parts[1]);
    } else if (cmd === 'FRAME') {
      const width = Number(parts[1]);
      const height = Number(parts[2]);
      const byteLen = width * height * 4;
      if (!width || !height || !Number.isFinite(byteLen) || byteLen <= 0) {
        reply('ERR\tFRAME\tinvalid dimensions');
        continue;
      }
      pendingFrame = { width, height, byteLen };
    } else if (cmd === 'SHUTDOWN') {
      spout.dispose();
      reply('OK\tSHUTDOWN');
      process.exit(0);
    }
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consume();
});

process.stdin.on('end', () => {
  spout.dispose();
  process.exit(0);
});

process.on('SIGTERM', () => {
  spout.dispose();
  process.exit(0);
});
