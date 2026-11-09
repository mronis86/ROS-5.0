/**
 * Fires ~once per second even when the window is visible but unfocused.
 * Main-thread setInterval is heavily throttled in that case; a Worker is not.
 * Falls back to setInterval if Workers are unavailable.
 */
export function startSecondTicker(onTick: () => void): () => void {
  let stopped = false;
  let worker: Worker | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let blobUrl: string | null = null;

  const tick = () => {
    if (!stopped) onTick();
  };

  try {
    blobUrl = URL.createObjectURL(
      new Blob(['setInterval(function(){postMessage(0)},1000)'], {
        type: 'application/javascript',
      })
    );
    worker = new Worker(blobUrl);
    worker.onmessage = tick;
  } catch {
    intervalId = setInterval(tick, 1000);
  }

  tick();

  return () => {
    stopped = true;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
