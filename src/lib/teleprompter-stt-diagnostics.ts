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
  verdict: 'pass' | 'fail_mic' | 'fail_browser' | 'fail_filter' | 'fail_quiet' | 'inconclusive';
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

async function probeGoogleSpeechReachability(
  lines: SttDiagLine[]
): Promise<'ok' | 'blocked' | 'unknown'> {
  // no-cors: opaque response means TCP/TLS reached Google; reject/timeout often = filter
  const urls = [
    'https://www.google.com/generate_204',
    'https://www.google.com/speech-api/full-duplex/v1/down?pair=0',
  ];
  let anyOk = false;
  let anyBlocked = false;

  for (const url of urls) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      // Opaque (type "opaque") or any completed fetch = network path exists
      anyOk = true;
      push(
        lines,
        'ok',
        `Google reachability: fetch completed (${url.split('?')[0]}) type=${res.type || 'n/a'}`
      );
    } catch (err: any) {
      anyBlocked = true;
      const name = err?.name || 'Error';
      push(
        lines,
        'error',
        `Google reachability FAILED: ${name} — ${err?.message || String(err)} (${url.split('?')[0]})`
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  if (anyOk && !anyBlocked) return 'ok';
  if (anyBlocked && !anyOk) return 'blocked';
  if (anyOk && anyBlocked) return 'unknown';
  return 'unknown';
}

export type RunSttDiagnosticsOptions = {
  /** Total STT listen window in ms (default 18000) */
  listenMs?: number;
  /** Mic meter sample window in ms (default 3000) */
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
  const listenMs = opts?.listenMs ?? 18000;
  const meterMs = opts?.meterMs ?? 3000;
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

  let googleReach: 'ok' | 'blocked' | 'unknown' = 'unknown';
  if (!aborted()) {
    push(lines, 'info', 'Probing Google HTTPS reachability (Umbrella/firewall check)…');
    googleReach = await probeGoogleSpeechReachability(lines);
    push(
      lines,
      googleReach === 'ok' ? 'ok' : googleReach === 'blocked' ? 'error' : 'warn',
      `Google reachability verdict: ${googleReach}`
    );
  }

  let sttHeardSpeech = false;
  let sttNetworkErrors = 0;
  let sttResults = 0;
  let sttNoSpeech = 0;
  let sttStartCount = 0;
  let sttAudioStartCount = 0;
  let sttEndCount = 0;
  let sttOtherErrors: string[] = [];

  if (!SpeechRecognitionApi) {
    push(lines, 'error', 'Skipping STT probe — API unavailable.');
  } else if (aborted()) {
    push(lines, 'warn', 'Diagnostics aborted before STT probe.');
  } else {
    // Release local mic so SpeechRecognition can take it (Chrome exclusive)
    await new Promise((r) => setTimeout(r, isEdgeBrowser() ? 600 : 300));

    push(
      lines,
      'info',
      `STT probe ${Math.round(listenMs / 1000)}s with auto-restart — speak clearly the whole time…`
    );
    push(
      lines,
      'info',
      'Note: Chrome/Edge send audio to Google speech servers. ROS does not host STT.'
    );

    await new Promise<void>((resolve) => {
      let settled = false;
      let rec: any = null;
      let restartTimer: number | null = null;
      const deadline = Date.now() + listenMs;

      const clearRestart = () => {
        if (restartTimer != null) {
          window.clearTimeout(restartTimer);
          restartTimer = null;
        }
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        clearRestart();
        window.clearTimeout(windowTimer);
        try {
          rec?.stop?.();
        } catch {
          /* ignore */
        }
        try {
          rec?.abort?.();
        } catch {
          /* ignore */
        }
        resolve();
      };

      const startRec = () => {
        if (settled || aborted() || Date.now() >= deadline) {
          finish();
          return;
        }
        rec = new SpeechRecognitionApi();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        try {
          rec.maxAlternatives = isEdgeBrowser() ? 1 : 3;
        } catch {
          /* ignore */
        }

        rec.onaudiostart = () => {
          sttAudioStartCount += 1;
          push(lines, 'ok', 'STT event: onaudiostart (engine opened audio)');
        };
        rec.onaudioend = () => push(lines, 'info', 'STT event: onaudioend');
        rec.onsoundstart = () => push(lines, 'ok', 'STT event: onsoundstart');
        rec.onspeechstart = () => {
          sttHeardSpeech = true;
          push(lines, 'ok', 'STT event: onspeechstart');
        };
        rec.onspeechend = () => push(lines, 'info', 'STT event: onspeechend');
        rec.onstart = () => {
          sttStartCount += 1;
          push(lines, 'ok', `STT event: onstart (#${sttStartCount})`);
        };
        rec.onend = () => {
          sttEndCount += 1;
          push(lines, 'info', `STT event: onend (#${sttEndCount})`);
          if (settled || aborted() || Date.now() >= deadline) {
            finish();
            return;
          }
          // Same as live teleprompter: restart until window ends (don't stop on first no-speech)
          const delay =
            sttNetworkErrors > 0
              ? Math.min(4000, 800 * sttNetworkErrors)
              : isEdgeBrowser()
                ? 400
                : 250;
          clearRestart();
          restartTimer = window.setTimeout(() => {
            try {
              startRec();
            } catch (err: any) {
              push(lines, 'warn', `STT restart failed: ${err?.message || String(err)}`);
              finish();
            }
          }, delay);
        };
        rec.onerror = (e: any) => {
          const code = String(e?.error || 'unknown');
          if (code === 'network') {
            sttNetworkErrors += 1;
            push(
              lines,
              'error',
              `STT error: network (Google speech path failed) — count ${sttNetworkErrors}`
            );
          } else if (code === 'no-speech') {
            sttNoSpeech += 1;
            push(lines, 'warn', `STT error: no-speech (#${sttNoSpeech})`);
          } else if (code === 'not-allowed') {
            push(lines, 'error', 'STT error: not-allowed (mic permission)');
            sttOtherErrors.push(code);
            finish();
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
                `STT ${interim ? 'interim' : 'final'}: "${transcript.slice(0, 120)}${
                  transcript.length > 120 ? '…' : ''
                }"`
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
        }
      };

      const windowTimer = window.setTimeout(() => {
        push(lines, 'info', 'STT listen window finished — stopping…');
        finish();
      }, listenMs);

      opts?.signal?.addEventListener('abort', () => {
        push(lines, 'warn', 'STT probe aborted by user');
        finish();
      });

      startRec();
    });

    push(
      lines,
      'info',
      `STT tallies: starts=${sttStartCount} audiostart=${sttAudioStartCount} results=${sttResults} network=${sttNetworkErrors} no-speech=${sttNoSpeech} ends=${sttEndCount}`
    );
  }

  const micLoud = peakLevel >= 8;
  const gotTranscript = sttHeardSpeech || sttResults > 0;
  const silentCloud =
    micOk &&
    micLoud &&
    sttStartCount > 0 &&
    sttResults === 0 &&
    sttNetworkErrors === 0 &&
    sttAudioStartCount === 0 &&
    sttEndCount >= 2;
  const filterByNetwork = micOk && sttNetworkErrors > 0 && !gotTranscript;
  const filterByGoogleProbe =
    micOk && micLoud && !gotTranscript && googleReach === 'blocked';
  const likelyUmbrellaBlock = filterByNetwork || filterByGoogleProbe || silentCloud;

  let verdict: SttDiagResult['verdict'];
  let summary: string;

  if (!SpeechRecognitionApi) {
    verdict = 'fail_browser';
    summary = 'FAIL: Use Chrome or Edge for teleprompter voice follow.';
  } else if (!micOk || sttOtherErrors.includes('not-allowed')) {
    verdict = 'fail_mic';
    summary = 'FAIL: Microphone permission or device issue — fix mic access first.';
  } else if (gotTranscript) {
    verdict = 'pass';
    summary =
      'PASS: Speech-to-text returned a transcript. Teleprompter voice follow should work on this PC/network.';
  } else if (likelyUmbrellaBlock) {
    verdict = 'fail_filter';
    summary =
      'FAIL — LIKELY UMBRELLA / NETWORK FILTER: Local mic works, but Google speech-to-text is blocked or unreachable. ' +
      'IT action: allow HTTPS (443) from this PC to Google (www.google.com and Chromium Web Speech / speech-api endpoints). ' +
      'Do not use fixed IPs. ' +
      speechRecognitionNetworkHelpMessage();
  } else if (micOk && !micLoud && !gotTranscript) {
    verdict = 'fail_quiet';
    summary =
      'FAIL: Mic opened but stayed very quiet — pick the correct input, raise gain, speak during the whole test, then re-run.';
  } else if (sttOtherErrors.includes('audio-capture')) {
    verdict = 'fail_mic';
    summary =
      'FAIL: Audio capture error — close other tabs using the mic (especially Edge), then re-run in Chrome if possible.';
  } else {
    verdict = 'inconclusive';
    summary =
      'INCONCLUSIVE: No transcript and no clear block signal. Re-run while speaking the entire countdown; try Chrome; confirm Windows default mic matches the selected device.';
  }

  push(
    lines,
    verdict === 'pass' ? 'ok' : verdict === 'inconclusive' ? 'warn' : 'error',
    `SUMMARY [${verdict}]: ${summary}`
  );
  push(lines, 'info', '=== Teleprompter STT diagnostics end ===');
  push(
    lines,
    'info',
    'IT allowlist hint: Chromium Web Speech → Google cloud STT over HTTPS (often www.google.com/speech-api/…). Avoid IP allowlists.'
  );

  const copyText = [
    'ROS Teleprompter STT Diagnostics',
    `Generated: ${new Date().toISOString()}`,
    `Verdict: ${verdict}`,
    '',
    summary,
    '',
    `Mic OK: ${micOk} | Peak: ${peakLevel}/100 | Google probe: ${googleReach}`,
    `STT: starts=${sttStartCount} audiostart=${sttAudioStartCount} results=${sttResults} network=${sttNetworkErrors} no-speech=${sttNoSpeech}`,
    '',
    ...lines.map((l) => `[${l.t}] ${l.level.toUpperCase()}: ${l.message}`),
  ].join('\n');

  return {
    lines,
    summary,
    verdict,
    likelyUmbrellaBlock,
    micOk,
    sttHeardSpeech,
    sttNetworkErrors,
    copyText,
  };
}
