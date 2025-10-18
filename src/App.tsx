import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import './App.css';
import { AuthProvider } from './contexts/AuthContext';
import AuthGuard from './components/AuthGuard';
import AppHeader from './components/AppHeader';
import EventListPage from './pages/EventListPage';
import RunOfShowPage from './pages/RunOfShowPage';
import FullScreenTimerPage from './pages/FullScreenTimerPage';
import ClockPage from './pages/ClockPage';
import LowerThirdsXMLPage from './pages/LowerThirdsXMLPage';
import NetlifyLowerThirdsXMLPage from './pages/NetlifyLowerThirdsXMLPage';
import NetlifyScheduleXMLPage from './pages/NetlifyScheduleXMLPage';
import NetlifyCustomColumnsXMLPage from './pages/NetlifyCustomColumnsXMLPage';
import GoogleSheetsVMIXPage from './pages/GoogleSheetsVMIXPage';
import ScheduleXMLPage from './pages/ScheduleXMLPage';
import CustomColumnsXMLPage from './pages/CustomColumnsXMLPage';
import GraphicsLinksPage from './pages/GraphicsLinksPage';
import ReportsPage from './pages/ReportsPage';
import GreenRoomPage from './pages/GreenRoomPage';
import PhotoViewPage from './pages/PhotoViewPage';
import ScriptsFollowPage from './pages/ScriptsFollowPage';
import TeleprompterPage from './pages/TeleprompterPage';

function AppContent() {
  const location = useLocation();
  const isFullScreenTimer = location.pathname === '/fullscreen-timer';
  const isClock = location.pathname === '/clock';
  const isGreenRoom = location.pathname === '/green-room';
  const isPhotoView = location.pathname === '/photo-view';
  const isScriptsFollow = location.pathname === '/scripts-follow';
  const isTeleprompter = location.pathname === '/teleprompter';
  const isGoogleSheets = location.pathname === '/google-sheets-vmix';
  const isLocalXML = location.pathname === '/lower-thirds-xml' || location.pathname === '/schedule-xml' || location.pathname === '/custom-columns-xml';
  const isNetlifyXML = location.pathname === '/netlify-lower-thirds-xml' || location.pathname === '/netlify-schedule-xml' || location.pathname === '/netlify-custom-columns-xml';

  return (
    <div className={`App ${isClock ? 'clock-page' : ''}`}>
      {/* Render AppHeader outside AuthGuard for pages that need authentication */}
      {!isFullScreenTimer && !isGreenRoom && !isPhotoView && !isScriptsFollow && !isTeleprompter && !isGoogleSheets && !isLocalXML && !isNetlifyXML && <AppHeader />}
      
      <AuthGuard>
        <Routes>
          <Route path="/" element={<EventListPage />} />
          <Route path="/run-of-show" element={<RunOfShowPage />} />
          <Route path="/fullscreen-timer" element={<FullScreenTimerPage />} />
          <Route path="/graphics-links" element={<GraphicsLinksPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/green-room" element={<GreenRoomPage />} />
          <Route path="/photo-view" element={<PhotoViewPage />} />
          <Route path="/scripts-follow" element={<ScriptsFollowPage />} />
          <Route path="/teleprompter" element={<TeleprompterPage />} />
        </Routes>
      </AuthGuard>
      
      {/* Pages that work without authentication */}
      <Routes>
        <Route path="/clock" element={<ClockPage />} />
        <Route path="/lower-thirds-xml" element={<LowerThirdsXMLPage />} />
        <Route path="/netlify-lower-thirds-xml" element={<NetlifyLowerThirdsXMLPage />} />
        <Route path="/schedule-xml" element={<ScheduleXMLPage />} />
        <Route path="/netlify-schedule-xml" element={<NetlifyScheduleXMLPage />} />
        <Route path="/custom-columns-xml" element={<CustomColumnsXMLPage />} />
        <Route path="/netlify-custom-columns-xml" element={<NetlifyCustomColumnsXMLPage />} />
        <Route path="/google-sheets-vmix" element={<GoogleSheetsVMIXPage />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;