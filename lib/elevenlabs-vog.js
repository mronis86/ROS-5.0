/**
 * ElevenLabs VOG (text-to-speech) integration.
 * API key lives only in Railway env — never returned to clients.
 */

const ELEVENLABS_DEFAULT_BASE = 'https://api.elevenlabs.io';

function getElevenLabsApiKey() {
  return String(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || '').trim();
}

function getElevenLabsApiBase() {
  const raw = String(process.env.ELEVENLABS_API_BASE || ELEVENLABS_DEFAULT_BASE).trim();
  return (raw || ELEVENLABS_DEFAULT_BASE).replace(/\/+$/, '');
}

function isElevenLabsConfigured() {
  return getElevenLabsApiKey().length > 0;
}

function elevenLabsStatusPayload() {
  return {
    configured: isElevenLabsConfigured(),
    provider: 'elevenlabs',
    // Never include the key. Base is safe public API host for debugging.
    apiBase: getElevenLabsApiBase(),
  };
}

async function elevenLabsFetch(pathname, options = {}) {
  const key = getElevenLabsApiKey();
  if (!key) {
    const err = new Error('ElevenLabs is not configured on this API (set ELEVENLABS_API_KEY on Railway).');
    err.statusCode = 503;
    err.code = 'ELEVENLABS_NOT_CONFIGURED';
    throw err;
  }
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = `${getElevenLabsApiBase()}${path}`;
  const headers = {
    Accept: options.accept || 'application/json',
    'xi-api-key': key,
    ...(options.headers || {}),
  };
  let res;
  try {
    res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: options.signal,
    });
  } catch (err) {
    const wrapped = new Error(`Cannot reach ElevenLabs: ${err.message || err}`);
    wrapped.statusCode = 502;
    wrapped.code = 'ELEVENLABS_UNREACHABLE';
    throw wrapped;
  }
  return res;
}

async function elevenLabsJson(pathname, options = {}) {
  const res = await elevenLabsFetch(pathname, options);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 400) };
    }
  }
  if (!res.ok) {
    const detail =
      (data && (data.detail?.message || data.detail || data.message || data.error)) ||
      `ElevenLabs HTTP ${res.status}`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = 'ELEVENLABS_API_ERROR';
    err.payload = data;
    throw err;
  }
  return data;
}

function mapVoiceRow(row) {
  if (!row || typeof row !== 'object') return null;
  const voiceId = String(row.voice_id || row.voiceId || '').trim();
  if (!voiceId) return null;
  return {
    voiceId,
    name: String(row.name || voiceId).trim(),
    category: row.category != null ? String(row.category) : null,
    description: row.description != null ? String(row.description) : null,
    previewUrl: row.preview_url || row.previewUrl || null,
    labels: row.labels && typeof row.labels === 'object' ? row.labels : {},
  };
}

async function listElevenLabsVoices() {
  // Prefer v2 search (paginated). Fall back to legacy /v1/voices.
  try {
    const page = await elevenLabsJson('/v2/voices?page_size=100&include_total_count=false');
    const voices = (Array.isArray(page?.voices) ? page.voices : [])
      .map(mapVoiceRow)
      .filter(Boolean);
    return {
      voices,
      hasMore: page?.has_more === true,
      nextPageToken: page?.next_page_token || null,
      source: 'v2',
    };
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 405) {
      const legacy = await elevenLabsJson('/v1/voices');
      const voices = (Array.isArray(legacy?.voices) ? legacy.voices : [])
        .map(mapVoiceRow)
        .filter(Boolean);
      return { voices, hasMore: false, nextPageToken: null, source: 'v1' };
    }
    throw err;
  }
}

async function probeElevenLabsConnection() {
  if (!isElevenLabsConfigured()) {
    return { ok: false, configured: false, error: 'ELEVENLABS_API_KEY is not set on Railway.' };
  }
  try {
    // Lightweight authenticated call — confirms key without generating audio.
    const user = await elevenLabsJson('/v1/user');
    const sub = user?.subscription || {};
    return {
      ok: true,
      configured: true,
      characterCount: sub.character_count != null ? Number(sub.character_count) : null,
      characterLimit: sub.character_limit != null ? Number(sub.character_limit) : null,
      tier: sub.tier != null ? String(sub.tier) : null,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err.message || 'ElevenLabs probe failed',
      statusCode: err.statusCode || null,
    };
  }
}

