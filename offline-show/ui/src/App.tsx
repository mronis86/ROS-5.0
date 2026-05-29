import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/OfflineAuthContext';
import { ActiveViewersProvider } from './contexts/ActiveViewersContext';
import OfflineAppShell from './components/OfflineAppShell';
import EventListPage from './pages/EventListPage';
import RunOfShowPage from './pages/RunOfShowPage';
import QuickModePage from './pages/QuickModePage';
import OfflineTimerPage from './pages/OfflineTimerPage';

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <ActiveViewersProvider>
        <Routes>
          {/* Full-screen timer display — no header or connectivity bar */}
          <Route path="/timer" element={<OfflineTimerPage />} />
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
