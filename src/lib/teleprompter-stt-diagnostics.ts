/**
 * Teleprompter STT diagnostics for IT / Umbrella troubleshooting.
 * Web Speech API → Google cloud (not ROS servers).
 */

import {
  audioConstraintsForMic,
  computeMicLevelFromTimeDomain,
  isEdgeBrowser,
  listAudioInputDevices,
  readStoredMicId,
  speechRecognitionNetworkHelpMessage,
  unlockAndListMics,
} from './teleprompter-mic';

export type SttDiagLine = {
  t: string;
  level: 'info' | 'ok' | 'warn' | 'error';
  message: string;
};

export type SttDiagResult = {
  lines: SttDiagLine[];
  summary: string;
  likelyUmbrellaBlock: boolean;
  micOk: boolean;
  sttHeardSpeech: boolean;
  sttNetworkErrors: number;
  copyText: string;
};

function ts(): string {
  return new Date().toISOString();
}

function push(
  lines: SttDiagLine[],
  level: SttDiagLine['level'],
  message: string
): void {
  lines.push({ t: ts(), level, message });
}

function getSpeechRecognitionCtor(): (new () => any) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type RunSttDiagnosticsOptions = {
  /** Total STT listen window in ms (default 12000) */
  listenMs?: number;
  /** Mic meter sample window in ms (default 2500) */
  meterMs?: number;
  deviceId?: string;
  signal?: AbortSignal;
};

/**
 * Runs environment + mic + Web Speech probes. Does not upload audio to ROS.
 */
