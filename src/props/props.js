import { db, auth, storage } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog, downloadCSV } from '../shared/ui.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { buildCastPicker, getCastMembers, subscribeToCast } from '../cast/cast.js';
import { syncSessionToFirestore, startSessionSync, stopSessionSync, hideHeartbeat } from '../shared/session-sync.js';
import { loadCheckState, saveCheckState, checkProgress, renderProgressBar } from '../shared/check-state.js';
import { updateRouteParams } from '../shared/router.js';

let props = [];
let propNotes = {};
let currentPage = 1;
let activeTab = 'manage';
let editingPropId = null;
let cueRows = [];
let _pendingPropPhoto = null; // { file, previewUrl } when user selects a new photo
let preChecked = {};
let postChecked = {};
let _checkStateLoaded = false;

// Module-level timer variables — used ONLY when state.runSession is null
let _timerRunning = false;
let _timerHeld = false;
let _timerInterval = null;
let _timerElapsed = 0;
let _timerTotalPages = 100;
let _timerDuration = 120;
let _timerWarnPages = 5;
let _currentPage = 1;

// Track which prop+enterPage combos have already fired a warn toast this cycle
const _warnedProps = new Set();

const appView = document.getElementById('app-view');
const content = document.getElementById('props-content');

/* ─────────────────────────────────────────────────
   TIMER STATE ACCESSORS
   Delegate to state.runSession when active;
   fall back to module-level variables otherwise.
───────────────────────────────────────────────── */
function getTimerState() {
  if (state.runSession) return state.runSession;
  return {
    timerRunning: _timerRunning,
    timerHeld: _timerHeld,
    timerInterval: _timerInterval,
    timerElapsed: _timerElapsed,
    timerTotalPages: _timerTotalPages,
    timerDuration: _timerDuration,
    timerWarnPages: _timerWarnPages,
    currentPage: _currentPage,
    holdStartTime: null,
    holdLog: [],
  };
}

function setTimerField(key, value) {
  if (state.runSession) {
    state.runSession[key] = value;
  } else {
    switch (key) {
      case 'timerRunning':   _timerRunning   = value; break;
      case 'timerHeld':      _timerHeld      = value; break;
      case 'timerInterval':  _timerInterval  = value; break;
      case 'timerElapsed':   _timerElapsed   = value; break;
      case 'timerTotalPages': _timerTotalPages = value; break;
      case 'timerDuration':  _timerDuration  = value; break;
      case 'timerWarnPages': _timerWarnPages  = value; break;
      case 'currentPage':    _currentPage    = value; break;
    }
  }
}

/* ─────────────────────────────────────────────────
   TIMER GETTERS (convenience shorthands used inside this module)
───────────────────────────────────────────────── */
function timerRunning()   { return getTimerState().timerRunning; }
function timerHeld()      { return getTimerState().timerHeld; }
function timerElapsed()   { return getTimerState().timerElapsed; }
function timerInterval()  { return getTimerState().timerInterval; }
function timerTotalPages(){ return getTimerState().timerTotalPages; }
function timerDuration()  { return getTimerState().timerDuration; }
function timerWarnPages() { return getTimerState().timerWarnPages; }
function timerCurrentPage(){ return state.runSession ? state.runSession.currentPage : _currentPage; }

/* ─────────────────────────────────────────────────
   PROP STATUS HELPER — exported for Run Show
───────────────────────────────────────────────── */
export function getPropStatus(prop, page) {
  const cues = prop.cues || [];
  let location = prop.start || 'SL';
  let status = 'Off Stage';
  let activeCue = null;
  let upcomingEnter = null;
  let crossover = null; // { from, to, mover, cueIndex } when next enter differs from current location
  if (cues.length > 0) {
    for (const cue of cues) {
      if (page >= cue.enterPage && page <= cue.exitPage) { status = 'ON'; location = 'ON'; activeCue = cue; break; }
      else if (page > cue.exitPage) { location = cue.exitLocation || 'SL'; status = 'Off Stage'; }
    }
    if (status !== 'ON') {
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (cue.enterPage > page) {
          upcomingEnter = cue.enterPage;
          // Determine where the prop currently sits
          const currentLoc = location; // already computed above
          const enterLoc = cue.enterLocation || currentLoc; // default: same side
          if (enterLoc !== currentLoc) {
            crossover = {
              from: currentLoc,
              to: enterLoc,
              mover: cue.mover || '',
              cueIndex: i,
            };
          }
          break;
        }
      }
    }
  } else {
    const enters = prop.enters || []; const exits = prop.exits || [];
    for (let i = 0; i < enters.length; i++) {
      if (page >= enters[i] && page <= (exits[i] || 9999)) { status = 'ON'; location = 'ON'; break; }
      else if (page > (exits[i] || 9999)) { location = prop.endLocation || 'SL'; }
    }
    if (status !== 'ON') { for (const ep of enters) { if (ep > page) { upcomingEnter = ep; break; } } }
  }
  return { location, status, activeCue, upcomingEnter, crossover };
}

/* ─────────────────────────────────────────────────
   GET PROPS — exported for Run Show stage columns
───────────────────────────────────────────────── */
export function getProps() { return props; }

/* ─────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────── */
export function initProps() {
  document.getElementById('props-subtabs').addEventListener('click', e => {
    const tab = e.target.closest('.props-subtab');
    if (!tab) return;
    const tabName = tab.dataset.subtab;
    if (tabName === 'manage' && !isOwner()) {
      toast('Only owners can manage props.', 'error');
      return;
    }
    setActiveTab(tabName);
  });
}

