import React, { createContext, useContext } from 'react';

export type ShowcaseViewportMode = 'compact' | 'enlarge';

const ShowcaseViewportContext = createContext<ShowcaseViewportMode>('compact');

export function ShowcaseViewportProvider({
  mode,
  children,
}: {
  mode: ShowcaseViewportMode;
  children: React.ReactNode;
}) {
  return <ShowcaseViewportContext.Provider value={mode}>{children}</ShowcaseViewportContext.Provider>;
}

export function useShowcaseViewport(): ShowcaseViewportMode {
  return useContext(ShowcaseViewportContext);
}
