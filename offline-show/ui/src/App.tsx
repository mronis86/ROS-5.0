import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/OfflineAuthContext';
import { ActiveViewersProvider } from './contexts/ActiveViewersContext';
import OfflineAppShell from './components/OfflineAppShell';
import EventListPage from './pages/EventListPage';
import RunOfShowPage from './pages/RunOfShowPage';
import QuickModePage from './pages/QuickModePage';
import OfflineTimerPage from './pages/OfflineTimerPage';
import UltritouchHealthMonitorPage from './pages/UltritouchHealthMonitorPage';

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <ActiveViewersProvider>
        <Routes>
          {/* Full-screen timer display — no header or connectivity bar */}
          <Route path="/timer" element={<OfflineTimerPage />} />
          <Route path="/ultritouch-health" element={<UltritouchHealthMonitorPage panel="4u" />} />
          <Route path="/ultritouch-health-monitor" element={<UltritouchHealthMonitorPage panel="4u" />} />
          <Route path="/ultritouch-health-2u" element={<UltritouchHealthMonitorPage panel="2u" />} />
          <Route path="/ultritouch-health-2" element={<UltritouchHealthMonitorPage panel="2u" />} />
          <Route element={<OfflineAppShell />}>
            <Route path="/" element={<EventListPage />} />
            <Route path="/run-of-show" element={<RunOfShowPage />} />
            <Route path="/quick-mode" element={<QuickModePage />} />
          </Route>
        </Routes>
      </ActiveViewersProvider>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
