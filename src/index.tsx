import './polyfills/cryptoRandomUUID';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installConsoleCapture, simulateConsoleCaptureTest } from './lib/consoleCapture';

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
    <App />
  </React.StrictMode>
);

