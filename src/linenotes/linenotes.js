import { db, storage } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, genId, confirmDialog } from '../shared/ui.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, getDoc, setDoc,
  serverTimestamp, query, where
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { getCastMembers } from '../cast/cast.js';

/*
 * linenotes.js now contains ONLY the Zone Editor view.
 * All note-reading, note-writing, note-display, script rendering, popover,
 * and send-notes functionality has moved to runshow/runshow.js.
 *
 * Exported surface:
 *   initLineNotes()            — wires zone editor DOM events
 *   onLineNotesTabActivated()  — called from tabs.js when Line Notes tab opens
 *   resetLineNotes()           — called from dashboard.js backToDashboard()
 *   loadScript()               — shared utility used by runshow.js
 *   loadOrExtractZones()       — shared utility used by runshow.js
 *   getLineZones()             — shared utility used by runshow.js
 *   getPdfDoc()                — shared utility used by runshow.js
 *   getPdfScale()              — shared utility used by runshow.js
 */

/* ═══════════════════════════════════════════════════════════
   SHARED PDF / ZONE STATE
   ═══════════════════════════════════════════════════════════ */
let pdfDoc = null;
let totalPages = 0;
let pdfScale = 1.4;
let lineZones = {};   // pageKey → [{x,y,w,h,text,isCharName,isStageDirection}]
let splitMode = false;
let currentPage = 1;
let currentHalf = 'L';
let zoneSaveTimeout = null;
let lnInitialized = false;

// Script page offset.
// scriptPageStartPage: which PDF page number is the first script page (1-indexed).
// scriptPageStartHalf: in split mode, which half of that PDF page is script page 1
//   ('L' = left half is p.1, 'R' = right half is p.1, '' = non-split/whole page).
//
// Split mode example: startPage=2, startHalf='R'
//   PDF-2R → script p.1,  PDF-3L → script p.2,  PDF-3R → script p.3, ...
// Non-split example: startPage=3, startHalf=''
//   PDF-3 → script p.1,   PDF-4 → script p.2, ...
let scriptPageStartPage = 1;
let scriptPageStartHalf = '';

// Zone editor state
let zeSelectedIdx = null;
let zeMultiSelected = new Set();
let zeDrawing = false;
let zeDrawStart = null;
let zeDragState = null;
let zeRenderGen = 0;

export function getPdfDoc()         { return pdfDoc; }
export function getPdfScale()       { return pdfScale; }
export function getLineZones()      { return lineZones; }
export function getTotalPages()     { return totalPages; }
export function isSplitMode()       { return splitMode; }
export function getCurrentPage()    { return currentPage; }
export function getCurrentHalf()    { return currentHalf; }
export function getScriptPageStartPage() { return scriptPageStartPage; }
export function getScriptPageStartHalf() { return scriptPageStartHalf; }

/**
 * Compute a signed integer offset (0 = first script page) for a given
 * (pdfPage, half) position, taking splitMode into account.
 *
 * In split mode each half is a separate script page, so we measure distance
 * in half-page units from the start position.
 *
 * In non-split mode each PDF page is one script page; half is ignored.
 */
function _scriptOffset(pdfPage, half, inSplitMode) {
  if (inSplitMode) {
    // Each PDF page = 2 half-pages.  Map (page, half) to an integer position.
    const halfPos = (p, h) => (p - 1) * 2 + (h === 'R' ? 1 : 0);
    return halfPos(pdfPage, half || 'L') - halfPos(scriptPageStartPage, scriptPageStartHalf || 'L');
  } else {
    return pdfPage - scriptPageStartPage;
  }
}

/**
 * Convert a (pdfPage, half) position to a human-readable script page label.
 *
 * In split mode: each half is a distinct page number (no L/R suffix in the label).
 *   e.g. startPage=2, startHalf='R' → 2R→"1", 3L→"2", 3R→"3"
 * In non-split mode: each PDF page is one numbered page.
 *   e.g. startPage=3 → PDF-3→"1", PDF-4→"2"
 *
 * Pages before the start get "i-N" labels (pre-script / front matter).
 *
 * @param {number} pdfPage   1-indexed PDF page number
 * @param {string} [half]    'L' | 'R' | '' — only relevant in split mode
 * @param {boolean} [inSplit] override splitMode (defaults to module splitMode)
 * @returns {string}
 */
export function pdfPageToScriptLabel(pdfPage, half, inSplit) {
  const useSplit = inSplit !== undefined ? inSplit : splitMode;
  const offset = _scriptOffset(pdfPage, half || '', useSplit);
  if (offset < 0) return 'i' + offset;   // e.g. "i-1", "i-2"
  return String(offset + 1);             // e.g. "1", "2", "42"
}

/**
 * Parse a script page number (integer string like "1", "42", or "i-1")
 * back to a { pdfPage, half } object.
 * Returns null if unparseable.
 *
 * In split mode the returned half will be 'L' or 'R'.
 * In non-split mode half will be ''.
 */
