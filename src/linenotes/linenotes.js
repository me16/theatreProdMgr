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

/* ===== LOCAL STATE ===== */
let pdfDoc = null;
let totalPages = 0;
let currentPage = 1;
let splitMode = false;
let currentHalf = 'L';
let currentView = 'notes'; // 'notes' | 'zones'
let pdfScale = 1.4;
let lineZones = {}; // keyed by pageKey
let notes = [];
let characters = []; // { id, name, color, email }
let activeCharIdx = 0;
let activeNoteType = 'skp';
let notesUnsub = null;
let selectedZoneIdxs = [];
let popoverOpen = false;
let popoverState = {};
let drawingRect = false;
let drawStart = null;
let zoneSaveTimeout = null;

const NOTE_TYPES = [
  { key: 'skp', label: 'Skip', color: '#e63946' },
  { key: 'para', label: 'Para', color: '#e89b3e' },
  { key: 'line', label: 'Line', color: '#5b9bd4' },
  { key: 'add', label: 'Add', color: '#6b8f4e' },
  { key: 'gen', label: 'Gen', color: '#9b7bc8' },
];

const DEFAULT_COLORS = [
  '#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#f4a261',
  '#264653', '#6b705c', '#e07a5f', '#3d405b', '#81b29a',
  '#d4af37', '#c8a96e', '#5b9bd4', '#9b7bc8', '#e89b3e',
];

const overlay = document.getElementById('linenotes-overlay');
const canvas = document.getElementById('ln-canvas');
const ctx = canvas.getContext('2d');
const zonesLayer = document.getElementById('ln-zones-layer');
const canvasArea = document.getElementById('ln-canvas-area');
const canvasContainer = document.getElementById('ln-canvas-container');
const processingOverlay = document.getElementById('ln-processing');
const progressFill = document.getElementById('ln-progress-fill');
const popoverEl = document.getElementById('note-popover');
const charModal = document.getElementById('char-modal');
const sendModal = document.getElementById('send-notes-modal');
const zoneEditorPanel = document.getElementById('zone-editor-panel');

export function initLineNotes() {
  document.getElementById('ln-back-btn').addEventListener('click', closeLineNotes);
  document.getElementById('ln-prev-page').addEventListener('click', () => goToPage(currentPage - 1));
  document.getElementById('ln-next-page').addEventListener('click', () => goToPage(currentPage + 1));
  document.getElementById('ln-split-btn').addEventListener('click', toggleSplit);
  document.getElementById('ln-view-notes-btn').addEventListener('click', () => setView('notes'));
  document.getElementById('ln-view-zones-btn').addEventListener('click', () => setView('zones'));
  document.getElementById('ln-send-btn').addEventListener('click', openSendNotes);
  document.getElementById('ln-add-char-btn').addEventListener('click', openCharModal);

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  // Canvas area interactions for rubber-band drawing
  canvasContainer.addEventListener('mousedown', onCanvasMouseDown);
  canvasContainer.addEventListener('mousemove', onCanvasMouseMove);
  canvasContainer.addEventListener('mouseup', onCanvasMouseUp);
}

export function openLineNotes() {
  overlay.classList.add('open');
  document.getElementById('ln-show-name').textContent = state.activeProduction?.title || '';

  // Show/hide zones tab for owners
  const zonesBtn = document.getElementById('ln-view-zones-btn');
  zonesBtn.classList.toggle('hidden', !isOwner());

  currentView = 'notes';
  currentPage = 1;
  splitMode = false;
  notes = [];
  lineZones = {};
  selectedZoneIdxs = [];

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

/* ===== SCRIPT LOADING ===== */
async function loadScript() {
  const scriptPath = state.activeProduction?.scriptPath;
  if (!scriptPath) {
    if (isOwner()) {
      showScriptUploadPrompt();
    } else {
      canvasArea.innerHTML = '<div style="color:#5c5850;text-align:center;padding:60px;">Script not yet uploaded by the production owner.</div>';
    }
    return;
  }
  showProcessing('Loading script\u2026');
  try {
    const url = await getDownloadURL(ref(storage, scriptPath));
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ url });
    loadingTask.onProgress = (p) => {
      if (p.total > 0) progressFill.style.width = Math.round((p.loaded / p.total) * 100) + '%';
    };
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    // Update Firestore page count if needed
    if (!state.activeProduction.scriptPageCount && isOwner()) {
      try {
        await updateDoc(doc(db, 'productions', state.activeProduction.id), { scriptPageCount: totalPages });
        state.activeProduction.scriptPageCount = totalPages;
      } catch (e) { /* non-critical */ }
    }
    hideProcessing();
    renderPage();
  } catch (e) {
    console.error('Script load error:', e);
    hideProcessing();
    canvasArea.innerHTML = '<div style="color:#e63946;text-align:center;padding:60px;">Failed to load script. ' + escapeHtml(e.message) + '</div>';
  }
}

function showScriptUploadPrompt() {
  canvasArea.innerHTML = `
    <div style="color:#5c5850;text-align:center;padding:60px;">
      <p style="font-size:16px;margin-bottom:12px;">No script uploaded.</p>
      <input type="file" id="ln-upload-script" accept="application/pdf" style="display:none;" />
      <button class="ln-header-btn" id="ln-upload-btn" style="padding:10px 24px;">Upload Script PDF</button>
    </div>`;
  const uploadBtn = canvasArea.querySelector('#ln-upload-btn');
  const fileInput = canvasArea.querySelector('#ln-upload-script');
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || file.type !== 'application/pdf') { toast('Select a PDF.', 'error'); return; }
    const { uploadBytesResumable } = await import('firebase/storage');
    const pid = state.activeProduction.id;
    const storageRef = ref(storage, 'productions/' + pid + '/script.pdf');
    showProcessing('Uploading\u2026');
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      s => { progressFill.style.width = Math.round((s.bytesTransferred / s.totalBytes) * 100) + '%'; },
      e => { hideProcessing(); toast('Upload failed.', 'error'); },
      async () => {
        await updateDoc(doc(db, 'productions', pid), { scriptPath: 'productions/' + pid + '/script.pdf', scriptPageCount: null });
        state.activeProduction.scriptPath = 'productions/' + pid + '/script.pdf';
        hideProcessing();
        loadScript();
      }
    );
  });
}

