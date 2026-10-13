/**
 * Draw a Companion button PNG: large state abbreviation, smaller name, optional flag.
 * Uses a hidden Electron window so we do not add a native image library.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const JURISDICTIONS = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
  ['AS', 'American Samoa'],
  ['GU', 'Guam'],
  ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'],
  ['VI', 'U.S. Virgin Islands'],
];

const BY_NAME = new Map(JURISDICTIONS.map(([code, name]) => [name.toLowerCase(), code]));
const BY_CODE = new Map(JURISDICTIONS.map(([code]) => [code, code]));

/** Companion bank images are 72 wide by 58 tall. */
const BUTTON_W = 72;
const BUTTON_H = 58;

const PAGE = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style><canvas id="c" width="72" height="58"></canvas><canvas id="big" width="72" height="58"></canvas>
<script>
window.drawButton = function (spec) {
  const w = spec.width || 72;
  const h = spec.height || 58;
  const c = document.getElementById('c');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { alpha: true });
  function fitFont(text, start, min, maxWidth) {
    let size = start;
    ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
    while (text && ctx.measureText(text).width > maxWidth && size > min) {
      size -= 1;
      ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
    }
    return size;
  }
  function wrapLines(text, maxWidth, size) {
    ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
    const words = String(text || '').split(/\\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  }
  function drawFlag(img) {
    const ratio = img.width / Math.max(1, img.height);
    const fh = 16;
    const fw = Math.min(w - 8, Math.round(fh * ratio));
    const x = Math.round((w - fw) / 2);
    const y = 2;
    ctx.drawImage(img, x, y, fw, fh);
    if (spec.flagOutline) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, fw - 2, fh - 2);
      ctx.restore();
    }
  }
  function paint(flagImg) {
    ctx.clearRect(0, 0, w, h);
    if (spec.eliminated) {
      ctx.fillStyle = spec.bgColor || '#808080';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const layout = spec.layout || 'abbrev-name';
    const stateName = String(spec.stateName || '');
    const abbrev = String(spec.abbrev || '');
    const name = String(spec.name || '');
    if (layout === 'state-name' || layout === 'flag-state-name') {
      const top = flagImg ? 18 : 4;
      const bottom = h - 4;
      const band = bottom - top;
      let size = layout === 'flag-state-name' ? 13 : 16;
      let lines = wrapLines(stateName, w - 6, size);
      while ((lines.length * (size + 1) > band || lines.some(function (line) {
        ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
        return ctx.measureText(line).width > w - 6;
      })) && size > 9) {
        size -= 1;
        lines = wrapLines(stateName, w - 6, size);
      }
      if (flagImg) drawFlag(flagImg);
      ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
      const block = lines.length * size;
      let y = top + (band - block) / 2 + size / 2;
      lines.forEach(function (line) {
        ctx.fillText(line, w / 2, y);
        y += size + 1;
      });
      return finish();
    }
    if (layout === 'state-student' || layout === 'flag-state-student' || layout === 'state-initial' || layout === 'flag-state-initial') {
      if (flagImg) drawFlag(flagImg);
      const top = flagImg ? 20 : 2;
      let nameSize = 9;
      let nameLines = name ? wrapLines(name, w - 6, nameSize) : [];
      while (name && nameLines.length > 2 && nameSize > 7) {
        nameSize -= 1;
        nameLines = wrapLines(name, w - 6, nameSize);
      }
      if (nameLines.length > 2) nameLines = nameLines.slice(0, 2);
      const nameBlock = name ? nameLines.length * (nameSize + 1) : 0;
      const bandBottom = h - 2 - nameBlock;
      const band = Math.max(8, bandBottom - top);
      let size = flagImg ? 10 : 12;
      let lines = wrapLines(stateName, w - 6, size);
      while ((lines.length * (size + 1) > band || lines.some(function (line) {
        ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
        return ctx.measureText(line).width > w - 6;
      })) && size > 8) {
        size -= 1;
        lines = wrapLines(stateName, w - 6, size);
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 ' + size + 'px "Segoe UI", Arial, sans-serif';
      const block = lines.length * size;
      let y = top + Math.max(0, (band - block) / 2) + size / 2;
      lines.forEach(function (line) {
        ctx.fillText(line, w / 2, y);
        y += size + 1;
      });
      if (name) {
        ctx.font = '600 ' + nameSize + 'px "Segoe UI", Arial, sans-serif';
        let ny = bandBottom + nameSize / 2;
        nameLines.forEach(function (line) {
          ctx.fillText(line, w / 2, ny);
          ny += nameSize + 1;
        });
      }
      return finish();
    }
    if (flagImg) {
      drawFlag(flagImg);
      fitFont(abbrev, 18, 12, w - 8);
      ctx.fillText(abbrev, w / 2, 32);
    } else {
      fitFont(abbrev, 22, 14, w - 8);
      ctx.fillText(abbrev, w / 2, 20);
    }
    let nameSize = flagImg ? 11 : 12;
    ctx.font = '600 ' + nameSize + 'px "Segoe UI", Arial, sans-serif';
    while (name && ctx.measureText(name).width > w - 8 && nameSize > 8) {
      nameSize -= 1;
      ctx.font = '600 ' + nameSize + 'px "Segoe UI", Arial, sans-serif';
    }
    ctx.fillText(name, w / 2, flagImg ? 48 : 42);
    return finish();
  }
  function finish() {
    if (spec.eliminated) {
      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(5, 5);
      ctx.lineTo(w - 5, h - 5);
      ctx.moveTo(w - 5, 5);
      ctx.lineTo(5, h - 5);
      ctx.stroke();
      const label = 'ELIMINATED';
      ctx.font = '700 8px "Segoe UI", Arial, sans-serif';
      const tw = ctx.measureText(label).width;
      const bw = tw + 6;
      const bh = 12;
      const bx = (w - bw) / 2;
      const by = (h - bh) / 2;
      ctx.fillStyle = 'rgba(127, 29, 29, 0.94)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, by + bh / 2);
      ctx.restore();
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        const after = ctx.getImageData(0, 0, w, h).data;
        let clear = 0;
        let ink = 0;
        for (let i = 3; i < after.length; i += 4) {
          if (after[i] === 0) clear += 1;
          else ink += 1;
        }
        resolve({
          dataUrl: c.toDataURL('image/png'),
          width: c.width,
          height: c.height,
          clearPct: Math.round((100 * clear) / (w * h)),
          inkPct: Math.round((100 * ink) / (w * h)),
          stillIn: spec.eliminated !== true,
        });
      }, 250);
    });
  }
  const wantsFlag = spec.layout === 'abbrev-name-flag' || spec.layout === 'flag-state-name' || spec.layout === 'flag-state-student' || spec.layout === 'flag-state-initial' || spec.flag;
  if (!spec.flag || !wantsFlag) return paint(null);
  return new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () { resolve(paint(img)); };
    img.onerror = function () { resolve(paint(null)); };
    img.src = spec.flag;
  });
};
window.enlargePng = function (dataUrl) {
  return new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () {
      const scale = 4;
      const c = document.getElementById('big');
      c.width = img.width * scale;
      c.height = img.height * scale;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = function () { resolve(''); };
    img.src = dataUrl;
  });
};
</script>`;

let windowPromise = null;
let painterChain = Promise.resolve();
const flagCache = new Map();

function withPainter(work) {
  const run = painterChain.then(work, work);
  painterChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function stateAbbrev(state) {
  const raw = String(state || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/\./g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    key === 'dc' ||
    key === 'd c' ||
    key === 'washington dc' ||
    key === 'washington d c' ||
    key === 'wash dc' ||
    key === 'district of columbia' ||
    key.includes('columbia')
  ) {
    return 'DC';
  }
  const byName = BY_NAME.get(raw.toLowerCase()) || BY_NAME.get(key);
  if (byName) return byName;
  const upper = raw.toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  return upper.slice(0, 2);
}

function ensureWindow() {
  if (windowPromise) return windowPromise;
  windowPromise = new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 160,
      height: 160,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.webContents.once('did-finish-load', () => resolve(win));
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      windowPromise = null;
      reject(new Error(`Button painter failed to load (${code} ${desc})`));
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  });
  return windowPromise;
}

const FLAG_URLS = {
  DC: [
    'https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_the_District_of_Columbia.svg?width=320',
    'https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Washington,_D.C.svg?width=320',
  ],
  AS: ['https://flagcdn.com/w320/as.png'],
  GU: ['https://flagcdn.com/w320/gu.png'],
  MP: ['https://flagcdn.com/w320/mp.png'],
  PR: ['https://flagcdn.com/w320/pr.png'],
  VI: ['https://flagcdn.com/w320/vi.png'],
};

const MIN_FLAG_BYTES = 200;

function flagUrls(code) {
  if (FLAG_URLS[code]) return FLAG_URLS[code];
  const name = (JURISDICTIONS.find(([c]) => c === code) || [])[1];
  const urls = [`https://flagcdn.com/w320/us-${code.toLowerCase()}.png`];
  if (name) {
    urls.push(
      `https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_${encodeURIComponent(name.replace(/ /g, '_'))}.svg?width=320`
    );
  }
  return urls;
}

