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

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */
let pdfDoc = null;
let totalPages = 0;
let currentPage = 1;
let splitMode = false;
let currentHalf = 'L';
let currentView = 'notes'; // 'notes' | 'zones'
let pdfScale = 1.4;
let lineZones = {};        // pageKey → [{x,y,w,h,text,isCharName,isStageDirection}]
let notes = [];
let characters = [];       // {id, name, color, email}
let activeCharIdx = 0;
let activeNoteType = 'skp';
let notesUnsub = null;
let zoneSaveTimeout = null;
let pdfFileName = '';

// Zone editor state
let zeSelectedIdx = null;
let zeMultiSelected = new Set();
let zeDrawing = false;
let zeDrawStart = null;
let zeDragState = null;    // {type:'move'|'resize', startX, startY, origBounds, idx, pw, ph}
let zeDetailDirty = false;

// Notes-view drawing state
let drawStart = null;
let drawing = false;

// Popover state
let popoverOpen = false;
let _popCloseGuard = false;
let pendingNote = null;

const NOTE_TYPES_MAP = {
  'skp': 'Skipped',
  'para': 'Paraphrase',
  'line': 'Called line',
  'add': 'Added words',
  'gen': 'General',
};
const NOTE_TYPES = [
  { key: 'skp', label: 'Skip', color: '#e63946' },
  { key: 'para', label: 'Para', color: '#e89b3e' },
  { key: 'line', label: 'Line', color: '#5b9bd4' },
  { key: 'add', label: 'Add', color: '#6b8f4e' },
  { key: 'gen', label: 'Gen', color: '#9b7bc8' },
];
const COLORS = [
  '#c45c4a','#d4844a','#c8a96e','#7ab87a','#5b9bd4',
  '#8b6cc4','#c46ca4','#6ab4b4','#d4b44a','#7a9ab4',
];

/* ═══════════════════════════════════════════════════════════
   DOM REFS
   ═══════════════════════════════════════════════════════════ */
const overlay        = document.getElementById('linenotes-overlay');
const popoverEl      = document.getElementById('note-popover');
const charModal      = document.getElementById('char-modal');
const sendModal      = document.getElementById('send-notes-modal');

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function pageZoneKey(num, half) { return splitMode ? `${num}${half}` : `${num}`; }
function pageLabel(num, half)   { return splitMode ? `${num}${half}` : `${num}`; }
function pk()                   { return pageZoneKey(currentPage, currentHalf); }

/* ═══════════════════════════════════════════════════════════
   INIT + OPEN/CLOSE
   ═══════════════════════════════════════════════════════════ */
export function initLineNotes() {
  document.getElementById('ln-back-btn').addEventListener('click', closeLineNotes);
  document.getElementById('ln-prev-page').addEventListener('click', () => changePage(-1));
  document.getElementById('ln-next-page').addEventListener('click', () => changePage(1));
  document.getElementById('ln-split-btn').addEventListener('click', toggleSplitMode);
  document.getElementById('ln-view-notes-btn').addEventListener('click', () => switchView('notes'));
  document.getElementById('ln-view-zones-btn').addEventListener('click', () => switchView('zones'));
  document.getElementById('ln-send-btn').addEventListener('click', openSendNotes);
  document.getElementById('ln-add-char-btn').addEventListener('click', openCharModal);

  // Notes view: rubber band on draw overlay
  document.getElementById('ln-draw-overlay').addEventListener('mousedown', notesDrawDown);

  // Zone editor: rubber band + drag on zone-edit-overlay
  const zeOvl = document.getElementById('ze-edit-overlay');
  zeOvl.addEventListener('mousedown', zeOverlayMouseDown);

  // Global mouse move/up for both views
  document.addEventListener('mousemove', globalMouseMove);
  document.addEventListener('mouseup', globalMouseUp);

  // Hit overlay click-to-close popover
  document.getElementById('ln-hit-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('ln-hit-overlay')) closePopover();
  });

  // Popover buttons
  document.getElementById('pop-cancel-btn').addEventListener('click', e => { e.stopPropagation(); closePopover(); });
  document.getElementById('pop-confirm-btn').addEventListener('click', e => { e.stopPropagation(); confirmNote(); });

  // Click outside to close modals
  document.addEventListener('click', e => {
    if (_popCloseGuard) return;
    if (popoverOpen && !popoverEl.contains(e.target)) closePopover();
    if (charModal.classList.contains('open') && e.target === charModal) charModal.classList.remove('open');
    if (sendModal.classList.contains('open') && e.target === sendModal) sendModal.classList.remove('open');
  });

  document.addEventListener('keydown', handleKeydown);
}

export function openLineNotes() {
  overlay.classList.add('open');
  document.getElementById('ln-show-name').textContent = state.activeProduction?.title || '';

  // Show/hide zones tab for owners
  document.getElementById('ln-view-zones-btn').classList.toggle('hidden', !isOwner());

  currentView = 'notes';
  currentPage = 1;
  splitMode = false;
  currentHalf = 'L';
  notes = [];
  lineZones = {};
  zeSelectedIdx = null;
  zeMultiSelected.clear();

  loadCharacters();
  subscribeToNotes();
  loadScript();
  updateViewButtons();
  renderSidebar();
}

function closeLineNotes() {
  overlay.classList.remove('open');
  closePopover();
  if (notesUnsub) { notesUnsub(); notesUnsub = null; }
}

/* ═══════════════════════════════════════════════════════════
   VIEW SWITCHING
   ═══════════════════════════════════════════════════════════ */
