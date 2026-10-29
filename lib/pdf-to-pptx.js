/**
 * Rasterize a PDF (one image per page) into a 16:9 .pptx for cue assets.
 * Picture slides only — not an editable Office rebuild.
 */

const Module = require('module');
const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');

// pdfjs-dist 3.x does require('canvas') in Node. Railway has @napi-rs/canvas,
// not the Cairo node-canvas package.
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveCanvasAlias(request, parent, isMain, options) {
  if (request === 'canvas') {
    return originalResolveFilename.call(this, '@napi-rs/canvas', parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = DOMMatrix;
if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = Path2D;
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData;

const pdfjsLib = require('pdfjs-dist/build/pdf.js');
const PptxGenJS = require('pptxgenjs');

const MAX_PAGES = 80;
const MAX_EDGE_PX = 1920;
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;
const JPEG_QUALITY = 82;

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.js');
} catch {
  /* Node can still render with disableWorker */
}

function NodeCanvasFactory() {}
NodeCanvasFactory.prototype.create = function create(width, height) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const canvas = createCanvas(w, h);
  return { canvas, context: canvas.getContext('2d') };
};
NodeCanvasFactory.prototype.reset = function reset(canvasAndContext, width, height) {
  canvasAndContext.canvas.width = Math.max(1, Math.ceil(width));
  canvasAndContext.canvas.height = Math.max(1, Math.ceil(height));
};
NodeCanvasFactory.prototype.destroy = function destroy(canvasAndContext) {
  canvasAndContext.canvas.width = 0;
  canvasAndContext.canvas.height = 0;
  canvasAndContext.canvas = null;
  canvasAndContext.context = null;
};

function fitOnSlide(imgW, imgH) {
  const imgAspect = imgW / Math.max(imgH, 1);
  const slideAspect = SLIDE_W_IN / SLIDE_H_IN;
  if (imgAspect > slideAspect) {
    const w = SLIDE_W_IN;
    const h = SLIDE_W_IN / imgAspect;
    return { x: 0, y: (SLIDE_H_IN - h) / 2, w, h };
  }
  const h = SLIDE_H_IN;
  const w = SLIDE_H_IN * imgAspect;
  return { x: (SLIDE_W_IN - w) / 2, y: 0, w, h };
}

function pptxNameFromPdf(originalName) {
  const raw = String(originalName || 'presentation.pdf').trim() || 'presentation.pdf';
  return raw.replace(/\.pdf$/i, '') + '.pptx';
}

function isPdfCueFile(name, mime) {
  const n = String(name || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  return n.endsWith('.pdf') || m === 'application/pdf';
}

async function pdfBufferToPptx(pdfBuffer, opts = {}) {
  const maxPages = Math.min(MAX_PAGES, Math.max(1, Number(opts.maxPages) || MAX_PAGES));
  const src = Buffer.isBuffer(pdfBuffer)
    ? pdfBuffer
    : Buffer.from(pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer));
  const data = new Uint8Array(src.byteLength);
  data.set(src);
  const canvasFactory = new NodeCanvasFactory();
  const loadingTask = pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
    canvasFactory,
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages || 0;
  if (pageCount < 1) {
    throw new Error('This PDF has no pages.');
  }
  const pagesToRender = Math.min(pageCount, maxPages);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'ROS16x9', width: SLIDE_W_IN, height: SLIDE_H_IN });
  pptx.layout = 'ROS16x9';
  pptx.author = 'Run of Show';
  pptx.title = String(opts.title || 'PDF slides').slice(0, 120);

  for (let pageNumber = 1; pageNumber <= pagesToRender; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_EDGE_PX / Math.max(base.width, 1), MAX_EDGE_PX / Math.max(base.height, 1), 2.5);
    const viewport = page.getViewport({ scale: Math.max(scale, 0.5) });
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
    }).promise;
    const jpeg = canvasAndContext.canvas.toBuffer('image/jpeg', JPEG_QUALITY);
    const box = fitOnSlide(canvasAndContext.canvas.width, canvasAndContext.canvas.height);
    const slide = pptx.addSlide();
    slide.background = { color: '000000' };
    slide.addImage({
      data: `image/jpeg;base64,${jpeg.toString('base64')}`,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    });
    canvasFactory.destroy(canvasAndContext);
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(out) ? out : Buffer.from(out);
  return {
    buffer,
    pages: pagesToRender,
    totalPages: pageCount,
    truncated: pageCount > pagesToRender,
  };
}

module.exports = {
  MAX_PAGES,
  pdfBufferToPptx,
  pptxNameFromPdf,
  isPdfCueFile,
};