export function scriptLabelToPosition(label, inSplit) {
  const useSplit = inSplit !== undefined ? inSplit : splitMode;
  const s = String(label).trim();
  let scriptNum;
  if (s.startsWith('i')) {
    scriptNum = parseInt(s.slice(1)); // negative number
    if (isNaN(scriptNum)) return null;
  } else {
    scriptNum = parseInt(s);
    if (isNaN(scriptNum)) return null;
    // convert 1-based label to 0-based offset
    scriptNum = scriptNum - 1;
  }
  if (useSplit) {
    const startHalfPos = (scriptPageStartPage - 1) * 2 + (scriptPageStartHalf === 'R' ? 1 : 0);
    const targetHalfPos = startHalfPos + scriptNum;
    const pdfPage = Math.floor(targetHalfPos / 2) + 1;
    const half = (targetHalfPos % 2 === 0) ? 'L' : 'R';
    return { pdfPage, half };
  } else {
    return { pdfPage: scriptPageStartPage + scriptNum, half: '' };
  }
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function pageZoneKey(num, half) { return splitMode ? `${num}${half}` : `${num}`; }
function pageLabel(num, half)   { return splitMode ? `${num}${half}` : `${num}`; }
function pk()                   { return pageZoneKey(currentPage, currentHalf); }

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */
export function initLineNotes() {
  // Zone editor: rubber band + drag on zone-edit-overlay
  const zeOvl = document.getElementById('ze-edit-overlay');
  zeOvl?.addEventListener('mousedown', zeOverlayMouseDown);

  // Global mouse move/up for zone editor
  document.addEventListener('mousemove', globalMouseMove);
  document.addEventListener('mouseup', globalMouseUp);

  // Wire zone editor toolbar
  setTimeout(() => wireZeToolbar(), 0);
}

export async function onLineNotesTabActivated() {
  if (!lnInitialized) {
    lnInitialized = true;
    currentPage = 1;
    splitMode = false;
    currentHalf = 'L';
    lineZones = {};
    pdfDoc = null;
    totalPages = 0;
    zeSelectedIdx = null;
    zeMultiSelected.clear();
    zeRenderGen = 0;
    // Read page offset fields directly from Firestore so all production members
    // automatically share the same p.1 setting without needing to re-select it.
    // We read fresh from the production doc rather than relying on whatever fields
    // dashboard.js chose to map onto state.activeProduction.
    await loadScriptPageOffset();
    document.getElementById('ln-show-name').textContent =
      state.activeProduction?.title || '';
    loadScript();
  }
  // The Line Notes tab now opens directly to the zones view
  switchToZonesView();
}

/** Fetch scriptPageStart fields from Firestore and apply them locally. */
async function loadScriptPageOffset() {
  const pid = state.activeProduction?.id;
  if (!pid) return;
  try {
    const snap = await getDoc(doc(db, 'productions', pid));
    if (snap.exists()) {
      const data = snap.data();
      scriptPageStartPage = data.scriptPageStartPage || 1;
      scriptPageStartHalf = data.scriptPageStartHalf || '';
      // Keep state.activeProduction in sync so Runshow can read it too
      state.activeProduction.scriptPageStartPage = scriptPageStartPage;
      state.activeProduction.scriptPageStartHalf = scriptPageStartHalf;
    }
  } catch(e) {
    console.warn('Could not load scriptPageOffset:', e);
    // Fall back to whatever is already on state.activeProduction
    scriptPageStartPage = state.activeProduction?.scriptPageStartPage || 1;
    scriptPageStartHalf = state.activeProduction?.scriptPageStartHalf || '';
  }
}

export function resetLineNotes() {
  lnInitialized = false;
  pdfDoc = null;
  lineZones = {};
}

/* ═══════════════════════════════════════════════════════════
   ZONES VIEW (the only view in Line Notes now)
   ═══════════════════════════════════════════════════════════ */
function switchToZonesView() {
  const zoneArea = document.getElementById('ln-zone-editor-area');
  if (zoneArea) zoneArea.style.display = 'flex';
  updatePageStartBadge();
  if (pdfDoc) renderZoneEditorPage(currentPage);
}

/** Updates the "page offset" indicator badge in the header (both LN and RS tabs). */
function updatePageStartBadge() {
  // Line Notes badge
  const badge = document.getElementById('ln-page-start-badge');
  const isDefault = scriptPageStartPage === 1 && scriptPageStartHalf === '';
  if (badge) {
    if (isDefault) {
      badge.style.display = 'none';
    } else {
      const halfStr = scriptPageStartHalf ? scriptPageStartHalf : '';
      badge.textContent = `PDF p.${scriptPageStartPage}${halfStr} = Script p.1`;
      badge.style.display = '';
    }
  }
  // Run Show badge (may not exist in LN context but harmless)
  const rsBadge = document.getElementById('rs-script-offset-badge');
  if (rsBadge) {
    if (isDefault) {
      rsBadge.style.display = 'none';
    } else {
      const halfStr = scriptPageStartHalf ? scriptPageStartHalf : '';
      rsBadge.textContent = `PDF p.${scriptPageStartPage}${halfStr} = p.1`;
      rsBadge.style.display = '';
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   SCRIPT LOADING  (shared with runshow.js via exports)
   ═══════════════════════════════════════════════════════════ */
export async function loadScript(canvasId, hitOverlayId, progressFillId, dropZoneId, pageWrapperId, pageNavId, processingId, totalPagesId) {
  // When called from linenotes (zone editor), use ln- prefixed IDs
  const _processingId = processingId || 'ln-processing';
  const _progressFillId = progressFillId || 'ln-progress-fill';
  const _dropZoneId = dropZoneId || 'ln-drop-zone';
  const _pageWrapperId = pageWrapperId || 'ze-page-wrapper';
  const _pageNavId = pageNavId || 'ln-page-nav';
  const _totalPagesId = totalPagesId || 'ln-total-pages';

  const scriptPath = state.activeProduction?.scriptPath;
  if (!scriptPath) {
    if (isOwner()) showScriptUploadPrompt();
    return;
  }
  showProcessing('Loading script\u2026', _processingId, _progressFillId);
  try {
    const url = await getDownloadURL(ref(storage, scriptPath));
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ url });
    loadingTask.onProgress = p => {
      const fill = document.getElementById(_progressFillId);
      if (p.total > 0 && fill) fill.style.width = Math.round((p.loaded / p.total) * 100) + '%';
    };
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    const totalEl = document.getElementById(_totalPagesId);
    if (totalEl) totalEl.textContent = totalPages;
    if (!state.activeProduction.scriptPageCount && isOwner()) {
      try { await updateDoc(doc(db, 'productions', state.activeProduction.id), { scriptPageCount: totalPages }); } catch(e) {}
    }
    hideProcessing(_processingId);
    const dz = document.getElementById(_dropZoneId);
    if (dz) dz.style.display = 'none';
    const pw = document.getElementById(_pageWrapperId);
    if (pw) pw.style.display = 'block';
    const pn = document.getElementById(_pageNavId);
    if (pn) pn.style.display = 'flex';
    if (currentPage) await renderZoneEditorPage(currentPage);
  } catch(e) {
    console.error('Script load error:', e);
    hideProcessing(_processingId);
    toast('Failed to load script: ' + e.message, 'error');
  }
}

function showScriptUploadPrompt() {
  // For zone editor (owner only in Line Notes tab)
  const dz = document.getElementById('ln-drop-zone');
  if (!dz) return;
  dz.style.display = 'flex';
  dz.querySelector('#ln-upload-btn')?.addEventListener('click', () => dz.querySelector('#ln-file-input')?.click());
  dz.querySelector('#ln-file-input')?.addEventListener('change', async function() {
    const file = this.files[0];
    if (!file || file.type !== 'application/pdf') { toast('Select a PDF.', 'error'); return; }
    const { uploadBytesResumable } = await import('firebase/storage');
    const pid = state.activeProduction.id;
    const storageRef = ref(storage, 'productions/' + pid + '/script.pdf');
    showProcessing('Uploading\u2026');
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      s => { const el = document.getElementById('ln-progress-fill'); if (el) el.style.width = Math.round((s.bytesTransferred / s.totalBytes) * 100) + '%'; },
      () => { hideProcessing(); toast('Upload failed.', 'error'); },
      async () => {
        await updateDoc(doc(db, 'productions', pid), { scriptPath: 'productions/' + pid + '/script.pdf', scriptPageCount: null });
        state.activeProduction.scriptPath = 'productions/' + pid + '/script.pdf';
        hideProcessing();
        loadScript();
      }
    );
  });
}

function showProcessing(msg, id, fillId) {
  const el = document.getElementById(id || 'ln-processing');
  if (el) { el.style.display = 'flex'; el.querySelector('.text').textContent = msg; }
  const fill = document.getElementById(fillId || 'ln-progress-fill');
  if (fill) fill.style.width = '0%';
}
function hideProcessing(id) {
  const el = document.getElementById(id || 'ln-processing');
  if (el) el.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════
   ZONE EXTRACTION  (shared with runshow.js via exports)
   ═══════════════════════════════════════════════════════════ */
export async function loadOrExtractZones(page, num, viewport, zKey) {
  const pid = state.activeProduction.id;
  try {
    const zoneDoc = await getDoc(doc(db, 'productions', pid, 'zones', zKey));
    if (zoneDoc.exists() && zoneDoc.data().zones?.length > 0) {
      lineZones[zKey] = zoneDoc.data().zones;
      return;
    }
  } catch(e) { /* fall through */ }

  showProcessing(`Extracting text from page ${num}\u2026`);
  try {
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(i => i.str && i.str.trim().length > 0);
    if (items.length > 2) {
      lineZones[zKey] = groupIntoLines(items, viewport, zKey);
    } else {
      lineZones[zKey] = generateFallbackZones(viewport.height);
      toast(`Page ${num}: no text layer — fallback zones generated.`);
    }
    if (isOwner()) firebaseSaveZones(zKey);
  } catch(e) {
    lineZones[zKey] = generateFallbackZones(viewport.height);
  }
  hideProcessing();
}

function groupIntoLines(items, viewport, zKey) {
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
    const half = zKey.slice(-1);
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
      groups.push({ items: [item], minX: item.x, maxX: item.x + item.w, minY: item.y - item.h * 0.1, maxY: item.y + item.h, cy: item.y });
    }
  }

  const textLines = groups.filter(g => g.maxX - g.minX > 4).map(g => {
    const allFonts = g.items.map(i => i.fontName || '').join(' ');
    const isItalic = /italic|oblique|[\-,_]it[\b,\-,_,A-Z]/i.test(allFonts);
    const textStr = g.items.map(i => i.str).join(' ');
    const letters = textStr.replace(/[^a-zA-Z]/g, '');
    const isAllCaps = letters.length > 2 && letters === letters.toUpperCase();
    return {
      x: Math.max(0, (g.minX / cw) * 100),
      y: Math.max(0, (g.minY / ch) * 100),
      w: Math.min(100, ((g.maxX - g.minX) / cw) * 100),
      h: Math.max(1.2, Math.min(10, ((g.maxY - g.minY) / ch) * 100)),
      text: textStr, isItalic, isAllCaps,
      avgH: g.items.reduce((s, i) => s + i.h, 0) / g.items.length,
      centerX: ((g.minX + g.maxX) / 2 / cw) * 100,
      leftX: (g.minX / cw) * 100
    };
  });

  return mergeIntoCharacterLines(detectCharacterNameLines(textLines), textLines);
}