function switchView(view) {
  currentView = view;
  const sidebar   = document.getElementById('ln-sidebar');
  const scriptArea = document.getElementById('ln-script-area');
  const zoneArea  = document.getElementById('ln-zone-editor-area');

  if (view === 'notes') {
    sidebar.style.display = 'flex';
    scriptArea.style.display = 'flex';
    zoneArea.style.display = 'none';
    if (pdfDoc) renderPage(currentPage);
  } else {
    sidebar.style.display = 'none';
    scriptArea.style.display = 'none';
    zoneArea.style.display = 'flex';
    if (pdfDoc) renderZoneEditorPage(currentPage);
  }
  updateViewButtons();
}

function updateViewButtons() {
  document.getElementById('ln-view-notes-btn').classList.toggle('ln-header-btn--active', currentView === 'notes');
  document.getElementById('ln-view-zones-btn').classList.toggle('ln-header-btn--active', currentView === 'zones');
}

/* ═══════════════════════════════════════════════════════════
   SCRIPT LOADING
   ═══════════════════════════════════════════════════════════ */
async function loadScript() {
  const scriptPath = state.activeProduction?.scriptPath;
  if (!scriptPath) {
    if (isOwner()) showScriptUploadPrompt();
    else document.getElementById('ln-canvas-area').innerHTML = '<div style="color:#5c5850;text-align:center;padding:60px;">Script not yet uploaded by the production owner.</div>';
    return;
  }
  showProcessing('Loading script\u2026');
  try {
    const url = await getDownloadURL(ref(storage, scriptPath));
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ url });
    loadingTask.onProgress = p => {
      if (p.total > 0) document.getElementById('ln-progress-fill').style.width = Math.round((p.loaded / p.total) * 100) + '%';
    };
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    pdfFileName = (state.activeProduction?.title || 'script').replace(/[^a-zA-Z0-9]/g, '_');
    document.getElementById('ln-total-pages').textContent = totalPages;
    if (!state.activeProduction.scriptPageCount && isOwner()) {
      try { await updateDoc(doc(db, 'productions', state.activeProduction.id), { scriptPageCount: totalPages }); } catch(e) {}
    }
    hideProcessing();
    document.getElementById('ln-drop-zone').style.display = 'none';
    document.getElementById('ln-page-wrapper').style.display = 'block';
    document.getElementById('ln-page-nav').style.display = 'flex';
    await renderPage(currentPage);
  } catch(e) {
    console.error('Script load error:', e);
    hideProcessing();
    toast('Failed to load script: ' + e.message, 'error');
  }
}

