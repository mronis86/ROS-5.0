import { useCallback, useRef, useState } from 'react';

type Options = {
  listenSocket?: boolean;
};

/**
 * Offline Show: displays always follow the local event — no Admin "pause displays" gate.
 */
export function useEventDisplaySyncGate(_eventId: string | undefined, _options: Options = {}) {
  const displaySyncEnabledRef = useRef(true);
  const [displaySyncPaused] = useState(false);
  const [displaySyncChecked] = useState(true);

  const applyDisplaySyncEnabled = useCallback((enabled: boolean) => {
    displaySyncEnabledRef.current = enabled;
  }, []);

  const followerSyncAllowed = useCallback(() => true, []);

  return {
    displaySyncEnabledRef,
    displaySyncPaused,
    displaySyncChecked,
    followerSyncAllowed,
    applyDisplaySyncEnabled,
  };
}
