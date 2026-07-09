export type ConsoleCaptureLevel = 'error' | 'warn' | 'window-error' | 'unhandled-rejection';

export interface ConsoleCaptureEntry {
  level: ConsoleCaptureLevel;
  message: string;
  timestamp: string;
  stack?: string;
}

const MAX_ENTRIES = 40;
const entries: ConsoleCaptureEntry[] = [];
let installed = false;

function pushEntry(entry: ConsoleCaptureEntry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

function serializeArg(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shouldSkipMessage(message: string): boolean {
  return /\[vite\]|Download the React DevTools/i.test(message);
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map(serializeArg).join(' ').slice(0, 2000);
}

export function installConsoleCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    const message = formatConsoleArgs(args);
    if (!shouldSkipMessage(message)) {
      pushEntry({
        level: 'error',
        message,
        timestamp: new Date().toISOString(),
      });
    }
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    const message = formatConsoleArgs(args);
    if (!shouldSkipMessage(message)) {
      pushEntry({
        level: 'warn',
        message,
        timestamp: new Date().toISOString(),
      });
    }
    originalWarn(...args);
  };

  window.addEventListener('error', (event) => {
    const message = event.message || String(event.error || 'Window error');
    if (shouldSkipMessage(message)) return;
    pushEntry({
      level: 'window-error',
      message,
      timestamp: new Date().toISOString(),
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : serializeArg(reason);
    if (shouldSkipMessage(message)) return;
    pushEntry({
      level: 'unhandled-rejection',
      message,
      timestamp: new Date().toISOString(),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

export function getConsoleCaptureEntries(): ConsoleCaptureEntry[] {
  return [...entries];
}

export function formatConsoleCaptureForReport(limit = MAX_ENTRIES): string {
  const slice = entries.slice(-limit);
  if (slice.length === 0) {
    return '(No console errors or warnings captured this session.)';
  }
  return slice
    .map((entry) => {
      const stack = entry.stack ? `\n  ${entry.stack.split('\n').join('\n  ')}` : '';
      return `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}${stack}`;
    })
    .join('\n\n');
}

export function getConsoleCaptureSummary(): { count: number; hasErrors: boolean } {
  const count = entries.length;
  const hasErrors = entries.some(
    (entry) => entry.level === 'error' || entry.level === 'window-error' || entry.level === 'unhandled-rejection'
  );
  return { count, hasErrors };
}

/** Dev helper — call from the browser console to verify capture appears in reports. */
export function simulateConsoleCaptureTest(): void {
  console.error('[ROS test] Simulated console error for issue report testing.');
}
