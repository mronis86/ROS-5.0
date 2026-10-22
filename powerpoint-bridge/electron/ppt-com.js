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
        return reject(new Error(stderr.trim() || `PowerPoint COM exited ${code}`));
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

module.exports = { getStatus, getLive, captureStills };