function isPng(buf) {
  return buf && buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';
}

function flagPath(code) {
  return path.join(app.getPath('userData'), 'state-flags', `${code.toLowerCase()}-w320.png`);
}

async function flagDataUrl(code) {
  const key = String(code || '').toUpperCase();
  if (!key) return null;
  if (flagCache.get(key)) return flagCache.get(key);
  const file = flagPath(key);
  try {
    if (fs.existsSync(file)) {
      const cached = fs.readFileSync(file);
      if (isPng(cached) && cached.length > MIN_FLAG_BYTES) {
        const url = `data:image/png;base64,${cached.toString('base64')}`;
        flagCache.set(key, url);
        return url;
      }
      fs.unlinkSync(file);
    }
  } catch {
    /* download a fresh file */
  }
  for (const url of flagUrls(key)) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ROS-Civics-Bridge/1.0', Accept: 'image/png,*/*' },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isPng(buf) || buf.length < MIN_FLAG_BYTES) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      flagCache.set(key, dataUrl);
      return dataUrl;
    } catch {
      /* try the next address */
    }
  }
  return null;
}

async function renderButtonPng(spec) {
  const width = spec.width || BUTTON_W;
  const height = spec.height || BUTTON_H;
  const abbrev = stateAbbrev(spec.state);
  const name = String(spec.name || '').trim();
  const stateName = String(spec.stateLabel || spec.state || '').trim();
  const layout = spec.layout || (spec.flag ? 'abbrev-name-flag' : 'abbrev-name');
  const wantsFlag = layout === 'abbrev-name-flag' || layout === 'flag-state-name' || layout === 'flag-state-student' || layout === 'flag-state-initial';
  const flag = wantsFlag ? await flagDataUrl(abbrev) : null;
  if (wantsFlag && !flag) {
    throw new Error(`The ${abbrev || stateName} flag could not be downloaded, so this picture would be missing its flag.`);
  }
  const eliminated = spec.eliminated === true;
  const flagOutline = spec.flagOutline === true;
  const bgColor = spec.bgColor || '#808080';
  return withPainter(async () => {
    const win = await ensureWindow();
    const drawn = await win.webContents.executeJavaScript(
      `window.drawButton(${JSON.stringify({
        width,
        height,
        layout,
        abbrev,
        stateName,
        name,
        flag,
        eliminated,
        flagOutline,
        bgColor,
      })})`
    );
    const dataUrl = drawn && typeof drawn.dataUrl === 'string' ? drawn.dataUrl : '';
    if (!dataUrl.startsWith('data:image/png')) {
      throw new Error('Button picture was not created');
    }
    if (drawn.width !== width || drawn.height !== height) {
      throw new Error(`Picture came out ${drawn.width}x${drawn.height} instead of ${width}x${height}.`);
    }
    if ((Number(drawn.inkPct) || 0) < 2) {
      throw new Error('Picture came out empty.');
    }
    if (!eliminated && (Number(drawn.clearPct) || 0) < 30) {
      throw new Error(`Still-in picture is only ${Number(drawn.clearPct) || 0}% transparent. It should have no background.`);
    }
    return dataUrl;
  });
}

