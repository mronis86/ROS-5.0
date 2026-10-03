import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type LiveSyncStatusSnapshot = {
  /** True while a Run of Show page is mounted with an event */
  active: boolean;
  connected: boolean | null;
  selfInPresence: boolean;
};

type LiveSyncStatusContextValue = LiveSyncStatusSnapshot & {
  setStatus: (next: LiveSyncStatusSnapshot) => void;
  clearStatus: () => void;
  /** ROS registers this so the header badge can open the connection alert */
  openAlert: (() => void) | null;
  setOpenAlert: (fn: (() => void) | null) => void;
};

const idleStatus: LiveSyncStatusSnapshot = {
  active: false,
  connected: null,
  selfInPresence: false,
};

const LiveSyncStatusContext = createContext<LiveSyncStatusContextValue | null>(null);

export function LiveSyncStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatusState] = useState<LiveSyncStatusSnapshot>(idleStatus);
  const [openAlert, setOpenAlertState] = useState<(() => void) | null>(null);

  const setStatus = useCallback((next: LiveSyncStatusSnapshot) => {
    setStatusState(next);
  }, []);

  const clearStatus = useCallback(() => {
    setStatusState(idleStatus);
  }, []);

  const setOpenAlert = useCallback((fn: (() => void) | null) => {
    setOpenAlertState(() => fn);
  }, []);

  const value = useMemo(
    () => ({
      ...status,
      setStatus,
      clearStatus,
      openAlert,
      setOpenAlert,
    }),
    [status, setStatus, clearStatus, openAlert, setOpenAlert]
  );

  return (
    <LiveSyncStatusContext.Provider value={value}>{children}</LiveSyncStatusContext.Provider>
  );
}

export function useLiveSyncStatus(): LiveSyncStatusContextValue {
  const ctx = useContext(LiveSyncStatusContext);
  if (!ctx) {
    throw new Error('useLiveSyncStatus must be used within LiveSyncStatusProvider');
  }
  return ctx;
}
