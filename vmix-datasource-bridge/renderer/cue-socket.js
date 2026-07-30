/**
 * Browser-side Socket.IO (same stack as the ROS web app).
 * Loaded after vendor/socket.io.min.js provides window.io
 */
(function () {
  let socket = null;

  function normalizeBaseUrl(url) {
    let s = String(url || '').trim();
    if (!s) return '';
    s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
    if (!/^https?:\/\//i.test(s)) {
      s = /localhost|127\.0\.0\.1/i.test(s) ? `http://${s}` : `https://${s}`;
    }
    s = s.replace(/\/+$/, '').replace(/\/api$/i, '');
    return s;
  }

  function stopCueSocket() {
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        /* ignore */
      }
      socket = null;
    }
  }

  function startCueSocket({ apiBaseUrl, eventId, apiToken }) {
    stopCueSocket();
    const api = window.rosVmixBridge;
    if (!api || typeof io === 'undefined') {
      api?.reportSocketStatus?.({
        ok: false,
        message: 'Socket.IO browser client missing',
      });
      return { ok: false, message: 'Socket.IO browser client missing' };
    }

    const url = normalizeBaseUrl(apiBaseUrl);
    const token = String(apiToken || '')
      .trim()
      .replace(/^Bearer\s+/i, '');
    if (!url || !eventId) {
      return { ok: false, message: 'API URL and event ID required for socket' };
    }

    socket = io(url, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionDelay: 800,
      timeout: 15000,
      ...(token
        ? {
            auth: { token },
            query: { token },
            transportOptions: {
              polling: {
                extraHeaders: { Authorization: `Bearer ${token}` },
              },
            },
          }
        : {}),
    });

    socket.on('connect', () => {
      const transport = socket.io?.engine?.transport?.name || 'unknown';
      socket.emit('joinEvent', eventId);
      api.reportSocketStatus({
        ok: true,
        message: `Browser Socket.IO connected (${transport})`,
        transport,
      });
    });

    socket.on('disconnect', (reason) => {
      api.reportSocketStatus({
        ok: false,
        message: `Browser Socket.IO disconnected: ${reason}`,
      });
    });

    socket.on('connect_error', (err) => {
      api.reportSocketStatus({
        ok: false,
        message: `Browser Socket.IO error: ${err?.message || err}`,
      });
    });

    socket.on('update', (message) => {
      if (!message || typeof message !== 'object') return;
      const type = message.type;
      const data = message.data || {};
      if (type === 'timerUpdated' || type === 'activeTimersUpdated') {
        const state = data.timer_state;
        const itemId = data.item_id != null ? parseInt(String(data.item_id), 10) : NaN;
        if ((state === 'loaded' || state === 'running') && Number.isFinite(itemId)) {
          void api.reportCue(itemId, data);
        }
      }
    });

    return { ok: true, message: `Connecting browser Socket.IO → ${url}` };
  }

  async function testCueSocket({ apiBaseUrl, apiToken, timeoutMs = 8000 }) {
    const url = normalizeBaseUrl(apiBaseUrl);
    const token = String(apiToken || '')
      .trim()
      .replace(/^Bearer\s+/i, '');
    if (typeof io === 'undefined') {
      return { ok: false, message: 'socket.io browser script not loaded' };
    }
    if (!url) return { ok: false, message: 'API base URL required' };

    return new Promise((resolve) => {
      const probe = io(url, {
        transports: ['polling', 'websocket'],
        reconnection: false,
        timeout: timeoutMs,
        ...(token
          ? {
              auth: { token },
              query: { token },
            }
          : {}),
      });
      const timer = setTimeout(() => {
        try {
          probe.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, message: `Timed out connecting to ${url} (browser Socket.IO)` });
      }, timeoutMs);

      probe.on('connect', () => {
        clearTimeout(timer);
        const transport = probe.io?.engine?.transport?.name || 'unknown';
        probe.close();
        resolve({
          ok: true,
          message: `Browser Socket.IO OK via ${transport} → ${url}`,
          transport,
        });
      });

      probe.on('connect_error', (err) => {
        clearTimeout(timer);
        try {
          probe.close();
        } catch {
          /* ignore */
        }
        resolve({
          ok: false,
          message: `Browser Socket.IO failed: ${err?.message || err}`,
        });
      });
    });
  }

  window.rosCueSocket = { startCueSocket, stopCueSocket, testCueSocket };
})();
