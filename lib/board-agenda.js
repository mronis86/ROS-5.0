/**
 * Simplified Event Board agenda: Times | Subject | Info.
 * Built for PDF/Word dumps, not a timed cue sheet.
 */

const TIME_RANGE =
  /(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?)\s*[-–—to]+\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?)/i;

const STARTS_WITH_TIME =
  /^\s*[•\-\u2022*]?\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?(?:\s*[-–—]\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?)?)\s*[-–—:]?\s*(.*)$/i;

const HEADER_LINE =
  /^(agenda|schedule|date|day\s*\d+|location|venue|page\s+\d+|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/i;

function cleanLine(line) {
  return String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isSkippable(line) {
  const t = cleanLine(line);
  if (!t) return true;
  if (HEADER_LINE.test(t)) return true;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return true;
  if (/^(time|times)\s+(subject|topic|session|title)/i.test(t)) return true;
  return false;
}

function formatClock(raw) {
  let s = cleanLine(raw).replace(/\s+/g, ' ');
  s = s.replace(/\ba\s*\.\s*m\s*\.?/gi, 'AM').replace(/\bp\s*\.\s*m\s*\.?/gi, 'PM');
  s = s.replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
  return s;
}

function splitTimeAndRest(line) {
  const t = cleanLine(line);
  const range = t.match(TIME_RANGE);
  if (range && t.indexOf(range[0]) <= 2) {
    const time = `${formatClock(range[1])} – ${formatClock(range[2])}`;
    const rest = t.slice(range.index + range[0].length).replace(/^[\s:–—-]+/, '').trim();
    return { time, rest };
  }
  const start = t.match(STARTS_WITH_TIME);
  if (!start) return null;
  const time = formatClock(start[1]);
  if (!/\d/.test(time)) return null;
  return { time, rest: cleanLine(start[2]) };
}

function parseTabRows(lines) {
  const items = [];
  for (const line of lines) {
    const cells = line.split('\t').map((c) => cleanLine(c)).filter((c, i, arr) => c || arr.some(Boolean));
    const filled = cells.filter(Boolean);
    if (filled.length < 2) continue;
    if (/^(time|times|start)$/i.test(filled[0]) && /subject|topic|session|title/i.test(filled[1] || '')) continue;
    const timed = splitTimeAndRest(filled[0]);
    if (timed) {
      items.push({
        time: timed.time,
        subject: timed.rest || filled[1] || '',
        info: [timed.rest ? filled[1] : '', ...filled.slice(2)].filter(Boolean).join(' · '),
      });
      continue;
    }
    items.push({
      time: filled[0],
      subject: filled[1] || '',
      info: filled.slice(2).join(' · '),
    });
  }
  return items;
}

function parseBoardAgenda(rawText) {
  const raw = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').map(cleanLine);
  const nonempty = lines.filter(Boolean);
  const tabby = nonempty.filter((l) => l.includes('\t'));
  if (tabby.length >= 2 && tabby.length >= nonempty.length * 0.4) {
    const items = parseTabRows(lines);
    return { items, text: formatBoardAgenda(items) };
  }

  const items = [];
  let current = null;

  const push = () => {
    if (!current) return;
    const subject = cleanLine(current.subject);
    const info = current.info.map(cleanLine).filter(Boolean).join(' · ');
    if (current.time || subject || info) {
      items.push({
        time: current.time || '',
        subject: subject || info || 'Agenda item',
        info: subject ? info : '',
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (!line || isSkippable(line)) continue;
    const timed = splitTimeAndRest(line);
    if (timed) {
      push();
      current = { time: timed.time, subject: '', info: [] };
      const parts = timed.rest.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length) current.subject = parts[0];
      if (parts.length > 1) current.info.push(...parts.slice(1));
      continue;
    }
    if (!current) {
      current = { time: '', subject: line, info: [] };
      continue;
    }
    if (!current.subject) current.subject = line;
    else current.info.push(line);
  }
  push();

  const useful = items.filter((row) => row.time || row.subject);
  return { items: useful, text: formatBoardAgenda(useful) };
}

function formatBoardAgenda(items) {
  return (items || [])
    .map((row) => [row.time, row.subject, row.info].filter(Boolean).join(' — '))
    .join('\n');
}

module.exports = { parseBoardAgenda, formatBoardAgenda };
