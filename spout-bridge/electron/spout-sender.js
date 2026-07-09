const fs = require('fs');
const path = require('path');

// Vtable indices from SpoutLibrary.h v2.007.017 (UnveilStudio/SPOUT2ForPython spout/_lib.py)
const V_SET_SENDER_NAME = 0;
const V_SET_SENDER_FORMAT = 1;
const V_RELEASE_SENDER = 2;
const V_SEND_IMAGE = 5;
const V_IS_INITIALIZED = 6;
const V_SET_CPU_SHARE = 137;
const V_SET_SHARE_MODE = 134;
const V_OPEN_DX11 = 167;
const V_CLOSE_OPENGL = 152;
const V_RELEASE = 171;

const GL_RGBA = 0x1908;
const GL_BGRA = 0x80e1;
const SHARE_MODE_CPU = 2;

function resolveDllPath() {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, 'vendor', 'SpoutLibrary.dll')
      : null,
    path.join(__dirname, '..', 'vendor', 'SpoutLibrary.dll'),
    path.join(path.dirname(process.execPath), 'vendor', 'SpoutLibrary.dll'),
    path.join(path.dirname(process.execPath), 'SpoutLibrary.dll'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function hwndFromBrowserWindow(win) {
  if (!win || win.isDestroyed()) return null;
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 4) return null;
    if (buf.length >= 8) {
      return buf.readBigUInt64LE(0);
    }
    return BigInt(buf.readUInt32LE(0));
  } catch {
    return null;
  }
}

class SpoutSender {
  constructor() {
    this.koffi = null;
    this.handle = null;
    this.dllPath = resolveDllPath();
    this.sendImageFn = null;
    this.setSenderNameFn = null;
    this.setSenderFormatFn = null;
    this.setShareModeFn = null;
    this.setCpuShareFn = null;
    this.releaseSenderFn = null;
    this.openDx11Fn = null;
    this.isInitializedFn = null;
    this.releaseFn = null;
    this.name = 'ROS LED';
    this.ready = false;
    this.initFailed = false;
    this.lastError = null;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.sendOkCount = 0;
    this.sendFailCount = 0;
  }

  get isAvailable() {
    return !!this.dllPath;
  }

  get isPublishing() {
    if (!this.ready || !this.isInitializedFn) return false;
    try {
      return !!this.isInitializedFn(this.handle);
    } catch {
      return false;
    }
  }

  get statusMessage() {
    if (!this.dllPath) {
      return 'SpoutLibrary.dll not found — copy it to spout-bridge/vendor/ (see vendor/README.md)';
    }
    if (this.lastError) return this.lastError;
    if (this.ready && this.isPublishing) return 'Spout sender publishing';
    if (this.ready) return 'Spout ready (waiting for first frame)';
    if (this.initFailed) return 'Spout init failed';
    return 'Spout DLL loaded';
  }

  _bindVtableFn(handle, index, retType, argTypes) {
    const vtblPtr = this.koffi.decode(handle, 'void *');
    const slots = this.koffi.decode(vtblPtr, `void *[${index + 1}]`);
    const fnPtr = slots[index];
    if (!fnPtr) {
      throw new Error(`Spout vtable slot ${index} is null`);
    }
    const proto = this.koffi.proto(retType, ['void *', ...argTypes]);
    return this.koffi.decode(fnPtr, proto);
  }

