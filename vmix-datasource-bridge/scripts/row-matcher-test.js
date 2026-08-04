const assert = require('assert');
const { resolveRowIndex, normalizeCueKey } = require('../electron/row-matcher');
const {
  parseFeed,
  parseCsvFeed,
  parseXmlFeed,
  withDayQuery,
  vmixIndexForRow,
} = require('../electron/feed-parser');
const { parseDataSourceNames, parseDataSourceCatalog, buildSelectValueCandidates } = require('../electron/vmix-client');

assert.strictEqual(normalizeCueKey('CUE 12'), '12');
assert.strictEqual(normalizeCueKey('cue  12'), '12');

const schedule = [
  { id: 1, day: 1, customFields: { cue: 'CUE 1' }, segmentName: 'Open' },
  { id: 5, day: 1, customFields: { cue: 'CUE 5' }, segmentName: 'Keynote' },
  { id: 12, day: 1, customFields: { cue: 'CUE 12' }, segmentName: 'Break' },
];

const csv = `Row,Day,Cue,Program,Segment Name
1,1,CUE 1,OPEN,Open
2,1,CUE 5,KEY,Keynote
3,1,CUE 12,BREAK,Break
`;
const parsedCsv = parseCsvFeed(csv);
assert.strictEqual(parsedCsv.hasHeaderRow, true);
assert.strictEqual(parsedCsv.rows.length, 3);
assert.strictEqual(parsedCsv.rows[2].cue, 'CUE 12');
assert.strictEqual(parsedCsv.rows[2].rowNumber, 3);
assert.strictEqual(vmixIndexForRow(parsedCsv, parsedCsv.rows[2], true), 2);
assert.strictEqual(vmixIndexForRow(parsedCsv, parsedCsv.rows[2], false), 3); // header counts as row 0

const byCueFeed = resolveRowIndex('cueColumn', {
  scheduleItems: schedule,
  itemId: 12,
  timerRow: { cue_is: 'CUE 12', timer_state: 'loaded' },
  parsedFeed: parsedCsv,
  vmixUsesHeaderRow: true,
});
assert.strictEqual(byCueFeed.ok, true);
assert.strictEqual(byCueFeed.index, 2);
assert.strictEqual(byCueFeed.source, 'feed');

const byRowFeed = resolveRowIndex('rowIndex', {
  scheduleItems: schedule,
  itemId: 12,
  parsedFeed: parsedCsv,
  vmixUsesHeaderRow: true,
});
assert.strictEqual(byRowFeed.ok, true);
assert.strictEqual(byRowFeed.index, 2);
assert.strictEqual(byRowFeed.targetRowNumber, 3);

// Without header option: vMix index includes header line
const byCueNoHeader = resolveRowIndex('cueColumn', {
  scheduleItems: schedule,
  itemId: 5,
  timerRow: { cue_is: 'CUE 5' },
  parsedFeed: parsedCsv,
  vmixUsesHeaderRow: false,
});
assert.strictEqual(byCueNoHeader.ok, true);
assert.strictEqual(byCueNoHeader.index, 2); // physical line of CUE 5

// All-days ROS feeds number Row globally (not per day). Day-scoped ?day=N feeds restart at 1.
const multiDayCsv = `Row,Day,Cue
1,1,CUE A
2,1,CUE B
3,2,CUE C
4,2,CUE D
`;
const multiParsed = parseCsvFeed(multiDayCsv);
const day2Schedule = [
  { id: 10, day: 1, customFields: { cue: 'CUE A' } },
  { id: 20, day: 1, customFields: { cue: 'CUE B' } },
  { id: 30, day: 2, customFields: { cue: 'CUE C' } },
  { id: 40, day: 2, customFields: { cue: 'CUE D' } },
];
const day2Cue = resolveRowIndex('cueColumn', {
  scheduleItems: day2Schedule,
  itemId: 40,
  timerRow: { cue_is: 'CUE D' },
  dayFilter: 2,
  parsedFeed: multiParsed,
});
assert.strictEqual(day2Cue.ok, true);
assert.strictEqual(day2Cue.index, 3);

const day2RowAllDaysFeed = resolveRowIndex('rowIndex', {
  scheduleItems: day2Schedule,
  itemId: 40,
  dayFilter: 2,
  parsedFeed: multiParsed,
});
assert.strictEqual(day2RowAllDaysFeed.ok, true);
assert.strictEqual(day2RowAllDaysFeed.targetRowNumber, 4); // global Row in all-days feed
assert.strictEqual(day2RowAllDaysFeed.index, 3);

// Day-scoped CSV (as returned by ?day=2) — no need to filter
const dayScopedCsv = `Row,Day,Cue
1,2,CUE C
2,2,CUE D
`;
const dayScoped = parseCsvFeed(dayScopedCsv);
const dayScopedMatch = resolveRowIndex('rowIndex', {
  scheduleItems: day2Schedule,
  itemId: 40,
  dayFilter: 2,
  parsedFeed: dayScoped,
});
assert.strictEqual(dayScopedMatch.ok, true);
assert.strictEqual(dayScopedMatch.index, 1);

// XML schedule
const xml = `<?xml version="1.0"?>
<data><schedule>
<item><row>1</row><day>1</day><cue><![CDATA[CUE 1]]></cue></item>
<item><row>2</row><day>1</day><cue><![CDATA[CUE 12]]></cue></item>
</schedule></data>`;
const parsedXml = parseXmlFeed(xml);
assert.strictEqual(parsedXml.rows.length, 2);
const xmlCue = resolveRowIndex('cueColumn', {
  scheduleItems: schedule,
  itemId: 12,
  timerRow: { cue_is: 'CUE 12' },
  parsedFeed: parsedXml,
});
assert.strictEqual(xmlCue.ok, true);
assert.strictEqual(xmlCue.index, 1);

// Lower-thirds XML has no <row>
const ltXml = `<data><lower_thirds>
<item><id>5</id><cue><![CDATA[CUE 5]]></cue></item>
<item><id>12</id><cue><![CDATA[CUE 12]]></cue></item>
</lower_thirds></data>`;
const lt = parseFeed(ltXml, 'https://x/lower-thirds.xml');
assert.strictEqual(lt.format, 'xml');
assert.strictEqual(lt.rows[1].rowNumber, 2);
const ltCue = resolveRowIndex('cueColumn', {
  scheduleItems: schedule,
  itemId: 12,
  timerRow: { cue_is: 'CUE 12' },
  parsedFeed: lt,
});
assert.strictEqual(ltCue.ok, true);
assert.strictEqual(ltCue.index, 1);

// Fallback without feed still works
const byIndex = resolveRowIndex('rowIndex', {
  scheduleItems: schedule,
  itemId: 12,
});
assert.strictEqual(byIndex.ok, true);
assert.strictEqual(byIndex.index, 2);
assert.strictEqual(byIndex.source, 'schedule');

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

assert.ok(withDayQuery('https://x/api/schedule.csv?eventId=abc', 2).includes('day=2'));
assert.ok(withDayQuery('https://x/api/schedule.csv?eventId=abc&day=1', 3).includes('day=3'));

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

assert.deepStrictEqual(buildSelectValueCandidates('Schedule', '', 3), ['Schedule,3', 'Schedule,,3']);
assert.deepStrictEqual(buildSelectValueCandidates('Book', 'Sheet1', 2), ['Book,Sheet1,2']);

console.log('row-matcher + feed-parser + vmix catalog tests OK');
