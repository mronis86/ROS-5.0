const assert = require('assert');
const {
  isElevenLabsConfigured,
  elevenLabsStatusPayload,
  mapVoiceRow,
  getElevenLabsApiBase,
  parseSpeechRequest,
  normalizeOutputFormat,
} = require('./elevenlabs-vog');

const prevKey = process.env.ELEVENLABS_API_KEY;
const prevAlt = process.env.ELEVEN_LABS_API_KEY;
const prevBase = process.env.ELEVENLABS_API_BASE;

try {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVEN_LABS_API_KEY;
  assert.strictEqual(isElevenLabsConfigured(), false);
  assert.strictEqual(elevenLabsStatusPayload().configured, false);
  assert.ok(!('apiKey' in elevenLabsStatusPayload()));

  process.env.ELEVENLABS_API_KEY = 'test-key';
  assert.strictEqual(isElevenLabsConfigured(), true);
  const status = elevenLabsStatusPayload();
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.provider, 'elevenlabs');
  assert.ok(String(status.apiBase).includes('elevenlabs'));
  assert.ok(!JSON.stringify(status).includes('test-key'));

  process.env.ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/';
  assert.strictEqual(getElevenLabsApiBase(), 'https://api.elevenlabs.io');

  const mapped = mapVoiceRow({
    voice_id: 'abc',
    name: 'Rachel',
    category: 'premade',
    preview_url: 'https://example.com/a.mp3',
    labels: { accent: 'american' },
  });
  assert.deepStrictEqual(mapped, {
    voiceId: 'abc',
    name: 'Rachel',
    category: 'premade',
    description: null,
    previewUrl: 'https://example.com/a.mp3',
    labels: { accent: 'american' },
  });
  assert.strictEqual(mapVoiceRow({}), null);
  assert.strictEqual(normalizeOutputFormat('wav_44100'), 'wav_44100');
  assert.strictEqual(normalizeOutputFormat('mp3_44100_128'), 'mp3_44100_128');
  assert.strictEqual(normalizeOutputFormat('nope'), 'mp3_44100_128');
  const speech = parseSpeechRequest({ text: 'Hello stage', voiceId: 'abc' });
  assert.strictEqual(speech.outputFormat, 'mp3_44100_128');
  assert.strictEqual(speech.modelId, 'eleven_multilingual_v2');
  try {
    parseSpeechRequest({ text: '', voiceId: 'abc' });
    assert.fail('expected empty text to throw');
  } catch (err) {
    assert.strictEqual(err.statusCode, 400);
  }

  console.log('elevenlabs-vog ok');
} finally {
  if (prevKey == null) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = prevKey;
  if (prevAlt == null) delete process.env.ELEVEN_LABS_API_KEY;
  else process.env.ELEVEN_LABS_API_KEY = prevAlt;
  if (prevBase == null) delete process.env.ELEVENLABS_API_BASE;
  else process.env.ELEVENLABS_API_BASE = prevBase;
}
