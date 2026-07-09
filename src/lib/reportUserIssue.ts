import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';
import { formatConsoleCaptureForReport } from './consoleCapture';

export interface UserIssueReportPayload {
  message: string;
  userNote?: string;
  page?: string;
  userEmail?: string;
  userName?: string;
  includeConsoleLog?: boolean;
  consoleLog?: string;
}

export async function reportUserIssue(
  payload: UserIssueReportPayload
): Promise<{ ok: boolean; error?: string }> {
  const base = getApiBaseUrl();
  const includeConsole = payload.includeConsoleLog !== false;
  try {
    const res = await fetch(`${base}/api/ops/user-report`, {
      method: 'POST',
      headers: apiJsonHeaders(),
      body: JSON.stringify({
        message: payload.message,
        userNote: payload.userNote,
        page: payload.page ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : undefined),
        userEmail: payload.userEmail,
        userName: payload.userName,
        includeConsoleLog: includeConsole,
        consoleLog: includeConsole ? payload.consoleLog ?? formatConsoleCaptureForReport() : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error || `Could not send report (HTTP ${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not reach the server to send report.',
    };
  }
}