function detectCharacterNameLines(textLines) {
  if (!textLines?.length) return new Set();
  const heights = textLines.map(l => l.avgH || 0).filter(h => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 0;

  const candidates = [];
  textLines.forEach((line, idx) => {
    const text = (line.text || '').trim();
    if (!text || text.length < 1 || text.length > 50) return;
    if (text.startsWith('(') && text.endsWith(')')) return;
    if (line.isItalic) return;
    if (/[a-z]/.test(text) && text.split(/\s+/).length > 4) return;
    const stripped = text.replace(/[&'\-.!?,\s\d]/g, '');
    if (stripped.length === 0 || !/^[A-Z]+$/.test(stripped)) return;
    if (line.w > 62) return;
    if (medianH > 0 && (line.avgH || medianH) < medianH * 0.65) return;
    candidates.push({ idx, line });
  });
  if (candidates.length === 0) return new Set();

  function modalBucket(values, size) {
    const counts = {};
    values.forEach(v => { const b = Math.round(v / size) * size; counts[b] = (counts[b] || 0) + 1; });
    return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
  }
  const modalLeft = modalBucket(candidates.map(c => c.line.leftX ?? 0), 4);
  const modalCenter = modalBucket(candidates.map(c => c.line.centerX ?? 50), 4);

  const nameIdxs = new Set();
  candidates.forEach(({ idx, line }) => {
    const ld = Math.abs((line.leftX ?? 0) - modalLeft);
    const cd = Math.abs((line.centerX ?? 50) - modalCenter);
    if (ld <= 8 || cd <= 8) nameIdxs.add(idx);
  });

  if (nameIdxs.size > textLines.length * 0.4) {
    nameIdxs.clear();
    candidates.forEach(({ idx, line }) => {
      const ld = Math.abs((line.leftX ?? 0) - modalLeft);
      const cd = Math.abs((line.centerX ?? 50) - modalCenter);
      if (ld <= 4 || cd <= 4) nameIdxs.add(idx);
    });
  }
  return nameIdxs;
}

function mergeIntoCharacterLines(nameIdxs, textLines) {
  if (!textLines?.length) return textLines;
  const result = [];
  let currentBlock = null;
  const flush = () => { if (currentBlock) { result.push(currentBlock); currentBlock = null; } };

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    if (nameIdxs.has(i)) { flush(); result.push({ ...line, isCharName: true }); continue; }
    if (line.isItalic) { flush(); result.push({ ...line, isStageDirection: true }); continue; }
    if (line.isAllCaps) { flush(); result.push({ ...line }); continue; }
    if (!currentBlock) {
      currentBlock = { x: line.x, y: line.y, w: line.w, h: line.h, text: line.text || '' };
    } else {
      const r = Math.max(currentBlock.x + currentBlock.w, line.x + line.w);
      const b = Math.max(currentBlock.y + currentBlock.h, line.y + line.h);
      currentBlock.x = Math.min(currentBlock.x, line.x);
      currentBlock.y = Math.min(currentBlock.y, line.y);
      currentBlock.w = r - currentBlock.x;
      currentBlock.h = b - currentBlock.y;
      if (line.text?.trim()) currentBlock.text = currentBlock.text ? currentBlock.text + ' ' + line.text.trim() : line.text.trim();
    }
  }
  flush();
  return result;
}

function generateFallbackZones(canvasHeight) {
  const lineHeightPx = 40 * (pdfScale / 1.4);
  const count = canvasHeight ? Math.max(10, Math.floor(canvasHeight / lineHeightPx)) : 30;
  const spacing = 90 / count;
  const h = Math.max(1.5, spacing * 0.85);
  const zones = [];
  for (let i = 0; i < count; i++) zones.push({ x: 5, y: 5 + i * spacing, w: 85, h, text: '' });
  return zones;
}

/* ═══════════════════════════════════════════════════════════
   ZONE EDITOR VIEW
   ═══════════════════════════════════════════════════════════ */
async function renderZoneEditorPage(num) {
  const gen = ++zeRenderGen;
  zeSelectedIdx = null;
  zeMultiSelected.clear();
  document.getElementById('ze-detail')?.classList.remove('visible');
  document.getElementById('ze-multi-bar')?.classList.remove('visible');

  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  if (gen !== zeRenderGen) return;

  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = document.getElementById('ze-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (splitMode) {
    const halfW = Math.floor(viewport.width / 2);
    canvas.width = halfW; canvas.height = viewport.height;
    const offsetX = currentHalf === 'L' ? 0 : halfW;
    ctx.save(); ctx.translate(-offsetX, 0);
    await page.render({ canvasContext: ctx, viewport }).promise;
    ctx.restore();
  } else {
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
  if (gen !== zeRenderGen) return;

  const pageInput = document.getElementById('ln-page-input');
  if (pageInput) pageInput.value = pdfPageToScriptLabel(num, currentHalf);
  // Also update page label tooltip
  const pageHint = document.getElementById('ln-page-hint');
  if (pageHint) pageHint.textContent = `PDF p.${num}`;
  const zKey = pk();
  if (!lineZones[zKey]) await loadOrExtractZones(page, num, viewport, zKey);
  if (gen !== zeRenderGen) return;

  zeRenderZones();
  zeUpdateListPanel();
}

function zeCurrentZones() {
  const zKey = pk();
  return lineZones[zKey] || (lineZones[zKey] = []);
}

function zeRenderZones() {
  const ovl = document.getElementById('ze-edit-overlay');
  if (!ovl) return;
  const rb = document.getElementById('ze-rubber-band');
  while (ovl.firstChild && ovl.firstChild !== rb) ovl.removeChild(ovl.firstChild);
  if (!ovl.contains(rb)) ovl.appendChild(rb);

  const zones = zeCurrentZones();
  zones.forEach((zone, idx) => {
    const div = document.createElement('div');
    const isMulti = zeMultiSelected.has(idx);
    div.className = 'ze-zone' + (zone.isCharName ? ' ze-char-name' : zone.isStageDirection ? ' ze-stage-dir' : '') + (idx === zeSelectedIdx ? ' selected' : '') + (isMulti ? ' ze-multi-selected' : '');
    div.style.left = zone.x + '%'; div.style.top = zone.y + '%';
    div.style.width = zone.w + '%'; div.style.height = Math.max(zone.h, 1.2) + '%';
    div.dataset.idx = idx;

    const label = document.createElement('span');
    label.className = 'ze-zone-label';
    label.textContent = zone.text ? zone.text.substring(0, 50) : `[zone ${idx}]`;
    div.appendChild(label);

    const handle = document.createElement('div');
    handle.className = 'ze-resize'; handle.dataset.idx = idx;
    div.appendChild(handle);

    div.addEventListener('mousedown', e => {
      if (e.target === handle) return;
      e.stopPropagation();
      if (e.shiftKey || e.metaKey || e.ctrlKey) { zeToggleMultiSelect(idx); return; }
      // If this zone is part of a multi-selection, drag all of them together
      if (zeMultiSelected.size > 0 && zeMultiSelected.has(idx)) {
        const wrapper = document.getElementById('ze-page-wrapper');
        const origAllBounds = {};
        zeMultiSelected.forEach(i => { if (zones[i]) origAllBounds[i] = { ...zones[i] }; });
        zeDragState = { type: 'move-all', idx, startX: e.clientX, startY: e.clientY, origBounds: { ...zones[idx] }, pw: wrapper.offsetWidth, ph: wrapper.offsetHeight, origAllBounds };
        return;
      }
      if (zeMultiSelected.size > 0) zeClearMultiSelect();
      zeSelectZone(idx);
      const wrapper = document.getElementById('ze-page-wrapper');
      zeDragState = { type: 'move', idx, startX: e.clientX, startY: e.clientY, origBounds: { ...zones[idx] }, pw: wrapper.offsetWidth, ph: wrapper.offsetHeight };
    });

    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      zeSelectZone(idx);
      const wrapper = document.getElementById('ze-page-wrapper');
      zeDragState = { type: 'resize', idx, startX: e.clientX, startY: e.clientY, origBounds: { ...zones[idx] }, pw: wrapper.offsetWidth, ph: wrapper.offsetHeight };
    });

    ovl.insertBefore(div, rb);
  });
}

function zeHandleMouseMove(e) {
  if (!zeDragState) return;
  const { type, idx, startX, startY, origBounds, pw, ph, origAllBounds } = zeDragState;
  const dx = ((e.clientX - startX) / pw) * 100;
  const dy = ((e.clientY - startY) / ph) * 100;
  const zones = zeCurrentZones();
  if (type === 'move-all' && origAllBounds) {
    // Move every zone in the multi-selection by the same delta, clamped individually
    zeMultiSelected.forEach(i => {
      const orig = origAllBounds[i];
      if (!orig || !zones[i]) return;
      zones[i].x = Math.max(0, Math.min(99, orig.x + dx));
      zones[i].y = Math.max(0, Math.min(99, orig.y + dy));
    });
    // Update all the overlay divs directly for smooth perf
    const ovl = document.getElementById('ze-edit-overlay');
    zeMultiSelected.forEach(i => {
      const div = ovl?.querySelector(`[data-idx="${i}"]`);
      if (div && zones[i]) { div.style.left = zones[i].x + '%'; div.style.top = zones[i].y + '%'; }
    });
    return;
  }
  if (type === 'move') {
    zones[idx].x = Math.max(0, Math.min(99, origBounds.x + dx));
    zones[idx].y = Math.max(0, Math.min(99, origBounds.y + dy));
  } else {
    zones[idx].w = Math.min(100 - zones[idx].x, Math.max(2, origBounds.w + dx));
    zones[idx].h = Math.max(0.5, origBounds.h + dy);
  }
  const div = document.getElementById('ze-edit-overlay')?.querySelector(`[data-idx="${idx}"]`);
  if (div) { div.style.left = zones[idx].x + '%'; div.style.top = zones[idx].y + '%'; div.style.width = zones[idx].w + '%'; div.style.height = Math.max(zones[idx].h, 1.2) + '%'; }
  if (idx === zeSelectedIdx) zePopulateDetail(idx);
}

function zeOverlayMouseDown(e) {
  if (e.target !== document.getElementById('ze-edit-overlay')) return;
  if (e.button !== 0) return;
  const wrapper = document.getElementById('ze-page-wrapper');
  const rect = wrapper.getBoundingClientRect();
  zeDrawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  zeDrawing = true;
  const rb = document.getElementById('ze-rubber-band');
  if (rb) { rb.style.display = 'block'; rb.style.left = zeDrawStart.x + 'px'; rb.style.top = zeDrawStart.y + 'px'; rb.style.width = '0'; rb.style.height = '0'; }
}

function zeFinishDraw(e) {
  zeDrawing = false;
  const rb = document.getElementById('ze-rubber-band');
  if (rb) rb.style.display = 'none';
  const wrapper = document.getElementById('ze-page-wrapper');
  const rect = wrapper.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const x = Math.min(cx, zeDrawStart.x), y = Math.min(cy, zeDrawStart.y);
  const w = Math.abs(cx - zeDrawStart.x), h = Math.abs(cy - zeDrawStart.y);
  if (w < 8 || h < 4) { zeDrawStart = null; return; }
  const pw = wrapper.offsetWidth, ph = wrapper.offsetHeight;
  const newZone = { x: (x / pw) * 100, y: (y / ph) * 100, w: (w / pw) * 100, h: (h / ph) * 100, text: '', isCharName: false };
  const zones = zeCurrentZones();
  zones.push(newZone);
  zeDrawStart = null;
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zones.length - 1, true);
  debounceSaveZones();
  toast('Zone drawn — type text in the panel →');
}

