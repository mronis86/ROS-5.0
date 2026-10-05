/**
 * Rewrite soft/pastel notes HTML colors to high-contrast stage-readable values.
 * Used when displaying notes in the grid and when opening the notes editor.
 */

const HIGHLIGHT_HEX: Record<string, string> = {
  '#fbbf24': '#ffe600',
  '#facc15': '#ffe600',
  '#fde047': '#ffe600',
  '#60a5fa': '#00b0ff',
  '#38bdf8': '#00b0ff',
  '#3b82f6': '#00b0ff',
  '#93c5fd': '#00b0ff',
  '#4ade80': '#00e676',
  '#22c55e': '#00e676',
  '#f472b6': '#ff4081',
  '#fb923c': '#ff9100',
  '#f97316': '#ff9100',
};

const TEXT_HEX: Record<string, string> = {
  // Soft / neon → darker stage-readable text colors
  '#ef4444': '#dc2626',
  '#f87171': '#dc2626',
  '#ff5252': '#dc2626',
  '#3b82f6': '#2563eb',
  '#60a5fa': '#2563eb',
  '#93c5fd': '#2563eb',
  '#7dd3fc': '#2563eb',
  '#22c55e': '#15803d',
  '#4ade80': '#15803d',
  '#69f0ae': '#15803d',
  '#16a34a': '#15803d',
  '#a855f7': '#7e22ce',
  '#c084fc': '#7e22ce',
  '#e040fb': '#7e22ce',
  '#f97316': '#ea580c',
  '#fb923c': '#ea580c',
  '#ffab40': '#ea580c',
};

const DARK_ON_HIGHLIGHT = '#111111';

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function normalizeColorToken(raw: string): string | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'inherit' || s === 'currentcolor') return null;
  if (s.startsWith('#')) {
    if (s.length === 4) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    return s.slice(0, 7);
  }
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function mapHighlight(hex: string): string {
  return HIGHLIGHT_HEX[hex] || hex;
}

function mapText(hex: string): string {
  return TEXT_HEX[hex] || hex;
}

function isCalloutChip(el: HTMLElement): boolean {
  if (el.closest('[data-settle-cue],[data-stage-direction]')) return true;
  const styleAttr = el.getAttribute('style') || '';
  // VO/BGM chips use background: shorthand + border; highlighter uses background-color
  if (
    /(?:^|;)\s*background\s*:/i.test(styleAttr) &&
    !/(?:^|;)\s*background-color\s*:/i.test(styleAttr) &&
    /border\s*:/i.test(styleAttr)
  ) {
    return true;
  }
  return false;
}

function boostElementColors(root: HTMLElement): void {
  const all = root.querySelectorAll<HTMLElement>('*');
  all.forEach((el) => {
    if (isCalloutChip(el)) return;

    const styleAttr = el.getAttribute('style') || '';
    const hasHighlighterBg =
      /(?:^|;)\s*background-color\s*:/i.test(styleAttr) &&
      !/(?:^|;)\s*background-color\s*:\s*transparent/i.test(styleAttr);

    const bg = el.style?.backgroundColor;
    if (hasHighlighterBg && bg && bg !== 'transparent') {
      const hex = normalizeColorToken(bg);
      if (hex) {
        el.style.backgroundColor = mapHighlight(hex);
      }
      el.style.color = DARK_ON_HIGHLIGHT;
      el.style.fontWeight = '800';
      el.querySelectorAll('font').forEach((font) => {
        font.setAttribute('color', DARK_ON_HIGHLIGHT);
        (font as HTMLElement).style.color = DARK_ON_HIGHLIGHT;
        (font as HTMLElement).style.fontWeight = '800';
      });
      return;
    }

    const inlineColor = el.style?.color;
    if (inlineColor) {
      const hex = normalizeColorToken(inlineColor);
      if (hex && hex !== '#ffffff' && hex !== '#000000' && hex !== '#0f172a' && hex !== '#111111') {
        el.style.color = mapText(hex);
        if (!el.style.fontWeight) el.style.fontWeight = '700';
      }
    }

    if (el.tagName === 'FONT') {
      const attr = el.getAttribute('color');
      const hex = normalizeColorToken(attr || '');
      if (hex && hex !== '#ffffff' && hex !== '#000000' && hex !== '#0f172a' && hex !== '#111111') {
        const next = mapText(hex);
        el.setAttribute('color', next);
        el.style.color = next;
        if (!el.style.fontWeight) el.style.fontWeight = '700';
      }
    }
  });
}

/** String-level fallback when DOM is unavailable. */
function boostNotesContrastHtmlString(html: string): string {
  let out = html;
  const pairs: Array<[RegExp, string]> = [
    [/rgb\(\s*251\s*,\s*191\s*,\s*36\s*\)/gi, '#ffe600'],
    [/#fbbf24\b/gi, '#ffe600'],
    [/#facc15\b/gi, '#ffe600'],
    [/rgb\(\s*96\s*,\s*165\s*,\s*250\s*\)/gi, '#00b0ff'],
    [/#60a5fa\b/gi, '#00b0ff'],
    [/rgb\(\s*74\s*,\s*222\s*,\s*128\s*\)/gi, '#00e676'],
    [/#4ade80\b/gi, '#00e676'],
    [/rgb\(\s*244\s*,\s*114\s*,\s*182\s*\)/gi, '#ff4081'],
    [/#f472b6\b/gi, '#ff4081'],
    [/rgb\(\s*251\s*,\s*146\s*,\s*60\s*\)/gi, '#ff9100'],
    [/#fb923c\b/gi, '#ff9100'],
  ];
  for (const [re, to] of pairs) out = out.replace(re, to);
  return out;
}

/**
 * Boost contrast for notes HTML shown in the ROS grid / editor.
 * Skips VO/Stage chips that use `background:` (not background-color) in most cases;
 * DOM walk only adjusts style.backgroundColor / color / font[color].
 */
export function boostNotesContrastHtml(html: string): string {
  if (!html) return html;
  if (typeof document === 'undefined') {
    return boostNotesContrastHtmlString(html);
  }
  try {
    const root = document.createElement('div');
    root.innerHTML = html;
    boostElementColors(root);
    return root.innerHTML;
  } catch {
    return boostNotesContrastHtmlString(html);
  }
}