  _bindApi() {
    if (this.handle) return true;
    if (!this.dllPath) {
      this.lastError = 'SpoutLibrary.dll missing';
      return false;
    }

    // eslint-disable-next-line global-require
    this.koffi = require('koffi');
    const lib = this.koffi.load(this.dllPath);
    const getSpout = lib.func('void * __cdecl GetSpout()');
    this.handle = getSpout();
    if (!this.handle) {
      this.lastError = 'GetSpout() returned null — check GPU / DirectX 11';
      return false;
    }

    this.setSenderNameFn = this._bindVtableFn(this.handle, V_SET_SENDER_NAME, 'void', ['str']);
    this.setSenderFormatFn = this._bindVtableFn(this.handle, V_SET_SENDER_FORMAT, 'void', ['uint32']);
    this.releaseSenderFn = this._bindVtableFn(this.handle, V_RELEASE_SENDER, 'void', ['uint32']);
    this.sendImageFn = this._bindVtableFn(this.handle, V_SEND_IMAGE, 'bool', [
      'void *',
      'uint32',
      'uint32',
      'uint32',
      'bool',
    ]);
    this.isInitializedFn = this._bindVtableFn(this.handle, V_IS_INITIALIZED, 'bool', []);
    this.setShareModeFn = this._bindVtableFn(this.handle, V_SET_SHARE_MODE, 'void', ['int32']);
    this.setCpuShareFn = this._bindVtableFn(this.handle, V_SET_CPU_SHARE, 'void', ['bool']);
    this.openDx11Fn = this._bindVtableFn(this.handle, V_OPEN_DX11, 'bool', ['void *']);
    this.releaseFn = this._bindVtableFn(this.handle, V_RELEASE, 'void', []);
    return true;
  }

  _applyCpuShareMode() {
    try {
      this.setShareModeFn(this.handle, SHARE_MODE_CPU);
    } catch {
      /* ignore */
    }
    try {
      this.setCpuShareFn(this.handle, true);
    } catch {
      /* ignore */
    }
    try {
      this.setSenderFormatFn(this.handle, 0);
    } catch {
      /* ignore */
    }
  }

  init(senderName) {
    if (this.ready) return true;
    if (this.initFailed) return false;

    this.name = String(senderName || 'ROS LED').trim() || 'ROS LED';

    try {
      if (!this._bindApi()) {
        this.initFailed = true;
        return false;
      }

      let dxOk = false;
      try {
        dxOk = !!this.openDx11Fn(this.handle, null);
      } catch {
        dxOk = false;
      }

      if (!dxOk) {
        this.initFailed = true;
        this.lastError = 'OpenDirectX11 failed — check GPU / DirectX 11';
        return false;
      }

      // CPU share mode: SendImage works without an OpenGL context (safe inside Electron).
      this._applyCpuShareMode();

      this.setSenderNameFn(this.handle, this.name);
      this.ready = true;
      this.lastError = null;
      return true;
    } catch (err) {
      this.initFailed = true;
      this.lastError = err.message || String(err);
      this.ready = false;
      return false;
    }
  }

  sendBitmap(buffer, width, height) {
    if (!this.ready || !this.sendImageFn || !buffer) {
      if (!buffer) this.lastError = 'Empty frame buffer';
      return false;
    }

    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));
    const expected = w * h * 4;
    if (!Number.isFinite(expected) || expected <= 0) {
      this.lastError = `Invalid frame size ${w}x${h}`;
      return false;
    }

    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length < expected) {
      this.lastError = `Bitmap size mismatch (${buf.length} bytes, expected ${expected} for ${w}x${h})`;
      return false;
    }

    try {
      if (this.lastWidth !== w || this.lastHeight !== h) {
        if (this.releaseSenderFn) {
          this.releaseSenderFn(this.handle, 0);
        }
        this.setSenderNameFn(this.handle, this.name);
        this._applyCpuShareMode();
        this.lastWidth = w;
        this.lastHeight = h;
      }

      const pixelBuf = buf.subarray(0, expected);
      const pixels = this.koffi.as(pixelBuf, 'void *');
      // bitmap-utils converts Electron BGRA → RGBA; CPU share mode needs GL_RGBA
      const ok = !!this.sendImageFn(this.handle, pixels, w, h, GL_RGBA, false);
      if (ok) {
        this.lastError = null;
        this.sendOkCount += 1;
        return true;
      }

      this.lastError = `SendImage failed for ${w}x${h}`;
      this.sendFailCount += 1;
      return false;
    } catch (err) {
      this.lastError = err.message || String(err);
      return false;
    }
  }

  dispose() {
    try {
      if (this.handle && this.releaseSenderFn) {
        this.releaseSenderFn(this.handle, 0);
      }
      if (this.handle && this.releaseFn) {
        this.releaseFn(this.handle);
      }
    } catch {
      /* ignore cleanup errors */
    }
    this.handle = null;
    this.ready = false;
    this.initFailed = false;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.sendImageFn = null;
  }
}

module.exports = { SpoutSender, resolveDllPath, hwndFromBrowserWindow };
