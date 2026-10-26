const assert = require('assert');
const { annotateCueFileVersions, sortCueFilesForDisplay } = require('./cue-file-versions');

const files = annotateCueFileVersions([
  { id: 'old', itemId: 5, originalName: 'Deck.pptx', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'new', itemId: 5, originalName: 'deck.pptx', createdAt: '2026-10-24T00:00:00Z', preferredAt: '2026-10-24T00:00:00Z' },
  { id: 'notes', itemId: 5, originalName: 'notes.pdf', createdAt: '2026-10-20T00:00:00Z' },
  { id: 'other', itemId: 7, originalName: 'Deck.pptx', createdAt: '2026-10-22T00:00:00Z' },
]);

const byId = Object.fromEntries(files.map((file) => [file.id, file]));
assert.strictEqual(byId.old.version, 1);
assert.strictEqual(byId.new.version, 2);
assert.strictEqual(byId.old.versionCount, 2);
assert.strictEqual(byId.new.isCurrent, true);
assert.strictEqual(byId.old.isCurrent, false);
assert.strictEqual(byId.notes.version, 1);
assert.strictEqual(byId.notes.isCurrent, true);
assert.strictEqual(byId.other.versionCount, 1);

const swapped = annotateCueFileVersions([
  { id: 'old', itemId: 5, originalName: 'Deck.pptx', createdAt: '2026-10-01T00:00:00Z', preferredAt: '2026-10-26T12:00:00Z' },
  { id: 'new', itemId: 5, originalName: 'Deck.pptx', createdAt: '2026-10-24T00:00:00Z', preferredAt: '2026-10-24T00:00:00Z' },
]);
assert.strictEqual(swapped.find((file) => file.id === 'old').isCurrent, true);
assert.strictEqual(swapped.find((file) => file.id === 'new').isCurrent, false);

const sorted = sortCueFilesForDisplay(files.filter((file) => file.itemId === 5));
assert.deepStrictEqual(sorted.map((file) => file.id), ['new', 'old', 'notes']);

console.log('cue-file-versions ok');
