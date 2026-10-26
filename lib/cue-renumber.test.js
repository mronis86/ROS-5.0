const assert = require('assert');
const {
  cueBody,
  parseMainCueNumber,
  isCustomCueLabel,
  groupCueBlocks,
  buildCueReorderScope,
  defaultStartNumber,
  previewCueNumbers,
  applyCueReorder,
} = require('./cue-renumber');

assert.strictEqual(cueBody('CUE 12'), '12');
assert.strictEqual(parseMainCueNumber('CUE 12.1'), 12);
assert.strictEqual(isCustomCueLabel('CUE OPEN'), true);
assert.strictEqual(isCustomCueLabel('CUE 7'), false);

const items = [
  { id: 1, day: 1, segmentName: 'Open', customFields: { cue: 'CUE OPEN' } },
  { id: 2, day: 1, segmentName: 'Welcome', customFields: { cue: 'CUE 1' } },
  { id: 3, day: 1, segmentName: 'Settle', customFields: { cue: 'CUE 1.1' }, isIndented: true },
  { id: 4, day: 1, segmentName: 'Keynote', customFields: { cue: 'CUE 5' } },
  { id: 5, day: 1, segmentName: 'Close', customFields: { cue: 'CUE 3' } },
];
const isChild = (item) => !!item.isIndented;
const grouped = groupCueBlocks(items, isChild);
assert.strictEqual(grouped.blocks.length, 4);
assert.strictEqual(grouped.blocks[1].length, 2);

const live = buildCueReorderScope(items, { activeItemId: 2, runningIds: [], isChild });
assert.strictEqual(live.liveLocked, true);
assert.strictEqual(live.locked.map((i) => i.id).join(','), '1,2,3');
assert.strictEqual(live.blocks.map((b) => b[0].id).join(','), '4,5');
assert.strictEqual(defaultStartNumber(live.locked, isChild), 2);

const preview = previewCueNumbers(live.blocks, { startAt: 2, keepCustomLabels: true, numberSubs: true });
assert.deepStrictEqual(preview.rows.map((r) => r.next), ['2', '3']);

const full = previewCueNumbers(grouped.blocks, { startAt: 1, keepCustomLabels: true, numberSubs: true });
assert.strictEqual(full.rows.find((r) => r.id === 1).next, 'OPEN');
assert.strictEqual(full.rows.find((r) => r.id === 2).next, '1');
assert.strictEqual(full.rows.find((r) => r.id === 3).next, '1.1');
assert.strictEqual(full.rows.find((r) => r.id === 4).next, '2');
assert.strictEqual(full.rows.find((r) => r.id === 5).next, '3');

const reordered = applyCueReorder(items, {
  day: 1,
  orderedParentIds: [1, 5, 2, 4],
  isChild,
  numberCues: true,
  startAt: 1,
});
assert.deepStrictEqual(reordered.nextDay.map((i) => i.id), [1, 5, 2, 3, 4]);
assert.strictEqual(reordered.nextDay.find((i) => i.id === 5).customFields.cue, 'CUE 1');
assert.strictEqual(reordered.nextDay.find((i) => i.id === 2).customFields.cue, 'CUE 2');
assert.strictEqual(reordered.nextDay.find((i) => i.id === 3).customFields.cue, 'CUE 2.1');
assert.strictEqual(reordered.orderChanged, true);

const otherDay = [
  ...items,
  { id: 9, day: 2, segmentName: 'Day2', customFields: { cue: 'CUE 1' } },
];
const applied = applyCueReorder(otherDay, {
  day: 1,
  orderedParentIds: [1, 2, 4, 5],
  isChild,
  numberCues: true,
  startAt: 1,
});
assert.strictEqual(applied.schedule.find((i) => i.id === 9).customFields.cue, 'CUE 1');
assert.strictEqual(applied.schedule.filter((i) => i.day === 2).length, 1);

console.log('cue-renumber ok');
