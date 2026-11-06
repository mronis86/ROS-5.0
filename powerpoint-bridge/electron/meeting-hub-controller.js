/**
 * Meeting Hub mode — list Hub PowerPoint decks and open them on this PC.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const ppt = require('./ppt-com');
const { httpFetch, fetchMeetingHubDecks } = require('./railway-client');

function safeFileName(name) {
  return String(name || 'deck.pptx')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'deck.pptx';
}

class MeetingHubController {
  constructor() {
    this.config = {};
    this.decks = [];
    this.lastError = '';
    this.lastAction = '';
    this.openPath = '';
    this.openDeckId = '';
  }

  cacheRoot(eventId) {
    return path.join(app.getPath('userData'), 'meeting-hub', String(eventId || 'unknown'));
  }

  get status() {
    return {
      mode: 'meetinghub',
      running: false,
      decks: this.decks,
      openDeckId: this.openDeckId || null,
      openPath: this.openPath || null,
      lastAction: this.lastAction || '',
      error: this.lastError || '',
      message: this.lastAction || '',
    };
  }

  async listDecks(config = {}) {
    this.config = { ...this.config, ...config };
    const eventId = String(this.config.eventId || '').trim();
    if (!eventId) throw new Error('Pick a Meeting Hub event first.');
    const data = await fetchMeetingHubDecks(this.config.apiBaseUrl, this.config.apiToken, eventId);
    this.decks = Array.isArray(data?.decks) ? data.decks : [];
    this.lastError = '';
    this.lastAction = `Loaded ${this.decks.length} Meeting Hub deck(s)`;
    return this.status;
  }

  async downloadFile(url, dest) {
    const res = await httpFetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    try {
      fs.unlinkSync(`${dest}:Zone.Identifier`);
    } catch {
      /* no MOTW stream */
    }
    return dest;
  }

  async openDeckById(deckId, config = {}) {
    this.config = { ...this.config, ...config };
    ppt.setOptions({
      focusTarget: this.config.focusTarget,
      forceEditMode: this.config.forceEditMode,
    });
    const eventId = String(this.config.eventId || '').trim();
    if (!eventId) throw new Error('Pick a Meeting Hub event first.');

    let decks = this.decks;
    if (!decks.length) {
      await this.listDecks(this.config);
      decks = this.decks;
    }
    let deck = decks.find((d) => String(d.id) === String(deckId));
    if (!deck?.url) {
      await this.listDecks(this.config);
      deck = this.decks.find((d) => String(d.id) === String(deckId));
    }
    if (!deck?.url) throw new Error('Deck not found or no download URL.');

    const fileName = safeFileName(deck.name || deck.original_name || `${deck.id}.pptx`);
    const dest = path.join(this.cacheRoot(eventId), `${deck.id}_${fileName}`);
    this.lastAction = `Downloading ${fileName}…`;
    await this.downloadFile(deck.url, dest);

    const prior = this.openPath && this.openPath !== dest ? this.openPath : null;
    this.lastAction = `Opening ${fileName}…`;
    await ppt.openDeck(dest, prior);
    this.openPath = dest;
    this.openDeckId = String(deck.id);
    this.lastError = '';
    this.lastAction = `Opened ${fileName}`;
    return this.status;
  }
}

module.exports = { MeetingHubController };
