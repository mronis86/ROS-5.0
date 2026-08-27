import { loadPdfJs } from './pdfJsLoader';

/** Normalized cue key → 1-based PDF page (first match wins). */
export type CreativeCuePages = Record<string, number>;

const CUE_ON_PAGE_RE = /\bCUE\s*([0-9]+[A-Za-z]?)\b/gi;

/** `CUE 1` / `CUE1` / `cue 2a` → `CUE1` / `CUE2A` */
export function normalizeCueKey(label: string): string {
  return String(label || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function parseCreativeCuePages(raw: unknown): CreativeCuePages {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CreativeCuePages = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const page = Number(value);
    if (!key || !Number.isInteger(page) || page < 1) continue;
    out[normalizeCueKey(key)] = page;
  }
  return out;
}

export function lookupCuePage(map: CreativeCuePages | null | undefined, cueLabel: string): number | null {
  if (!map) return null;
  const key = normalizeCueKey(cueLabel);
  if (!key) return null;
  if (map[key] != null) return map[key];
  // Label might be "1" or "2A" without CUE prefix
  const withCue = normalizeCueKey(`CUE ${cueLabel}`);
  if (map[withCue] != null) return map[withCue];
  return null;
}

function pageTextFromContent(content: { items: Array<{ str?: string }> }): string {
  return (content.items || []).map((item) => String(item.str || '')).join(' ');
}

/**
 * Scan each PDF page for text like "CUE 1" / "CUE2A".
 * First page that mentions a cue wins (typically the section start).
 */
export async function scanPdfForCuePages(
  source: ArrayBuffer | Uint8Array | string
): Promise<{ pages: CreativeCuePages; numPages: number }> {
  const pdfjsLib = await loadPdfJs();
  const loadingTask =
    typeof source === 'string'
      ? pdfjsLib.getDocument({ url: source })
      : pdfjsLib.getDocument({ data: source });
  const pdf = await loadingTask.promise;
  const pages: CreativeCuePages = {};

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = pageTextFromContent(content);
    CUE_ON_PAGE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CUE_ON_PAGE_RE.exec(text)) !== null) {
      const key = normalizeCueKey(`CUE ${match[1]}`);
      if (pages[key] == null) pages[key] = pageNumber;
    }
  }

  return { pages, numPages: pdf.numPages };
}

/** True when we can drive page jumps with PDF.js (not Drive / Office Online). */
export function isPdfJsNavigableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('view.officeapps.live.com')) return false;
  if (u.includes('docs.google.com') || u.includes('drive.google.com')) return false;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  // Railway signed URLs often include the original filename in the path
  if (u.includes('/content-review/') && u.includes('.pdf')) return true;
  if (u.includes('pdf') && (u.includes('x-amz') || u.includes('amazonaws') || u.includes('r2.cloudflare'))) {
    return true;
  }
  return false;
}