function globalMouseMove(e) {
  if (zeDragState) zeHandleMouseMove(e);
  if (zeDrawing && zeDrawStart) {
    const wrapper = document.getElementById('ze-page-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const x = Math.min(cx, zeDrawStart.x), y = Math.min(cy, zeDrawStart.y);
    const w = Math.abs(cx - zeDrawStart.x), h = Math.abs(cy - zeDrawStart.y);
    const rb = document.getElementById('ze-rubber-band');
    if (rb) { rb.style.left = x + 'px'; rb.style.top = y + 'px'; rb.style.width = w + 'px'; rb.style.height = h + 'px'; }
  }
}

function globalMouseUp(e) {
  if (zeDragState) { zeDragState = null; zeUpdateListPanel(); debounceSaveZones(); return; }
  if (zeDrawing && zeDrawStart) { zeFinishDraw(e); return; }
}

function zeSelectZone(idx, focusText = false) {
  zeSelectedIdx = idx;
  document.getElementById('ze-edit-overlay')?.querySelectorAll('.ze-zone').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === idx));
  document.getElementById('ze-items-list')?.querySelectorAll('.ze-list-item').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === idx));
  if (idx !== null && idx !== undefined) {
    zePopulateDetail(idx, focusText);
    document.getElementById('ze-detail')?.classList.add('visible');
    const li = document.getElementById('ze-items-list')?.querySelector(`[data-idx="${idx}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
  } else {
    document.getElementById('ze-detail')?.classList.remove('visible');
  }
}

function zeToggleMultiSelect(idx) {
  zeSelectedIdx = null;
  document.getElementById('ze-detail')?.classList.remove('visible');
  if (zeMultiSelected.has(idx)) zeMultiSelected.delete(idx); else zeMultiSelected.add(idx);
  zeRefreshMultiBar(); zeRenderZones(); zeUpdateListPanel();
}

function zeClearMultiSelect() { zeMultiSelected.clear(); zeRefreshMultiBar(); zeRenderZones(); zeUpdateListPanel(); }

function zeRefreshMultiBar() {
  const bar = document.getElementById('ze-multi-bar');
  const count = document.getElementById('ze-multi-count');
  if (!bar) return;
  if (zeMultiSelected.size > 0) { bar.classList.add('visible'); if (count) count.textContent = `${zeMultiSelected.size} zone${zeMultiSelected.size > 1 ? 's' : ''} selected`; }
  else bar.classList.remove('visible');
}

function zePopulateDetail(idx, focusText = false) {
  const z = zeCurrentZones()[idx]; if (!z) return;
  const getValue = id => document.getElementById(id);
  const x = getValue('zd-x'); if (x) x.value = z.x.toFixed(1);
  const y = getValue('zd-y'); if (y) y.value = z.y.toFixed(1);
  const w = getValue('zd-w'); if (w) w.value = z.w.toFixed(1);
  const h = getValue('zd-h'); if (h) h.value = z.h.toFixed(1);
  const t = getValue('zd-text'); if (t) t.value = z.text || '';
  const cn = getValue('zd-charname'); if (cn) cn.checked = !!z.isCharName;
  const sd = getValue('zd-stagedir'); if (sd) sd.checked = !!z.isStageDirection;
  if (focusText && t) requestAnimationFrame(() => { t.focus(); t.select(); });
}

function zeApplyDetail() {
  if (zeSelectedIdx === null) return;
  const zones = zeCurrentZones(); const z = zones[zeSelectedIdx]; if (!z) return;
  z.x = parseFloat(document.getElementById('zd-x')?.value) || z.x;
  z.y = parseFloat(document.getElementById('zd-y')?.value) || z.y;
  z.w = parseFloat(document.getElementById('zd-w')?.value) || z.w;
  z.h = parseFloat(document.getElementById('zd-h')?.value) || z.h;
  z.text = document.getElementById('zd-text')?.value || '';
  z.isCharName = document.getElementById('zd-charname')?.checked || false;
  z.isStageDirection = document.getElementById('zd-stagedir')?.checked || false;
  if (z.isCharName) z.isStageDirection = false;
  if (z.isStageDirection) z.isCharName = false;
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones();
  toast('Zone updated');
}

function zeDeleteSelected() {
  if (zeSelectedIdx === null) return;
  zeCurrentZones().splice(zeSelectedIdx, 1);
  zeSelectedIdx = null;
  document.getElementById('ze-detail')?.classList.remove('visible');
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones(); toast('Zone deleted');
}

function zeMultiDelete() {
  if (zeMultiSelected.size === 0) return;
  const zones = zeCurrentZones();
  [...zeMultiSelected].sort((a, b) => b - a).forEach(i => zones.splice(i, 1));
  const cnt = zeMultiSelected.size;
  zeMultiSelected.clear(); zeSelectedIdx = null;
  document.getElementById('ze-detail')?.classList.remove('visible');
  zeRefreshMultiBar(); zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
  toast(`Deleted ${cnt} zone${cnt > 1 ? 's' : ''}`);
}

function zeMultiToggleCharName() {
  const zones = zeCurrentZones();
  const anyNon = [...zeMultiSelected].some(i => !zones[i]?.isCharName);
  zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isCharName = anyNon; if (anyNon) zones[i].isStageDirection = false; } });
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
}

function zeMultiToggleStagDir() {
  const zones = zeCurrentZones();
  const anyNon = [...zeMultiSelected].some(i => !zones[i]?.isStageDirection);
  zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isStageDirection = anyNon; if (anyNon) zones[i].isCharName = false; } });
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
}

function zeSelectAllForDrag() {
  const zones = zeCurrentZones();
  if (zones.length === 0) return;
  const isAllSelected = zeMultiSelected.size === zones.length;
  if (isAllSelected) {
    zeClearMultiSelect();
    toast('Deselected all zones');
  } else {
    zeSelectedIdx = null;
    document.getElementById('ze-detail')?.classList.remove('visible');
    zeMultiSelected.clear();
    zones.forEach((_, i) => zeMultiSelected.add(i));
    zeRefreshMultiBar();
    zeRenderZones();
    zeUpdateListPanel();
    toast(`All ${zones.length} zones selected — drag any zone to move them all`);
  }
}


function zeUpdateListPanel() {
  const zones = zeCurrentZones();
  const annotatable = zones.filter(z => !z.isCharName).length;
  const meta = document.getElementById('ze-list-meta');
  if (meta) meta.textContent = `${zones.length} zones (${annotatable} annotatable) \u00b7 p.${pageLabel(currentPage, currentHalf)}`;

  // Render or update the "Select All & Drag" button below the list
  let selectAllBtn = document.getElementById('ze-btn-select-all-drag');
  if (!selectAllBtn) {
    const listContainer = document.getElementById('ze-items-list')?.parentElement;
    if (listContainer) {
      selectAllBtn = document.createElement('button');
      selectAllBtn.id = 'ze-btn-select-all-drag';
      selectAllBtn.className = 'ze-select-all-drag-btn';
      selectAllBtn.title = 'Select all zones and drag them together to fix a uniform offset';
      listContainer.appendChild(selectAllBtn);
      selectAllBtn.addEventListener('click', zeSelectAllForDrag);
    }
  }
  if (selectAllBtn) {
    const isAllSelected = zones.length > 0 && zeMultiSelected.size === zones.length;
    selectAllBtn.textContent = isAllSelected ? '✕ Deselect All' : '⊕ Select All & Drag';
    selectAllBtn.classList.toggle('active', isAllSelected);
    selectAllBtn.disabled = zones.length === 0;
  }

  const list = document.getElementById('ze-items-list');
  if (!list) return;
  if (zones.length === 0) {
    list.innerHTML = `<div style="padding:20px 12px;text-align:center;font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);line-height:1.8">No zones on this page.<br>Draw zones or click Re-extract.</div>`;
    return;
  }
  list.innerHTML = zones.map((z, idx) => {
    const type = z.isCharName ? 'char name' : z.isStageDirection ? 'stage dir' : 'dialogue';
    const textEl = z.text ? `<div class="ze-item-text">${escapeHtml(z.text.substring(0, 60))}${z.text.length > 60 ? '\u2026' : ''}</div>` : `<div class="ze-item-no-text">[no text]</div>`;
    const isSel = idx === zeSelectedIdx, isMulti = zeMultiSelected.has(idx);
    const cls = ['ze-list-item', isSel ? 'selected' : '', isMulti ? 'ze-multi-selected' : '', z.isCharName ? 'ze-cn-item' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-idx="${idx}"><div class="ze-item-idx">${idx}</div><div class="ze-item-body"><div class="ze-item-type">${type}</div>${textEl}</div><button class="ze-item-del" data-idx="${idx}">\u00d7</button></div>`;
  }).join('');

  list.querySelectorAll('.ze-list-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('ze-item-del')) return;
      const idx = parseInt(el.dataset.idx);
      if (e.shiftKey || e.metaKey || e.ctrlKey) zeToggleMultiSelect(idx);
      else { if (zeMultiSelected.size > 0) zeClearMultiSelect(); zeSelectZone(idx); }
    });
  });
  list.querySelectorAll('.ze-item-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      zeCurrentZones().splice(idx, 1);
      if (zeSelectedIdx === idx) { zeSelectedIdx = null; document.getElementById('ze-detail')?.classList.remove('visible'); }
      else if (zeSelectedIdx > idx) zeSelectedIdx--;
      zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
    });
  });
}

