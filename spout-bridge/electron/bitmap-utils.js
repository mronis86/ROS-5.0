/**
 * Electron getBitmap on Windows is BGRA. Spout CPU share mode expects GL_RGBA.
 */
function bgraToRgbaInto(src, dst) {
  const n = Math.min(src.length, dst.length);
  for (let i = 0; i < n; i += 4) {
    dst[i] = src[i + 2];
    dst[i + 1] = src[i + 1];
    dst[i + 2] = src[i];
    dst[i + 3] = src[i + 3];
  }
  return dst;
}

function extractPaintBitmap(image, reuseBuffer) {
  if (!image || typeof image.getSize !== 'function') return null;

  const { width, height } = image.getSize();
  if (!width || !height) return null;

  let raw = null;
  if (typeof image.getBitmap === 'function') {
    raw = image.getBitmap();
  } else if (typeof image.toBitmap === 'function') {
    const bitmap = image.toBitmap({ scaleFactor: 1.0 });
    if (bitmap?.data) raw = bitmap.data;
  }

  if (!raw) return null;

  const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const rowBytes = width * 4;
  const expected = rowBytes * height;

  if (!reuseBuffer || reuseBuffer.length < expected) {
    reuseBuffer = Buffer.alloc(expected);
  }

  let packed = data;
  if (data.length > expected) {
    const stride = Math.floor(data.length / height);
    if (stride < rowBytes) return null;
    if (stride === rowBytes) {
      packed = data.subarray(0, expected);
    } else {
      for (let y = 0; y < height; y += 1) {
        data.copy(reuseBuffer, y * rowBytes, y * stride, y * stride + rowBytes);
      }
      packed = reuseBuffer.subarray(0, expected);
    }
  } else if (data.length >= expected) {
    packed = data.subarray(0, expected);
  } else {
    return null;
  }

  bgraToRgbaInto(packed, reuseBuffer);

  return { width, height, data: reuseBuffer.subarray(0, expected), buffer: reuseBuffer };
}

module.exports = { extractPaintBitmap };
