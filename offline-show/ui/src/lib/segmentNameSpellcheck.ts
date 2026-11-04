/** Offline: spellcheck dictionary omitted — helpers no-op so ScheduleRow still builds. */

export function subscribeSegmentSpellcheck(onStoreChange: () => void): () => void {
  void onStoreChange;
  return () => {};
}

export function getSegmentSpellcheckVersion(): number {
  return 0;
}

export function misspelledSegmentWords(_text: string, _ignored?: Iterable<string>): string[] {
  return [];
}

export function normalizeSpellingOk(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function addSpellingOk(existing: unknown, word: string): string[] {
  return normalizeSpellingOk([...(Array.isArray(existing) ? existing : []), word]);
}

export function suggestSegmentWord(_word: string): string[] {
  return [];
}

export function replaceSegmentWord(text: string, from: string, to: string): string {
  const source = String(text || '');
  if (!from || !source) return source;
  const TOKEN_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  return source.replace(TOKEN_RE, (token) => (token === from ? String(to || '') : token));
}