let pictureDirOverride = '';

function setButtonPictureDir(dir) {
  const raw = String(dir || '').trim();
  pictureDirOverride = raw && path.isAbsolute(raw) ? path.normalize(raw) : '';
}

function buttonPictureDir() {
  if (pictureDirOverride) return pictureDirOverride;
  const base = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
  return path.join(base, 'button-pictures');
}

function ensureButtonPictureDir() {
  const dir = buttonPictureDir();
  fs.mkdirSync(dir, { recursive: true });
  const note = path.join(dir, 'README.txt');
  if (!fs.existsSync(note)) {
    fs.writeFileSync(
      note,
      [
        'Transparent Companion button pictures. 01.png is button 1.',
        'Companion paints the button color behind these files.',
        '',
      ].join('\r\n')
    );
  }
  return dir;
}

async function saveButtonPictures(dataUrls) {
  const dir = buttonPictureDir();
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set(['README.txt']);
  const note = [
    'These are the live Companion button pictures.',
    'Pictures have no background color. Companion supplies the button color.',
    '01.png is button 1 at the real 72x58 size. 01-large.png is the same picture, easier to look at.',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(dir, 'README.txt'), note);
  for (let i = 0; i < dataUrls.length; i += 1) {
    const dataUrl = dataUrls[i];
    const name = `${String(i + 1).padStart(2, '0')}.png`;
    const large = `${String(i + 1).padStart(2, '0')}-large.png`;
    if (!dataUrl || !String(dataUrl).startsWith('data:image/png')) {
      for (const file of [name, large]) {
        const target = path.join(dir, file);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      continue;
    }
    keep.add(name);
    keep.add(large);
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    try {
      const win = await ensureWindow();
      const bigger = await win.webContents.executeJavaScript(
        `window.enlargePng(${JSON.stringify(dataUrl)})`
      );
      if (typeof bigger === 'string' && bigger.startsWith('data:image/png')) {
        fs.writeFileSync(path.join(dir, large), Buffer.from(bigger.split(',')[1], 'base64'));
      }
    } catch {
      /* The small picture is already saved. */
    }
  }
  for (const file of fs.readdirSync(dir)) {
    if (/^\d\d(-large)?\.png$/i.test(file) && !keep.has(file)) fs.unlinkSync(path.join(dir, file));
  }
  return dir;
}

function decodeRgba(buf) {
  if (!buf || buf.length < 26 || buf.toString('ascii', 1, 4) !== 'PNG' || buf[25] !== 6) return null;
  const zlib = require('zlib');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  let offset = 8;
  const idat = [];
  while (offset + 8 < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(buf.subarray(offset + 8, offset + 8 + len));
    if (type === 'IEND') break;
    offset += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = rgba.subarray(y * stride, y * stride + stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? cur[i - 4] : 0;
      const up = prev[i];
      const upLeft = i >= 4 ? prev[i - 4] : 0;
      if (filter === 0) cur[i] = src[i];
      else if (filter === 1) cur[i] = (src[i] + left) & 255;
      else if (filter === 2) cur[i] = (src[i] + up) & 255;
      else if (filter === 3) cur[i] = (src[i] + Math.floor((left + up) / 2)) & 255;
      else cur[i] = (src[i] + paeth(left, up, upLeft)) & 255;
    }
    prev = Buffer.from(cur);
  }
  return { width, height, rgba };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodeRgbaPng(width, height, rgba) {
  const zlib = require('zlib');
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function isOldFill(r, g, b) {
  const fills = [
    [30, 58, 95],
    [22, 163, 74],
    [63, 63, 70],
    [15, 23, 42],
  ];
  return fills.some(
    ([R, G, B]) => Math.abs(r - R) <= 8 && Math.abs(g - G) <= 8 && Math.abs(b - B) <= 8
  );
}

function isBakedBlack(r, g, b, a) {
  if (a < 180) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 45 && max - min < 18;
}

/** Non-eliminated pictures stay transparent. A baked black fill is removed. Eliminated pictures keep their grey. */
function prepareButtonPicture(dataUrl, eliminated) {
  if (!dataUrl || eliminated) return dataUrl;
  const buf = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
  const decoded = decodeRgba(buf);
  if (!decoded) return dataUrl;
  const { rgba, width, height } = decoded;
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  if (!corners.every((i) => isBakedBlack(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]))) {
    return dataUrl;
  }
  for (let i = 0; i < rgba.length; i += 4) {
    if (!isBakedBlack(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])) continue;
    rgba[i] = 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 0;
  }
  const out = encodeRgbaPng(width, height, rgba);
  return `data:image/png;base64,${out.toString('base64')}`;
}

function scrubOldFills(dataUrl) {
  const buf = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
  const decoded = decodeRgba(buf);
  if (!decoded) return dataUrl;
  const { rgba } = decoded;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (isOldFill(rgba[i], rgba[i + 1], rgba[i + 2])) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    }
  }
  const out = encodeRgbaPng(decoded.width, decoded.height, rgba);
  return `data:image/png;base64,${out.toString('base64')}`;
}

