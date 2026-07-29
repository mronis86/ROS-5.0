const assert = require('assert');
const { resolveRowIndex, normalizeCueKey } = require('../electron/row-matcher');
const { parseDataSourceNames, parseDataSourceCatalog } = require('../electron/vmix-client');

assert.strictEqual(normalizeCueKey('CUE 12'), '12');
assert.strictEqual(normalizeCueKey('cue  12'), '12');

const schedule = [
  { id: 1, day: 1, customFields: { cue: 'CUE 1' }, segmentName: 'Open' },
  { id: 5, day: 1, customFields: { cue: 'CUE 5' }, segmentName: 'Keynote' },
  { id: 12, day: 1, customFields: { cue: 'CUE 12' }, segmentName: 'Break' },
];

const byIndex = resolveRowIndex('rowIndex', {
  scheduleItems: schedule,
  itemId: 12,
});
assert.strictEqual(byIndex.ok, true);
assert.strictEqual(byIndex.index, 2);

const byCue = resolveRowIndex('cueColumn', {
  scheduleItems: schedule,
  itemId: 12,
  timerRow: { cue_is: 'CUE 12', timer_state: 'loaded' },
});
assert.strictEqual(byCue.ok, true);
assert.strictEqual(byCue.index, 2);

const dayFiltered = resolveRowIndex('rowIndex', {
  scheduleItems: [
    { id: 1, day: 1, customFields: { cue: 'CUE 1' } },
    { id: 2, day: 2, customFields: { cue: 'CUE 2' } },
  ],
  itemId: 2,
  dayFilter: 2,
});
assert.strictEqual(dayFiltered.ok, true);
assert.strictEqual(dayFiltered.index, 0);

const names = parseDataSourceNames(
  '<vmix><dataSources><dataSource name="Schedule" /><dataSource name="LowerThirds" /></dataSources></vmix>'
);
assert.deepStrictEqual(names, ['LowerThirds', 'Schedule']);

const catalog = parseDataSourceCatalog(`
<dataSources>
  <dataSource name="ShowBook">
    <table name="Sheet1" />
    <sheet name="Day2" />
    <key name="Speakers" />
  </dataSource>
  <dataSource name="CSVFeed" />
</dataSources>
`);
assert.strictEqual(catalog.length, 2);
const book = catalog.find((c) => c.name === 'ShowBook');
assert.ok(book);
assert.deepStrictEqual(book.tables, ['Day2', 'Sheet1', 'Speakers']);

console.log('row-matcher + vmix catalog tests OK');
