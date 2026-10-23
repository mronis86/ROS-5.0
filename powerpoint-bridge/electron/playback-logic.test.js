const assert = require('assert');
const {
  isPptAssetName,
  cacheFileName,
  preferredAssetForItem,
  decidePlaybackAction,
} = require('./playback-logic');

assert.strictEqual(isPptAssetName('deck.pptx'), true);
assert.strictEqual(isPptAssetName('notes.pdf'), false);

assert.ok(cacheFileName('abc', 'Keynote Deck.pptx').endsWith('.pptx'));
assert.ok(!cacheFileName('abc', 'bad/name?.pptx').includes('/'));

const assets = [
  { itemId: 1, fileId: 'old', originalName: 'a.pptx', preferred: false },
  { itemId: 1, fileId: 'new', originalName: 'a.pptx', preferred: true },
  { itemId: 2, fileId: 'b', originalName: 'b.pptx', preferred: true },
];
assert.strictEqual(preferredAssetForItem(assets, 1).fileId, 'new');

assert.strictEqual(
  decidePlaybackAction({ hasPPT: false, cachedPath: 'c:\\a.pptx', currentPath: 'c:\\a.pptx' }).action,
  'close'
);
assert.strictEqual(
  decidePlaybackAction({ hasPPT: true, cachedPath: null, currentPath: null }).action,
  'warn'
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\cache\\b.pptx',
    currentPath: 'C:\\cache\\a.pptx',
  }).action,
  'swap'
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\cache\\a.pptx',
    currentPath: 'c:\\cache\\a.pptx',
  }).action,
  'keep'
);

console.log('playback-logic ok');