function wireZeToolbar() {
  document.getElementById('ze-btn-reextract')?.addEventListener('click', zeReExtract);
  document.getElementById('ze-btn-clear')?.addEventListener('click', zeClearAll);
  document.getElementById('ze-btn-save')?.addEventListener('click', () => firebaseSaveZones(pk()));
  document.getElementById('ze-btn-multi-char')?.addEventListener('click', zeMultiToggleCharName);
  document.getElementById('ze-btn-multi-dir')?.addEventListener('click', zeMultiToggleStagDir);
  document.getElementById('ze-btn-multi-del')?.addEventListener('click', zeMultiDelete);
  document.getElementById('ze-btn-multi-clear')?.addEventListener('click', zeClearMultiSelect);
  document.getElementById('ze-btn-apply')?.addEventListener('click', zeApplyDetail);
  document.getElementById('ze-btn-del-zone')?.addEventListener('click', zeDeleteSelected);

  const textArea = document.getElementById('zd-text');
  if (textArea) {
    textArea.addEventListener('input', () => {
      if (zeSelectedIdx === null) return;
      const z = zeCurrentZones()[zeSelectedIdx];
      if (!z) return;
      z.text = textArea.value;
      const ovl = document.getElementById('ze-edit-overlay');
      const el = ovl?.querySelector(`[data-idx="${zeSelectedIdx}"] .ze-zone-label`);
      if (el) el.textContent = textArea.value ? textArea.value.substring(0, 50) : `[zone ${zeSelectedIdx}]`;
      const li = document.getElementById('ze-items-list')?.querySelector(`[data-idx="${zeSelectedIdx}"] .ze-item-text, [data-idx="${zeSelectedIdx}"] .ze-item-no-text`);
      if (li) { li.className = textArea.value ? 'ze-item-text' : 'ze-item-no-text'; li.textContent = textArea.value ? textArea.value.substring(0, 60) + (textArea.value.length > 60 ? '\u2026' : '') : '[no text]'; }
      debounceSaveZones();
    });
    textArea.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); zeApplyDetail(); } });
  }

  document.getElementById('zd-charname')?.addEventListener('change', zeApplyDetail);
  document.getElementById('zd-stagedir')?.addEventListener('change', zeApplyDetail);

  // Page navigation (zone editor uses the same ln-page-nav)
  document.getElementById('ln-prev-page')?.addEventListener('click', () => changeZonePage(-1));
  document.getElementById('ln-next-page')?.addEventListener('click', () => changeZonePage(1));
  document.getElementById('ln-split-btn')?.addEventListener('click', toggleSplitMode);

  // "Set as Page 1" — marks the currently-viewed page/half as script page 1.
  // Saved to Firestore so all production members share the same offset automatically.
  document.getElementById('ln-set-page1-btn')?.addEventListener('click', async () => {
    if (!pdfDoc) return;
    scriptPageStartPage = currentPage;
    scriptPageStartHalf = splitMode ? currentHalf : '';
    if (state.activeProduction) {
      state.activeProduction.scriptPageStartPage = scriptPageStartPage;
      state.activeProduction.scriptPageStartHalf = scriptPageStartHalf;
      try {
        await updateDoc(doc(db, 'productions', state.activeProduction.id), {
          scriptPageStartPage,
          scriptPageStartHalf,
        });
      } catch(e) { console.warn('Could not save scriptPageStart', e); }
    }
    // Refresh page display
    const pageInput = document.getElementById('ln-page-input');
    if (pageInput) pageInput.value = pdfPageToScriptLabel(currentPage, currentHalf);
    updatePageStartBadge();
    const halfStr = splitMode ? currentHalf : '';
    toast(`Page offset set — PDF p.${scriptPageStartPage}${halfStr} is now script page 1`);
  });

  const pageInput = document.getElementById('ln-page-input');
  if (pageInput) {
    pageInput.addEventListener('change', () => {
      if (!pdfDoc) return;
      const pos = scriptLabelToPosition(pageInput.value.trim());
      if (!pos) { pageInput.value = pdfPageToScriptLabel(currentPage, currentHalf); return; }
      const clamped = Math.max(1, Math.min(totalPages, pos.pdfPage));
      const newHalf = splitMode ? (pos.half || 'L') : 'L';
      pageInput.value = pdfPageToScriptLabel(clamped, newHalf);
      if (clamped !== currentPage || newHalf !== currentHalf) {
        currentPage = clamped; currentHalf = newHalf; renderZoneEditorPage(currentPage);
      }
    });
    pageInput.addEventListener('keydown', e => { if (e.key === 'Enter') pageInput.blur(); });
  }
}

