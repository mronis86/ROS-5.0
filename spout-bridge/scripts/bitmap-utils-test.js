const { extractPaintBitmap } = require('../electron/bitmap-utils');

// Simulate strided Electron bitmap: 4px wide, 2 rows, stride 20 bytes (16 pixel + 4 pad)
const width = 4;
const height = 2;
const stride = 20;
const raw = Buffer.alloc(stride * height, 0x11);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const o = y * stride + x * 4;
    raw[o] = 10 + x;
    raw[o + 3] = 255;
  }
}

const image = {
  toBitmap() {
    return { width, height, data: raw };
  },
};

const frame = extractPaintBitmap(image);
console.log('packed len', frame.data.length, 'expected', width * height * 4);
console.log('row0', [...frame.data.subarray(0, 4)]);
console.log('row1 first px', frame.data[16]);
console.log(frame.data.length === width * height * 4 ? 'ok' : 'fail');