function showProcessing(text) {
  processingOverlay.style.display = 'flex';
  processingOverlay.querySelector('.text').textContent = text;
  progressFill.style.width = '0%';
}
function hideProcessing() { processingOverlay.style.display = 'none'; }

/* ===== PAGE RENDERING ===== */
async function renderPage() {
  if (!pdfDoc) return;
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;
  updatePageDisplay();

  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: pdfScale });

  if (splitMode) {
    canvas.width = viewport.width / 2;
    canvas.height = viewport.height;
    ctx.save();
    if (currentHalf === 'R') ctx.translate(-viewport.width / 2, 0);
    const renderCtx = { canvasContext: ctx, viewport };
    await page.render(renderCtx).promise;
    ctx.restore();
  } else {
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  await loadZonesForPage();
  renderZones();
  renderNoteMarkers();
}

function goToPage(num) {
  if (!pdfDoc) return;
  closePopover();
  if (splitMode) {
    // In split mode, each PDF page has two halves: L and R
    // "next" goes L->R, then R->L of next page
    // "prev" goes R->L, then L->R of prev page
    if (num > currentPage) {
      // Going forward
      if (currentHalf === 'L') {
        currentHalf = 'R';
        renderPage();
        return;
      } else {
        currentHalf = 'L';
        // fall through to advance page
      }
    } else if (num < currentPage) {
      // Going backward
      if (currentHalf === 'R') {
        currentHalf = 'L';
        renderPage();
        return;
      } else {
        currentHalf = 'R';
        // fall through to go back a page
      }
    }
  }
  currentPage = Math.max(1, Math.min(num, totalPages));
  renderPage();
}

function getPageKey() {
  if (splitMode) return currentPage + currentHalf;
  return String(currentPage);
}

function updatePageDisplay() {
  const display = splitMode ? currentPage + currentHalf + ' / ' + totalPages : currentPage + ' / ' + totalPages;
  document.getElementById('ln-page-num').textContent = display;
}

function toggleSplit() {
  splitMode = !splitMode;
  if (splitMode) currentHalf = 'L';
  document.getElementById('ln-split-btn').classList.toggle('ln-header-btn--active', splitMode);
  renderPage();
}

function setView(view) {
  currentView = view;
  updateViewButtons();
  if (view === 'zones' && isOwner()) {
    zoneEditorPanel.classList.add('open');
    document.getElementById('ln-sidebar').style.display = 'none';
    renderZoneEditor();
  } else {
    zoneEditorPanel.classList.remove('open');
    document.getElementById('ln-sidebar').style.display = 'flex';
    renderSidebar();
  }
  renderZones();
  renderNoteMarkers();
}

function updateViewButtons() {
  document.getElementById('ln-view-notes-btn').classList.toggle('ln-header-btn--active', currentView === 'notes');
  document.getElementById('ln-view-zones-btn').classList.toggle('ln-header-btn--active', currentView === 'zones');
}

/* ===== ZONE LOADING & EXTRACTION ===== */
async function loadZonesForPage() {
  const pk = getPageKey();
  if (lineZones[pk]) return;

  // Try Firestore
  const pid = state.activeProduction.id;
  try {
    const zoneDoc = await getDoc(doc(db, 'productions', pid, 'zones', pk));
    if (zoneDoc.exists()) {
      lineZones[pk] = zoneDoc.data().zones || [];
      return;
    }
  } catch (e) { /* fall through to extraction */ }

  // Extract from PDF
  if (!pdfDoc) return;
  try {
    const page = await pdfDoc.getPage(currentPage);
    const zones = await extractPageZones(page);
    lineZones[pk] = zones;
    // Save to Firestore (owners only)
    if (isOwner()) {
      try {
        await setDoc(doc(db, 'productions', pid, 'zones', pk), {
          zones, updatedAt: serverTimestamp(), updatedBy: state.currentUser.uid
        });
      } catch (e) { console.warn('Could not save zones to Firestore', e); }
    }
  } catch (e) {
    console.error('Zone extraction error', e);
    lineZones[pk] = [];
  }
}

async function extractPageZones(page) {
  const viewport = page.getViewport({ scale: pdfScale });
  const textContent = await page.getTextContent();
  const items = textContent.items;

  if (!items || items.length === 0) return generateFallbackZones(viewport);

  // Map items to positioned rects with percentage coordinates
  const cw = splitMode ? viewport.width / 2 : viewport.width;
  const ch = viewport.height;

  const mapped = items.map(item => {
    const tx = item.transform;
    const x = tx[4];
    const y = ch - tx[5]; // PDF coords are bottom-up
    const w = item.width || (item.str.length * tx[0] * 0.6);
    const h = Math.abs(tx[3]) || 12;
    return {
      x: (x / cw) * 100,
      y: ((y - h) / ch) * 100,
      w: (w / cw) * 100,
      h: (h / ch) * 100,
      str: item.str,
      fontName: item.fontName || '',
    };
  }).filter(m => m.str.trim().length > 0);

  if (mapped.length === 0) return generateFallbackZones(viewport);

  // Group into lines by proximity
  const thresh = (8 * pdfScale / ch) * 100;
  const lines = groupIntoLines(mapped, thresh);

  // Detect character names & stage directions
  const pageWidth = 100; // percentage
  for (const line of lines) {
    line.isCharName = detectCharName(line, pageWidth);
    line.isStageDirection = detectStageDirection(line);
  }

  // Merge into character dialogue lines
  const merged = mergeIntoCharacterLines(lines);

  return merged.map(z => ({
    x: z.x, y: z.y, w: z.w, h: z.h,
    text: z.text, isCharName: z.isCharName || false, isStageDirection: z.isStageDirection || false,
  }));
}

