import React, { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/OfflineAuthContext';
import { ActiveViewersProvider } from './contexts/ActiveViewersContext';
import { AppHeaderCollapseProvider } from './contexts/AppHeaderCollapseContext';
import { LiveSyncStatusProvider } from './contexts/LiveSyncStatusContext';
import OfflineAppShell from './components/OfflineAppShell';
import EventListPage from './pages/EventListPage';
import RunOfShowPage from './pages/RunOfShowPage';
import QuickModePage from './pages/QuickModePage';
import OfflineTimerPage from './pages/OfflineTimerPage';
import {
  hydrateAppSettingsFromServer,
  refreshAppSettingsFromServer,
} from './lib/hydrateAppSettings';
import { onCloudModeChange } from './services/socket-client';

const App: React.FC = () => {
  useEffect(() => {
    void hydrateAppSettingsFromServer();
    const unsub = onCloudModeChange(() => {
      void refreshAppSettingsFromServer();
    });
    const poll = window.setInterval(() => {
      void refreshAppSettingsFromServer();
    }, 60_000);
    return () => {
      unsub?.();
      window.clearInterval(poll);
    };
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <ActiveViewersProvider>
          <AppHeaderCollapseProvider>
            <LiveSyncStatusProvider>
              <Routes>
                {/* Full-screen timer displays — no header or connectivity bar */}
                <Route path="/timer" element={<OfflineTimerPage />} />
                <Route path="/fullscreen-timer" element={<OfflineTimerPage />} />
                <Route element={<OfflineAppShell />}>
                  <Route path="/" element={<EventListPage />} />
                  <Route path="/run-of-show" element={<RunOfShowPage />} />
                  <Route path="/quick-mode" element={<QuickModePage />} />
                </Route>
              </Routes>
            </LiveSyncStatusProvider>
          </AppHeaderCollapseProvider>
        </ActiveViewersProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
