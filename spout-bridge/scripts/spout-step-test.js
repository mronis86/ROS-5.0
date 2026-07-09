const { SpoutSender } = require('../electron/spout-sender');

const spout = new SpoutSender();
console.log('1 init');
if (!spout.init('ROS LED Step Test', null)) {
  console.log('init failed', spout.statusMessage);
  process.exit(1);
}
console.log('2 init ok');

const w = 64;
const h = 64;
const buf = Buffer.alloc(w * h * 4, 255);
console.log('3 createSender');
try {
  const fn = spout.createSenderFn;
  if (fn) {
    const ok = fn(spout.handle, spout.name, w, h, 0);
    console.log('createSender result:', ok);
  }
} catch (e) {
  console.log('createSender threw:', e.message);
}

console.log('4 sendImage');
try {
  const koffi = require('koffi');
  const pixels = koffi.as(buf, 'void *');
  const ok = spout.sendImageFn(spout.handle, pixels, w, h, 0x80e1, false);
  console.log('sendImage result:', ok);
} catch (e) {
  console.log('sendImage threw:', e.message);
}

spout.dispose();
console.log('done');