function groupIntoLines(items, thresh) {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let currentLine = { items: [sorted[0]], y: sorted[0].y };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentLine.y) < thresh) {
      currentLine.items.push(item);
    } else {
      lines.push(finishLine(currentLine));
      currentLine = { items: [item], y: item.y };
    }
  }
  lines.push(finishLine(currentLine));
  return lines;
}

function finishLine(lineGroup) {
  const items = lineGroup.items;
  const x = Math.min(...items.map(i => i.x));
  const y = Math.min(...items.map(i => i.y));
  const maxRight = Math.max(...items.map(i => i.x + i.w));
  const maxBottom = Math.max(...items.map(i => i.y + i.h));
  const text = items.map(i => i.str).join(' ').trim();
  const fontNames = items.map(i => i.fontName);
  return { x, y, w: maxRight - x, h: maxBottom - y, text, fontNames, items };
}

function detectCharName(line, pageWidth) {
  const text = line.text.trim();
  if (text.length === 0 || text.length > 40) return false;
  // All caps check
  const alpha = text.replace(/[^a-zA-Z]/g, '');
  if (alpha.length < 2) return false;
  if (alpha !== alpha.toUpperCase()) return false;
  // Centered check: center of text should be roughly in the middle portion
  const center = line.x + line.w / 2;
  if (center < 25 || center > 75) return false;
  // Short line
  if (line.w > 50) return false;
  // Not italic
  const isItalic = line.fontNames?.some(f => /italic/i.test(f));
  if (isItalic) return false;
  return true;
}

function detectStageDirection(line) {
  return line.fontNames?.some(f => /italic/i.test(f)) || false;
}

function mergeIntoCharacterLines(lines) {
  const merged = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.isCharName) {
      // Merge following non-charName, non-stageDir lines as dialogue
      merged.push({ ...line });
      i++;
      while (i < lines.length && !lines[i].isCharName) {
        const dl = lines[i];
        const prev = merged[merged.length - 1];
        // Expand previous zone to include this line
        const newY = Math.min(prev.y, dl.y);
        const newBottom = Math.max(prev.y + prev.h, dl.y + dl.h);
        const newX = Math.min(prev.x, dl.x);
        const newRight = Math.max(prev.x + prev.w, dl.x + dl.w);
        prev.y = newY;
        prev.h = newBottom - newY;
        prev.x = newX;
        prev.w = newRight - newX;
        prev.text += '\n' + dl.text;
        if (dl.isStageDirection) prev.isStageDirection = true;
        i++;
      }
    } else {
      merged.push({ ...line });
      i++;
    }
  }
  return merged;
}

function generateFallbackZones(viewport) {
  const zones = [];
  const rows = 20;
  const rowH = 100 / rows;
  for (let i = 0; i < rows; i++) {
    zones.push({ x: 5, y: i * rowH, w: 90, h: rowH * 0.9, text: '', isCharName: false, isStageDirection: false });
  }
  return zones;
}

/* ===== ZONE RENDERING ===== */
function renderZones() {
  zonesLayer.innerHTML = '';
  const pk = getPageKey();
  const zones = lineZones[pk] || [];

  zones.forEach((z, idx) => {
    const el = document.createElement('div');
    el.className = 'line-zone';
    if (z.isCharName) el.classList.add('line-zone--char');
    if (z.isStageDirection) el.classList.add('line-zone--stage-dir');

    el.style.left = z.x + '%';
    el.style.top = z.y + '%';
    el.style.width = z.w + '%';
    el.style.height = z.h + '%';
    el.dataset.idx = idx;

    // Check if this zone has a note
    const note = findNoteForZone(idx);
    if (note) {
      el.classList.add('line-zone--has-note');
      el.style.borderBottomColor = note.charColor || '#c8a96e';
    }

    if (currentView === 'zones' && isOwner()) {
      const selected = selectedZoneIdxs.includes(idx);
      if (selected) el.classList.add('zone-list-item--selected');
      el.addEventListener('click', e => { onZoneClickEditor(idx, e); e.stopPropagation(); });
    } else {
      el.addEventListener('click', e => { onZoneClickNotes(idx, e); e.stopPropagation(); });
    }

    zonesLayer.appendChild(el);
  });
}

function renderNoteMarkers() {
  if (currentView !== 'notes') return;
  const pk = getPageKey();
  const pageNotes = notes.filter(n => {
    const noteKey = splitMode ? n.page + (n.half || '') : String(n.page);
    return noteKey === pk;
  });
  pageNotes.forEach(n => {
    const typeInfo = NOTE_TYPES.find(t => t.key === n.type) || NOTE_TYPES[0];
    // Render as a tag near the zone
    const tag = document.createElement('div');
    tag.className = 'note-type-tag';
    tag.style.backgroundColor = typeInfo.color;
    tag.style.top = n.bounds.y + '%';
    tag.style.right = '-40px';
    tag.textContent = n.type;
    zonesLayer.appendChild(tag);
  });
}

/* ===== NOTES SUBSCRIPTION ===== */
function subscribeToNotes() {
  if (notesUnsub) notesUnsub();
  const pid = state.activeProduction.id;
  // Try with productionId filter first; fall back to unfiltered subcollection query
  try {
    notesUnsub = onSnapshot(
      query(collection(db, 'productions', pid, 'lineNotes'), where('productionId', '==', pid)),
      snap => {
        notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderSidebar();
        renderZones();
        renderNoteMarkers();
      },
      err => {
        console.warn('Filtered lineNotes query failed, falling back to unfiltered:', err);
        // Unsubscribe the failed listener
        if (notesUnsub) { notesUnsub(); notesUnsub = null; }
        // Re-subscribe without the filter
        notesUnsub = onSnapshot(collection(db, 'productions', pid, 'lineNotes'), snap => {
          notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          renderSidebar();
          renderZones();
          renderNoteMarkers();
        });
      }
    );
  } catch (e) {
    // Fallback for synchronous errors
    notesUnsub = onSnapshot(collection(db, 'productions', pid, 'lineNotes'), snap => {
      notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSidebar();
      renderZones();
      renderNoteMarkers();
    });
  }
  state.unsubscribers.push(() => { if (notesUnsub) { notesUnsub(); notesUnsub = null; } });
}

