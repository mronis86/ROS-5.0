import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import './App.css';
import { AuthProvider } from './contexts/AuthContext';
import { ActiveViewersProvider } from './contexts/ActiveViewersContext';
import { AppHeaderCollapseProvider } from './contexts/AppHeaderCollapseContext';
import AuthGuard from './components/AuthGuard';
import AppHeader from './components/AppHeader';
import ReportIssueFab from './components/ReportIssueFab';
import EventListPage from './pages/EventListPage';
import RunOfShowPage from './pages/RunOfShowPage';
import RunOfShowMobilePage from './pages/RunOfShowMobilePage';
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
import ContentReviewPage from './pages/ContentReviewPage';
import GreenRoomPage from './pages/GreenRoomPage';
import PhotoViewPage from './pages/PhotoViewPage';
import ScriptsFollowPage from './pages/ScriptsFollowPage';
import TeleprompterPage from './pages/TeleprompterPage';
import AdminPage from './pages/AdminPage';
import PinNotesPopoutPage from './pages/PinNotesPopoutPage';
import QuickModePage from './pages/QuickModePage';
import ComparisonPage from './pages/ComparisonPage';
import DashboardPage from './pages/DashboardPage';
import AccessManagerPage from './pages/AccessManagerPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AccessPortalPage from './pages/AccessPortalPage';
import LedLayoutsPage from './pages/LedLayoutsPage';
import LedOutputPage from './pages/LedOutputPage';

function AppContent() {
  const location = useLocation();
  const isFullScreenTimer = location.pathname === '/fullscreen-timer';
  const isPinNotesPopout = location.pathname === '/pin-notes-popout';
  const isClock = location.pathname === '/clock';
  const isGreenRoom = location.pathname === '/green-room';
  const isPhotoView = location.pathname === '/photo-view';
  const isScriptsFollow = location.pathname === '/scripts-follow';
  const isTeleprompter = location.pathname === '/teleprompter';
  const isGoogleSheets = location.pathname === '/google-sheets-vmix';
  const isLocalXML = location.pathname === '/lower-thirds-xml' || location.pathname === '/schedule-xml' || location.pathname === '/custom-columns-xml';
  const isNetlifyXML = location.pathname === '/netlify-lower-thirds-xml' || location.pathname === '/netlify-schedule-xml' || location.pathname === '/netlify-custom-columns-xml';
  const isAdmin = location.pathname === '/admin';
  const isQuickMode = location.pathname === '/quick-mode';
  const isComparison = location.pathname === '/comparison';
  const isResetPassword = location.pathname === '/reset-password';
  const isAccessPortal = location.pathname === '/access';
  const isLedOutput = location.pathname === '/led-output';

  const hideReportFab =
    isFullScreenTimer ||
    isPinNotesPopout ||
    isGreenRoom ||
    isPhotoView ||
    isScriptsFollow ||
    isTeleprompter ||
    isGoogleSheets ||
    isLocalXML ||
    isNetlifyXML ||
    isComparison ||
    isResetPassword ||
    isAccessPortal ||
    isLedOutput ||
    isClock;

  return (
    <ActiveViewersProvider>
    <div className={`App ${isClock ? 'clock-page' : ''} ${isLedOutput ? 'led-output-page' : ''}`}>
      {/* Render AppHeader outside AuthGuard for pages that need authentication */}
      {!isFullScreenTimer && !isPinNotesPopout && !isGreenRoom && !isPhotoView && !isScriptsFollow && !isTeleprompter && !isGoogleSheets && !isLocalXML && !isNetlifyXML && !isAdmin && !isQuickMode && !isComparison && !isResetPassword && !isAccessPortal && !isLedOutput && <AppHeader />}
      
      {!isPinNotesPopout && !isComparison && !isResetPassword && !isAccessPortal && !isNetlifyXML && !isLocalXML && (
        <AuthGuard>
          <Routes>
            <Route path="/admin" element={null} />
            <Route path="/" element={<EventListPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/access-manager" element={<AccessManagerPage />} />
            <Route path="/quick-mode" element={<QuickModePage />} />
            <Route path="/run-of-show" element={<RunOfShowPage />} />
            <Route path="/run-of-show-mobile" element={<RunOfShowMobilePage />} />
            <Route path="/fullscreen-timer" element={<FullScreenTimerPage />} />
            <Route path="/graphics-links" element={<GraphicsLinksPage />} />
            <Route path="/led-layouts" element={<LedLayoutsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/content-review" element={<ContentReviewPage />} />
            <Route path="/green-room" element={<GreenRoomPage />} />
            <Route path="/photo-view" element={<PhotoViewPage />} />
            <Route path="/scripts-follow" element={<ScriptsFollowPage />} />
            <Route path="/teleprompter" element={<TeleprompterPage />} />
          </Routes>
        </AuthGuard>
      )}

      {/* Pages that work without authentication (popout loads without auth) */}
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/comparison" element={<ComparisonPage />} />
        <Route path="/pin-notes-popout" element={<PinNotesPopoutPage />} />
        <Route path="/clock" element={<ClockPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/access" element={<AccessPortalPage />} />
        <Route path="/led-output" element={<LedOutputPage />} />
        <Route path="/lower-thirds-xml" element={<LowerThirdsXMLPage />} />
        <Route path="/netlify-lower-thirds-xml" element={<NetlifyLowerThirdsXMLPage />} />
        <Route path="/schedule-xml" element={<ScheduleXMLPage />} />
        <Route path="/netlify-schedule-xml" element={<NetlifyScheduleXMLPage />} />
        <Route path="/custom-columns-xml" element={<CustomColumnsXMLPage />} />
        <Route path="/netlify-custom-columns-xml" element={<NetlifyCustomColumnsXMLPage />} />
        <Route path="/google-sheets-vmix" element={<GoogleSheetsVMIXPage />} />
        {/* Suppress "No routes matched" for paths handled by AuthGuard routes above */}
        <Route path="*" element={null} />
      </Routes>
      {!hideReportFab ? <ReportIssueFab /> : null}
    </div>
    </ActiveViewersProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppHeaderCollapseProvider>
          <AppContent />
        </AppHeaderCollapseProvider>
      </Router>
    </AuthProvider>
  );
}

export default App;
