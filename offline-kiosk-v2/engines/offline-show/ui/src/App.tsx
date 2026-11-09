import React from 'react';
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
import PhotoViewPage from './pages/PhotoViewPage';
import OperatorCueDisplayPage from './pages/OperatorCueDisplayPage';

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <ActiveViewersProvider>
        <AppHeaderCollapseProvider>
          <LiveSyncStatusProvider>
            <Routes>
              {/* Full-screen timer / display pages — no header or connectivity bar */}
              <Route path="/timer" element={<OfflineTimerPage />} />
              <Route path="/fullscreen-timer" element={<OfflineTimerPage />} />
              {/* DSM Clock URL used by kiosk Displays; shares OfflineTimer until dedicated DSM page is synced */}
              <Route path="/dsm-clock" element={<OfflineTimerPage />} />
              <Route path="/photo-view" element={<PhotoViewPage />} />
              <Route path="/operator-cue-display" element={<OperatorCueDisplayPage />} />
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

export default App;
