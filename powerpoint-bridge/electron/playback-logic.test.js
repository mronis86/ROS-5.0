const assert = require('assert');
const {
  isPptAssetName,
  cacheFileName,
  syncFileName,
  shouldReplaceLocalFile,
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
    slideshowActive: true,
  }).action,
  'keep'
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\cache\\a.pptx',
    currentPath: 'c:\\cache\\a.pptx',
    slideshowActive: false,
  }).action,
  'run'
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\sync\\cue7.pptx',
    currentPath: 'C:\\sync\\cue7.pptx',
    livePath: 'C:\\other\\USCLC.pptx',
    timerState: 'running',
  }).action,
  'swap'
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\sync\\cue7.pptx',
    livePath: 'C:\\sync\\cue7.pptx',
    timerState: 'running',
    slideshowActive: false,
  }).action,
  'run'
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\sync\\cue7.pptx',
    livePath: 'C:\\sync\\cue7.pptx',
    slideshowActive: true,
  }).startShow,
  undefined
);
assert.strictEqual(
  decidePlaybackAction({
    hasPPT: true,
    cachedPath: 'C:\\sync\\cue7.pptx',
    livePath: 'C:\\other\\USCLC.pptx',
  }).startShow,
  true
);
assert.ok(syncFileName({ itemId: 7, originalName: 'Map.pptx' }, 'CUE 7').startsWith('CUE 7 - Map'));
assert.strictEqual(
  shouldReplaceLocalFile({ fileId: 'old', sizeBytes: 10 }, { fileId: 'new', sizeBytes: 10 }),
  true
);
assert.strictEqual(
  shouldReplaceLocalFile({ fileId: 'a', sizeBytes: 10 }, { fileId: 'a', sizeBytes: 10 }),
  false
);

console.log('playback-logic ok');
