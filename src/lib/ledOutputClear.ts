export const LED_OUTPUT_CLEAR_EVENT = 'led-output-clear';

function storageKey(eventId: string) {
  return `ledOutputClear_${eventId}`;
}

/** Signal all output pages for this event (same browser + API/WebSocket when available). */
export function dispatchLedOutputClear(eventId: string) {
  localStorage.setItem(storageKey(eventId), String(Date.now()));
  window.dispatchEvent(new CustomEvent(LED_OUTPUT_CLEAR_EVENT, { detail: { eventId } }));
}

export function subscribeLedOutputClear(
  eventId: string,
  onClear: () => void
): () => void {
  const key = storageKey(eventId);

  const onStorage = (e: StorageEvent) => {
    if (e.key === key) onClear();
  };

  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<{ eventId?: string }>).detail;
    if (detail?.eventId === eventId) onClear();
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(LED_OUTPUT_CLEAR_EVENT, onCustom);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LED_OUTPUT_CLEAR_EVENT, onCustom);
  };
}
