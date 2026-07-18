import './polyfills/cryptoRandomUUID';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installConsoleCapture, simulateConsoleCaptureTest } from './lib/consoleCapture';
import { initSentry, Sentry } from './lib/sentry';

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