function setActiveTab(tab) {
  activeTab = tab;
  updateRouteParams({ sub: tab }); // P2: sync sub-tab to URL
  document.querySelectorAll('.props-subtab').forEach(t =>
    t.classList.toggle('props-subtab--active', t.dataset.subtab === tab)
  );
  const manageTab = document.querySelector('.props-subtab[data-subtab="manage"]');
  if (!isOwner()) {
    manageTab?.classList.add('hidden');
    if (tab === 'manage') activeTab = 'view';
  } else {
    manageTab?.classList.remove('hidden');
  }
  renderContent();
}

export function showApp() {
  appView.style.display = 'flex';
  const prod = state.activeProduction;
  document.getElementById('app-prod-title').textContent = prod.title;
  const badge = document.getElementById('app-role-badge');
  badge.textContent = state.activeRole;
  badge.className = 'role-badge role-badge--' + state.activeRole;
  // Stop any running timer from previous production
  stopTimer();
  props = []; propNotes = {}; currentPage = 1;
  preChecked = {}; postChecked = {}; _checkStateLoaded = false;
  editingPropId = null; cueRows = [];
  subscribeToProps();
  subscribeToCast();
  // Reset to Run Show tab (the new default)
  document.querySelectorAll('.app-tab').forEach(btn =>
    btn.classList.toggle('app-tab--active', btn.dataset.tab === 'runshow')
  );
  document.querySelectorAll('.tab-panel').forEach(panel =>
    panel.classList.toggle('tab-panel--active', panel.id === 'tab-runshow')
  );
  setActiveTab(isOwner() ? 'manage' : 'view');
}

export function hideApp() {
  appView.style.display = 'none';
  document.querySelectorAll('.prop-notes-modal').forEach(m => m.remove());
}

function subscribeToProps() {
  const pid = state.activeProduction.id;
  const unsubProps = onSnapshot(collection(db, 'productions', pid, 'props'), snap => {
    props = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderContent();
  });
  const unsubNotes = onSnapshot(collection(db, 'productions', pid, 'propNotes'), snap => {
    propNotes = {};
    snap.docs.forEach(d => {
      const data = d.data();
      propNotes[data.propName] = { id: d.id, ...data };
    });
    renderContent();
  });
  state.unsubscribers.push(unsubProps, unsubNotes);
}

function renderContent() {
  if (!document.getElementById('tab-props')?.classList.contains('tab-panel--active')) return;
  switch (activeTab) {
    case 'manage': renderManageTab(); break;
    case 'view': renderViewTab(); break;
    case 'check': renderCheckTab(); break;
  }
}

export function onPropsTabActivated() {
  renderContent();
}

