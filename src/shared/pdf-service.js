/**
 * pdf-service.js — Shared PDF document singleton and zone utilities
 * Prevents double-loading the script PDF across linenotes and runshow modules.
 */
let _pdfDoc = null;
let _loading = null;
let _cachedUrl = null;

/**
 * Return a pdf.js PDFDocumentProxy for the given URL.
 * Loads once; subsequent calls with the same URL return the cached handle.
 */
export async function getPdfDoc(url) {
  if (_pdfDoc && _cachedUrl === url) return _pdfDoc;
  if (_loading) return _loading;
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  _loading = pdfjsLib.getDocument({ url }).promise.then(doc => {
    _pdfDoc = doc;
    _cachedUrl = url;
    _loading = null;
    return doc;
  });
  return _loading;
}

/** Clear the cached document handle (call on production change or script upload). */
export function resetPdfDoc() {
  _pdfDoc = null;
  _loading = null;
  _cachedUrl = null;
}

/**
 * Group pdf.js text items into logical line zones.
 * Shared between linenotes.js and Runshow.js.
 */
export function groupIntoLines(items, viewport, zKey, splitMode, pdfScale, currentHalf) {
  const fullW = viewport.width;
  const halfW = fullW / 2;
  const scale = pdfScale;
  const mapped = items.map(item => {
    const tx = item.transform;
    const x = tx[4] * scale;
    const y = viewport.height - tx[5] * scale;
    const w = Math.abs(tx[0]) * scale * (item.width / Math.abs(tx[0]) || 1);
    const h = Math.abs(tx[3]) * scale;
    return { x, y, w, h, str: item.str, fontName: item.fontName || '' };
  });
  let filteredMapped = mapped;
  let canvasW = fullW;
  if (splitMode && zKey) {
    const half = currentHalf || zKey.slice(-1);
    if (half === 'L') {
      filteredMapped = mapped.filter(i => i.x < halfW);
    } else {
      filteredMapped = mapped.filter(i => i.x >= halfW).map(i => ({ ...i, x: i.x - halfW }));
    }
    canvasW = halfW;
  }
  const cw = canvasW, ch = viewport.height;
  const thresh = 8 * scale;
  filteredMapped.sort((a, b) => a.y - b.y);
  const groups = [];
  for (const item of filteredMapped) {
    let placed = false;
    for (const g of groups) {
      if (Math.abs(item.y - g.cy) < thresh) {
        g.items.push(item);
        g.minX = Math.min(g.minX, item.x);
        g.maxX = Math.max(g.maxX, item.x + item.w);
        g.minY = Math.min(g.minY, item.y - item.h * 0.1);
        g.maxY = Math.max(g.maxY, item.y + item.h);
        g.cy = (g.minY + g.maxY) / 2;
        placed = true; break;
      }
    }
    if (!placed) {
      groups.push({
        items: [item], minX: item.x, maxX: item.x + item.w,
        minY: item.y - item.h * 0.1, maxY: item.y + item.h,
        cy: item.y,
      });
    }
  }
  return groups.map(g => {
    const text = g.items.map(i => i.str).join(' ').trim();
    const fontName = g.items[0]?.fontName || '';
    const isCharName = /bold|heavy|black/i.test(fontName) && text.length < 40 && text === text.toUpperCase();
    const isStageDirection = /italic|oblique/i.test(fontName);
    return {
      x: (g.minX / cw) * 100,
      y: (g.minY / ch) * 100,
      w: Math.min(100, ((g.maxX - g.minX) / cw) * 100) || 80,
      h: Math.max(1.2, ((g.maxY - g.minY) / ch) * 100),
      text, isCharName, isStageDirection,
    };
  }).filter(z => z.h > 0.3 && z.w > 0.5);
}

/** Generate evenly-spaced fallback zones when no text layer is available. */
export function generateFallbackZones(canvasHeight, pdfScale) {
  const lineHeightPx = 40 * (pdfScale / 1.4);
  const count = canvasHeight ? Math.max(10, Math.floor(canvasHeight / lineHeightPx)) : 30;
  const spacing = 90 / count;
  const h = Math.max(1.5, spacing * 0.85);
  const zones = [];
  for (let i = 0; i < count; i++) zones.push({ x: 5, y: 5 + i * spacing, w: 85, h, text: '' });
  return zones;
}
