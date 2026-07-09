const { SpoutSender } = require('../electron/spout-sender');

const V_SET_SENDER_FORMAT = 1;
const V_SET_SHARE_MODE = 134;
const V_SET_CPU_SHARE = 137;
const GL_BGRA = 0x80e1;

function bind(spout, index, ret, args) {
  return spout._bindVtableFn(spout.handle, index, ret, args);
}

const spout = new SpoutSender();
spout._bindApi();
spout.openDx11Fn(spout.handle, null);
spout.setSenderNameFn(spout.handle, 'ROS CPU Test');

const setFormat = bind(spout, V_SET_SENDER_FORMAT, 'void', ['uint32']);
const setShare = bind(spout, V_SET_SHARE_MODE, 'void', ['int32']);
const setCpu = bind(spout, V_SET_CPU_SHARE, 'void', ['bool']);

for (const mode of [2, 1, 0]) {
  try {
    setShare(spout.handle, mode);
  } catch (e) {
    console.log('setShare', mode, e.message);
  }
}
try {
  setCpu(spout.handle, true);
} catch (e) {
  console.log('setCpu', e.message);
}
try {
  setFormat(spout.handle, 0);
} catch (e) {
  console.log('setFormat', e.message);
}

const koffi = require('koffi');
const w = 320;
const h = 180;
const b = Buffer.alloc(w * h * 4, 200);
const p = koffi.as(b, 'void *');

let ok = false;
try {
  ok = spout.sendImageFn(spout.handle, p, w, h, GL_BGRA, false);
} catch (e) {
  console.log('send threw', e.message);
}
console.log('send', ok, 'initialized', spout.isInitializedFn(spout.handle));
spout.dispose();
