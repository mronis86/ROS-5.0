/**
 * Follow offline-show (or any ROS Socket.IO) timer events and invoke play/clear callbacks.
 */
function createCueFollower({ ioClient, url, eventId, onPlayCue, onClear, onStatus }) {
  let socket = null;
  let stopped = false;

  function handleUpdate(message) {
    if (!message || typeof message !== 'object') return;
    const type = message.type;
    const data = message.data || {};

    if (type === 'timerUpdated' || type === 'activeTimersUpdated') {
      const state = data.timer_state;
      const itemId = data.item_id != null ? parseInt(String(data.item_id), 10) : NaN;
      if (state === 'loaded' || state === 'running') {
        if (Number.isFinite(itemId)) onPlayCue?.(itemId, data);
        return;
      }
      if (state === 'stopped') {
        onClear?.(data);
      }
      return;
    }

    if (type === 'timerStopped' || type === 'timersStopped' || type === 'resetAllStates') {
      onClear?.(data);
    }
  }

  function connect() {
    if (stopped) return;
    try {
      socket = ioClient(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        timeout: 10000,
      });
    } catch (err) {
      onStatus?.({ ok: false, message: err.message || 'Socket connect failed' });
      return;
    }

    socket.on('connect', () => {
      socket.emit('joinEvent', eventId);
      onStatus?.({ ok: true, message: `Cue follow connected (${url})` });
    });

    socket.on('disconnect', (reason) => {
      onStatus?.({ ok: false, message: `Cue follow disconnected: ${reason}` });
    });

    socket.on('connect_error', (err) => {
      onStatus?.({ ok: false, message: `Cue follow error: ${err.message || err}` });
    });

    socket.on('update', handleUpdate);
  }

  function dispose() {
    stopped = true;
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

  connect();
  return { dispose };
}

module.exports = { createCueFollower };