function findNoteForZone(zoneIdx) {
  const pk = getPageKey();
  return notes.find(n => {
    const noteKey = splitMode ? n.page + (n.half || '') : String(n.page);
    return noteKey === pk && n.zoneIdx === zoneIdx;
  });
}

/* ===== CHARACTER MANAGEMENT ===== */
async function loadCharacters() {
  const uid = state.currentUser.uid;
  const pid = state.activeProduction.id;
  try {
    const charDoc = await getDoc(doc(db, 'users', uid, 'productions', pid));
    if (charDoc.exists() && charDoc.data().characters) {
      characters = charDoc.data().characters;
    } else {
      characters = [];
    }
  } catch (e) {
    characters = [];
  }
  if (characters.length > 0) activeCharIdx = 0;
  renderSidebar();
}

async function saveCharacters() {
  const uid = state.currentUser.uid;
  const pid = state.activeProduction.id;
  try {
    await setDoc(doc(db, 'users', uid, 'productions', pid), { characters }, { merge: true });
  } catch (e) { console.warn('Failed to save characters', e); }
}

function openCharModal() {
  const modal = charModal;
  modal.classList.add('open');
  modal.innerHTML = `
    <div class="char-modal-card">
      <h3>Add Character</h3>
      <input type="text" id="char-name-input" placeholder="Character Name" maxlength="100" />
      <div style="font-size:12px;color:#5c5850;margin-bottom:6px;">Color</div>
      <div class="char-color-grid" id="char-color-grid">
        ${DEFAULT_COLORS.map((c, i) => '<div class="char-color-swatch ' + (i === 0 ? 'char-color-swatch--selected' : '') + '" data-color="' + c + '" style="background:' + c + ';"></div>').join('')}
      </div>
      <div class="modal-btns">
        <button class="modal-btn-cancel" id="char-cancel">Cancel</button>
        <button class="modal-btn-primary" id="char-save">Add</button>
      </div>
    </div>`;

  let selectedColor = DEFAULT_COLORS[0];
  modal.querySelectorAll('.char-color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      modal.querySelectorAll('.char-color-swatch').forEach(ss => ss.classList.remove('char-color-swatch--selected'));
      s.classList.add('char-color-swatch--selected');
      selectedColor = s.dataset.color;
    });
  });
  modal.querySelector('#char-cancel').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  modal.querySelector('#char-save').addEventListener('click', () => {
    const name = sanitizeName(modal.querySelector('#char-name-input').value);
    if (!name) { toast('Enter a name.', 'error'); return; }
    characters.push({ id: genId(), name, color: selectedColor, email: '' });
    activeCharIdx = characters.length - 1;
    saveCharacters();
    modal.classList.remove('open');
    renderSidebar();
  });
}

/* ===== SIDEBAR ===== */
function renderSidebar() {
  // Cast list
  const castList = document.getElementById('ln-cast-list');
  castList.innerHTML = characters.map((c, i) => {
    const noteCount = notes.filter(n => n.charId === c.id).length;
    return '<div class="char-item ' + (i === activeCharIdx ? 'char-item--active' : '') + '" data-idx="' + i + '">' +
      '<div class="char-dot" style="background:' + escapeHtml(c.color) + ';"></div>' +
      '<span>' + escapeHtml(c.name) + '</span>' +
      '<span class="char-count">' + noteCount + '</span>' +
      '<button class="delete-char" data-idx="' + i + '">\u00d7</button></div>';
  }).join('') || '<div style="color:#5c5850;font-size:12px;">No characters.</div>';

  castList.querySelectorAll('.char-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('delete-char')) return;
      activeCharIdx = parseInt(el.dataset.idx);
      renderSidebar();
    });
  });
  castList.querySelectorAll('.delete-char').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const ch = characters[idx];
      const hasNotes = notes.some(n => n.charId === ch.id);
      if (hasNotes && !confirmDialog('Delete ' + ch.name + '? Their notes will remain.')) return;
      characters.splice(idx, 1);
      if (activeCharIdx >= characters.length) activeCharIdx = Math.max(0, characters.length - 1);
      saveCharacters();
      renderSidebar();
    });
  });

  // Note types
  const typesEl = document.getElementById('ln-note-types');
  typesEl.innerHTML = NOTE_TYPES.map(t =>
    '<button class="note-type-btn ' + (activeNoteType === t.key ? 'note-type-btn--active' : '') + '" data-type="' + t.key + '">' + t.key + '</button>'
  ).join('');
  typesEl.querySelectorAll('.note-type-btn').forEach(btn => {
    btn.addEventListener('click', () => { activeNoteType = btn.dataset.type; renderSidebar(); });
  });

  // Notes list
  const notesList = document.getElementById('ln-notes-list');
  const sorted = [...notes].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return (a.bounds?.y || 0) - (b.bounds?.y || 0);
  });
  notesList.innerHTML = sorted.map(n => {
    const typeInfo = NOTE_TYPES.find(t => t.key === n.type) || NOTE_TYPES[0];
    return '<div class="note-item" data-noteid="' + escapeHtml(n.id) + '">' +
      '<div class="note-color-bar" style="background:' + escapeHtml(n.charColor || '#888') + ';"></div>' +
      '<div class="note-item-content">' +
        '<div class="note-item-header">' +
          '<span class="note-page">p.' + n.page + (n.half || '') + '</span>' +
          '<span class="note-char-name">' + escapeHtml(n.charName || '?') + '</span>' +
          '<span class="note-type-label">' + escapeHtml(n.type) + '</span>' +
        '</div>' +
        '<div class="note-text-preview">' + escapeHtml((n.lineText || '').slice(0, 80)) + '</div>' +
      '</div>' +
      '<button class="note-delete-btn" data-noteid="' + escapeHtml(n.id) + '">\u00d7</button></div>';
  }).join('') || '<div style="color:#5c5850;font-size:12px;padding:12px;">No notes yet.</div>';

  notesList.querySelectorAll('.note-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('note-delete-btn')) return;
      const noteId = el.dataset.noteid;
      const note = notes.find(n => n.id === noteId);
      if (note) jumpToNote(note);
    });
  });
  notesList.querySelectorAll('.note-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const noteId = btn.dataset.noteid;
      const note = notes.find(n => n.id === noteId);
      if (!note) return;
      if (note.uid !== state.currentUser.uid && !isOwner()) { toast('Can only delete your own notes.', 'error'); return; }
      try {
        await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'lineNotes', noteId));
        toast('Note deleted.', 'info');
      } catch (e) { toast('Failed to delete.', 'error'); }
    });
  });
}