/* ======================== MANAGE PROPS TAB ======================== */
function renderManageTab() {
  if (!isOwner()) { setActiveTab('view'); return; }
  const editProp = editingPropId ? props.find(p => p.id === editingPropId) : null;

  let cueRowsHtml = '';
  if (cueRows.length === 0) {
    cueRowsHtml = '<div style="color:#555;font-size:13px;padding:8px 0;">No cues added. Prop will stay in its starting location.</div>';
  } else {
    cueRowsHtml = cueRows.map((c, i) => {
      // Determine the "expected" enter side: previous cue's exitLocation, or prop start for first cue
      const prevLoc = i === 0
        ? (editProp?.start || content.querySelector('#prop-start-select')?.value || 'SL')
        : (cueRows[i - 1].exitLocation || 'SL');
      const enterLoc = c.enterLocation || prevLoc;
      const needsCrossover = enterLoc !== prevLoc;
      return `
      <div class="cue-row" data-idx="${i}">
        <span class="cue-num">#${i + 1}</span>
        <select class="form-select cue-enter-loc" title="Enter from">
          <option value="SL" ${enterLoc === 'SL' ? 'selected' : ''}>SL</option>
          <option value="SR" ${enterLoc === 'SR' ? 'selected' : ''}>SR</option>
        </select>
        <input class="form-input cue-enter" type="number" min="1" placeholder="Enter pg" value="${c.enterPage || ''}" />
        <span class="arrow">\u2192</span>
        <input class="form-input cue-exit" type="number" min="1" placeholder="Exit pg" value="${c.exitPage || ''}" />
        <select class="form-select cue-loc">
          <option value="SL" ${c.exitLocation === 'SL' ? 'selected' : ''}>SL</option>
          <option value="SR" ${c.exitLocation === 'SR' ? 'selected' : ''}>SR</option>
        </select>
        <input class="form-input carrier-input cue-con" type="text" maxlength="100" placeholder="Carrier On" value="${escapeHtml(c.carrierOn || '')}" />
        <input class="form-input carrier-input cue-coff" type="text" maxlength="100" placeholder="Carrier Off" value="${escapeHtml(c.carrierOff || '')}" />
        ${needsCrossover ? `<input class="form-input carrier-input cue-mover" type="text" maxlength="100" placeholder="Moved by…" value="${escapeHtml(c.mover || '')}" />` : ''}
        <button class="remove-cue-btn" data-idx="${i}" title="Remove cue">\u00d7</button>
        ${needsCrossover ? `<div class="cue-crossover-alert" title="Prop must be moved from ${prevLoc} → ${enterLoc}">⚠ Cross ${prevLoc}→${enterLoc}</div>` : ''}
      </div>`}).join('');
  }

  let tableRows = '';
  if (props.length === 0) {
    tableRows = '<tr><td colspan="6" style="color:#555;text-align:center;padding:24px;">No props added yet.</td></tr>';
  } else {
    tableRows = props.map(p => {
      const cues = p.cues || [];
      const endLoc = cues.length > 0 ? cues[cues.length - 1].exitLocation : (p.endLocation || p.start);
      const cueTags = cues.map(c =>
        '<span class="cue-tag cue-tag--enter">\u2191' + c.enterPage + '</span><span class="cue-tag cue-tag--exit">\u2193' + c.exitPage + '</span>'
      ).join(' ') || '<span style="color:#555;">\u2014</span>';
      const thumbHtml = p.photoUrl
        ? '<img class="prop-thumb" src="' + escapeHtml(p.photoUrl) + '" data-src="' + escapeHtml(p.photoUrl) + '" alt="" title="Click to enlarge" />'
        : '<span style="color:#555;font-size:18px;">📦</span>';
      return '<tr><td style="width:52px;text-align:center;">' + thumbHtml + '</td><td>' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.start) + '</td><td>' + cueTags + '</td><td>' + escapeHtml(endLoc) + '</td><td>' +
        '<button class="panel-btn edit-prop-btn" data-id="' + escapeHtml(p.id) + '">Edit</button> ' +
        '<button class="panel-btn panel-btn--danger delete-prop-btn" data-id="' + escapeHtml(p.id) + '">Delete</button></td></tr>';
    }).join('');
  }

  content.innerHTML = `
    ${isOwner() ? '<div style="display:flex;gap:8px;margin-bottom:16px;"><button class="settings-btn" id="props-import-btn">Import JSON</button><button class="settings-btn" id="props-export-btn">Export CSV</button></div>' : ''}
    <div class="prop-form">
      <h3>${editingPropId ? 'Edit Prop' : 'Add Prop'}</h3>
      <div class="form-row">
        <label>Prop Name</label>
        <input class="form-input" id="prop-name-input" type="text" maxlength="200" placeholder="e.g. Yorick's Skull" value="${escapeHtml(editProp?.name || '')}" />
      </div>
      <div class="form-row">
        <label>Starting Location</label>
        <select class="form-select" id="prop-start-select">
          <option value="SL" ${(editProp?.start || 'SL') === 'SL' ? 'selected' : ''}>Stage Left</option>
          <option value="SR" ${editProp?.start === 'SR' ? 'selected' : ''}>Stage Right</option>
        </select>
      </div>
      <div class="form-row" style="flex-direction:column;align-items:flex-start;">
        <label style="min-width:unset;">Prop Photo <span style="color:#555;font-size:11px;">(optional)</span></label>
        <div class="prop-photo-upload-row">
          <input type="file" id="prop-photo-input" accept="image/*" style="font-size:12px;color:#aaa;background:#0f0f1e;border:1px solid #2a2a3e;border-radius:4px;padding:4px 6px;" />
          ${editProp?.photoUrl ? `<img class="prop-photo-preview" id="prop-photo-preview" src="${escapeHtml(editProp.photoUrl)}" title="Click to enlarge" />` : '<span id="prop-photo-preview-placeholder" style="font-size:12px;color:#555;">No photo yet.</span>'}
          ${editProp?.photoUrl ? '<button class="prop-photo-clear-btn" id="prop-photo-clear-btn">✕ Remove</button>' : ''}
        </div>
      </div>
      <h4 style="font-size:14px;color:#888;margin:16px 0 8px;">Cues</h4>
      <div class="cue-rows" id="cue-rows-container">${cueRowsHtml}</div>
      <button class="add-cue-btn" id="add-cue-btn">+ Add Cue</button>
      <div class="form-actions">
        ${editingPropId ? '<button class="modal-btn-cancel" id="cancel-edit-btn">Cancel</button>' : ''}
        <button class="modal-btn-primary" id="save-prop-btn">${editingPropId ? 'Update Prop' : 'Add Prop'}</button>
      </div>
    </div>
    <div class="props-table-wrap"><table class="props-table">
      <thead><tr><th>Photo</th><th>Name</th><th>Start</th><th>Cues</th><th>End</th><th></th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>`;

  // Photo upload input wiring
  const photoInput = content.querySelector('#prop-photo-input');
  if (photoInput) {
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { toast('Photo must be under 8 MB.', 'error'); photoInput.value = ''; return; }
      const url = URL.createObjectURL(file);
      _pendingPropPhoto = { file, previewUrl: url };
      let preview = content.querySelector('#prop-photo-preview');
      const placeholder = content.querySelector('#prop-photo-preview-placeholder');
      if (!preview) {
        preview = document.createElement('img');
        preview.id = 'prop-photo-preview';
        preview.className = 'prop-photo-preview';
        if (placeholder) placeholder.replaceWith(preview);
        else content.querySelector('.prop-photo-upload-row').appendChild(preview);
      }
      preview.src = url;
      preview.title = 'Click to enlarge';
    });
  }
  const photoClearBtn = content.querySelector('#prop-photo-clear-btn');
  if (photoClearBtn) {
    photoClearBtn.addEventListener('click', () => {
      _pendingPropPhoto = { file: null, previewUrl: null, clear: true };
      const row = content.querySelector('.prop-photo-upload-row');
      if (row) {
        const preview = row.querySelector('#prop-photo-preview');
        if (preview) preview.remove();
        const clearBtn = row.querySelector('#prop-photo-clear-btn');
        if (clearBtn) clearBtn.remove();
        let ph = row.querySelector('#prop-photo-preview-placeholder');
        if (!ph) {
          ph = document.createElement('span');
          ph.id = 'prop-photo-preview-placeholder';
          ph.style.cssText = 'font-size:12px;color:#555;';
          ph.textContent = 'No photo yet.';
          row.appendChild(ph);
        }
      }
    });
  }
  const photoPreview = content.querySelector('#prop-photo-preview');
  if (photoPreview) {
    photoPreview.addEventListener('click', () => openPhotoLightbox(photoPreview.src));
  }

  content.querySelector('#add-cue-btn').addEventListener('click', () => {
    syncCueRowsFromDOM();
    cueRows.push({ enterPage: '', exitPage: '', enterLocation: '', exitLocation: 'SL', carrierOn: '', carrierOff: '', carrierOnCastId: '', carrierOffCastId: '', mover: '', moverCastId: '' });
    renderContent();
  });

  content.querySelectorAll('.cue-row').forEach((row, i) => {
    const conInput = row.querySelector('.cue-con');
    const coffInput = row.querySelector('.cue-coff');
    const moverInput = row.querySelector('.cue-mover');
    buildCastPicker(conInput, (sel) => {
      if (cueRows[i]) { cueRows[i].carrierOn = sel ? sel.castName : ''; cueRows[i].carrierOnCastId = sel ? (sel.castId || '') : ''; }
    }, cueRows[i]?.carrierOn || '');
    buildCastPicker(coffInput, (sel) => {
      if (cueRows[i]) { cueRows[i].carrierOff = sel ? sel.castName : ''; cueRows[i].carrierOffCastId = sel ? (sel.castId || '') : ''; }
    }, cueRows[i]?.carrierOff || '');
    if (moverInput) {
      buildCastPicker(moverInput, (sel) => {
        if (cueRows[i]) { cueRows[i].mover = sel ? sel.castName : ''; cueRows[i].moverCastId = sel ? (sel.castId || '') : ''; }
      }, cueRows[i]?.mover || '');
    }
  });
  content.querySelector('#save-prop-btn').addEventListener('click', saveProp);
  content.querySelector('#cancel-edit-btn')?.addEventListener('click', () => { editingPropId = null; cueRows = []; _pendingPropPhoto = null; renderContent(); });
  content.querySelectorAll('.remove-cue-btn').forEach(btn => {
    btn.addEventListener('click', () => { syncCueRowsFromDOM(); cueRows.splice(parseInt(btn.dataset.idx), 1); renderContent(); });
  });
  content.querySelectorAll('.edit-prop-btn').forEach(btn => btn.addEventListener('click', () => startEdit(btn.dataset.id)));
  content.querySelectorAll('.delete-prop-btn').forEach(btn => btn.addEventListener('click', () => deleteProp(btn.dataset.id)));
  content.querySelectorAll('.prop-thumb').forEach(img => img.addEventListener('click', e => { e.stopPropagation(); openPhotoLightbox(img.dataset.src); }));
  // Feature 6: Import/Export
  content.querySelector('#props-import-btn')?.addEventListener('click', importPropsJSON);
  content.querySelector('#props-export-btn')?.addEventListener('click', exportPropsCSV);
}

