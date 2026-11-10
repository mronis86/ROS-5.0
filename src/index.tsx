import './polyfills/cryptoRandomUUID';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installConsoleCapture, simulateConsoleCaptureTest } from './lib/consoleCapture';
import { initSentry, Sentry } from './lib/sentry';
import { bootstrapApiTokenFromUrl, getApiAccessToken } from './lib/sessionAuth';
import { apiClient } from './services/api-client';

// Display clients (Green Room) may pass apiToken in the URL — apply before any page fetch.
bootstrapApiTokenFromUrl();
if (getApiAccessToken()) {
  apiClient.clearAuthBackoff();
}

initSentry();
installConsoleCapture();

if (import.meta.env.DEV) {
  (window as unknown as { simulateConsoleCaptureTest?: () => void }).simulateConsoleCaptureTest =
    simulateConsoleCaptureTest;
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p style={{ padding: 16 }}>Something went wrong. Please refresh.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

