// Pure pixel helpers that make table images easier for OCR (no DOM, so they can be tested in Node).
// Input is a grayscale buffer (0 = black, 255 = white) of w*h bytes.

/** Local-mean threshold (handles uneven lighting on photos). Returns 0 for ink, 255 for paper. */
export function adaptiveBinarize(gray, w, h, win = Math.max(15, Math.round(Math.min(w, h) / 24) | 1), bias = 0.1) {
  const W = w + 1, sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row; }
  }
  const r = win >> 1, out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const area = (x1 - x0) * (y1 - y0);
      const mean = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / area;
      out[y * w + x] = gray[y * w + x] < mean * (1 - bias) ? 0 : 255;
    }
  }
  return out;
}

/**
 * Erases long straight dark runs (table borders) from a 0/255 image, in place.
 * A run is "a line" when it is at least minRun pixels long; letters and hyphens are far shorter.
 */
export function removeLines(bin, w, h, minRun = Math.max(40, Math.round(0.035 * Math.max(w, h)))) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { // horizontal runs
    let x = 0;
    while (x < w) {
      if (bin[y * w + x] !== 0) { x++; continue; }
      let e = x; while (e < w && bin[y * w + e] === 0) e++;
      if (e - x >= minRun) for (let i = x; i < e; i++) { mask[y * w + i] = 1; if (y > 0) mask[(y - 1) * w + i] = 1; if (y < h - 1) mask[(y + 1) * w + i] = 1; }
      x = e;
    }
  }
  for (let x = 0; x < w; x++) { // vertical runs
    let y = 0;
    while (y < h) {
      if (bin[y * w + x] !== 0) { y++; continue; }
      let e = y; while (e < h && bin[e * w + x] === 0) e++;
      if (e - y >= minRun) for (let j = y; j < e; j++) { mask[j * w + x] = 1; if (x > 0) mask[j * w + x - 1] = 1; if (x < w - 1) mask[j * w + x + 1] = 1; }
      y = e;
    }
  }
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { bin[i] = 255; n++; }
  return n;
}

/** RGBA ImageData bytes -> grayscale. */
export function toGray(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return g;
}

/** Grayscale -> clean black-on-white image without table borders. */
export function cleanForOcr(gray, w, h) {
  const bin = adaptiveBinarize(gray, w, h);
  removeLines(bin, w, h);
  return bin;
}