/** Starter-safe default. ElevenLabs: WAV/PCM @ 44.1 kHz needs Pro+; mp3_44100_192 needs Creator+. */
const ALLOWED_OUTPUT_FORMATS = new Set([
  'mp3_22050_32',
  'mp3_24000_48',
  'mp3_44100_32',
  'mp3_44100_64',
  'mp3_44100_96',
  'mp3_44100_128',
  'mp3_44100_192',
  'wav_8000',
  'wav_16000',
  'wav_22050',
  'wav_24000',
  'wav_32000',
  'wav_44100',
  'wav_48000',
]);
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const MAX_VOG_TEXT_CHARS = 5000;

function normalizeOutputFormat(raw) {
  const value = String(raw || DEFAULT_OUTPUT_FORMAT).trim().toLowerCase();
  return ALLOWED_OUTPUT_FORMATS.has(value) ? value : DEFAULT_OUTPUT_FORMAT;
}

function extensionForOutputFormat(outputFormat) {
  const fmt = String(outputFormat || '').toLowerCase();
  if (fmt.startsWith('mp3_')) return 'mp3';
  if (fmt.startsWith('wav_')) return 'wav';
  if (fmt.startsWith('pcm_')) return 'pcm';
  if (fmt.startsWith('opus_')) return 'opus';
  return 'bin';
}

function contentTypeForOutputFormat(outputFormat, fallback) {
  const ext = extensionForOutputFormat(outputFormat);
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'opus') return 'audio/opus';
  return fallback || 'application/octet-stream';
}

function normalizeVoiceSettings(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  if (raw.stability != null && Number.isFinite(Number(raw.stability))) {
    out.stability = Math.min(1, Math.max(0, Number(raw.stability)));
  }
  if (raw.similarity_boost != null && Number.isFinite(Number(raw.similarity_boost))) {
    out.similarity_boost = Math.min(1, Math.max(0, Number(raw.similarity_boost)));
  } else if (raw.similarityBoost != null && Number.isFinite(Number(raw.similarityBoost))) {
    out.similarity_boost = Math.min(1, Math.max(0, Number(raw.similarityBoost)));
  }
  if (raw.style != null && Number.isFinite(Number(raw.style))) {
    out.style = Math.min(1, Math.max(0, Number(raw.style)));
  }
  if (raw.speed != null && Number.isFinite(Number(raw.speed))) {
    out.speed = Math.min(1.2, Math.max(0.7, Number(raw.speed)));
  }
  if (typeof raw.use_speaker_boost === 'boolean') out.use_speaker_boost = raw.use_speaker_boost;
  if (typeof raw.useSpeakerBoost === 'boolean') out.use_speaker_boost = raw.useSpeakerBoost;
  return Object.keys(out).length ? out : undefined;
}

