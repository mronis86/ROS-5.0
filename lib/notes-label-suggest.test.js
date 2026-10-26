const assert = require('assert');
const {
  normalizeLooseTime,
  extractNotesPlainLines,
  parseNoteLabelHint,
  suggestNoteLabelActions,
  removePlainLineFromNotesHtml,
} = require('./notes-label-suggest');

assert.strictEqual(normalizeLooseTime('4:45pm'), '16:45');
assert.strictEqual(normalizeLooseTime('4:45 PM'), '16:45');
assert.strictEqual(normalizeLooseTime('16:45'), '16:45');

const vo = parseNoteLabelHint('VO 4:45pm welcome remarks');
assert.strictEqual(vo.type, 'vo');
assert.strictEqual(vo.kind, 'vo');
assert.strictEqual(vo.time, '16:45');
assert.strictEqual(vo.label, 'welcome remarks');

const bgm = parseNoteLabelHint('BGM 10:00 walk in');
assert.strictEqual(bgm.kind, 'bgm');
assert.strictEqual(bgm.time, '10:00');

assert.strictEqual(parseNoteLabelHint('just a normal note'), null);
const typedChip = parseNoteLabelHint('VO - 4:45PM - welcome');
assert.strictEqual(typedChip.type, 'vo');
assert.strictEqual(typedChip.time, '16:45');
assert.strictEqual(typedChip.label, 'welcome');

const settle = parseNoteLabelHint('please settle motion and presenters', '7');
assert.strictEqual(settle.type, 'settle');
assert.strictEqual(settle.cuePrefix, '7');

const settleCue = parseNoteLabelHint('Cue 12.1 settle');
assert.strictEqual(settleCue.cuePrefix, '12');

const html = '<p>VO 4:45 welcome</p><p>settle the room</p><ul data-ros-callout="1"><li>VO - 1:00PM</li></ul>';
const lines = extractNotesPlainLines(html);
assert.deepStrictEqual(lines, ['VO 4:45 welcome', 'settle the room']);

const suggestions = suggestNoteLabelActions(html, { fallbackCue: '3' });
assert.strictEqual(suggestions.length, 2);
assert.strictEqual(suggestions[0].type, 'vo');
assert.strictEqual(suggestions[1].type, 'settle');

const stripped = removePlainLineFromNotesHtml('<p>VO 4:45 welcome</p><p>keep</p>', 'VO 4:45 welcome');
assert.ok(!/VO 4:45 welcome/i.test(stripped));
assert.ok(/keep/i.test(stripped));

const chromeBlocks = extractNotesPlainLines('8.1 Settle<div>8.2 VO test</div><div>Other Line</div><div>8.3 VO 2 test</div>');
assert.deepStrictEqual(chromeBlocks, ['8.1 Settle', '8.2 VO test', 'Other Line', '8.3 VO 2 test']);
const chromeHints = suggestNoteLabelActions(
  '8.1 Settle<div>8.2 VO test</div><div>Other Line</div><div>8.3 VO 2 test</div>',
  { fallbackCue: '8' }
);
assert.strictEqual(chromeHints.length, 3);
assert.strictEqual(chromeHints[0].type, 'settle');
assert.strictEqual(chromeHints[0].cuePrefix, '8');
assert.strictEqual(chromeHints[1].label, 'test');
assert.strictEqual(chromeHints[1].cuePrefix, '8.2');
assert.ok(!/other line/i.test(chromeHints[1].label));
assert.strictEqual(parseNoteLabelHint('8.3 VO 2 test').cuePrefix, '8.3');

console.log('notes-label-suggest ok');