function syncCueRowsFromDOM() {
  const rows = content.querySelectorAll('.cue-row');
  rows.forEach((row, i) => {
    if (cueRows[i]) {
      cueRows[i].enterPage = row.querySelector('.cue-enter').value;
      cueRows[i].exitPage = row.querySelector('.cue-exit').value;
      cueRows[i].exitLocation = row.querySelector('.cue-loc').value;
      const enterLocSelect = row.querySelector('.cue-enter-loc');
      if (enterLocSelect) cueRows[i].enterLocation = enterLocSelect.value;
      const moverInput = row.querySelector('.cue-mover');
      if (moverInput) cueRows[i].mover = moverInput.value;
    }
  });
}

async function saveProp() {
  if (!isOwner()) return;
  syncCueRowsFromDOM();
  const name = sanitizeName(content.querySelector('#prop-name-input').value);
  const start = content.querySelector('#prop-start-select').value;
  if (!name) { toast('Prop name is required.', 'error'); return; }
  // P3: Zero-cue props allowed — props with no cues appear in starting location
  const cues = cueRows.map((c, i) => {
    // Determine expected enter location: previous exit or prop start
    const prevLoc = i === 0 ? start : (cueRows[i - 1].exitLocation || 'SL');
    const enterLoc = c.enterLocation || prevLoc;
    return {
      enterPage: parseInt(c.enterPage) || 0,
      exitPage: parseInt(c.exitPage) || 0,
      enterLocation: enterLoc,
      exitLocation: c.exitLocation || 'SL',
      carrierOn: sanitizeName(c.carrierOn),
      carrierOnCastId: c.carrierOnCastId || '',
      carrierOff: sanitizeName(c.carrierOff),
      carrierOffCastId: c.carrierOffCastId || '',
      mover: sanitizeName(c.mover || ''),
      moverCastId: c.moverCastId || '',
    };
  });
  for (let i = 0; i < cues.length; i++) {
    if (!cues[i].enterPage || !cues[i].exitPage) { toast('Cue #' + (i+1) + ': enter and exit pages required.', 'error'); return; }
    if (cues[i].exitPage < cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit must be >= enter.', 'error'); return; }
  }
  const pid = state.activeProduction.id;
  const endLocation = cues.length > 0 ? cues[cues.length - 1].exitLocation : start;
  const enters = cues.map(c => c.enterPage);
  const exits = cues.map(c => c.exitPage);
  // Photo upload / clear handling
  let photoUrl = editingPropId ? (props.find(p => p.id === editingPropId)?.photoUrl || '') : '';
  let photoStoragePath = editingPropId ? (props.find(p => p.id === editingPropId)?.photoStoragePath || '') : '';
  if (_pendingPropPhoto?.clear) {
    if (photoStoragePath) {
      try { await deleteObject(ref(storage, photoStoragePath)); } catch(_e) { /* ignore */ }
    }
    photoUrl = ''; photoStoragePath = '';
  } else if (_pendingPropPhoto?.file) {
    const file = _pendingPropPhoto.file;
    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = `props/${pid}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const storageRef = ref(storage, storagePath);
    try {
      const saveBtn = content.querySelector('#save-prop-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Uploading…'; }
      const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
      await new Promise((resolve, reject) => task.on('state_changed', null, reject, resolve));
      if (photoStoragePath) {
        try { await deleteObject(ref(storage, photoStoragePath)); } catch(_e) { /* ignore */ }
      }
      photoUrl = await getDownloadURL(storageRef);
      photoStoragePath = storagePath;
    } catch(uploadErr) {
      toast('Photo upload failed: ' + uploadErr.message, 'error');
      const saveBtn = content.querySelector('#save-prop-btn');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editingPropId ? 'Update Prop' : 'Add Prop'; }
      return;
    }
  }
  _pendingPropPhoto = null;

  const propData = { name, start, cues, enters, exits, endLocation, photoUrl, photoStoragePath, createdAt: serverTimestamp() };
  try {
    if (editingPropId) {
      await updateDoc(doc(db, 'productions', pid, 'props', editingPropId), propData);
      toast('Prop updated.', 'success'); editingPropId = null;
    } else {
      await addDoc(collection(db, 'productions', pid, 'props'), propData);
      toast('Prop added!', 'success');
    }
    cueRows = [];
  } catch (e) { console.error(e); toast('Failed to save prop.', 'error'); }
}

function startEdit(propId) {
  const prop = props.find(p => p.id === propId);
  if (!prop) return;
  editingPropId = propId;
  cueRows = (prop.cues || []).map(c => ({ ...c }));
  if (cueRows.length === 0 && prop.enters?.length) {
    for (let i = 0; i < prop.enters.length; i++) {
      cueRows.push({ enterPage: prop.enters[i], exitPage: prop.exits?.[i] || prop.enters[i], enterLocation: '', exitLocation: prop.endLocation || 'SL', carrierOn: '', carrierOff: '', mover: '', moverCastId: '' });
    }
  }
  renderContent(); content.scrollTop = 0;
}

async function deleteProp(propId) {
  if (!isOwner()) return;
  if (!confirmDialog('Delete this prop?')) return;
  const prop = props.find(p => p.id === propId);
  try {
    if (prop?.photoStoragePath) {
      try { await deleteObject(ref(storage, prop.photoStoragePath)); } catch(_e) { /* ignore */ }
    }
    await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'props', propId));
    toast('Prop deleted.', 'success');
    if (editingPropId === propId) { editingPropId = null; cueRows = []; _pendingPropPhoto = null; }
  } catch (e) { toast('Failed to delete prop.', 'error'); }
}

/* ======================== VIEW SHOW TAB ======================== */
function renderViewTab() {
  const page = timerCurrentPage();
  const warnPgs = timerWarnPages();
  const slProps = [], onProps = [], srProps = [];
  props.forEach(p => {
    const r = getPropStatus(p, page);
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPgs && (r.upcomingEnter - page) > 0;
    const item = { prop: p, ...r, warn };
    if (r.status === 'ON') onProps.push(item);
    else if (r.location === 'SL') slProps.push(item);
    else srProps.push(item);
  });

  const renderCol = (items) => {
    if (items.length === 0) return '<div style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;">\u2014</div>';
    return items.map(({ prop: p, activeCue: ac, warn, upcomingEnter: ue, crossover: xo }) => {
      let carrier = '';
      if (ac) {
        if (ac.carrierOn) carrier += '<div class="prop-carrier">\u2191 ' + escapeHtml(ac.carrierOn) + '</div>';
        if (ac.carrierOff) carrier += '<div class="prop-carrier">\u2193 ' + escapeHtml(ac.carrierOff) + '</div>';
      }
      let crossoverHtml = '';
      if (xo) {
        const moverLabel = xo.mover ? escapeHtml(xo.mover) : '<em>unassigned</em>';
        crossoverHtml = '<div class="prop-crossover-alert">\u26a0 Move ' + escapeHtml(xo.from) + '\u2192' + escapeHtml(xo.to) + ' \u00b7 ' + moverLabel + '</div>';
      }
      const wt = warn ? ' <span style="color:#d4af37;font-size:11px;">(pg ' + ue + ')</span>' : '';
      const pillThumb = p.photoUrl ? '<img class="prop-thumb" style="float:right;margin:0 0 4px 8px;" src="' + escapeHtml(p.photoUrl) + '" data-src="' + escapeHtml(p.photoUrl) + '" alt="" />' : '';
      return '<div class="stage-prop ' + (warn ? 'stage-prop--warn' : '') + (xo ? ' stage-prop--crossover' : '') + '" data-propname="' + escapeHtml(p.name) + '">' +
        pillThumb + '<div class="prop-name">' + escapeHtml(p.name) + wt + '</div>' + carrier + crossoverHtml + '</div>';
    }).join('');
  };

  content.innerHTML = `
    <div class="stage-nav">
      <button id="stage-prev">\u25c4 Prev</button>
      <span class="page-display" id="stage-page-display">Page ${page}</span>
      <button id="stage-next">Next \u25ba</button>
    </div>
    <div class="stage-columns">
      <div class="stage-col stage-col--sl"><h4>Stage Left</h4>${renderCol(slProps)}</div>
      <div class="stage-col stage-col--on"><h4>ON Stage</h4>${renderCol(onProps)}</div>
      <div class="stage-col stage-col--sr"><h4>Stage Right</h4>${renderCol(srProps)}</div>
    </div>`;

  content.querySelector('#stage-prev').addEventListener('click', () => {
    const p = timerCurrentPage();
    if (p > 1) { setTimerField('currentPage', p - 1); renderContent(); }
  });
  content.querySelector('#stage-next').addEventListener('click', () => {
    setTimerField('currentPage', timerCurrentPage() + 1); renderContent();
  });
  content.querySelectorAll('.stage-prop').forEach(el =>
    el.addEventListener('click', () => openPropNotesModal(el.dataset.propname))
  );
  content.querySelectorAll('.stage-prop .prop-thumb').forEach(img =>
    img.addEventListener('click', e => { e.stopPropagation(); openPhotoLightbox(img.dataset.src); })
  );
}

/* ======================== TIMER ENGINE ======================== */
// renderTimerPanel() has moved to runshow.js — the engine functions remain here.

function formatTime(s) {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

export function startTimer(pagesOverride, durationOverride) {
  const ts = getTimerState();
  const pages = pagesOverride ?? ts.timerTotalPages;
  const dur   = durationOverride ?? ts.timerDuration;
  setTimerField('timerTotalPages', pages);
  setTimerField('timerDuration', dur);

  if (ts.timerHeld) {
    // Resume from hold — log the hold event
    if (state.runSession?.holdStartTime != null) {
      const holdDur = (Date.now() - state.runSession.holdStartTime) / 1000;
      state.runSession.holdLog.push({
        startedAt: state.runSession.holdStartTime,
        endedAt: Date.now(),
        durationSeconds: holdDur,
      });
      state.runSession.holdStartTime = null;
    }
    setTimerField('timerHeld', false);
  } else {
    setTimerField('timerElapsed', 0);
    setTimerField('currentPage', 1);
    _warnedProps.clear();
  }
  setTimerField('timerRunning', true);

  const existingInterval = getTimerState().timerInterval;
  if (existingInterval) clearInterval(existingInterval);

  const startRef = Date.now() - getTimerState().timerElapsed * 1000;
  const interval = setInterval(() => {
    const elapsed = (Date.now() - startRef) / 1000;
    setTimerField('timerElapsed', elapsed);

    const totalSec = getTimerState().timerDuration * 60;
    const tp = getTimerState().timerTotalPages;
    const secPerPage = tp > 0 ? totalSec / tp : totalSec;
    const newPage = Math.min(tp, Math.floor(elapsed / secPerPage) + 1);
    const oldPage = getTimerState().currentPage;
    if (newPage !== oldPage) {
      setTimerField('currentPage', newPage);
      _warnedProps.clear(); // clear warn set on page change
    }

    // Prop warning toasts
    const warnPgs = getTimerState().timerWarnPages;
    props.forEach(p => {
      const r = getPropStatus(p, newPage);
      if (r.upcomingEnter) {
        const pagesAway = r.upcomingEnter - newPage;
        if (pagesAway > 0 && pagesAway <= warnPgs) {
          const warnKey = `${p.id}:${r.upcomingEnter}`;
          if (!_warnedProps.has(warnKey)) {
            _warnedProps.add(warnKey);
            let msg = `\u26a0\ufe0f ${p.name} \u2014 ${pagesAway} pages (pg ${r.upcomingEnter})`;
            if (r.crossover) {
              const moverName = r.crossover.mover || 'unassigned';
              msg += ` \u2022 MOVE ${r.crossover.from}\u2192${r.crossover.to} by ${moverName}`;
            }
            toast(msg, state.runSession ? 'warn' : 'info');
          }
        }
      }
    });

    if (elapsed >= totalSec) { stopTimer(); toast('Show complete!', 'success'); }

    // Trigger Run Show re-render if active
    _notifyRunShow();
  }, 1000);

  setTimerField('timerInterval', interval);
  _notifyRunShow();
  syncSessionToFirestore(); // P0: sync on timer start
}

export function holdTimer() {
  if (state.runSession) {
    state.runSession.holdStartTime = Date.now();
  }
  setTimerField('timerHeld', true);
  setTimerField('timerRunning', false);
  const iv = getTimerState().timerInterval;
  if (iv) { clearInterval(iv); setTimerField('timerInterval', null); }
  _notifyRunShow();
  syncSessionToFirestore(); // P0
}

export function stopTimer() {
  const iv = getTimerState().timerInterval;
  if (iv) { clearInterval(iv); setTimerField('timerInterval', null); }
  setTimerField('timerRunning', false);
  setTimerField('timerHeld', false);
  setTimerField('timerElapsed', 0);
  _warnedProps.clear();
  _notifyRunShow();
  syncSessionToFirestore(); // P0
}

// Callback hook — set by runshow.js to trigger its re-render
let _runShowNotify = null;
export function setRunShowNotifyCallback(fn) { _runShowNotify = fn; }
function _notifyRunShow() { if (_runShowNotify) _runShowNotify(); }

/* ======================== SESSION LIFECYCLE ======================== */

/**
 * Start a new run session.
 * Security: sessions subcollection is readable by all production members;
 * create is allowed by any member; update/delete restricted to creator or owner.
 */
export async function startRunSession(sessionTitle, totalPages, durationMin, warnPages) {
  const pid = state.activeProduction.id;
  const uid = state.currentUser.uid;

  // 1. Create Firestore session doc (status: "active")
  // Security rule note: sessions readable by all production members; create by any member
  const sessionRef = await addDoc(collection(db, 'productions', pid, 'sessions'), {
    productionId: pid,
    title: sessionTitle,
    date: serverTimestamp(),
    startedAt: Date.now(),
    endedAt: null,
    durationSeconds: 0,
    holdLog: [],
    totalHoldSeconds: 0,
    totalPages: totalPages,
    targetDurationMinutes: durationMin,
    warnPages: warnPages,
    createdBy: uid,
    scratchpadNotes: '',
    status: 'active',
    reportHtml: '',
    liveElapsedSeconds: 0,
    liveCurrentPage: 1,
    liveHoldLog: [],
    liveScratchpad: '',
    liveTimerRunning: false,
    liveTimerHeld: false,
    lastSyncTimestamp: serverTimestamp(),
    noteCount: 0,
    notesByActor: {},
  });

  // 2. Populate state.runSession
  state.runSession = {
    sessionId: sessionRef.id,
    title: sessionTitle,
    timerRunning: false,
    timerHeld: false,
    timerElapsed: 0,
    timerTotalPages: totalPages,
    timerDuration: durationMin,
    timerWarnPages: warnPages,
    currentPage: 1,
    timerInterval: null,
    holdStartTime: null,
    holdLog: [],
    scratchpad: '',
  };

  // 3. Start the timer immediately
  startTimer(totalPages, durationMin);
}
  // P0: Start periodic Firestore sync
  startSessionSync();

/**
 * End the active run session.
 * Security: sessions update restricted to creator or owner (createdBy == uid || role == owner)
 */
export async function endRunSession(scratchpadText) {
  if (!state.runSession) return;

  stopTimer();

  // P0: Stop sync and write final state
  stopSessionSync();
  await syncSessionToFirestore();
  hideHeartbeat();

  const sid = state.runSession.sessionId;
  const pid = state.activeProduction.id;
  const elapsed = state.runSession.timerElapsed;
  const holdLog = state.runSession.holdLog || [];
  const totalHold = holdLog.reduce((s, h) => s + (h.durationSeconds || 0), 0);

  // Security rule note: sessions update restricted to creator (createdBy == uid) or owner role
  await updateDoc(doc(db, 'productions', pid, 'sessions', sid), {
    endedAt: serverTimestamp(),
    durationSeconds: elapsed,
    holdLog: holdLog,
    totalHoldSeconds: totalHold,
    scratchpadNotes: scratchpadText || '',
    status: 'ended',
  });

  state.runSession = null;
}

/* ======================== PROP NOTES MODAL ======================== */
function openPropNotesModal(propName) {
  const note = propNotes[propName];
  const canEdit = isOwner();
  const prop = props.find(p => p.name === propName);
  if (!prop) return;
  const cues = prop.cues || [];
  const cueSummary = cues.map((c, i) => {
    const enterLoc = c.enterLocation || (i === 0 ? (prop.start || 'SL') : (cues[i-1].exitLocation || 'SL'));
    const prevLoc = i === 0 ? (prop.start || 'SL') : (cues[i-1].exitLocation || 'SL');
    const xoTag = enterLoc !== prevLoc
      ? ' <span style="color:#e63946;">\u26a0 move ' + escapeHtml(prevLoc) + '\u2192' + escapeHtml(enterLoc) + (c.mover ? ' by ' + escapeHtml(c.mover) : '') + '</span>'
      : '';
    return 'Cue ' + (i+1) + ': ' + escapeHtml(enterLoc) + ' pg ' + c.enterPage + '\u2013' + c.exitPage + ' \u2192 ' + escapeHtml(c.exitLocation) +
    (c.carrierOn ? ' (on: ' + escapeHtml(c.carrierOn) + ')' : '') + (c.carrierOff ? ' (off: ' + escapeHtml(c.carrierOff) + ')' : '') + xoTag;
  }).join('<br/>') || 'No cues';

  const existing = document.querySelector('.prop-notes-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.className = 'prop-notes-modal';
  const photoSection = prop.photoUrl ? `<img class="prop-notes-photo" id="prop-notes-photo-img" src="${escapeHtml(prop.photoUrl)}" alt="${escapeHtml(propName)}" title="Click to enlarge" />` : '';
  modal.innerHTML = `<div class="prop-notes-card">
    <h3>${escapeHtml(propName)}</h3>
    ${photoSection}
    <div class="cue-summary">${cueSummary}</div>
    <textarea id="prop-notes-text" ${canEdit ? '' : 'disabled'} placeholder="Add notes about this prop...">${escapeHtml(note?.notes || '')}</textarea>
    <div class="modal-btns" style="margin-top:12px;">
      <button class="modal-btn-cancel" id="close-prop-notes">Close</button>
      ${canEdit ? '<button class="modal-btn-primary" id="save-prop-notes">Save</button>' : ''}
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#close-prop-notes').addEventListener('click', () => modal.remove());
  modal.querySelector('#prop-notes-photo-img')?.addEventListener('click', () => openPhotoLightbox(prop.photoUrl));
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#save-prop-notes')?.addEventListener('click', async () => {
    if (!isOwner()) return;
    const text = modal.querySelector('#prop-notes-text').value;
    const pid = state.activeProduction.id;
    try {
      if (note?.id) {
        await updateDoc(doc(db, 'productions', pid, 'propNotes', note.id), {
          notes: text, updatedAt: serverTimestamp(), updatedBy: state.currentUser.uid
        });
      } else {
        await addDoc(collection(db, 'productions', pid, 'propNotes'), {
          propName, notes: text, updatedAt: serverTimestamp(), updatedBy: state.currentUser.uid
        });
      }
      toast('Notes saved.', 'success');
      modal.remove();
    } catch (e) { toast('Failed to save notes.', 'error'); }
  });
}