function jumpToNote(note) {
  currentPage = note.page;
  if (splitMode && note.half) currentHalf = note.half;
  renderPage();
}

/* ===== POPOVER ===== */
function onZoneClickNotes(zoneIdx, event) {
  const pk = getPageKey();
  const zones = lineZones[pk] || [];
  const zone = zones[zoneIdx];
  if (!zone) return;

  const existing = findNoteForZone(zoneIdx);
  openPopover(event.clientX, event.clientY, zone, zoneIdx, existing);
}

function openPopover(x, y, zone, zoneIdx, existingNote) {
  if (characters.length === 0) {
    toast('Add a character first.', 'error');
    return;
  }
  closePopover();
  popoverOpen = true;

  const selectedChar = existingNote
    ? characters.findIndex(c => c.id === existingNote.charId)
    : activeCharIdx;
  const selectedType = existingNote ? existingNote.type : activeNoteType;

  popoverState = {
    zoneIdx, zone, existingNote,
    charIdx: selectedChar >= 0 ? selectedChar : 0,
    noteType: selectedType,
  };

  const charsHtml = characters.map((c, i) =>
    '<div class="popover-char ' + (i === popoverState.charIdx ? 'popover-char--active' : '') + '" data-idx="' + i + '">' +
      '<div class="char-dot" style="background:' + escapeHtml(c.color) + ';width:8px;height:8px;"></div>' +
      '<span>' + escapeHtml(c.name) + '</span>' +
      '<span class="shortcut-key">' + (i + 1) + '</span></div>'
  ).join('');

  const typesHtml = NOTE_TYPES.map(t =>
    '<div class="popover-type ' + (popoverState.noteType === t.key ? 'popover-type--active' : '') + '" data-type="' + t.key + '">' + t.key + '</div>'
  ).join('');

  popoverEl.innerHTML = `
    <div class="popover-chars">${charsHtml}</div>
    <div class="popover-types">${typesHtml}</div>
    <div class="popover-line-text">${escapeHtml(zone.text || '(no text)')}</div>
    <div class="popover-btns">
      ${existingNote ? '<button class="popover-btn popover-btn--delete" id="pop-delete">Delete</button>' : ''}
      <button class="popover-btn popover-btn--cancel" id="pop-cancel">Cancel</button>
      <button class="popover-btn popover-btn--confirm" id="pop-confirm">${existingNote ? 'Update' : 'Add Note'}</button>
    </div>`;

  // Position
  const pw = 300, ph = popoverEl.offsetHeight || 200;
  let px = Math.min(x, window.innerWidth - pw - 16);
  let py = Math.min(y, window.innerHeight - ph - 16);
  if (px < 16) px = 16;
  if (py < 16) py = 16;
  popoverEl.style.left = px + 'px';
  popoverEl.style.top = py + 'px';
  popoverEl.classList.add('open');

  // Wire events
  popoverEl.querySelectorAll('.popover-char').forEach(el => {
    el.addEventListener('click', () => {
      popoverState.charIdx = parseInt(el.dataset.idx);
      popoverEl.querySelectorAll('.popover-char').forEach(e => e.classList.remove('popover-char--active'));
      el.classList.add('popover-char--active');
    });
  });
  popoverEl.querySelectorAll('.popover-type').forEach(el => {
    el.addEventListener('click', () => {
      popoverState.noteType = el.dataset.type;
      popoverEl.querySelectorAll('.popover-type').forEach(e => e.classList.remove('popover-type--active'));
      el.classList.add('popover-type--active');
    });
  });
  popoverEl.querySelector('#pop-cancel').addEventListener('click', closePopover);
  popoverEl.querySelector('#pop-confirm').addEventListener('click', confirmPopover);
  popoverEl.querySelector('#pop-delete')?.addEventListener('click', deleteFromPopover);
}

function closePopover() {
  popoverOpen = false;
  popoverEl.classList.remove('open');
}

async function confirmPopover() {
  const { zoneIdx, zone, existingNote, charIdx, noteType } = popoverState;
  const ch = characters[charIdx];
  if (!ch) { toast('Select a character.', 'error'); return; }

  const pid = state.activeProduction.id;
  const noteData = {
    uid: state.currentUser.uid,
    charId: ch.id,
    charName: ch.name,
    charColor: ch.color,
    type: noteType,
    page: currentPage,
    half: splitMode ? currentHalf : '',
    zoneIdx,
    bounds: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
    lineText: zone.text || '',
    productionId: pid,
  };

  try {
    if (existingNote) {
      await updateDoc(doc(db, 'productions', pid, 'lineNotes', existingNote.id), {
        ...noteData, updatedAt: serverTimestamp()
      });
      toast('Note updated.', 'success');
    } else {
      await addDoc(collection(db, 'productions', pid, 'lineNotes'), {
        ...noteData, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      toast('Note added!', 'success');
    }
  } catch (e) { console.error(e); toast('Failed to save note.', 'error'); }

  closePopover();
}

async function deleteFromPopover() {
  const { existingNote } = popoverState;
  if (!existingNote) return;
  if (existingNote.uid !== state.currentUser.uid && !isOwner()) { toast('Can only delete your own notes.', 'error'); return; }
  try {
    await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'lineNotes', existingNote.id));
    toast('Note deleted.', 'info');
  } catch (e) { toast('Failed to delete.', 'error'); }
  closePopover();
}

