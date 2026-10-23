const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveScript() {
  const packaged = path.join(process.resourcesPath || '', 'ppt-com.ps1');
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'ppt-com.ps1');
}

const SCRIPT = resolveScript();

function cleanPptError(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/E_FAIL|COMException|InteropServices/i.test(text)) {
    return 'PowerPoint refused the COM call (E_FAIL). Close any PowerPoint dialog or Protected View, then Follow loaded cue again.';
  }
  return text.replace(/[A-Za-z]:\\[^\s:]+\.ps1\s*:/g, '').trim() || text;
}

function runPptCommand(command, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT,
      '-Command',
      command,
      ...extraArgs,
    ];
    const child = spawn('powershell.exe', args, {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const text = stdout.trim();
      if (!text) {
        return reject(new Error(cleanPptError(stderr.trim() || `PowerPoint COM exited ${code}`)));
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error(`PowerPoint COM returned invalid JSON: ${text.slice(0, 200)}`));
      }
    });
  });
}

async function getStatus() {
  return runPptCommand('status');
}

async function getLive() {
  return runPptCommand('live');
}

async function captureStills() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ros-ppt-stills-'));
  try {
    const meta = await runPptCommand('snapshot', ['-OutDir', outDir]);
    if (!meta || meta.ok === false) return meta;
    const slides = Array.isArray(meta.slides) ? meta.slides : meta.slides ? [meta.slides] : [];
    const withImages = slides.map((slide) => {
      const file = path.join(outDir, slide.fileName || `${slide.pptSlideId}.jpg`);
      let imageBase64 = '';
      try {
        imageBase64 = fs.readFileSync(file).toString('base64');
      } catch {
        imageBase64 = '';
      }
      return {
        pptSlideId: String(slide.pptSlideId),
        slideIndex: Number(slide.slideIndex),
        title: slide.title || '',
        imageBase64,
        width: slide.width || 480,
        height: slide.height || 270,
      };
    });
    return {
      ok: true,
      deckName: meta.deckName || '',
      slideCount: withImages.length,
      slides: withImages,
    };
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function extra(flag, value) {
  if (value == null || value === '') return [];
  return [flag, String(value)];
}

async function openDeck(filePath, closePath) {
  return runPptCommand('open', [...extra('-FilePath', filePath), ...extra('-ClosePath', closePath)]);
}

async function swapDeck(filePath, closePath) {
  return runPptCommand('swap', [...extra('-FilePath', filePath), ...extra('-ClosePath', closePath)]);
}

async function closeDeck(filePath) {
  return runPptCommand('close', extra('-FilePath', filePath));
}

async function startShow(filePath) {
  return runPptCommand('startShow', extra('-FilePath', filePath));
}

async function endShow() {
  return runPptCommand('endShow');
}

async function nextSlide() {
  return runPptCommand('next');
}

async function prevSlide() {
  return runPptCommand('prev');
}

async function gotoSlide(slideIndex) {
  return runPptCommand('goto', extra('-SlideIndex', slideIndex));
}

module.exports = {
  getStatus,
  getLive,
  captureStills,
  openDeck,
  swapDeck,
  closeDeck,
  startShow,
  endShow,
  nextSlide,
  prevSlide,
  gotoSlide,
};