/* ======================== PHOTO LIGHTBOX ======================== */
function openPhotoLightbox(url) {
  if (!url) return;
  const existing = document.querySelector('.prop-photo-lightbox');
  if (existing) existing.remove();
  const lb = document.createElement('div');
  lb.className = 'prop-photo-lightbox';
  lb.innerHTML = `<img src="${escapeHtml(url)}" alt="Prop photo" />`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

/* ======================== PRE/POST CHECK TAB ======================== */
async function renderCheckTab() {
  // P0: Load persisted check state from Firestore (only on first render)
  if (!_checkStateLoaded) {
    const _saved = await loadCheckState();
    preChecked = _saved.preChecked;
    postChecked = _saved.postChecked;
    _checkStateLoaded = true;
  }

  const renderCheckGrid = (type, checked) => {
    const items = props.map(p => {
      const isPreShow = type === 'pre';
      const loc = isPreShow ? p.start : ((p.cues || []).length > 0 ? p.cues[p.cues.length - 1].exitLocation : (p.endLocation || p.start));
      const carrier = isPreShow
        ? ((p.cues || [])[0]?.carrierOn || '')
        : ((p.cues || []).length > 0 ? p.cues[p.cues.length - 1].carrierOff : '');
      return { name: p.name, loc, carrier, photoUrl: p.photoUrl || '' };
    });
    const total = items.length;
    const done = items.filter(it => checked[it.name]).length;
    const allDone = total > 0 && done === total;
    return `
      <div class="check-section">
        <h3>${type === 'pre' ? 'Pre-Show Preset' : 'Post-Show Strike'}</h3>
        <div class="check-progress">${done}/${total} checked
          <span class="badge ${allDone ? 'badge--done' : 'badge--pending'}">${allDone ? 'Complete' : 'In Progress'}</span>
        </div>
        <div class="check-grid">${items.map(it => `
          <div class="check-card ${checked[it.name] ? 'check-card--checked' : ''}" data-name="${escapeHtml(it.name)}" data-type="${type}">
            <span class="check-mark">${checked[it.name] ? '\u2713' : ''}</span>
            ${it.photoUrl ? `<img class="prop-thumb-check" src="${escapeHtml(it.photoUrl)}" data-src="${escapeHtml(it.photoUrl)}" alt="" />` : ''}
            <div class="check-name">${escapeHtml(it.name)}</div>
            <div class="check-detail">${escapeHtml(it.loc)}${it.carrier ? ' \u00b7 ' + escapeHtml(it.carrier) : ''}</div>
          </div>
        `).join('')}</div>
        <button class="reset-checks-btn" data-type="${type}">Reset All</button>
      </div>`;
  };

  // P0: Progress bars
  const _preProg = checkProgress(preChecked, props.length);
  const _postProg = checkProgress(postChecked, props.length);
  content.innerHTML = renderProgressBar('Pre-Show', _preProg) + renderProgressBar('Post-Show', _postProg) + renderCheckGrid('pre', preChecked) + renderCheckGrid('post', postChecked);

  content.querySelectorAll('.prop-thumb-check').forEach(img => {
    img.addEventListener('click', e => { e.stopPropagation(); openPhotoLightbox(img.dataset.src); });
  });
  content.querySelectorAll('.check-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.dataset.name;
      const type = card.dataset.type;
      if (type === 'pre') preChecked[name] = !preChecked[name];
      else postChecked[name] = !postChecked[name];
      saveCheckState(preChecked, postChecked); // P0: persist
      renderContent();
    });
  });
  content.querySelectorAll('.reset-checks-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.type === 'pre') preChecked = {};
      else postChecked = {};
      saveCheckState(preChecked, postChecked); // P0: persist
      renderContent();
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   FEATURE 6: IMPORT/EXPORT PROPS
   ═══════════════════════════════════════════════════════════ */
function exportPropsCSV() {
  if (props.length === 0) { toast('No props to export.', 'warn'); return; }
  const maxCues = Math.max(1, ...props.map(p => (p.cues || []).length));
  const header = ['name', 'start', 'endLocation'];
  for (let i = 1; i <= maxCues; i++) { header.push('cue_' + i + '_enterLocation', 'cue_' + i + '_enterPage', 'cue_' + i + '_exitPage', 'cue_' + i + '_exitLocation', 'cue_' + i + '_carrierOn', 'cue_' + i + '_carrierOff', 'cue_' + i + '_mover'); }
  const rows = [header];
  props.forEach(p => {
    const cues = p.cues || [];
    const endLoc = cues.length > 0 ? cues[cues.length - 1].exitLocation : (p.endLocation || p.start);
    const row = [p.name, p.start, endLoc];
    for (let i = 0; i < maxCues; i++) { const c = cues[i]; if (c) { row.push(c.enterLocation || '', c.enterPage, c.exitPage, c.exitLocation || '', c.carrierOn || '', c.carrierOff || '', c.mover || ''); } else { row.push('', '', '', '', '', '', ''); } }
    rows.push(row);
  });
  const title = (state.activeProduction?.title || 'production').replace(/[^a-zA-Z0-9]/g, '_');
  downloadCSV(rows, 'props_' + title + '_' + new Date().toISOString().split('T')[0] + '.csv');
  toast('Props exported.', 'success');
}

function importPropsJSON() {
  if (!isOwner()) return;
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) { toast('JSON must be an array of props.', 'error'); return; }
      for (let i = 0; i < data.length; i++) {
        const p = data[i];
        if (!p.name || typeof p.name !== 'string') { toast('Item ' + (i+1) + ': name is required.', 'error'); return; }
        if (!['SL', 'SR'].includes(p.start)) { toast('Item ' + (i+1) + ': start must be SL or SR.', 'error'); return; }
        if (p.cues && !Array.isArray(p.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        for (let j = 0; j < p.cues.length; j++) {
          if (!Number.isInteger(p.cues[j].enterPage) || p.cues[j].enterPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': enterPage must be a positive integer.', 'error'); return; }
          if (!Number.isInteger(p.cues[j].exitPage) || p.cues[j].exitPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': exitPage must be a positive integer.', 'error'); return; }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' props. Import will ADD to existing props — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const p of data) {
        const cues = (p.cues || []).map(c => ({ enterPage: c.enterPage, exitPage: c.exitPage, enterLocation: c.enterLocation || '', exitLocation: c.exitLocation || 'SL', carrierOn: c.carrierOn || '', carrierOnCastId: '', carrierOff: c.carrierOff || '', carrierOffCastId: '', mover: c.mover || '', moverCastId: '' }));
        await addDoc(collection(db, 'productions', pid, 'props'), { name: sanitizeName(p.name), start: p.start, cues, enters: cues.map(c => c.enterPage), exits: cues.map(c => c.exitPage), endLocation: cues.length > 0 ? cues[cues.length - 1].exitLocation : p.start, createdAt: serverTimestamp() });
      }
      toast('Imported ' + data.length + ' props.', 'success');
    } catch(e) { toast('Invalid JSON: ' + e.message, 'error'); }
  });
  input.click();
}