/* ===== RUBBER BAND DRAWING (custom bounds) ===== */
function onCanvasMouseDown(e) {
  if (currentView !== 'notes') return;
  if (popoverOpen) return;
  // Check if clicking on a zone
  if (e.target.classList.contains('line-zone')) return;
  const rect = canvasContainer.getBoundingClientRect();
  drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  drawingRect = true;
}

function onCanvasMouseMove(e) {
  if (!drawingRect || !drawStart) return;
  const rect = canvasContainer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Visual feedback: draw a dashed rect
  let rubberBand = zonesLayer.querySelector('.rubber-band');
  if (!rubberBand) {
    rubberBand = document.createElement('div');
    rubberBand.className = 'rubber-band';
    rubberBand.style.cssText = 'position:absolute;border:1px dashed #c8a96e;pointer-events:none;';
    zonesLayer.appendChild(rubberBand);
  }
  const sx = Math.min(drawStart.x, x), sy = Math.min(drawStart.y, y);
  const sw = Math.abs(x - drawStart.x), sh = Math.abs(y - drawStart.y);
  const cw = canvasContainer.offsetWidth, ch = canvasContainer.offsetHeight;
  rubberBand.style.left = (sx / cw * 100) + '%';
  rubberBand.style.top = (sy / ch * 100) + '%';
  rubberBand.style.width = (sw / cw * 100) + '%';
  rubberBand.style.height = (sh / ch * 100) + '%';
}

function onCanvasMouseUp(e) {
  if (!drawingRect || !drawStart) return;
  drawingRect = false;
  const rubberBand = zonesLayer.querySelector('.rubber-band');
  if (rubberBand) rubberBand.remove();

  const rect = canvasContainer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cw = canvasContainer.offsetWidth, ch = canvasContainer.offsetHeight;

  const sx = Math.min(drawStart.x, x) / cw * 100;
  const sy = Math.min(drawStart.y, y) / ch * 100;
  const sw = Math.abs(x - drawStart.x) / cw * 100;
  const sh = Math.abs(y - drawStart.y) / ch * 100;

  drawStart = null;
  if (sw < 1 || sh < 1) return; // Too small

  const customZone = { x: sx, y: sy, w: sw, h: sh, text: '' };
  openPopover(e.clientX, e.clientY, customZone, -1, null);
}

/* ===== ZONE EDITOR (OWNERS ONLY) ===== */
function onZoneClickEditor(zoneIdx, event) {
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    // Multi-select
    if (selectedZoneIdxs.includes(zoneIdx)) {
      selectedZoneIdxs = selectedZoneIdxs.filter(i => i !== zoneIdx);
    } else {
      selectedZoneIdxs.push(zoneIdx);
    }
  } else {
    selectedZoneIdxs = [zoneIdx];
  }
  renderZones();
  renderZoneEditor();
}

