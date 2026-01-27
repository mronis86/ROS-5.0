import React, { createContext, useContext, useState } from 'react';

export interface ActiveViewer {
  userId: string;
  userName: string;
  userRole: string;
}

interface ActiveViewersContextValue {
  viewers: ActiveViewer[];
  setViewers: (viewers: ActiveViewer[]) => void;
}

const ActiveViewersContext = createContext<ActiveViewersContextValue | null>(null);

export function ActiveViewersProvider({ children }: { children: React.ReactNode }) {
  const [viewers, setViewers] = useState<ActiveViewer[]>([]);
  return (
    <ActiveViewersContext.Provider value={{ viewers, setViewers }}>
      {children}
    </ActiveViewersContext.Provider>
  );
}

export function useActiveViewers() {
  const ctx = useContext(ActiveViewersContext);
  return ctx ?? { viewers: [], setViewers: () => {} };
}
