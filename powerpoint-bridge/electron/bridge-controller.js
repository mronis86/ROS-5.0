const ppt = require('./ppt-com');
const { uploadStills, reportLive } = require('./railway-client');

class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.running = false;
    this.config = null;
    this.timer = null;
    this.lastSlideId = null;
    this.lastSlideCount = null;
    this.status = this.blankStatus('Stopped');
  }

  blankStatus(message) {
    return {
      running: this.running,
      message: message || '',
      powerpoint: false,
      slideshowActive: false,
      deckName: '',
      slideCount: 0,
      currentSlideId: null,
      currentIndex: null,
      lastAction: '',
      error: '',
    };
  }

  emit(partial) {
    this.status = { ...this.status, ...partial, running: this.running };
    this.onStatus(this.status);
  }

  start(config) {
    this.stop();
    this.config = config || {};
    if (!this.config.eventId) {
      this.emit({ error: 'Pick an event first.', message: 'No event' });
      return;
    }
    this.running = true;
    this.lastSlideId = null;
    this.emit({ message: 'Starting…', error: '' });
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emit({ message: 'Stopped', slideshowActive: false });
  }

  scheduleNext(ms) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), ms);
  }

  async tick() {
    if (!this.running) return;
    try {
      const live = await ppt.getLive();
      if (!live || live.ok === false) {
        this.emit({
          powerpoint: false,
          slideshowActive: false,
          message: live?.error || 'PowerPoint not found',
          error: live?.error || '',
        });
        this.scheduleNext(1500);
        return;
      }

      const slideCount = Number(live.slideCount) || 0;
      if (this.lastSlideCount != null && slideCount !== this.lastSlideCount && slideCount > 0) {
        this.captureStills().catch((err) => {
          this.emit({ error: err.message || String(err) });
        });
      }
      this.lastSlideCount = slideCount;

      const slideshowActive = !!live.slideshowActive;
      const pptSlideId = live.pptSlideId ? String(live.pptSlideId) : null;
      this.emit({
        powerpoint: true,
        slideshowActive,
        deckName: live.deckName || '',
        slideCount,
        currentSlideId: pptSlideId,
        currentIndex: live.slideIndex != null ? Number(live.slideIndex) : null,
        message: slideshowActive
          ? `Live slide ${live.slideIndex || '?'}`
          : 'PowerPoint connected — start Slideshow to fire cues',
        error: '',
      });

      const result = await reportLive(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
        slideshowActive,
        pptSlideId,
        slideIndex: live.slideIndex,
        deckName: live.deckName,
        slideCount,
      });
      if (result?.fired) {
        this.emit({
          lastAction: `${result.action || 'fired'} → item ${result.itemId || '?'}`,
        });
      }
      this.lastSlideId = pptSlideId;
      this.scheduleNext(slideshowActive ? 250 : 1000);
    } catch (err) {
      this.emit({ error: err.message || String(err), message: 'Bridge error' });
      this.scheduleNext(2000);
    }
  }

  async captureStills(config) {
    if (config) this.config = config;
    const snap = await ppt.captureStills();
    if (!snap || snap.ok === false) {
      throw new Error(snap?.error || 'Could not capture stills');
    }
    if (!this.config?.eventId) throw new Error('Pick an event first.');
    const uploaded = await uploadStills(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
      deckName: snap.deckName,
      slides: snap.slides,
    });
    this.lastSlideCount = snap.slideCount;
    this.emit({
      powerpoint: true,
      deckName: snap.deckName,
      slideCount: snap.slideCount,
      message: `Uploaded ${snap.slideCount} stills`,
      error: '',
    });
    return uploaded;
  }
}

module.exports = { BridgeController };