function renderZoneEditor() {
  if (!isOwner()) return;
  const pk = getPageKey();
  const zones = lineZones[pk] || [];
  const selCount = selectedZoneIdxs.length;
  const sel = selCount === 1 ? zones[selectedZoneIdxs[0]] : null;

  let detailHtml = '';
  if (sel) {
    const idx = selectedZoneIdxs[0];
    detailHtml = `
      <div class="zone-detail">
        <label>X (%)</label><input type="number" id="ze-x" value="${sel.x.toFixed(1)}" step="0.1" />
        <label>Y (%)</label><input type="number" id="ze-y" value="${sel.y.toFixed(1)}" step="0.1" />
        <label>W (%)</label><input type="number" id="ze-w" value="${sel.w.toFixed(1)}" step="0.1" />
        <label>H (%)</label><input type="number" id="ze-h" value="${sel.h.toFixed(1)}" step="0.1" />
        <label>Text</label><textarea id="ze-text">${escapeHtml(sel.text)}</textarea>
        <label style="margin-top:8px;">
          <input type="checkbox" id="ze-charname" ${sel.isCharName ? 'checked' : ''} /> Character Name (C)
        </label>
        <label>
          <input type="checkbox" id="ze-stagedir" ${sel.isStageDirection ? 'checked' : ''} /> Stage Direction (S)
        </label>
        <button class="panel-btn" id="ze-apply" style="margin-top:8px;">Apply</button>
      </div>`;
  }

  let multiBar = '';
  if (selCount > 1) {
    multiBar = `<div class="multi-select-bar open">
      <span>${selCount} zones selected</span>
      <button id="ze-toggle-char">Toggle Char Name</button>
      <button id="ze-toggle-dir">Toggle Stage Dir</button>
      <button id="ze-delete-sel" style="color:#e63946;">Delete Selected</button>
    </div>`;
  }

  const zoneListHtml = zones.map((z, i) => {
    const selected = selectedZoneIdxs.includes(i);
    const typeLabel = z.isCharName ? 'CHAR' : z.isStageDirection ? 'SD' : 'DLG';
    return '<div class="zone-list-item ' + (selected ? 'zone-list-item--selected' : '') + '" data-idx="' + i + '">' +
      '<span class="zone-type-label">' + typeLabel + '</span>' +
      '<span class="zone-text">' + escapeHtml((z.text || '').slice(0, 40)) + '</span>' +
      '<button class="zone-delete" data-idx="' + i + '">\u00d7</button></div>';
  }).join('');

  zoneEditorPanel.innerHTML = `
    <h5>Zone Editor <span class="zone-saved-badge" id="ze-saved">\u2713 saved</span></h5>
    <div class="zone-toolbar">
      <button id="ze-reextract">Re-extract</button>
      <button id="ze-add">Add Manual</button>
      <button id="ze-clear" style="color:#e63946;">Clear All</button>
      <button id="ze-save">Save</button>
    </div>
    ${multiBar}
    ${detailHtml}
    <h5 style="margin-top:12px;">Zones (${zones.length})</h5>
    <div style="max-height:300px;overflow-y:auto;">${zoneListHtml || '<div style="color:#5c5850;font-size:12px;">No zones.</div>'}</div>`;

  // Wire events
  zoneEditorPanel.querySelector('#ze-reextract')?.addEventListener('click', async () => {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(currentPage);
    const zones = await extractPageZones(page);
    lineZones[pk] = zones;
    selectedZoneIdxs = [];
    renderZones();
    renderZoneEditor();
    toast('Zones re-extracted.', 'info');
  });
  zoneEditorPanel.querySelector('#ze-add')?.addEventListener('click', () => {
    const zones = lineZones[pk] || [];
    zones.push({ x: 10, y: 10, w: 80, h: 3, text: '', isCharName: false, isStageDirection: false });
    lineZones[pk] = zones;
    selectedZoneIdxs = [zones.length - 1];
    renderZones();
    renderZoneEditor();
  });
  zoneEditorPanel.querySelector('#ze-clear')?.addEventListener('click', () => {
    if (!confirmDialog('Clear all zones on this page?')) return;
    lineZones[pk] = [];
    selectedZoneIdxs = [];
    renderZones();
    renderZoneEditor();
  });
  zoneEditorPanel.querySelector('#ze-save')?.addEventListener('click', saveZones);

  // Detail apply
  zoneEditorPanel.querySelector('#ze-apply')?.addEventListener('click', () => {
    if (!sel) return;
    const idx = selectedZoneIdxs[0];
    const zones = lineZones[pk];
    zones[idx] = {
      ...zones[idx],
      x: parseFloat(zoneEditorPanel.querySelector('#ze-x').value) || 0,
      y: parseFloat(zoneEditorPanel.querySelector('#ze-y').value) || 0,
      w: parseFloat(zoneEditorPanel.querySelector('#ze-w').value) || 0,
      h: parseFloat(zoneEditorPanel.querySelector('#ze-h').value) || 0,
      text: zoneEditorPanel.querySelector('#ze-text').value,
      isCharName: zoneEditorPanel.querySelector('#ze-charname').checked,
      isStageDirection: zoneEditorPanel.querySelector('#ze-stagedir').checked,
    };
    renderZones();
    renderZoneEditor();
    debounceSaveZones();
  });

  // Multi-select actions
  zoneEditorPanel.querySelector('#ze-toggle-char')?.addEventListener('click', () => {
    const zones = lineZones[pk];
    selectedZoneIdxs.forEach(i => { if (zones[i]) zones[i].isCharName = !zones[i].isCharName; });
    renderZones(); renderZoneEditor(); debounceSaveZones();
  });
  zoneEditorPanel.querySelector('#ze-toggle-dir')?.addEventListener('click', () => {
    const zones = lineZones[pk];
    selectedZoneIdxs.forEach(i => { if (zones[i]) zones[i].isStageDirection = !zones[i].isStageDirection; });
    renderZones(); renderZoneEditor(); debounceSaveZones();
  });
  zoneEditorPanel.querySelector('#ze-delete-sel')?.addEventListener('click', () => {
    const zones = lineZones[pk];
    lineZones[pk] = zones.filter((_, i) => !selectedZoneIdxs.includes(i));
    selectedZoneIdxs = [];
    renderZones(); renderZoneEditor(); debounceSaveZones();
  });

  // Zone list click
  zoneEditorPanel.querySelectorAll('.zone-list-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('zone-delete')) return;
      const idx = parseInt(el.dataset.idx);
      if (e.shiftKey || e.ctrlKey) {
        if (selectedZoneIdxs.includes(idx)) selectedZoneIdxs = selectedZoneIdxs.filter(i => i !== idx);
        else selectedZoneIdxs.push(idx);
      } else {
        selectedZoneIdxs = [idx];
      }
      renderZones(); renderZoneEditor();
    });
  });
  zoneEditorPanel.querySelectorAll('.zone-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const zones = lineZones[pk];
      zones.splice(idx, 1);
      selectedZoneIdxs = selectedZoneIdxs.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
      renderZones(); renderZoneEditor(); debounceSaveZones();
    });
  });
}

function debounceSaveZones() {
  if (zoneSaveTimeout) clearTimeout(zoneSaveTimeout);
  zoneSaveTimeout = setTimeout(saveZones, 500);
}

async function saveZones() {
  if (!isOwner()) return;
  const pk = getPageKey();
  const zones = lineZones[pk] || [];
  const pid = state.activeProduction.id;
  try {
    await setDoc(doc(db, 'productions', pid, 'zones', pk), {
      zones, updatedAt: serverTimestamp(), updatedBy: state.currentUser.uid
    });
    const badge = zoneEditorPanel.querySelector('#ze-saved');
    if (badge) {
      badge.classList.add('visible');
      setTimeout(() => badge.classList.remove('visible'), 1800);
    }
  } catch (e) { toast('Failed to save zones.', 'error'); }
}

/* ===== KEYBOARD SHORTCUTS ===== */
function handleKeydown(e) {
  if (!overlay.classList.contains('open')) return;
  // Don't interfere with inputs
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'ArrowLeft') { goToPage(currentPage - 1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { goToPage(currentPage + 1); e.preventDefault(); }
  if (e.key === 'Escape') {
    closePopover();
    selectedZoneIdxs = [];
    renderZones();
    if (currentView === 'zones' && isOwner()) renderZoneEditor();
  }

  // Char shortcuts 1-9
  if (e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (popoverOpen && idx < characters.length) {
      popoverState.charIdx = idx;
      popoverEl.querySelectorAll('.popover-char').forEach(el =>
        el.classList.toggle('popover-char--active', parseInt(el.dataset.idx) === idx)
      );
    } else if (idx < characters.length) {
      activeCharIdx = idx;
      renderSidebar();
    }
  }

  // Zone editor shortcuts
  if (currentView === 'zones' && isOwner()) {
    if (e.key === 's' || e.key === 'S') {
      if (selectedZoneIdxs.length === 1) {
        const pk = getPageKey();
        const zones = lineZones[pk];
        const z = zones[selectedZoneIdxs[0]];
        if (z) { z.isStageDirection = !z.isStageDirection; renderZones(); renderZoneEditor(); debounceSaveZones(); }
      }
      e.preventDefault();
    }
    if (e.key === 'c' || e.key === 'C') {
      if (selectedZoneIdxs.length === 1) {
        const pk = getPageKey();
        const zones = lineZones[pk];
        const z = zones[selectedZoneIdxs[0]];
        if (z) { z.isCharName = !z.isCharName; renderZones(); renderZoneEditor(); debounceSaveZones(); }
      }
      e.preventDefault();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedZoneIdxs.length > 0) {
        const pk = getPageKey();
        lineZones[pk] = (lineZones[pk] || []).filter((_, i) => !selectedZoneIdxs.includes(i));
        selectedZoneIdxs = [];
        renderZones(); renderZoneEditor(); debounceSaveZones();
        e.preventDefault();
      }
    }
  }
}

