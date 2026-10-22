/** Cue follow for Scripts Follow / Teleprompter. */

export const CUE_MARKER_RE = /\[\[\s*cue\s*:?\s*([0-9A-Za-z._-]+)\s*\]\]/i;

export function normalizeCueKey(raw: unknown): string | null {
  if (raw == null) return null;
  const stripped = String(raw)
    .trim()
    .replace(/^cue\s*/i, '')
    .trim();
  return stripped ? stripped.toLowerCase() : null;
}

export function isCueMarkerScriptLine(line: string): boolean {
  return /^\s*\[\[\s*cue\s*:?\s*[0-9A-Za-z._-]+\s*\]\]\s*$/i.test(line);
}

export function parseCueMarkers(scriptText: string): Record<string, number> {
  const out: Record<string, number> = {};
  String(scriptText || '')
    .split('\n')
    .forEach((line, index) => {
      const match = line.match(CUE_MARKER_RE);
      if (!match) return;
      const key = normalizeCueKey(match[1]);
      if (key && out[key] == null) out[key] = index;
    });
  return out;
}

export function formatCueMarker(cueLabel: string): string {
  const key = normalizeCueKey(cueLabel) || String(cueLabel || '').trim();
  return `[[CUE ${key}]]`;
}

export function cueKeyFromScheduleItem(item: {
  id?: unknown;
  customFields?: { cue?: unknown } | null;
}): string | null {
  return normalizeCueKey(item?.customFields?.cue);
}

export type ScriptCueBinding = {
  event_id: string;
  item_id: number;
  script_id: string;
  jump_line: number | null;
};

export type ScriptCueFollowPayload = {
  eventId: string;
  itemId: number;
  cueKey?: string | null;
  cueLabel?: string;
  scriptId?: string | null;
  scriptName?: string;
  scriptText?: string;
  comments?: unknown[];
  voiceIgnoreLines?: number[];
  jumpLine: number | null;
  reason: 'binding' | 'marker';
};

/** Client fallback when Railway has not emitted scriptCueFollow yet. */
export async function loadFollowForLoadedCue(opts: {
  eventId: string;
  itemId: number;
  currentScriptText: string;
  apiBase: string;
  headers: HeadersInit;
}): Promise<ScriptCueFollowPayload | null> {
  const itemId = Number(opts.itemId);
  if (!opts.eventId || !Number.isFinite(itemId)) return null;
  let cueKey: string | null = null;
  let cueLabel = '';
  let binding: ScriptCueBinding | null = null;
  try {
    const bindRes = await fetch(`${opts.apiBase}/api/script-cue-bindings/${opts.eventId}`, {
      headers: opts.headers,
    });
    if (bindRes.ok) {
      const data = await bindRes.json();
      const cues = Array.isArray(data?.cues) ? data.cues : [];
      const cue = cues.find((row: { item_id?: unknown }) => Number(row.item_id) === itemId);
      cueKey = cue?.cue_key || normalizeCueKey(cue?.cue) || null;
      cueLabel = String(cue?.label || '');
      binding =
        (Array.isArray(data?.bindings) ? data.bindings : []).find(
          (row: ScriptCueBinding) => Number(row.item_id) === itemId
        ) || null;
    }
  } catch {
    /* bindings route may not exist until API deploy */
  }

  if (binding?.script_id) {
    const scriptRes = await fetch(`${opts.apiBase}/api/scripts/${binding.script_id}`, {
      headers: opts.headers,
    });
    if (!scriptRes.ok) return null;
    const packed = await scriptRes.json();
    const script = packed.script || packed;
    const text = String(script.script_text || '');
    const markers = parseCueMarkers(text);
    const jumpLine =
      binding.jump_line != null && Number.isFinite(Number(binding.jump_line))
        ? Number(binding.jump_line)
        : cueKey != null && markers[cueKey] != null
          ? markers[cueKey]
          : 0;
    return {
      eventId: opts.eventId,
      itemId,
      cueKey,
      cueLabel,
      scriptId: String(script.id || binding.script_id),
      scriptName: script.script_name || '',
      scriptText: text,
      comments: packed.comments || [],
      voiceIgnoreLines: script.voice_ignore_lines || [],
      jumpLine,
      reason: 'binding',
    };
  }

  const markers = parseCueMarkers(opts.currentScriptText);
  if (!cueKey) {
    try {
      const rosRes = await fetch(`${opts.apiBase}/api/run-of-show-data/${opts.eventId}`, {
        headers: opts.headers,
      });
      if (rosRes.ok) {
        const ros = await rosRes.json();
        const rawItems = ros?.schedule_items;
        const items = Array.isArray(rawItems)
          ? rawItems
          : typeof rawItems === 'string'
            ? JSON.parse(rawItems)
            : [];
        const item = items.find((row: { id?: unknown }) => Number(row.id) === itemId);
        cueKey = normalizeCueKey(item?.customFields?.cue ?? item?.custom_fields?.cue);
        cueLabel = String(item?.customFields?.cue || item?.segmentName || '');
      }
    } catch {
      return null;
    }
  }
  if (!cueKey || markers[cueKey] == null) return null;
  return {
    eventId: opts.eventId,
    itemId,
    cueKey,
    cueLabel,
    jumpLine: markers[cueKey],
    reason: 'marker',
  };
}
