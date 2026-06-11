import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'ros.runOfShow.headerCollapsed';

type AppHeaderCollapseContextValue = {
  /** True when on Run of Show and user collapsed the global AppHeader */
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  isRunOfShowPage: boolean;
};

const AppHeaderCollapseContext = createContext<AppHeaderCollapseContextValue | null>(null);

export const AppHeaderCollapseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const isRunOfShowPage = location.pathname === '/run-of-show';

  const [collapsed, setCollapsedState] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      sessionStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  // Leaving Run of Show — restore header for other pages
  useEffect(() => {
    if (!isRunOfShowPage) {
      document.documentElement.style.setProperty('--app-header-height', '3.5rem');
    }
  }, [isRunOfShowPage]);

  // Sync CSS variable when collapsed on Run of Show
  useEffect(() => {
    if (!isRunOfShowPage) return;
    document.documentElement.style.setProperty(
      '--app-header-height',
      collapsed ? '0px' : '3.5rem'
    );
  }, [isRunOfShowPage, collapsed]);

  const effectiveCollapsed = isRunOfShowPage && collapsed;

  return (
    <AppHeaderCollapseContext.Provider
      value={{
        collapsed: effectiveCollapsed,
        setCollapsed,
        toggleCollapsed,
        isRunOfShowPage,
      }}
    >
      {children}
    </AppHeaderCollapseContext.Provider>
  );
};

export function useAppHeaderCollapse(): AppHeaderCollapseContextValue {
  const ctx = useContext(AppHeaderCollapseContext);
  if (!ctx) {
    throw new Error('useAppHeaderCollapse must be used within AppHeaderCollapseProvider');
  }
  return ctx;
}

/** Header offset in px for Run of Show layout math */
export function getAppHeaderOffsetPx(collapsed: boolean): number {
  return collapsed ? 0 : 56;
}
