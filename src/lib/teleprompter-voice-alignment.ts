/**
 * Tokenize script into normalized words with source line indices (0-based).
 */
export type ScriptSpeechToken = {
  word: string;
  lineIndex: number;
};

/** Stage directions in [brackets] — show in script but ignore for speech matching (see voice-teleprompter pattern). */
export function stripBracketHintsForSpeech(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ' ');
}

export function normalizeSpeechToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']/g, '');
}

export function tokenizeScriptForSpeech(scriptText: string): ScriptSpeechToken[] {
  const cleaned = stripBracketHintsForSpeech(scriptText);
  const lines = cleaned.split('\n');
  const tokens: ScriptSpeechToken[] = [];
  for (let li = 0; li < lines.length; li++) {
    const parts = lines[li].split(/\s+/).filter((p) => p.length > 0);
    for (const w of parts) {
      const word = normalizeSpeechToken(w);
      if (word.length > 0) tokens.push({ word, lineIndex: li });
    }
  }
  return tokens;
}

/** Capped Levenshtein for short phrases (inspired by akhhiiillll/voice-teleprompter speech-matcher). */
export function levenshteinDistance(a: string, b: string): number {
  const max = 180;
  const sa = a.length > max ? a.slice(0, max) : a;
  const sb = b.length > max ? b.slice(0, max) : b;
  const m = sa.length;
  const n = sb.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = sa[i - 1] === sb[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/** How far ahead (in script words) we may jump from the committed position without very strong evidence. */
export function maxForwardJumpWords(tailWordCount: number): number {
  return Math.min(56, 10 + Math.max(tailWordCount, 5) * 2);
}

export function shouldAcceptVoiceJump(
  anchorWordIndex: number,
  proposedWordIndex: number,
  tailWordCount: number
): boolean {
  const maxBack = 16;
  if (proposedWordIndex < anchorWordIndex - maxBack) return false;
  const forward = proposedWordIndex - anchorWordIndex;
  if (forward <= 0) return true;
  return forward <= maxForwardJumpWords(tailWordCount);
}

/**
 * Match recognized tail to script using minimum Levenshtein distance over expanding prefixes.
 * More tolerant of mis-hearings than greedy word-by-word scoring alone.
 */
export function alignTranscriptLevenshtein(
  scriptTokens: ScriptSpeechToken[],
  transcriptWords: string[],
  lastWordIndex: number
): { scriptWordIndex: number; lineIndex: number; distance: number } | null {
  const normalized = transcriptWords.map(normalizeSpeechToken).filter((w) => w.length > 0);
  if (normalized.length === 0 || scriptTokens.length === 0) return null;

  const comparisonString = normalized.join(' ').trim();
  if (comparisonString.length < 2) return null;

  let anchor = Math.max(0, Math.min(lastWordIndex, scriptTokens.length - 1));
  const windowLen = Math.min(normalized.length * 2 + 10, 34);
  const slice = scriptTokens.slice(anchor, anchor + windowLen);
  if (slice.length === 0) return null;

  const distances: number[] = [];
  for (let i = 1; i <= slice.length; i++) {
    const refSubstring = slice
      .slice(0, i)
      .map((t) => t.word)
      .join(' ')
      .trim();
    distances.push(levenshteinDistance(comparisonString, refSubstring));
  }
  let minDist = Infinity;
  let idx = 0;
  for (let k = 0; k < distances.length; k++) {
    const d = distances[k];
    if (d < minDist) {
      minDist = d;
      idx = k;
    } else if (d === minDist) {
      idx = Math.min(idx, k);
    }
  }
  const maxAllowed = Math.max(8, Math.min(45, Math.floor(comparisonString.length * 2.2)));
  if (minDist > maxAllowed) return null;

  const scriptWordIndex = Math.min(scriptTokens.length - 1, anchor + idx);
  return {
    scriptWordIndex,
    lineIndex: scriptTokens[scriptWordIndex].lineIndex,
    distance: minDist
  };
}

/**
 * Find script word index best aligned with the tail of transcriptWords.
 * searchAnchor is the last confident script token index (0-based).
 */
export function alignTranscriptWords(
  scriptTokens: ScriptSpeechToken[],
  transcriptWords: string[],
  searchAnchor: number,
  options?: { forwardWindow?: number }
): { scriptWordIndex: number; lineIndex: number; matchScore: number } | null {
  if (scriptTokens.length === 0 || transcriptWords.length === 0) return null;

  const tail = transcriptWords
    .map(normalizeSpeechToken)
    .filter((w) => w.length > 0)
    .slice(-24);

  if (tail.length === 0) return null;

  const forwardWindow = options?.forwardWindow ?? 44;
  const searchStart = Math.max(0, searchAnchor - 8);
  const searchEnd = Math.min(scriptTokens.length - 1, searchAnchor + forwardWindow);

  let bestScore = 0;
  let bestStart = searchAnchor;

  for (let j = searchStart; j <= searchEnd; j++) {
    let score = 0;
    for (let t = 0; t < tail.length && j + t < scriptTokens.length; t++) {
      const sw = scriptTokens[j + t].word;
      const tw = tail[t];
      if (tw.length === 0) continue;
      if (sw === tw) score += 3;
      else if (sw.startsWith(tw) || tw.startsWith(sw)) score += 2;
      else if (tw.length >= 4 && sw.includes(tw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = j;
    } else if (score === bestScore && score > 0) {
      const dOld = Math.abs(bestStart - searchAnchor);
      const dNew = Math.abs(j - searchAnchor);
      if (dNew < dOld || (dNew === dOld && j < bestStart)) {
        bestStart = j;
      }
    }
  }

  if (bestScore < 3) return null;

  const scriptWordIndex = Math.min(
    scriptTokens.length - 1,
    bestStart + Math.max(0, tail.length - 1)
  );
  return {
    scriptWordIndex,
    lineIndex: scriptTokens[scriptWordIndex].lineIndex,
    matchScore: bestScore
  };
}

/**
 * Prefer Levenshtein near anchor, then sliding score. Rejects matches that leap past duplicate phrases
 * unless the spoken tail is long enough to justify the jump.
 */
export function alignTranscriptHybrid(
  scriptTokens: ScriptSpeechToken[],
  transcriptWords: string[],
  searchAnchor: number
): { scriptWordIndex: number; lineIndex: number; matchScore: number } | null {
  const normalized = transcriptWords.map(normalizeSpeechToken).filter((w) => w.length > 0);
  const tailTokens = normalized.slice(-24);
  const tailLen = Math.max(1, tailTokens.length);

  const lev = alignTranscriptLevenshtein(scriptTokens, transcriptWords, searchAnchor);
  let candidate: { scriptWordIndex: number; lineIndex: number; matchScore: number } | null = null;
  if (lev) {
    candidate = {
      scriptWordIndex: lev.scriptWordIndex,
      lineIndex: lev.lineIndex,
      matchScore: Math.max(1, 50 - lev.distance)
    };
  } else {
    candidate = alignTranscriptWords(scriptTokens, transcriptWords, searchAnchor);
  }

  if (!candidate) return null;

  if (shouldAcceptVoiceJump(searchAnchor, candidate.scriptWordIndex, tailLen)) {
    return candidate;
  }

  const maxSpan = maxForwardJumpWords(tailLen);
  const forwardWindow = Math.max(10, maxSpan - Math.max(0, tailLen - 1));
  return alignTranscriptWords(scriptTokens, transcriptWords, searchAnchor, {
    forwardWindow
  });
}

// ── VoicePrompt-style matcher (voiceprompt.live / chgeuer/voice_prompt teleprompter.js) ──

/** Fuzzy word match as in voice_prompt `wordsMatch`. */
export function wordsMatchVoicePrompt(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b.slice(0, -1)) || b.startsWith(a.slice(0, -1))) return true;
  if (a.length > 5 && b.includes(a.slice(0, -1))) return true;
  if (b.length > 5 && a.includes(b.slice(0, -1))) return true;
  return false;
}

export function isSignificantSpeechToken(w: string): boolean {
  return w.length >= 4;
}

/**
 * Local fuzzy alignment near `wordCursor` (script word index), ported from
 * https://github.com/chgeuer/voice_prompt/blob/master/assets/js/hooks/teleprompter.js `processHeardText`.
 */
export function alignTranscriptVoicePrompt(
  scriptTokens: ScriptSpeechToken[],
  heardWordsIn: string[],
  wordCursor: number
): { scriptWordIndex: number; lineIndex: number } | null {
  const heardWords = heardWordsIn.map(normalizeSpeechToken).filter((w) => w.length > 0);
  if (heardWords.length === 0 || scriptTokens.length === 0) return null;

  const wc = Math.max(0, Math.min(wordCursor, scriptTokens.length - 1));
  const searchStart = Math.max(0, wc - 1);
  /** Keep the window tight so duplicate words don't yank us far ahead. */
  const searchEnd = Math.min(
    scriptTokens.length - 1,
    wc + Math.min(14, Math.max(6, heardWords.length * 2 + 2))
  );
  /** Prefer multi-word confirmation; allow a single strong match only for short finals. */
  const minMatchLen = heardWords.length <= 2 ? 1 : 2;

  let bestPos = -1;
  let bestScore = -1;

  for (let scriptPos = searchStart; scriptPos <= searchEnd; scriptPos++) {
    for (let heardStart = 0; heardStart < heardWords.length; heardStart++) {
      let matchLen = 0;
      let significantMatches = 0;
      let si = scriptPos;
      let hi = heardStart;
      let skips = 0;

      while (si <= searchEnd && hi < heardWords.length && skips < 2) {
        const scriptWord = scriptTokens[si]?.word ?? '';
        const heardWord = heardWords[hi];

        if (!heardWord) {
          hi++;
          continue;
        }
        if (!scriptWord) {
          si++;
          continue;
        }

        if (wordsMatchVoicePrompt(scriptWord, heardWord)) {
          matchLen++;
          if (isSignificantSpeechToken(scriptWord)) significantMatches++;
          si++;
          hi++;
          skips = 0;
        } else {
          let skipped = false;
          if (hi + 1 < heardWords.length) {
            const nextHeard = heardWords[hi + 1];
            if (wordsMatchVoicePrompt(scriptWord, nextHeard)) {
              hi++;
              skips++;
              skipped = true;
            }
          }
          if (!skipped && si + 1 <= searchEnd) {
            const nextScript = scriptTokens[si + 1]?.word ?? '';
            if (nextScript && wordsMatchVoicePrompt(nextScript, heardWord)) {
              si++;
              skips++;
              skipped = true;
            }
          }
          if (!skipped) break;
        }
      }

      const effectiveEnd = si - 1;
      if (matchLen < minMatchLen) continue;
      if (significantMatches < 1 && matchLen < 2) continue;

      const jumpDistance = scriptPos - wc;
      if (jumpDistance < -1) continue;
      if (jumpDistance > 8 && matchLen < 3) continue;
      if (jumpDistance > 4 && matchLen < 2) continue;

      // Strong proximity bias — closer matches always beat far ones with similar length
      const proximityBonus = 3.0 - Math.max(0, jumpDistance) * 0.35;
      const score = matchLen * 1.4 + significantMatches * 0.6 + proximityBonus;

      if (score > bestScore) {
        bestScore = score;
        bestPos = effectiveEnd;
      }
    }
  }

  if (bestPos < 0 || bestPos < wc) {
    /** Last resort: next exact/fuzzy word within a few tokens (no long leaps). */
    if (heardWords.length >= 1 && heardWords.length <= 3) {
      const tail = [...heardWords].reverse().find((h) => h.length >= 3);
      if (tail) {
        for (let i = wc; i <= Math.min(scriptTokens.length - 1, wc + 5); i++) {
          if (wordsMatchVoicePrompt(scriptTokens[i].word, tail)) {
            const np = Math.max(wc, i);
            if (np > wc) {
              return { scriptWordIndex: np, lineIndex: scriptTokens[np].lineIndex };
            }
          }
        }
      }
    }
    return null;
  }

  const newPos = Math.max(wc, bestPos);
  /** Cap advance so one noisy recognition can't skip a whole paragraph. */
  const maxJump = Math.min(6, Math.max(2, Math.round(heardWords.length * 1.1)));
  const cappedPos = Math.min(newPos, wc + maxJump);
  if (cappedPos <= wc) return null;

  return {
    scriptWordIndex: cappedPos,
    lineIndex: scriptTokens[cappedPos].lineIndex
  };
}
