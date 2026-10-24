const assert = require('assert');
const { normalizeCacheFiles, listPendingDeckUpdates } = require('./ppt-pending-updates');

assert.strictEqual(normalizeCacheFiles(null), null);
assert.deepStrictEqual(
  normalizeCacheFiles([
    { itemId: 5, fileId: 'new' },
    { item_id: 5, file_id: 'dup' },
    { itemId: 'x', fileId: 'bad' },
  ]),
  [{ itemId: 5, fileId: 'new' }]
);

const preferred = [
  { itemId: 3, fileId: 'live', originalName: 'now.pptx' },
  { itemId: 5, fileId: 'new5', originalName: 'five.pptx' },
  { itemId: 7, fileId: 'same', originalName: 'seven.pptx' },
];

assert.deepStrictEqual(
  listPendingDeckUpdates({
    preferred,
    cacheFiles: [
      { itemId: 3, fileId: 'old3' },
      { itemId: 5, fileId: 'old5' },
      { itemId: 7, fileId: 'same' },
    ],
    skipItemIds: [3],
    cueLabels: { 5: 'CUE 5' },
  }),
  [
    {
      itemId: 5,
      fileId: 'new5',
      originalName: 'five.pptx',
      sizeBytes: null,
      cueLabel: 'CUE 5',
      localFileId: 'old5',
    },
  ]
);

assert.deepStrictEqual(
  listPendingDeckUpdates({ preferred, cacheFiles: null, skipItemIds: [] }),
  []
);

assert.deepStrictEqual(
  listPendingDeckUpdates({ preferred, cacheFiles: [], skipItemIds: [] }),
  []
);

assert.strictEqual(
  listPendingDeckUpdates({
    preferred,
    cacheFiles: [{ itemId: 3, fileId: 'live' }],
    skipItemIds: [3],
  }).map((row) => row.itemId).join(','),
  '5,7'
);

console.log('ppt-pending-updates ok');