function showScriptUploadPrompt() {
  const dz = document.getElementById('ln-drop-zone');
  dz.style.display = 'flex';
  dz.querySelector('#ln-upload-btn').addEventListener('click', () => dz.querySelector('#ln-file-input').click());
  dz.querySelector('#ln-file-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file || file.type !== 'application/pdf') { toast('Select a PDF.', 'error'); return; }
    const { uploadBytesResumable } = await import('firebase/storage');
    const pid = state.activeProduction.id;
    const storageRef = ref(storage, 'productions/' + pid + '/script.pdf');
    showProcessing('Uploading\u2026');
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      s => { document.getElementById('ln-progress-fill').style.width = Math.round((s.bytesTransferred / s.totalBytes) * 100) + '%'; },
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

function showProcessing(msg) {
  const el = document.getElementById('ln-processing');
  el.style.display = 'flex';
  el.querySelector('.text').textContent = msg;
  document.getElementById('ln-progress-fill').style.width = '0%';
}
function hideProcessing() { document.getElementById('ln-processing').style.display = 'none'; }

/* ═══════════════════════════════════════════════════════════
   SPLIT MODE
   ═══════════════════════════════════════════════════════════ */
function toggleSplitMode() {
  splitMode = !splitMode;
  currentHalf = 'L';
  lineZones = {};
  document.getElementById('ln-split-btn').classList.toggle('ln-header-btn--active', splitMode);
  toast(splitMode ? '2-up split ON' : '2-up split OFF');
  if (pdfDoc) {
    if (currentView === 'notes') renderPage(currentPage);
    else renderZoneEditorPage(currentPage);
  }
}

/* ═══════════════════════════════════════════════════════════
   PAGE NAVIGATION
   ═══════════════════════════════════════════════════════════ */
async function changePage(delta) {
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
  document.getElementById('ln-page-input').value = currentPage;
  if (currentView === 'notes') await renderPage(currentPage);
  else await renderZoneEditorPage(currentPage);
}

/* ═══════════════════════════════════════════════════════════
   NOTES VIEW — RENDER PAGE
   ═══════════════════════════════════════════════════════════ */
async function renderPage(num) {
  closePopover();
  const hitOverlay = document.getElementById('ln-hit-overlay');
  hitOverlay.innerHTML = '';

  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = document.getElementById('ln-canvas');
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

  document.getElementById('ln-page-input').value = num;
  const zKey = pk();
  if (!lineZones[zKey]) await loadOrExtractZones(page, num, viewport, zKey);
  renderLineZones(zKey);
  renderNoteMarkers(num, currentHalf);
}

/* ═══════════════════════════════════════════════════════════
   ZONE EXTRACTION
   ═══════════════════════════════════════════════════════════ */
async function loadOrExtractZones(page, num, viewport, zKey) {
  // Try Firestore first
  const pid = state.activeProduction.id;
  try {
    const zoneDoc = await getDoc(doc(db, 'productions', pid, 'zones', zKey));
    if (zoneDoc.exists() && zoneDoc.data().zones?.length > 0) {
      lineZones[zKey] = zoneDoc.data().zones;
      return;
    }
  } catch(e) { /* fall through */ }

  // Extract from PDF text layer
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
    // Auto-save for owners
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
   NOTES VIEW — RENDER LINE ZONES + NOTE MARKERS
   ═══════════════════════════════════════════════════════════ */
function renderLineZones(zKey) {
  const hitOverlay = document.getElementById('ln-hit-overlay');
  const zones = lineZones[zKey] || [];
  const existingZoneIdxs = new Set(
    notes.filter(n => n.page === currentPage && n.half === (splitMode ? currentHalf : ''))
      .map(n => n.zoneIdx).filter(i => i !== undefined)
  );

  zones.forEach((zone, idx) => {
    if (zone.isCharName) return;
    if (zone.isStageDirection) {
      const sd = document.createElement('div');
      sd.style.cssText = `position:absolute;left:${zone.x}%;top:${zone.y}%;width:${zone.w}%;height:${Math.max(zone.h,1.5)}%;border-left:2px solid rgba(154,148,136,0.3);pointer-events:none;`;
      hitOverlay.appendChild(sd);
      return;
    }
    const div = document.createElement('div');
    div.className = 'line-zone' + (existingZoneIdxs.has(idx) ? ' has-note' : '');
    div.style.left = zone.x + '%'; div.style.top = zone.y + '%';
    div.style.width = zone.w + '%'; div.style.height = Math.max(zone.h, 1.5) + '%';
    div.dataset.zone = idx;
    div.title = zone.text ? zone.text.substring(0, 80) : '';
    div.addEventListener('click', e => {
      e.stopPropagation();
      const existing = notes.find(n => n.page === currentPage && (splitMode ? n.half === currentHalf : true) && n.zoneIdx === idx);
      if (existing) openEditPopover(e, existing);
      else openPopover(e, currentPage, currentHalf, idx, zone);
    });
    const label = document.createElement('span');
    label.className = 'zone-label';
    label.textContent = zone.text ? zone.text.substring(0, 40) : `zone ${idx}`;
    div.appendChild(label);
    hitOverlay.appendChild(div);
  });
}

function renderNoteMarkers(num, half) {
  const hitOverlay = document.getElementById('ln-hit-overlay');
  notes.filter(n => n.page === num && (splitMode ? n.half === half : true)).forEach(note => {
    const ch = characters.find(c => c.id === note.charId);
    const color = ch?.color || note.charColor || '#c8a96e';
    if (!note.bounds) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${note.bounds.x}%;top:${note.bounds.y}%;width:${note.bounds.w}%;height:${note.bounds.h}%;z-index:5;pointer-events:all;cursor:pointer;`;
    const underline = document.createElement('div');
    underline.style.cssText = `position:absolute;bottom:0;left:0;right:0;height:2.5px;border-radius:1px;opacity:0.75;background:${color};`;
    wrap.appendChild(underline);
    const tag = document.createElement('div');
    tag.className = 'note-tag';
    tag.style.background = color;
    tag.textContent = note.type;
    wrap.appendChild(tag);
    wrap.addEventListener('click', e => { e.stopPropagation(); openEditPopover(e, note); });
    hitOverlay.appendChild(wrap);
  });
}

function redrawOverlay(num) {
  const hitOverlay = document.getElementById('ln-hit-overlay');
  hitOverlay.innerHTML = '';
  renderLineZones(pk());
  renderNoteMarkers(num, currentHalf);
}

/* ═══════════════════════════════════════════════════════════
   NOTES VIEW — POPOVER
   ═══════════════════════════════════════════════════════════ */
function openPopover(e, pageNum, half, zoneIdx, zone) {
  e.stopPropagation();
  if (characters.length === 0) { toast('Add a cast member first'); return; }
  pendingNote = { page: pageNum, half: splitMode ? half : '', zoneIdx, bounds: { x: zone.x, y: zone.y, w: zone.w, h: Math.max(zone.h, 1.5) }, lineText: zone.text || '' };
  buildPopover(null, null, zone.text);
  positionPopover(e.clientX, e.clientY);
  showPopover();
}

function openEditPopover(e, note) {
  e.stopPropagation();
  pendingNote = { editId: note.id, page: note.page, half: note.half || '', bounds: note.bounds, lineText: note.lineText || '' };
  buildPopover(note.charId, note.type, note.lineText);
  positionPopover(e.clientX, e.clientY);
  showPopover();
}

function buildPopover(selCharId, selType, lineText) {
  const charsDiv = document.getElementById('pop-chars');
  const typesDiv = document.getElementById('pop-types');
  const lineEl = document.getElementById('pop-line-text');
  charsDiv.innerHTML = ''; typesDiv.innerHTML = '';
  if (lineText && lineText.trim().length > 1) { lineEl.textContent = '\u201c' + lineText.trim() + '\u201d'; lineEl.style.display = 'block'; }
  else lineEl.style.display = 'none';

  const defChar = selCharId || (characters[activeCharIdx]?.id) || characters[0]?.id;
  characters.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'popover-char' + (c.id === defChar ? ' popover-char--active' : '');
    div.dataset.id = c.id;
    div.innerHTML = `<div class="pop-char-dot" style="background:${c.color};width:8px;height:8px;border-radius:50%;flex-shrink:0;"></div><span>${escapeHtml(c.name)}</span><span class="shortcut-key">${i+1}</span>`;
    div.addEventListener('click', () => { charsDiv.querySelectorAll('.popover-char').forEach(el => el.classList.remove('popover-char--active')); div.classList.add('popover-char--active'); activeCharIdx = i; });
    charsDiv.appendChild(div);
  });
  if (defChar) { const ci = characters.findIndex(c => c.id === defChar); if (ci >= 0) activeCharIdx = ci; }

  const defType = selType || activeNoteType;
  Object.entries(NOTE_TYPES_MAP).forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'popover-type' + (key === defType ? ' popover-type--active' : '');
    btn.dataset.type = key; btn.textContent = key; btn.title = label;
    btn.addEventListener('click', () => { typesDiv.querySelectorAll('.popover-type').forEach(el => el.classList.remove('popover-type--active')); btn.classList.add('popover-type--active'); activeNoteType = key; });
    typesDiv.appendChild(btn);
  });
  if (defType) activeNoteType = defType;

  // Update confirm button text
  document.getElementById('pop-confirm-btn').textContent = pendingNote?.editId ? 'Update' : 'Add Note \u21b5';
}

function positionPopover(mx, my) {
  popoverEl.style.visibility = 'hidden'; popoverEl.style.display = 'flex';
  const pw = popoverEl.offsetWidth || 250, ph = popoverEl.offsetHeight || 220;
  popoverEl.style.display = 'none'; popoverEl.style.visibility = '';
  let left = mx + 14, top = my - 24;
  if (left + pw > window.innerWidth - 16) left = mx - pw - 14;
  if (top + ph > window.innerHeight - 16) top = window.innerHeight - ph - 16;
  popoverEl.style.left = left + 'px'; popoverEl.style.top = Math.max(8, top) + 'px';
}

function showPopover() {
  popoverEl.style.display = 'flex'; popoverOpen = true;
  _popCloseGuard = true;
  requestAnimationFrame(() => { _popCloseGuard = false; });
}
function closePopover() { popoverEl.style.display = 'none'; pendingNote = null; popoverOpen = false; }

async function confirmNote() {
  if (!pendingNote || activeCharIdx < 0 || !characters[activeCharIdx]) return;
  const ch = characters[activeCharIdx];
  const pid = state.activeProduction.id;
  const noteData = {
    uid: state.currentUser.uid,
    charId: ch.id, charName: ch.name, charColor: ch.color,
    type: activeNoteType, page: pendingNote.page, half: pendingNote.half || '',
    zoneIdx: pendingNote.zoneIdx, bounds: pendingNote.bounds, lineText: pendingNote.lineText || '',
    productionId: pid,
  };

  try {
    if (pendingNote.editId) {
      await updateDoc(doc(db, 'productions', pid, 'lineNotes', pendingNote.editId), { ...noteData, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, 'productions', pid, 'lineNotes'), { ...noteData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    toast('Note ' + (pendingNote.editId ? 'updated' : 'added'));
  } catch(e) { toast('Failed to save note', 'error'); }
  closePopover();
}

/* ═══════════════════════════════════════════════════════════
   NOTES VIEW — RUBBER BAND DRAW
   ═══════════════════════════════════════════════════════════ */
function notesDrawDown(e) {
  if (e.button !== 0 || characters.length === 0) return;
  const wrapper = document.getElementById('ln-page-wrapper');
  const wRect = wrapper.getBoundingClientRect();
  const clickX = e.clientX - wRect.left, clickY = e.clientY - wRect.top;
  const pw = wrapper.offsetWidth, ph = wrapper.offsetHeight;
  const xPct = (clickX / pw) * 100, yPct = (clickY / ph) * 100;
  const zKey = pk();
  const zones = lineZones[zKey] || [];
  if (zones.some(z => !z.isCharName && xPct >= z.x && xPct <= z.x + z.w && yPct >= z.y && yPct <= z.y + Math.max(z.h, 1.5))) return;
  if (notes.some(n => { const b = n.bounds; return b && n.page === currentPage && xPct >= b.x && xPct <= b.x + b.w && yPct >= b.y && yPct <= b.y + b.h; })) return;
  drawStart = { x: clickX, y: clickY };
  drawing = true;
  const rb = document.getElementById('ln-rubber-band');
  rb.style.display = 'block'; rb.style.left = drawStart.x + 'px'; rb.style.top = drawStart.y + 'px'; rb.style.width = '0'; rb.style.height = '0';
}

/* ═══════════════════════════════════════════════════════════
   GLOBAL MOUSE MOVE/UP
   ═══════════════════════════════════════════════════════════ */
function globalMouseMove(e) {
  // Notes rubber band
  if (drawing && drawStart) {
    const wrapper = document.getElementById('ln-page-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const x = Math.min(cx, drawStart.x), y = Math.min(cy, drawStart.y);
    const w = Math.abs(cx - drawStart.x), h = Math.abs(cy - drawStart.y);
    const rb = document.getElementById('ln-rubber-band');
    rb.style.left = x + 'px'; rb.style.top = y + 'px'; rb.style.width = w + 'px'; rb.style.height = h + 'px';
  }
  // Zone editor drag
  if (zeDragState) zeHandleMouseMove(e);
  // Zone editor rubber band
  if (zeDrawing && zeDrawStart) {
    const wrapper = document.getElementById('ze-page-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const x = Math.min(cx, zeDrawStart.x), y = Math.min(cy, zeDrawStart.y);
    const w = Math.abs(cx - zeDrawStart.x), h = Math.abs(cy - zeDrawStart.y);
    const rb = document.getElementById('ze-rubber-band');
    rb.style.left = x + 'px'; rb.style.top = y + 'px'; rb.style.width = w + 'px'; rb.style.height = h + 'px';
  }
}

function globalMouseUp(e) {
  // Zone editor drag end
  if (zeDragState) { zeDragState = null; zeUpdateListPanel(); debounceSaveZones(); return; }
  // Zone editor rubber band end
  if (zeDrawing && zeDrawStart) { zeFinishDraw(e); return; }
  // Notes rubber band end
  if (!drawing || !drawStart) return;
  drawing = false;
  document.getElementById('ln-rubber-band').style.display = 'none';
  const wrapper = document.getElementById('ln-page-wrapper');
  const rect = wrapper.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const x = Math.min(cx, drawStart.x), y = Math.min(cy, drawStart.y);
  const w = Math.abs(cx - drawStart.x), h = Math.abs(cy - drawStart.y);
  if (w < 10 || h < 5) { drawStart = null; return; }
  const pw = wrapper.offsetWidth, ph = wrapper.offsetHeight;
  const bounds = { x: (x / pw) * 100, y: (y / ph) * 100, w: (w / pw) * 100, h: (h / ph) * 100 };
  pendingNote = { page: currentPage, half: splitMode ? currentHalf : '', bounds, lineText: '' };
  buildPopover(null, null, '');
  positionPopover(e.clientX, e.clientY);
  showPopover();
  drawStart = null;
}

/* ═══════════════════════════════════════════════════════════
   ZONE EDITOR VIEW
   ═══════════════════════════════════════════════════════════ */
async function renderZoneEditorPage(num) {
  zeSelectedIdx = null;
  zeMultiSelected.clear();
  document.getElementById('ze-detail').classList.remove('visible');
  document.getElementById('ze-multi-bar').classList.remove('visible');

  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = document.getElementById('ze-canvas');
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

  document.getElementById('ln-page-input').value = num;
  const zKey = pk();
  if (!lineZones[zKey]) await loadOrExtractZones(page, num, viewport, zKey);

  zeRenderZones();
  zeUpdateListPanel();
}

function zeCurrentZones() {
  const zKey = pk();
  return lineZones[zKey] || (lineZones[zKey] = []);
}

function zeRenderZones() {
  const ovl = document.getElementById('ze-edit-overlay');
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
  const { type, idx, startX, startY, origBounds, pw, ph } = zeDragState;
  const dx = ((e.clientX - startX) / pw) * 100;
  const dy = ((e.clientY - startY) / ph) * 100;
  const zones = zeCurrentZones();
  if (type === 'move') {
    zones[idx].x = Math.max(0, Math.min(99, origBounds.x + dx));
    zones[idx].y = Math.max(0, Math.min(99, origBounds.y + dy));
  } else {
    zones[idx].w = Math.min(100 - zones[idx].x, Math.max(2, origBounds.w + dx));
    zones[idx].h = Math.max(0.5, origBounds.h + dy);
  }
  const div = document.getElementById('ze-edit-overlay').querySelector(`[data-idx="${idx}"]`);
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
  rb.style.display = 'block'; rb.style.left = zeDrawStart.x + 'px'; rb.style.top = zeDrawStart.y + 'px'; rb.style.width = '0'; rb.style.height = '0';
}

function zeFinishDraw(e) {
  zeDrawing = false;
  document.getElementById('ze-rubber-band').style.display = 'none';
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
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zones.length - 1);
  debounceSaveZones();
  toast('Zone drawn \u2014 edit text or type in the panel');
}

/* ── Zone editor selection ── */
function zeSelectZone(idx) {
  zeSelectedIdx = idx;
  document.getElementById('ze-edit-overlay').querySelectorAll('.ze-zone').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === idx));
  document.getElementById('ze-items-list').querySelectorAll('.ze-list-item').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === idx));
  if (idx !== null && idx !== undefined) {
    zePopulateDetail(idx);
    document.getElementById('ze-detail').classList.add('visible');
  } else {
    document.getElementById('ze-detail').classList.remove('visible');
  }
}

function zeToggleMultiSelect(idx) {
  zeSelectedIdx = null;
  document.getElementById('ze-detail').classList.remove('visible');
  if (zeMultiSelected.has(idx)) zeMultiSelected.delete(idx); else zeMultiSelected.add(idx);
  zeRefreshMultiBar(); zeRenderZones(); zeUpdateListPanel();
}

function zeClearMultiSelect() { zeMultiSelected.clear(); zeRefreshMultiBar(); zeRenderZones(); zeUpdateListPanel(); }

function zeRefreshMultiBar() {
  const bar = document.getElementById('ze-multi-bar');
  const count = document.getElementById('ze-multi-count');
  if (zeMultiSelected.size > 0) { bar.classList.add('visible'); count.textContent = `${zeMultiSelected.size} zone${zeMultiSelected.size > 1 ? 's' : ''} selected`; }
  else bar.classList.remove('visible');
}

function zePopulateDetail(idx) {
  const z = zeCurrentZones()[idx]; if (!z) return;
  document.getElementById('zd-x').value = z.x.toFixed(1);
  document.getElementById('zd-y').value = z.y.toFixed(1);
  document.getElementById('zd-w').value = z.w.toFixed(1);
  document.getElementById('zd-h').value = z.h.toFixed(1);
  document.getElementById('zd-text').value = z.text || '';
  document.getElementById('zd-charname').checked = !!z.isCharName;
  document.getElementById('zd-stagedir').checked = !!z.isStageDirection;
}

function zeApplyDetail() {
  if (zeSelectedIdx === null) return;
  const zones = zeCurrentZones(); const z = zones[zeSelectedIdx]; if (!z) return;
  z.x = parseFloat(document.getElementById('zd-x').value) || z.x;
  z.y = parseFloat(document.getElementById('zd-y').value) || z.y;
  z.w = parseFloat(document.getElementById('zd-w').value) || z.w;
  z.h = parseFloat(document.getElementById('zd-h').value) || z.h;
  z.text = document.getElementById('zd-text').value;
  z.isCharName = document.getElementById('zd-charname').checked;
  z.isStageDirection = document.getElementById('zd-stagedir').checked;
  if (z.isCharName) z.isStageDirection = false;
  if (z.isStageDirection) z.isCharName = false;
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones();
  toast('Zone updated');
}

function zeDeleteSelected() {
  if (zeSelectedIdx === null) return;
  zeCurrentZones().splice(zeSelectedIdx, 1);
  zeSelectedIdx = null;
  document.getElementById('ze-detail').classList.remove('visible');
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones(); toast('Zone deleted');
}

function zeMultiDelete() {
  if (zeMultiSelected.size === 0) return;
  const zones = zeCurrentZones();
  [...zeMultiSelected].sort((a, b) => b - a).forEach(i => zones.splice(i, 1));
  const cnt = zeMultiSelected.size;
  zeMultiSelected.clear(); zeSelectedIdx = null;
  document.getElementById('ze-detail').classList.remove('visible');
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

function zeUpdateListPanel() {
  const zones = zeCurrentZones();
  const annotatable = zones.filter(z => !z.isCharName).length;
  document.getElementById('ze-list-meta').textContent = `${zones.length} zones (${annotatable} annotatable) \u00b7 p.${pageLabel(currentPage, currentHalf)}`;

  const list = document.getElementById('ze-items-list');
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
      if (zeSelectedIdx === idx) { zeSelectedIdx = null; document.getElementById('ze-detail').classList.remove('visible'); }
      else if (zeSelectedIdx > idx) zeSelectedIdx--;
      zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
    });
  });
}

// Wire up zone editor toolbar (called once from initLineNotes would require static HTML; we wire on view switch)
function wireZeToolbar() {
  document.getElementById('ze-btn-reextract')?.removeEventListener('click', zeReExtract);
  document.getElementById('ze-btn-reextract')?.addEventListener('click', zeReExtract);
  document.getElementById('ze-btn-clear')?.addEventListener('click', zeClearAll);
  document.getElementById('ze-btn-save')?.addEventListener('click', () => firebaseSaveZones(pk()));
  document.getElementById('ze-btn-multi-char')?.addEventListener('click', zeMultiToggleCharName);
  document.getElementById('ze-btn-multi-dir')?.addEventListener('click', zeMultiToggleStagDir);
  document.getElementById('ze-btn-multi-del')?.addEventListener('click', zeMultiDelete);
  document.getElementById('ze-btn-multi-clear')?.addEventListener('click', zeClearMultiSelect);
  document.getElementById('ze-btn-apply')?.addEventListener('click', zeApplyDetail);
  document.getElementById('ze-btn-del-zone')?.addEventListener('click', zeDeleteSelected);
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
  document.getElementById('ze-detail').classList.remove('visible');
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
   NOTES SUBSCRIPTION (FIREBASE)
   ═══════════════════════════════════════════════════════════ */
function subscribeToNotes() {
  if (notesUnsub) notesUnsub();
  const pid = state.activeProduction.id;
  try {
    notesUnsub = onSnapshot(
      query(collection(db, 'productions', pid, 'lineNotes'), where('productionId', '==', pid)),
      snap => { notes = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderSidebar(); if (currentView === 'notes' && pdfDoc) redrawOverlay(currentPage); },
      err => {
        if (notesUnsub) { notesUnsub(); notesUnsub = null; }
        notesUnsub = onSnapshot(collection(db, 'productions', pid, 'lineNotes'), snap => {
          notes = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderSidebar(); if (currentView === 'notes' && pdfDoc) redrawOverlay(currentPage);
        });
      }
    );
  } catch(e) {
    notesUnsub = onSnapshot(collection(db, 'productions', pid, 'lineNotes'), snap => {
      notes = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderSidebar(); if (currentView === 'notes' && pdfDoc) redrawOverlay(currentPage);
    });
  }
  state.unsubscribers.push(() => { if (notesUnsub) { notesUnsub(); notesUnsub = null; } });
}

/* ═══════════════════════════════════════════════════════════
   CHARACTERS
   ═══════════════════════════════════════════════════════════ */
async function loadCharacters() {
  const uid = state.currentUser.uid, pid = state.activeProduction.id;
  try {
    const d = await getDoc(doc(db, 'users', uid, 'productions', pid));
    characters = d.exists() && d.data().characters ? d.data().characters : [];
  } catch(e) { characters = []; }
  if (characters.length > 0) activeCharIdx = 0;
  renderSidebar();
}

async function saveCharacters() {
  try { await setDoc(doc(db, 'users', state.currentUser.uid, 'productions', state.activeProduction.id), { characters }, { merge: true }); } catch(e) {}
}

function openCharModal() {
  charModal.classList.add('open');
  const usedColors = characters.map(c => c.color);
  const availColor = COLORS.find(c => !usedColors.includes(c)) || COLORS[0];
  let selectedColor = availColor;

  charModal.innerHTML = `<div class="char-modal-card"><h3>Add Cast Member</h3>
    <input type="text" id="cm-name" placeholder="Character / Actor name" maxlength="100" />
    <div style="font-size:11px;color:#5c5850;margin:8px 0 4px;">Color</div>
    <div class="char-color-grid">${COLORS.map(c => `<div class="char-color-swatch${c === availColor ? ' char-color-swatch--selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>
    <div class="modal-btns"><button class="modal-btn-cancel" id="cm-cancel">Cancel</button><button class="modal-btn-primary" id="cm-save">Add Member</button></div>
  </div>`;

  charModal.querySelectorAll('.char-color-swatch').forEach(s => s.addEventListener('click', () => {
    charModal.querySelectorAll('.char-color-swatch').forEach(ss => ss.classList.remove('char-color-swatch--selected'));
    s.classList.add('char-color-swatch--selected'); selectedColor = s.dataset.color;
  }));
  charModal.querySelector('#cm-cancel').addEventListener('click', () => charModal.classList.remove('open'));
  const nameInput = charModal.querySelector('#cm-name');
  setTimeout(() => nameInput.focus(), 50);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  charModal.querySelector('#cm-save').addEventListener('click', doAdd);

  function doAdd() {
    const name = sanitizeName(nameInput.value);
    if (!name) { toast('Enter a name', 'error'); return; }
    characters.push({ id: genId(), name, color: selectedColor, email: '' });
    activeCharIdx = characters.length - 1;
    saveCharacters(); charModal.classList.remove('open'); renderSidebar(); toast(name + ' added');
  }
}

/* ═══════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════ */
function renderSidebar() {
  const castList = document.getElementById('ln-cast-list');
  castList.innerHTML = characters.map((c, i) => {
    const cnt = notes.filter(n => n.charId === c.id).length;
    return `<div class="char-item ${i === activeCharIdx ? 'char-item--active' : ''}" data-idx="${i}"><div class="char-dot" style="background:${escapeHtml(c.color)}"></div><span>${escapeHtml(c.name)}</span>${cnt ? `<span class="char-count">${cnt}</span>` : ''}<button class="delete-char" data-idx="${i}">\u00d7</button></div>`;
  }).join('') || '<div style="color:#5c5850;font-size:12px;padding:8px;">Add cast members to get started</div>';

  castList.querySelectorAll('.char-item').forEach(el => el.addEventListener('click', e => {
    if (e.target.classList.contains('delete-char')) return;
    activeCharIdx = parseInt(el.dataset.idx); renderSidebar();
  }));
  castList.querySelectorAll('.delete-char').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation(); const idx = parseInt(btn.dataset.idx); const ch = characters[idx];
    if (notes.some(n => n.charId === ch.id) && !confirmDialog('Delete ' + ch.name + '? Notes will remain.')) return;
    characters.splice(idx, 1); if (activeCharIdx >= characters.length) activeCharIdx = Math.max(0, characters.length - 1);
    saveCharacters(); renderSidebar();
  }));

  const typesEl = document.getElementById('ln-note-types');
  typesEl.innerHTML = NOTE_TYPES.map(t => `<button class="note-type-btn ${activeNoteType === t.key ? 'note-type-btn--active' : ''}" data-type="${t.key}">${t.key}</button>`).join('');
  typesEl.querySelectorAll('.note-type-btn').forEach(btn => btn.addEventListener('click', () => { activeNoteType = btn.dataset.type; renderSidebar(); }));

  const notesList = document.getElementById('ln-notes-list');
  const sorted = [...notes].sort((a, b) => a.page !== b.page ? a.page - b.page : (a.bounds?.y || 0) - (b.bounds?.y || 0));
  notesList.innerHTML = sorted.map(n => {
    return `<div class="note-item" data-noteid="${escapeHtml(n.id)}"><div class="note-color-bar" style="background:${escapeHtml(n.charColor || '#888')}"></div><div class="note-item-content"><div class="note-item-header"><span class="note-page">p.${n.page}${n.half || ''}</span><span class="note-char-name">${escapeHtml(n.charName || '?')}</span><span class="note-type-label">${escapeHtml(n.type)}</span></div>${n.lineText ? `<div class="note-text-preview">\u201c${escapeHtml(n.lineText.slice(0, 80))}\u201d</div>` : ''}</div><button class="note-delete-btn" data-noteid="${escapeHtml(n.id)}">\u00d7</button></div>`;
  }).join('') || '<div style="color:#5c5850;font-size:12px;padding:12px;">No notes yet. Load a script and click any line.</div>';

  notesList.querySelectorAll('.note-item').forEach(el => el.addEventListener('click', e => {
    if (e.target.classList.contains('note-delete-btn')) return;
    const note = notes.find(n => n.id === el.dataset.noteid);
    if (note) { currentPage = note.page; if (splitMode && note.half) currentHalf = note.half; renderPage(currentPage); }
  }));
  notesList.querySelectorAll('.note-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation(); const note = notes.find(n => n.id === btn.dataset.noteid); if (!note) return;
    if (note.uid !== state.currentUser.uid && !isOwner()) { toast('Can only delete your own notes', 'error'); return; }
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'lineNotes', note.id)); toast('Note deleted'); } catch(e) { toast('Failed', 'error'); }
  }));
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════ */
function handleKeydown(e) {
  if (!overlay.classList.contains('open')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (popoverOpen) {
    if (e.key === 'Enter') { confirmNote(); return; }
    if (e.key === 'Escape') { closePopover(); return; }
    const num = parseInt(e.key);
    if (num >= 1 && num <= characters.length) {
      document.getElementById('pop-chars').querySelectorAll('.popover-char').forEach((el, i) => el.classList.toggle('popover-char--active', i === num - 1));
      activeCharIdx = num - 1; return;
    }
    const typeKeys = { 's': 'skp', 'p': 'para', 'l': 'line', 'a': 'add', 'g': 'gen' };
    if (typeKeys[e.key.toLowerCase()]) {
      activeNoteType = typeKeys[e.key.toLowerCase()];
      document.getElementById('pop-types').querySelectorAll('.popover-type').forEach(el => el.classList.toggle('popover-type--active', el.dataset.type === activeNoteType));
      return;
    }
  }

  if (e.key === 'ArrowRight' || e.key === ']') changePage(1);
  if (e.key === 'ArrowLeft' || e.key === '[') changePage(-1);
  if (e.key === 'Escape') { closePopover(); zeSelectZone(null); zeClearMultiSelect(); }

  if (currentView === 'zones') {
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
  }
}

/* ═══════════════════════════════════════════════════════════
   SEND NOTES
   ═══════════════════════════════════════════════════════════ */
function openSendNotes() {
  if (notes.length === 0) { toast('No notes to send'); return; }
  sendModal.classList.add('open');
  const byChar = {};
  notes.forEach(n => { if (!byChar[n.charId]) byChar[n.charId] = { name: n.charName, color: n.charColor, email: '', notes: [] }; byChar[n.charId].notes.push(n); });
  characters.forEach(c => { if (byChar[c.id]) byChar[c.id].email = c.email || ''; });
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const show = state.activeProduction?.title || '';

  const sections = Object.entries(byChar).filter(([, d]) => d.notes.length > 0).map(([cid, data]) => {
    const sorted = data.notes.sort((a, b) => a.page - b.page || (a.bounds?.y || 0) - (b.bounds?.y || 0));
    const rows = sorted.map(n => `<div class="send-note-row" style="border-left-color:${escapeHtml(data.color)}"><strong>p.${n.page}${n.half || ''}</strong> [${escapeHtml(n.type)}] <em>${escapeHtml((n.lineText || '').slice(0, 100))}</em></div>`).join('');
    return `<div class="send-char-section"><div class="send-char-header"><div style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(data.color)};display:inline-block;"></div><span class="char-name">${escapeHtml(data.name)}</span></div>${rows}</div>`;
  }).join('');

  sendModal.innerHTML = `<div class="send-notes-card"><h3>Send Line Notes</h3><div style="font-family:'DM Mono',monospace;font-size:11px;color:#5c5850;margin-bottom:16px;">${date} \u00b7 ${notes.length} note${notes.length !== 1 ? 's' : ''}</div>${sections}<div class="send-notes-actions"><button class="modal-btn-primary" id="send-print">Generate Notes Report \u2197</button><button class="modal-btn-cancel" id="send-close">Close</button></div></div>`;
  sendModal.querySelector('#send-close').addEventListener('click', () => sendModal.classList.remove('open'));
  sendModal.querySelector('#send-print').addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow popups'); return; }
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Line Notes</title><style>@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#f5f3ee;color:#1a1814;padding:40px 48px}h1{font-family:'Instrument Serif',serif;font-size:32px;margin-bottom:6px}.meta{font-family:'DM Mono',monospace;font-size:12px;color:#999;margin-bottom:36px}.s{background:#fff;border-radius:10px;padding:22px 26px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.07)}.sh{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #f0ede4}.sd{width:12px;height:12px;border-radius:50%}.sn{font-size:18px;font-weight:500;flex:1}.nr{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f5f3ee}.nr:last-child{border-bottom:none}.np{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;color:#fff;padding:3px 8px;border-radius:3px;flex-shrink:0;margin-top:3px}.nd{display:flex;flex-direction:column;gap:5px}.pg{font-family:'DM Mono',monospace;font-size:11px;color:#aaa;margin-right:6px}.tl{font-size:13px;font-weight:500;color:#444}.lt{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;color:#333}@media print{body{padding:20px}}</style></head><body><h1>Line Notes</h1><div class="meta">${escapeHtml(show)} \u00b7 ${date} \u00b7 ${notes.length} note${notes.length !== 1 ? 's' : ''}</div>`;
    Object.entries(byChar).forEach(([, data]) => {
      if (!data.notes.length) return;
      const sorted = data.notes.sort((a, b) => a.page - b.page);
      html += `<section class="s"><div class="sh"><span class="sd" style="background:${escapeHtml(data.color)}"></span><span class="sn">${escapeHtml(data.name)}</span></div>`;
      sorted.forEach(n => {
        html += `<div class="nr"><div class="np" style="background:${escapeHtml(data.color)}">${escapeHtml(n.type)}</div><div class="nd"><div><span class="pg">p.${n.page}${n.half || ''}</span><span class="tl">${NOTE_TYPES_MAP[n.type] || n.type}</span></div>${n.lineText ? `<div class="lt">\u201c${escapeHtml(n.lineText)}\u201d</div>` : ''}</div></div>`;
      });
      html += '</section>';
    });
    html += '</body></html>';
    w.document.write(html); w.document.close();
    sendModal.classList.remove('open'); toast('Notes report opened');
  });
}

/* ═══════════════════════════════════════════════════════════
   PROCESSING UI / TOAST (reuse app toast)
   ═══════════════════════════════════════════════════════════ */
// Wire zone editor toolbar buttons after DOM is ready
setTimeout(() => wireZeToolbar(), 0);