async function saveOneButtonPicture(index, dataUrl, dirOverride) {
  const dir = dirOverride || buttonPictureDir();
  fs.mkdirSync(dir, { recursive: true });
  const note = path.join(dir, 'README.txt');
  if (!fs.existsSync(note)) {
    fs.writeFileSync(
      note,
      [
        'These are the pictures uploaded to Companion.',
        'They have no green or blue background. Companion paints its own button color behind them.',
        '01.png is button 1. The bridge uploads this file, not a second colored copy.',
        '',
      ].join('\r\n')
    );
  }
  const name = `${String(index + 1).padStart(2, '0')}.png`;
  const large = `${String(index + 1).padStart(2, '0')}-large.png`;
  if (!dataUrl || !String(dataUrl).startsWith('data:image/png')) {
    for (const file of [name, large]) {
      const target = path.join(dir, file);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    return dir;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  const largeFile = path.join(dir, large);
  if (fs.existsSync(largeFile)) fs.unlinkSync(largeFile);
  return file;
}

function readButtonPicture(index, dirOverride) {
  const file = path.join(dirOverride || buttonPictureDir(), `${String(index + 1).padStart(2, '0')}.png`);
  if (!fs.existsSync(file)) return '';
  const buf = fs.readFileSync(file);
  if (!isPng(buf)) return '';
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function transparencyReport(dataUrl) {
  const buf = Buffer.from(String(dataUrl || '').split(',')[1] || '', 'base64');
  const decoded = decodeRgba(buf);
  if (!decoded) return { ok: false, clearPct: 0, oldFill: 0, message: 'not an RGBA png' };
  const { width, height, rgba } = decoded;
  let clear = 0;
  let oldFill = 0;
  const total = width * height;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) clear += 1;
    else if (isOldFill(rgba[i], rgba[i + 1], rgba[i + 2])) oldFill += 1;
  }
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + (width - 1)) * 4];
  const cornersClear = corners.every((i) => rgba[i + 3] === 0);
  const clearPct = total ? Math.round((100 * clear) / total) : 0;
  const ok = cornersClear && oldFill === 0 && clear / total >= 0.45;
  const message = ok
    ? `${clearPct}% transparent`
    : `not transparent (${clearPct}% clear, ${oldFill} old-color pixels, corners ${cornersClear ? 'clear' : 'filled'})`;
  return { ok, clearPct, oldFill, message };
}

function pictureStats(dataUrl) {
  const buf = Buffer.from(String(dataUrl || '').split(',')[1] || '', 'base64');
  let decoded = null;
  try {
    decoded = decodeRgba(buf);
  } catch {
    decoded = null;
  }
  if (!decoded) return null;
  const { width, height, rgba } = decoded;
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) clear += 1;
  return { width, height, clearPct: Math.round((100 * clear) / Math.max(1, width * height)) };
}

function pngCornerIsClear(dataUrl) {
  return transparencyReport(dataUrl).ok;
}

let blankPng = '';
function blankButtonPng() {
  if (blankPng) return blankPng;
  const png = encodeRgbaPng(BUTTON_W, BUTTON_H, Buffer.alloc(BUTTON_W * BUTTON_H * 4));
  blankPng = `data:image/png;base64,${png.toString('base64')}`;
  return blankPng;
}

module.exports = {
  renderButtonPng,
  stateAbbrev,
  saveButtonPictures,
  saveOneButtonPicture,
  readButtonPicture,
  buttonPictureDir,
  ensureButtonPictureDir,
  setButtonPictureDir,
  pngCornerIsClear,
  transparencyReport,
  pictureStats,
  prepareButtonPicture,
  blankButtonPng,
};