/* ===== SEND NOTES ===== */
function openSendNotes() {
  sendModal.classList.add('open');

  // Group notes by character
  const byChar = {};
  notes.forEach(n => {
    if (!byChar[n.charId]) byChar[n.charId] = { name: n.charName, color: n.charColor, email: '', notes: [] };
    byChar[n.charId].notes.push(n);
  });

  // Get emails from characters
  characters.forEach(c => { if (byChar[c.id]) byChar[c.id].email = c.email || ''; });

  const charIds = Object.keys(byChar);
  if (charIds.length === 0) {
    sendModal.innerHTML = `<div class="send-notes-card">
      <h3>Send Notes</h3>
      <p style="color:#5c5850;">No notes to send.</p>
      <div class="modal-btns"><button class="modal-btn-cancel" id="send-close">Close</button></div>
    </div>`;
    sendModal.querySelector('#send-close').addEventListener('click', () => sendModal.classList.remove('open'));
    sendModal.addEventListener('click', e => { if (e.target === sendModal) sendModal.classList.remove('open'); });
    return;
  }

  const sectionsHtml = charIds.map(cid => {
    const data = byChar[cid];
    const sorted = data.notes.sort((a, b) => a.page - b.page || (a.bounds?.y || 0) - (b.bounds?.y || 0));
    const notesHtml = sorted.map(n => {
      const typeInfo = NOTE_TYPES.find(t => t.key === n.type) || NOTE_TYPES[0];
      return '<div class="send-note-row" style="border-left-color:' + escapeHtml(data.color) + ';">' +
        '<strong>p.' + n.page + (n.half || '') + '</strong> [' + escapeHtml(n.type) + '] ' +
        '<em>' + escapeHtml((n.lineText || '').slice(0, 100)) + '</em></div>';
    }).join('');
    const mailBody = sorted.map(n =>
      'p.' + n.page + (n.half || '') + ' [' + n.type + '] ' + (n.lineText || '').slice(0, 100)
    ).join('\n');
    const mailSubject = 'Line Notes for ' + data.name + ' - ' + (state.activeProduction?.title || '');
    const mailto = 'mailto:' + encodeURIComponent(data.email || '') + '?subject=' + encodeURIComponent(mailSubject) + '&body=' + encodeURIComponent(mailBody);
    return '<div class="send-char-section">' +
      '<div class="send-char-header">' +
        '<div class="char-dot" style="background:' + escapeHtml(data.color) + ';width:10px;height:10px;border-radius:50%;display:inline-block;"></div>' +
        '<span class="char-name">' + escapeHtml(data.name) + '</span>' +
        '<a class="mail-link" href="' + mailto + '" target="_blank">Open in Mail \u2197</a>' +
      '</div>' + notesHtml + '</div>';
  }).join('');

  sendModal.innerHTML = `<div class="send-notes-card">
    <h3>Send Notes</h3>
    ${sectionsHtml}
    <div class="send-notes-actions">
      <button class="modal-btn-primary" id="send-print">Print / Export</button>
      <button class="modal-btn-cancel" id="send-close">Close</button>
    </div>
  </div>`;

  sendModal.querySelector('#send-close').addEventListener('click', () => sendModal.classList.remove('open'));
  sendModal.addEventListener('click', e => { if (e.target === sendModal) sendModal.classList.remove('open'); });
  sendModal.querySelector('#send-print').addEventListener('click', () => printNotes(byChar));
}

function printNotes(byChar) {
  const title = state.activeProduction?.title || 'Production';
  let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Line Notes - ' + escapeHtml(title) +
    '</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;color:#1a1a1a;} ' +
    'h1{text-align:center;font-size:24px;margin-bottom:4px;} .subtitle{text-align:center;color:#666;margin-bottom:32px;} ' +
    '.char-section{margin-bottom:24px;} .char-name{font-size:18px;font-weight:bold;border-bottom:2px solid #ddd;padding-bottom:4px;margin-bottom:8px;} ' +
    '.note-row{padding:4px 0 4px 16px;border-left:3px solid #ddd;margin-bottom:4px;font-size:14px;} ' +
    '.note-type{font-weight:bold;} em{color:#666;}</style></head><body>';
  html += '<h1>Line Notes</h1><div class="subtitle">' + escapeHtml(title) + '</div>';
  for (const cid of Object.keys(byChar)) {
    const data = byChar[cid];
    html += '<div class="char-section"><div class="char-name" style="border-left:4px solid ' + escapeHtml(data.color) + ';padding-left:8px;">' + escapeHtml(data.name) + '</div>';
    data.notes.sort((a, b) => a.page - b.page || (a.bounds?.y || 0) - (b.bounds?.y || 0)).forEach(n => {
      html += '<div class="note-row"><span class="note-type">p.' + n.page + (n.half || '') + ' [' + escapeHtml(n.type) + ']</span> <em>' + escapeHtml((n.lineText || '').slice(0, 200)) + '</em></div>';
    });
    html += '</div>';
  }
  html += '</body></html>';
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}
