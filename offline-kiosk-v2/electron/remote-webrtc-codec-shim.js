/**
 * Meshcast (and some LiveKit-era clients) call setCodecPreferences with
 * incomplete codec objects (e.g. mimeType/name "H264"). Chromium M124+
 * requires entries from RTCRtpReceiver.getCapabilities — bare names throw:
 *   Invalid codec preferences: invalid codec with name "H264"
 *
 * Injected into the RemoteOp BrowserView main world before page scripts run.
 */
const WEBRTC_CODEC_SHIM = `(() => {
  if (window.__rosWebrtcCodecShim) return;
  window.__rosWebrtcCodecShim = true;
  const proto = window.RTCRtpTransceiver && RTCRtpTransceiver.prototype;
  if (!proto || typeof proto.setCodecPreferences !== 'function') return;
  const original = proto.setCodecPreferences;

  function mimeKind(codecs) {
    const sample = (codecs || []).find((c) => c && (c.mimeType || c.name));
    const raw = String(sample?.mimeType || sample?.name || 'video/H264');
    return raw.toLowerCase().startsWith('audio') ? 'audio' : 'video';
  }

  function normalizeMime(raw, kind) {
    const s = String(raw || '').trim();
    if (!s) return s;
    if (s.includes('/')) return s;
    return kind + '/' + s;
  }

  function sanitize(codecs) {
    if (!Array.isArray(codecs)) return codecs;
    const kind = mimeKind(codecs);
    const supported = (RTCRtpReceiver.getCapabilities(kind) || {}).codecs || [];
    if (!supported.length) return codecs;

    const out = [];
    const seen = new Set();
    const push = (c) => {
      const key = c.mimeType + '|' + (c.sdpFmtpLine || '');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(c);
    };

    for (const want of codecs) {
      const mime = normalizeMime(want?.mimeType || want?.name, kind);
      if (!mime) continue;
      const lower = mime.toLowerCase();
      const exact = supported.filter(
        (s) =>
          s.mimeType.toLowerCase() === lower &&
          (want.sdpFmtpLine == null || want.sdpFmtpLine === '' || want.sdpFmtpLine === s.sdpFmtpLine)
      );
      if (exact.length) exact.forEach(push);
      else supported.filter((s) => s.mimeType.toLowerCase() === lower).forEach(push);
    }

    for (const s of supported) {
      const m = s.mimeType.toLowerCase();
      if (m.includes('rtx') || m.includes('red') || m.includes('ulpfec') || m.includes('flexfec')) {
        push(s);
      }
    }

    const hasPrimary = out.some((c) => {
      const m = c.mimeType.toLowerCase();
      return !m.includes('rtx') && !m.includes('red') && !m.includes('ulpfec') && !m.includes('flexfec');
    });
    if (!hasPrimary) return supported;
    for (const s of supported) push(s);
    return out;
  }

  proto.setCodecPreferences = function setCodecPreferencesPatched(codecs) {
    try {
      return original.call(this, sanitize(codecs));
    } catch (err) {
      try {
        const kind = mimeKind(codecs);
        const supported = (RTCRtpReceiver.getCapabilities(kind) || {}).codecs || [];
        return original.call(this, supported);
      } catch {
        throw err;
      }
    }
  };
})();`;

function injectRemoteWebrtcCodecShim(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  if (webContents.__rosWebrtcCodecShimBound) return;
  webContents.__rosWebrtcCodecShimBound = true;

  const run = async () => {
    if (webContents.isDestroyed()) return;
    try {
      await webContents.executeJavaScript(WEBRTC_CODEC_SHIM, true);
    } catch {
      /* page may be mid-navigation */
    }
  };

  webContents.on('dom-ready', () => {
    void run();
  });
  webContents.on('did-frame-finish-load', (_e, isMainFrame) => {
    if (isMainFrame) void run();
  });
  void run();
}

module.exports = { injectRemoteWebrtcCodecShim, WEBRTC_CODEC_SHIM };
