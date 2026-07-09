const { SpoutSender } = require('../electron/spout-sender');

const spout = new SpoutSender();
console.log('init:', spout.init('ROS LED Smoke Test'));
const w = 1920;
const h = 1080;
const buf = Buffer.alloc(w * h * 4, 255);
console.log('send:', spout.sendBitmap(buf, w, h), spout.statusMessage);
console.log('publishing:', spout.isPublishing);
spout.dispose();