async function changeZonePage(delta) {
  if (!pdfDoc) return;
  if (splitMode) {
    if (delta > 0) {
      if (currentHalf === 'L') { currentHalf = 'R'; } else { if (currentPage >= totalPages) return; currentPage++; currentHalf = 'L'; }
    } else {
      if (currentHalf === 'R') { currentHalf = 'L'; } else { if (currentPage <= 1) return; currentPage--; currentHalf = 'R'; }
    }
  } else {
    const next = currentPage + delta;
    if (next < 1 || next > totalPages) return;
    currentPage = next;
  }
  const pageInput = document.getElementById('ln-page-input');
  if (pageInput) pageInput.value = pdfPageToScriptLabel(currentPage, currentHalf);
  await renderZoneEditorPage(currentPage);
}

function toggleSplitMode() {
  splitMode = !splitMode;
  currentHalf = 'L';
  lineZones = {};
  const splitBtn = document.getElementById('ln-split-btn');
  if (splitBtn) splitBtn.classList.toggle('ln-header-btn--active', splitMode);
  toast(splitMode ? '2-up split ON' : '2-up split OFF');
  if (pdfDoc) renderZoneEditorPage(currentPage);
}

async function zeReExtract() {
  if (!pdfDoc) return;
  const zKey = pk();
  delete lineZones[zKey];
  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: pdfScale });
  await loadOrExtractZones(page, currentPage, viewport, zKey);
  zeRenderZones(); zeUpdateListPanel();
  toast('Zones re-extracted from PDF text layer');
}