export async function runTeleprompterSttDiagnostics(
  opts?: RunSttDiagnosticsOptions
): Promise<SttDiagResult> {
  const lines: SttDiagLine[] = [];
  const listenMs = opts?.listenMs ?? 12000;
  const meterMs = opts?.meterMs ?? 2500;
  const preferredId = (opts?.deviceId || readStoredMicId() || '').trim();
  const aborted = () => !!opts?.signal?.aborted;

  push(lines, 'info', '=== Teleprompter STT diagnostics start ===');
  push(lines, 'info', `Origin: ${typeof location !== 'undefined' ? location.origin : '(n/a)'}`);
  push(
    lines,
    typeof window !== 'undefined' && window.isSecureContext ? 'ok' : 'error',
    `Secure context (HTTPS/localhost): ${typeof window !== 'undefined' && window.isSecureContext}`
  );
  push(lines, 'info', `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : '(n/a)'}`);
  push(lines, isEdgeBrowser() ? 'warn' : 'info', `Browser: ${isEdgeBrowser() ? 'Edge' : 'Chrome-or-other'}`);

  const SpeechRecognitionApi = getSpeechRecognitionCtor();
  if (!SpeechRecognitionApi) {
    push(lines, 'error', 'SpeechRecognition API missing — use Chrome or Edge.');
  } else {
    push(lines, 'ok', 'SpeechRecognition API available');
  }

  // Permissions API (best-effort)
  try {
    const perm = await (navigator.permissions as any)?.query?.({ name: 'microphone' });
    if (perm?.state) {
      push(
        lines,
        perm.state === 'granted' ? 'ok' : perm.state === 'denied' ? 'error' : 'warn',
        `navigator.permissions microphone: ${perm.state}`
      );
    } else {
      push(lines, 'info', 'navigator.permissions microphone: (unsupported)');
    }
  } catch {
    push(lines, 'info', 'navigator.permissions microphone: (query failed / unsupported)');
  }

  let micOk = false;
  let peakLevel = 0;
  let stream: MediaStream | null = null;

  try {
    if (aborted()) throw new Error('aborted');
    const unlocked = await unlockAndListMics(preferredId || undefined);
    stream = unlocked.stream;
    const devices = unlocked.devices.length ? unlocked.devices : await listAudioInputDevices();
    push(lines, 'ok', `Microphone permission OK — ${devices.length} input(s)`);
    devices.slice(0, 12).forEach((d, i) => {
      const mark = preferredId && d.deviceId === preferredId ? ' [selected]' : '';
      push(lines, 'info', `  mic[${i}]: ${d.label}${mark} (${d.deviceId.slice(0, 8)}…)`);
    });
    if (preferredId) push(lines, 'info', `Preferred deviceId: ${preferredId.slice(0, 12)}…`);

    // Re-open preferred device for meter if needed
    stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia(
      audioConstraintsForMic(preferredId, { exactDevice: isEdgeBrowser() && !!preferredId })
    );
    micOk = true;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const meterEnd = Date.now() + meterMs;
    push(lines, 'info', `Mic meter sampling ${meterMs}ms — speak now…`);
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (aborted() || Date.now() >= meterEnd) {
          resolve();
          return;
        }
        analyser.getByteTimeDomainData(data);
        peakLevel = Math.max(peakLevel, computeMicLevelFromTimeDomain(data));
        requestAnimationFrame(tick);
      };
      tick();
    });
    try {
      source.disconnect();
      await audioCtx.close();
    } catch {
      /* ignore */
    }
    push(
      lines,
      peakLevel >= 8 ? 'ok' : 'warn',
      `Mic meter peak level: ${peakLevel}/100 ${peakLevel >= 8 ? '(hearing audio)' : '(very quiet — check mic/gain)'}`
    );
  } catch (err: any) {
    const name = err?.name || 'Error';
    const msg = err?.message || String(err);
    push(lines, 'error', `Microphone test failed: ${name} — ${msg}`);
    if (name === 'NotAllowedError') {
      push(lines, 'error', 'Fix: allow microphone for this site (browser lock icon → Site settings).');
    }
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  let sttHeardSpeech = false;
  let sttNetworkErrors = 0;
  let sttResults = 0;
  let sttOtherErrors: string[] = [];

  if (!SpeechRecognitionApi) {
    push(lines, 'error', 'Skipping STT probe — API unavailable.');
  } else if (aborted()) {
    push(lines, 'warn', 'Diagnostics aborted before STT probe.');
  } else {
    // Release local mic so SpeechRecognition can take it (Chrome exclusive)
    await new Promise((r) => setTimeout(r, isEdgeBrowser() ? 550 : 200));

    push(lines, 'info', `STT probe ${listenMs}ms — speak a few clear sentences…`);
    push(
      lines,
      'info',
      'Note: Chrome/Edge send audio to Google speech servers (www.google.com speech-api). ROS does not host STT.'
    );

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
        resolve();
      };

      const rec: any = new SpeechRecognitionApi();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      try {
        rec.maxAlternatives = isEdgeBrowser() ? 1 : 3;
      } catch {
        /* ignore */
      }

      rec.onaudiostart = () => push(lines, 'ok', 'STT event: onaudiostart (engine opened audio)');
      rec.onaudioend = () => push(lines, 'info', 'STT event: onaudioend');
      rec.onsoundstart = () => push(lines, 'ok', 'STT event: onsoundstart');
      rec.onspeechstart = () => {
        sttHeardSpeech = true;
        push(lines, 'ok', 'STT event: onspeechstart');
      };
      rec.onspeechend = () => push(lines, 'info', 'STT event: onspeechend');
      rec.onstart = () => push(lines, 'ok', 'STT event: onstart');
      rec.onend = () => {
        push(lines, 'info', 'STT event: onend');
        finish();
      };
      rec.onerror = (e: any) => {
        const code = String(e?.error || 'unknown');
        if (code === 'network') {
          sttNetworkErrors += 1;
          push(lines, 'error', `STT error: network (Google speech path failed) — count ${sttNetworkErrors}`);
        } else if (code === 'no-speech') {
          push(lines, 'warn', 'STT error: no-speech (mic may be quiet or wrong device)');
        } else if (code === 'not-allowed') {
          push(lines, 'error', 'STT error: not-allowed (mic permission)');
          sttOtherErrors.push(code);
        } else if (code === 'audio-capture') {
          push(lines, 'error', 'STT error: audio-capture (mic busy or unavailable)');
          sttOtherErrors.push(code);
        } else if (code === 'aborted') {
          push(lines, 'info', 'STT error: aborted');
        } else {
          push(lines, 'error', `STT error: ${code}`);
          sttOtherErrors.push(code);
        }
      };
      rec.onresult = (event: any) => {
        sttResults += 1;
        try {
          const result = event.results?.[event.results.length - 1];
          const alt = result?.[0];
          const transcript = String(alt?.transcript || '').trim();
          const interim = result && result.isFinal === false;
          if (transcript) {
            sttHeardSpeech = true;
            push(
              lines,
              'ok',
              `STT ${interim ? 'interim' : 'final'}: "${transcript.slice(0, 120)}${transcript.length > 120 ? '…' : ''}"`
            );
          }
        } catch {
          push(lines, 'warn', 'STT onresult (could not read transcript)');
        }
      };

      try {
        rec.start();
      } catch (err: any) {
        push(lines, 'error', `STT start failed: ${err?.message || String(err)}`);
        finish();
        return;
      }

      const timer = window.setTimeout(() => {
        push(lines, 'info', 'STT listen window finished — stopping…');
        try {
          rec.stop();
        } catch {
          finish();
        }
      }, listenMs);

      opts?.signal?.addEventListener('abort', () => {
        window.clearTimeout(timer);
        push(lines, 'warn', 'STT probe aborted by user');
        finish();
      });
    });

    push(lines, 'info', `STT results received: ${sttResults}; network errors: ${sttNetworkErrors}`);
  }

  const likelyUmbrellaBlock = micOk && peakLevel >= 8 && sttNetworkErrors > 0 && !sttHeardSpeech;
  const likelyUmbrellaPartial =
    micOk && sttNetworkErrors > 0 && sttResults === 0;

  let summary: string;
  if (!SpeechRecognitionApi) {
    summary = 'FAIL: Use Chrome or Edge for teleprompter voice follow.';
  } else if (!micOk) {
    summary = 'FAIL: Microphone permission or device issue — fix mic access first.';
  } else if (likelyUmbrellaBlock || likelyUmbrellaPartial) {
    summary =
      'LIKELY NETWORK FILTER: Mic works locally, but speech-to-text cannot reach Google. ' +
      'Ask IT/Umbrella to allow HTTPS to Google speech endpoints (typically www.google.com speech-api / related Google domains on 443). ' +
      speechRecognitionNetworkHelpMessage();
  } else if (sttHeardSpeech || sttResults > 0) {
    summary = 'PASS: Speech-to-text heard speech. Teleprompter voice follow should work on this network.';
  } else if (micOk && peakLevel < 8) {
    summary = 'INCONCLUSIVE: Mic opened but very quiet — check input device/gain, then re-run while speaking.';
  } else {
    summary =
      'INCONCLUSIVE: No transcript and no clear network error. Re-run while speaking clearly; if network errors appear, treat as filter/VPN.';
  }

  push(lines, likelyUmbrellaBlock || likelyUmbrellaPartial ? 'error' : sttHeardSpeech ? 'ok' : 'warn', `SUMMARY: ${summary}`);
  push(lines, 'info', '=== Teleprompter STT diagnostics end ===');
  push(
    lines,
    'info',
    'IT allowlist hint: Chromium Web Speech uses Google cloud STT over HTTPS (often www.google.com/speech-api/…). Do not rely on fixed IPs.'
  );

  const copyText = [
    'ROS Teleprompter STT Diagnostics',
    `Generated: ${new Date().toISOString()}`,
    '',
    summary,
    '',
    ...lines.map((l) => `[${l.t}] ${l.level.toUpperCase()}: ${l.message}`),
  ].join('\n');

  return {
    lines,
    summary,
    likelyUmbrellaBlock: likelyUmbrellaBlock || likelyUmbrellaPartial,
    micOk,
    sttHeardSpeech,
    sttNetworkErrors,
    copyText,
  };
}
