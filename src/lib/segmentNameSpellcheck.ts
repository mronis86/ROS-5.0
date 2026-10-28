/** Local English spellcheck for the Segment Name column only. */

import affUrl from '../assets/spellcheck/en.aff?url';
import dicUrl from '../assets/spellcheck/en.dic?url';

type NSpell = {
  correct: (word: string) => boolean
  suggest: (word: string) => string[]
  add: (word: string) => void
}

const SHOW_WORDS = [
  'b2b',
  'civics',
  'comms',
  'endshow',
  'f&b',
  'gfx',
  'hyperdeck',
  'keynote',
  'led',
  'lowerthird',
  'mitti',
  'osc',
  'podium',
  'preshow',
  'ppt',
  'pre-show',
  'q&a',
  'resolume',
  'ros',
  'rundown',
  'teleprompter',
  'ted-talk',
  'tedtalk',
  'trt',
  'ultritouch',
  'vmix',
  'vo',
]

let spell: NSpell | null = null
let version = 0
let loadStarted = false
const listeners = new Set<() => void>()

function emit() {
  version += 1
  listeners.forEach((fn) => fn())
}

export function subscribeSegmentSpellcheck(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  void ensureSegmentSpellcheck()
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function getSegmentSpellcheckVersion(): number {
  return version
}

async function ensureSegmentSpellcheck(): Promise<void> {
  if (spell || loadStarted) return
  loadStarted = true
  try {
    const nspellMod = await import('nspell')
    const create = (nspellMod as { default?: unknown }).default ?? nspellMod
    const [aff, dic] = await Promise.all([
      fetch(affUrl).then((r) => r.text()),
      fetch(dicUrl).then((r) => r.text()),
    ])
    const next = (create as (aff: string, dic: string) => NSpell)(aff, dic)
    for (const word of SHOW_WORDS) next.add(word)
    spell = next
    emit()
  } catch {
    loadStarted = false
  }
}

const TOKEN_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g

function skipToken(word: string): boolean {
  if (word.length < 2) return true
  if (/[0-9]/.test(word)) return true
  if (/^[A-Z]{2,6}$/.test(word)) return true
  return false
}

export function misspelledSegmentWords(text: string, ignored?: Iterable<string>): string[] {
  if (!spell) return []
  const raw = String(text || '')
  if (!raw.trim()) return []
  const skip = new Set(
    Array.from(ignored || [], (word) => String(word || '').toLowerCase()).filter(Boolean)
  )
  const seen = new Set<string>()
  const out: string[] = []
  TOKEN_RE.lastIndex = 0
  const tokens = raw.match(TOKEN_RE) || []
  for (const token of tokens) {
    if (skipToken(token)) continue
    const key = token.toLowerCase()
    if (seen.has(key) || skip.has(key)) continue
    seen.add(key)
    const check = token.includes("'") ? token.replace(/'s$/i, '') : token
    if (skipToken(check)) continue
    if (spell.correct(check) || spell.correct(check.toLowerCase())) continue
    out.push(token)
  }
  return out
}

export function normalizeSpellingOk(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    const key = String(value || '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function addSpellingOk(existing: unknown, word: string): string[] {
  return normalizeSpellingOk([...(Array.isArray(existing) ? existing : []), word])
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = cur
    }
  }
  return row[b.length]
}

function isCloseSuggestion(word: string, suggestion: string): boolean {
  const a = word.toLowerCase()
  const b = suggestion.toLowerCase()
  if (a.slice(0, 3) === b.slice(0, 3)) return true
  const limit = Math.max(a.length, b.length) <= 4 ? 1 : 2
  return editDistance(a, b) <= limit
}

export function suggestSegmentWord(word: string): string[] {
  if (!word) return []
  const seen = new Set<string>([word.toLowerCase()])
  const out: string[] = []
  const push = (value: string) => {
    const next = String(value || '').trim()
    if (!next) return
    const key = next.toLowerCase()
    if (seen.has(key) || !isCloseSuggestion(word, next)) return
    seen.add(key)
    out.push(next)
  }
  const prefix = word.toLowerCase().slice(0, 3)
  if (prefix.length >= 3) {
    for (const showWord of SHOW_WORDS) {
      if (showWord.startsWith(prefix)) push(showWord)
    }
  }
  if (spell) {
    try {
      for (const suggestion of spell.suggest(word) || []) push(suggestion)
    } catch {
      /* dictionary suggest is optional */
    }
  }
  return out.slice(0, 1)
}

export function replaceSegmentWord(text: string, from: string, to: string): string {
  const source = String(text || '')
  const target = String(to || '')
  if (!from || !source) return source
  TOKEN_RE.lastIndex = 0
  return source.replace(TOKEN_RE, (token) => (token === from ? target : token))
}