function parseSpeechRequest(body) {
  const text = String(body?.text || '').trim();
  const voiceId = String(body?.voiceId || body?.voice_id || '').trim();
  const modelId = String(body?.modelId || body?.model_id || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
  const outputFormat = normalizeOutputFormat(body?.outputFormat || body?.output_format);
  const voiceSettings = normalizeVoiceSettings(body?.voiceSettings || body?.voice_settings);
  if (!text) {
    const err = new Error('text is required');
    err.statusCode = 400;
    throw err;
  }
  if (text.length > MAX_VOG_TEXT_CHARS) {
    const err = new Error(`text is too long (max ${MAX_VOG_TEXT_CHARS} characters)`);
    err.statusCode = 400;
    throw err;
  }
  if (!voiceId) {
    const err = new Error('voiceId is required');
    err.statusCode = 400;
    throw err;
  }
  return { text, voiceId, modelId, outputFormat, voiceSettings };
}

function safeDownloadBaseName(raw) {
  const base = String(raw || 'vog')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return base || 'vog';
}

async function synthesizeSpeech(input) {
  const { text, voiceId, modelId, outputFormat, voiceSettings } = parseSpeechRequest(input || {});
  if (!isElevenLabsConfigured()) {
    const err = new Error('ElevenLabs is not configured on this API (set ELEVENLABS_API_KEY on Railway).');
    err.statusCode = 503;
    err.code = 'ELEVENLABS_NOT_CONFIGURED';
    throw err;
  }
  const qs = new URLSearchParams({ output_format: outputFormat });
  const payload = { text, model_id: modelId };
  if (voiceSettings) payload.voice_settings = voiceSettings;
  const res = await elevenLabsFetch(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?${qs}`, {
    method: 'POST',
    accept: 'audio/mpeg, audio/wav, audio/*, */*',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    let detail = `ElevenLabs HTTP ${res.status}`;
    try {
      const data = JSON.parse(errText);
      detail =
        data?.detail?.message ||
        (typeof data?.detail === 'string' ? data.detail : null) ||
        data?.message ||
        data?.error ||
        detail;
    } catch {
      if (errText) detail = errText.slice(0, 400);
    }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = 'ELEVENLABS_TTS_ERROR';
    throw err;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) {
    const err = new Error('ElevenLabs returned empty audio');
    err.statusCode = 502;
    throw err;
  }
  return {
    buffer,
    contentType:
      res.headers.get('content-type') || contentTypeForOutputFormat(outputFormat, 'audio/mpeg'),
    outputFormat,
    extension: extensionForOutputFormat(outputFormat),
    modelId,
    voiceId,
    characterCount: text.length,
  };
}

function registerElevenLabsVogRoutes(app, { requireAdminAccess } = {}) {
  app.get('/api/vog/status', (_req, res) => {
    res.json(elevenLabsStatusPayload());
  });

  app.get('/api/vog/voices', async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!isElevenLabsConfigured()) {
        return res.status(503).json({
          error: 'ElevenLabs is not configured. Set ELEVENLABS_API_KEY on the Railway API service.',
          configured: false,
        });
      }
      const pack = await listElevenLabsVoices();
      res.json({
        configured: true,
        voices: pack.voices,
        hasMore: pack.hasMore,
        nextPageToken: pack.nextPageToken,
      });
    } catch (err) {
      console.error('[vog] list voices failed:', err.message || err);
      res.status(err.statusCode || 500).json({
        error: err.message || 'Failed to list ElevenLabs voices',
        configured: isElevenLabsConfigured(),
      });
    }
  });

  async function handleSpeech(req, res, { download }) {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const audio = await synthesizeSpeech(req.body || {});
      const ext = audio.extension || extensionForOutputFormat(audio.outputFormat);
      res.setHeader('Content-Type', audio.contentType || contentTypeForOutputFormat(audio.outputFormat));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-VOG-Format', audio.outputFormat);
      res.setHeader('X-VOG-Characters', String(audio.characterCount));
      if (download) {
        const hint = safeDownloadBaseName(req.body?.fileName || req.body?.filename || 'vog');
        res.setHeader('Content-Disposition', `attachment; filename="${hint}.${ext}"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }
      return res.send(audio.buffer);
    } catch (err) {
      console.error('[vog] speech failed:', err.message || err);
      return res.status(err.statusCode || 500).json({
        error: err.message || 'Failed to generate speech',
        configured: isElevenLabsConfigured(),
      });
    }
  }

  app.post('/api/vog/preview', (req, res) => handleSpeech(req, res, { download: false }));
  app.post('/api/vog/download', (req, res) => handleSpeech(req, res, { download: true }));

  if (typeof requireAdminAccess === 'function') {
    app.get('/api/admin/vog/status', requireAdminAccess, async (_req, res) => {
      try {
        const probe = await probeElevenLabsConnection();
        res.json({ ...elevenLabsStatusPayload(), ...probe });
      } catch (err) {
        res.status(500).json({
          ...elevenLabsStatusPayload(),
          ok: false,
          error: err.message || 'Failed to check ElevenLabs',
        });
      }
    });
  }
}

module.exports = {
  getElevenLabsApiKey,
  getElevenLabsApiBase,
  isElevenLabsConfigured,
  elevenLabsStatusPayload,
  elevenLabsFetch,
  elevenLabsJson,
  listElevenLabsVoices,
  probeElevenLabsConnection,
  synthesizeSpeech,
  parseSpeechRequest,
  normalizeOutputFormat,
  extensionForOutputFormat,
  contentTypeForOutputFormat,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_MODEL_ID,
  MAX_VOG_TEXT_CHARS,
  registerElevenLabsVogRoutes,
  mapVoiceRow,
};