function zeClearAll() {
  if (!confirmDialog('Delete all zones on this page?')) return;
  lineZones[pk()] = [];
  zeSelectedIdx = null;
  document.getElementById('ze-detail')?.classList.remove('visible');
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
  toast('All zones cleared');
}

/* ═══════════════════════════════════════════════════════════
   FIREBASE ZONE PERSISTENCE
   ═══════════════════════════════════════════════════════════ */
function debounceSaveZones() {
  if (zoneSaveTimeout) clearTimeout(zoneSaveTimeout);
  zoneSaveTimeout = setTimeout(() => firebaseSaveZones(pk()), 500);
}

async function firebaseSaveZones(zKey) {
  if (!isOwner()) return;
  const zones = lineZones[zKey] || [];
  const pid = state.activeProduction.id;
  try {
    await setDoc(doc(db, 'productions', pid, 'zones', zKey), { zones, updatedAt: serverTimestamp(), updatedBy: state.currentUser.uid });
    const badge = document.getElementById('ze-saved-badge');
    if (badge) { badge.classList.add('visible'); setTimeout(() => badge.classList.remove('visible'), 1800); }
  } catch(e) { toast('Failed to save zones', 'error'); }
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS (zone editor only)
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (!document.getElementById('tab-linenotes')?.classList.contains('tab-panel--active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'ArrowRight' || e.key === ']') changeZonePage(1);
  if (e.key === 'ArrowLeft' || e.key === '[') changeZonePage(-1);
  if (e.key === 'Escape') { zeSelectZone(null); zeClearMultiSelect(); }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const zones = zeCurrentZones();
    if (!zones.length) return;
    const cur = zeSelectedIdx !== null ? zeSelectedIdx : (dir === 1 ? -1 : zones.length);
    const next = Math.max(0, Math.min(zones.length - 1, cur + dir));
    zeSelectZone(next);
    return;
  }

  if (e.key === 'Enter' && zeSelectedIdx !== null) { zeSelectZone(zeSelectedIdx, true); return; }

  if ((e.key === 'Delete' || e.key === 'Backspace')) {
    if (zeMultiSelected.size > 0) { zeMultiDelete(); return; }
    if (zeSelectedIdx !== null) { zeDeleteSelected(); return; }
  }
  if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
    if (zeMultiSelected.size > 0) { zeMultiToggleCharName(); return; }
    if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isCharName = !z.isCharName; if (z.isCharName) z.isStageDirection = false; zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }
    return;
  }
  if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
    if (zeMultiSelected.size > 0) { zeMultiToggleStagDir(); return; }
    if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isStageDirection = !z.isStageDirection; if (z.isStageDirection) z.isCharName = false; zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }
    return;
  }
});