import { db, auth } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { openPanel } from '../production/production.js';
import { openLineNotes } from '../linenotes/linenotes.js';

let props = [];
let propNotes = {};
let currentPage = 1;
let activeTab = 'manage';
let editingPropId = null;
let cueRows = [];
let timerRunning = false;
let timerHeld = false;
let timerInterval = null;
let timerStartTime = 0;
let timerElapsed = 0;
let timerTotalPages = 100;
let timerDuration = 120;
let timerWarnPages = 5;
let preChecked = {};
let postChecked = {};

const appView = document.getElementById('app-view');
const content = document.getElementById('props-content');

export function initProps() {
  document.getElementById('props-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.props-tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    if (tabName === 'manage' && !isOwner()) {
      toast('Only owners can manage props.', 'error');
      return;
    }
    setActiveTab(tabName);
  });
  document.getElementById('open-settings-btn').addEventListener('click', openPanel);
  document.getElementById('open-linenotes-btn').addEventListener('click', openLineNotes);
  document.getElementById('app-logout-btn').addEventListener('click', () => auth.signOut());
}

function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.props-tab').forEach(t =>
    t.classList.toggle('props-tab--active', t.dataset.tab === tab)
  );
  const manageTab = document.querySelector('.props-tab[data-tab="manage"]');
  if (!isOwner()) {
    manageTab.classList.add('hidden');
    if (tab === 'manage') activeTab = 'view';
  } else {
    manageTab.classList.remove('hidden');
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
  const settingsBtn = document.getElementById('open-settings-btn');
  settingsBtn.classList.toggle('hidden', !isOwner());
  // Stop any running timer from previous production
  stopTimer();
  props = []; propNotes = {}; currentPage = 1;
  preChecked = {}; postChecked = {};
  editingPropId = null; cueRows = [];
  subscribeToProps();
  setActiveTab(isOwner() ? 'manage' : 'view');
}

export function hideApp() {
  appView.style.display = 'none';
  // Close any open overlays
  document.getElementById('linenotes-overlay').classList.remove('open');
  document.getElementById('production-panel').classList.remove('open');
  document.getElementById('production-backdrop').classList.remove('open');
  // Remove any lingering modals
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
  switch (activeTab) {
    case 'manage': renderManageTab(); break;
    case 'view': renderViewTab(); break;
    case 'check': renderCheckTab(); break;
  }
}

/* ======================== MANAGE PROPS TAB ======================== */
function renderManageTab() {
  if (!isOwner()) { setActiveTab('view'); return; }
  const editProp = editingPropId ? props.find(p => p.id === editingPropId) : null;

  let cueRowsHtml = '';
  if (cueRows.length === 0) {
    cueRowsHtml = '<div style="color:#555;font-size:13px;padding:8px 0;">No cues yet. Add at least one.</div>';
  } else {
    cueRowsHtml = cueRows.map((c, i) => `
      <div class="cue-row" data-idx="${i}">
        <span class="cue-num">#${i + 1}</span>
        <input class="form-input cue-enter" type="number" min="1" placeholder="Enter pg" value="${c.enterPage || ''}" />
        <span class="arrow">\u2192</span>
        <input class="form-input cue-exit" type="number" min="1" placeholder="Exit pg" value="${c.exitPage || ''}" />
        <select class="form-select cue-loc">
          <option value="SL" ${c.exitLocation === 'SL' ? 'selected' : ''}>SL</option>
          <option value="SR" ${c.exitLocation === 'SR' ? 'selected' : ''}>SR</option>
        </select>
        <input class="form-input carrier-input cue-con" type="text" maxlength="100" placeholder="Carrier On" value="${escapeHtml(c.carrierOn || '')}" />
        <input class="form-input carrier-input cue-coff" type="text" maxlength="100" placeholder="Carrier Off" value="${escapeHtml(c.carrierOff || '')}" />
        <button class="remove-cue-btn" data-idx="${i}" title="Remove cue">\u00d7</button>
      </div>`).join('');
  }

  let tableRows = '';
  if (props.length === 0) {
    tableRows = '<tr><td colspan="5" style="color:#555;text-align:center;padding:24px;">No props added yet.</td></tr>';
  } else {
    tableRows = props.map(p => {
      const cues = p.cues || [];
      const endLoc = cues.length > 0 ? cues[cues.length - 1].exitLocation : (p.endLocation || p.start);
      const cueTags = cues.map(c =>
        '<span class="cue-tag cue-tag--enter">\u2191' + c.enterPage + '</span><span class="cue-tag cue-tag--exit">\u2193' + c.exitPage + '</span>'
      ).join(' ') || '<span style="color:#555;">\u2014</span>';
      return '<tr><td>' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.start) + '</td><td>' + cueTags + '</td><td>' + escapeHtml(endLoc) + '</td><td>' +
        '<button class="panel-btn edit-prop-btn" data-id="' + escapeHtml(p.id) + '">Edit</button> ' +
        '<button class="panel-btn panel-btn--danger delete-prop-btn" data-id="' + escapeHtml(p.id) + '">Delete</button></td></tr>';
    }).join('');
  }

  content.innerHTML = `
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
      <h4 style="font-size:14px;color:#888;margin:16px 0 8px;">Cues</h4>
      <div class="cue-rows" id="cue-rows-container">${cueRowsHtml}</div>
      <button class="add-cue-btn" id="add-cue-btn">+ Add Cue</button>
      <div class="form-actions">
        ${editingPropId ? '<button class="modal-btn-cancel" id="cancel-edit-btn">Cancel</button>' : ''}
        <button class="modal-btn-primary" id="save-prop-btn">${editingPropId ? 'Update Prop' : 'Add Prop'}</button>
      </div>
    </div>
    <div class="props-table-wrap"><table class="props-table">
      <thead><tr><th>Name</th><th>Start</th><th>Cues</th><th>End</th><th></th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>`;

  content.querySelector('#add-cue-btn').addEventListener('click', () => {
    syncCueRowsFromDOM();
    cueRows.push({ enterPage: '', exitPage: '', exitLocation: 'SL', carrierOn: '', carrierOff: '' });
    renderContent();
  });
  content.querySelector('#save-prop-btn').addEventListener('click', saveProp);
  content.querySelector('#cancel-edit-btn')?.addEventListener('click', () => {
    editingPropId = null; cueRows = []; renderContent();
  });
  content.querySelectorAll('.remove-cue-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      syncCueRowsFromDOM();
      cueRows.splice(parseInt(btn.dataset.idx), 1);
      renderContent();
    });
  });
  content.querySelectorAll('.edit-prop-btn').forEach(btn =>
    btn.addEventListener('click', () => startEdit(btn.dataset.id))
  );
  content.querySelectorAll('.delete-prop-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteProp(btn.dataset.id))
  );
}

function syncCueRowsFromDOM() {
  const rows = content.querySelectorAll('.cue-row');
  rows.forEach((row, i) => {
    if (cueRows[i]) {
      cueRows[i].enterPage = row.querySelector('.cue-enter').value;
      cueRows[i].exitPage = row.querySelector('.cue-exit').value;
      cueRows[i].exitLocation = row.querySelector('.cue-loc').value;
      cueRows[i].carrierOn = row.querySelector('.cue-con').value;
      cueRows[i].carrierOff = row.querySelector('.cue-coff').value;
    }
  });
}

async function saveProp() {
  if (!isOwner()) return;
  syncCueRowsFromDOM();
  const name = sanitizeName(content.querySelector('#prop-name-input').value);
  const start = content.querySelector('#prop-start-select').value;
  if (!name) { toast('Prop name is required.', 'error'); return; }
  if (cueRows.length === 0) { toast('Add at least one cue.', 'error'); return; }
  const cues = cueRows.map(c => ({
    enterPage: parseInt(c.enterPage) || 0,
    exitPage: parseInt(c.exitPage) || 0,
    exitLocation: c.exitLocation || 'SL',
    carrierOn: sanitizeName(c.carrierOn),
    carrierOff: sanitizeName(c.carrierOff),
  }));
  for (let i = 0; i < cues.length; i++) {
    if (!cues[i].enterPage || !cues[i].exitPage) { toast('Cue #' + (i+1) + ': enter and exit pages required.', 'error'); return; }
    if (cues[i].exitPage < cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit must be >= enter.', 'error'); return; }
  }
  const pid = state.activeProduction.id;
  const endLocation = cues[cues.length - 1].exitLocation;
  const enters = cues.map(c => c.enterPage);
  const exits = cues.map(c => c.exitPage);
  const propData = { name, start, cues, enters, exits, endLocation, createdAt: serverTimestamp() };
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
      cueRows.push({ enterPage: prop.enters[i], exitPage: prop.exits?.[i] || prop.enters[i], exitLocation: prop.endLocation || 'SL', carrierOn: '', carrierOff: '' });
    }
  }
  renderContent(); content.scrollTop = 0;
}

async function deleteProp(propId) {
  if (!isOwner()) return;
  if (!confirmDialog('Delete this prop?')) return;
  try {
    await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'props', propId));
    toast('Prop deleted.', 'success');
    if (editingPropId === propId) { editingPropId = null; cueRows = []; }
  } catch (e) { toast('Failed to delete prop.', 'error'); }
}

/* ======================== STATUS LOGIC ======================== */
function getPropStatus(prop, page) {
  const cues = prop.cues || [];
  let location = prop.start || 'SL';
  let status = 'Off Stage';
  let activeCue = null;
  let upcomingEnter = null;
  if (cues.length > 0) {
    for (const cue of cues) {
      if (page >= cue.enterPage && page <= cue.exitPage) { status = 'ON'; location = 'ON'; activeCue = cue; break; }
      else if (page > cue.exitPage) { location = cue.exitLocation || 'SL'; status = 'Off Stage'; }
    }
    if (status !== 'ON') {
      for (const cue of cues) { if (cue.enterPage > page) { upcomingEnter = cue.enterPage; break; } }
    }
  } else {
    const enters = prop.enters || []; const exits = prop.exits || [];
    for (let i = 0; i < enters.length; i++) {
      if (page >= enters[i] && page <= (exits[i] || 9999)) { status = 'ON'; location = 'ON'; break; }
      else if (page > (exits[i] || 9999)) { location = prop.endLocation || 'SL'; }
    }
    if (status !== 'ON') { for (const ep of enters) { if (ep > page) { upcomingEnter = ep; break; } } }
  }
  return { location, status, activeCue, upcomingEnter };
}

/* ======================== VIEW SHOW TAB ======================== */
function renderViewTab() {
  const slProps = [], onProps = [], srProps = [];
  props.forEach(p => {
    const r = getPropStatus(p, currentPage);
    const warn = r.upcomingEnter && (r.upcomingEnter - currentPage) <= timerWarnPages && (r.upcomingEnter - currentPage) > 0;
    const item = { prop: p, ...r, warn };
    if (r.status === 'ON') onProps.push(item);
    else if (r.location === 'SL') slProps.push(item);
    else srProps.push(item);
  });

  const renderCol = (items) => {
    if (items.length === 0) return '<div style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;">\u2014</div>';
    return items.map(({ prop: p, activeCue: ac, warn, upcomingEnter: ue }) => {
      let carrier = '';
      if (ac) {
        if (ac.carrierOn) carrier += '<div class="prop-carrier">\u2191 ' + escapeHtml(ac.carrierOn) + '</div>';
        if (ac.carrierOff) carrier += '<div class="prop-carrier">\u2193 ' + escapeHtml(ac.carrierOff) + '</div>';
      }
      const wt = warn ? ' <span style="color:#d4af37;font-size:11px;">(pg ' + ue + ')</span>' : '';
      return '<div class="stage-prop ' + (warn ? 'stage-prop--warn' : '') + '" data-propname="' + escapeHtml(p.name) + '">' +
        '<div class="prop-name">' + escapeHtml(p.name) + wt + '</div>' + carrier + '</div>';
    }).join('');
  };

  content.innerHTML = renderTimerPanel() + `
    <div class="stage-nav">
      <button id="stage-prev">\u25c4 Prev</button>
      <span class="page-display" id="stage-page-display">Page ${currentPage}</span>
      <button id="stage-next">Next \u25ba</button>
    </div>
    <div class="stage-columns">
      <div class="stage-col stage-col--sl"><h4>Stage Left</h4>${renderCol(slProps)}</div>
      <div class="stage-col stage-col--on"><h4>ON Stage</h4>${renderCol(onProps)}</div>
      <div class="stage-col stage-col--sr"><h4>Stage Right</h4>${renderCol(srProps)}</div>
    </div>`;

  content.querySelector('#stage-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderContent(); } });
  content.querySelector('#stage-next').addEventListener('click', () => { currentPage++; renderContent(); });
  wireTimerEvents();
  content.querySelectorAll('.stage-prop').forEach(el =>
    el.addEventListener('click', () => openPropNotesModal(el.dataset.propname))
  );
}

/* ======================== TIMER ======================== */
function renderTimerPanel() {
  const elapsed = timerElapsed;
  const totalSec = timerDuration * 60;
  const pct = totalSec > 0 ? Math.min(100, (elapsed / totalSec) * 100) : 0;
  const elapsedStr = formatTime(elapsed);
  const remainStr = formatTime(Math.max(0, totalSec - elapsed));
  const secPerPage = timerTotalPages > 0 ? totalSec / timerTotalPages : 0;
  const nextTurnSec = secPerPage > 0 ? Math.max(0, secPerPage - (elapsed % secPerPage)) : 0;

  return `<div class="timer-panel">
    <h3>Show Timer</h3>
    <div class="timer-inputs">
      <div><label>Total Pages</label><br/><input type="number" id="timer-pages" min="1" value="${timerTotalPages}" ${timerRunning ? 'disabled' : ''} /></div>
      <div><label>Duration (min)</label><br/><input type="number" id="timer-duration" min="1" value="${timerDuration}" ${timerRunning ? 'disabled' : ''} /></div>
      <div><label>Warn Pages</label><br/><input type="number" id="timer-warn" min="0" value="${timerWarnPages}" /></div>
    </div>
    <div class="timer-btns">
      <button class="timer-btn timer-btn--start" id="timer-start" ${timerRunning && !timerHeld ? 'disabled' : ''}>${timerHeld ? 'Resume' : 'Start'}</button>
      <button class="timer-btn timer-btn--hold" id="timer-hold" ${!timerRunning || timerHeld ? 'disabled' : ''}>Hold Page</button>
      <button class="timer-btn timer-btn--stop" id="timer-stop" ${!timerRunning && !timerHeld ? 'disabled' : ''}>Stop</button>
    </div>
    <div class="timer-progress"><div class="timer-progress-bar" style="width:${pct}%"></div></div>
    <div class="timer-display">
      <span>Elapsed: ${elapsedStr}</span>
      <span>Remaining: ${remainStr}</span>
      <span>Next turn: ${formatTime(nextTurnSec)}</span>
    </div>
  </div>`;
}

function wireTimerEvents() {
  content.querySelector('#timer-start')?.addEventListener('click', startTimer);
  content.querySelector('#timer-hold')?.addEventListener('click', holdTimer);
  content.querySelector('#timer-stop')?.addEventListener('click', stopTimer);
  content.querySelector('#timer-warn')?.addEventListener('change', e => {
    timerWarnPages = parseInt(e.target.value) || 5;
  });
}

function startTimer() {
  const pagesInput = content.querySelector('#timer-pages');
  const durInput = content.querySelector('#timer-duration');
  if (pagesInput) timerTotalPages = parseInt(pagesInput.value) || 100;
  if (durInput) timerDuration = parseInt(durInput.value) || 120;

  if (timerHeld) { timerHeld = false; } else {
    timerElapsed = 0; currentPage = 1;
    timerStartTime = Date.now();
  }
  timerRunning = true;
  if (timerInterval) clearInterval(timerInterval);
  const startRef = Date.now() - timerElapsed * 1000;
  timerInterval = setInterval(() => {
    timerElapsed = (Date.now() - startRef) / 1000;
    const totalSec = timerDuration * 60;
    const secPerPage = timerTotalPages > 0 ? totalSec / timerTotalPages : totalSec;
    const newPage = Math.min(timerTotalPages, Math.floor(timerElapsed / secPerPage) + 1);
    if (newPage !== currentPage) { currentPage = newPage; }
    if (timerElapsed >= totalSec) { stopTimer(); toast('Show complete!', 'success'); }
    renderContent();
  }, 1000);
  renderContent();
}

function holdTimer() {
  timerHeld = true; timerRunning = false;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  renderContent();
}

function stopTimer() {
  timerRunning = false; timerHeld = false;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerElapsed = 0;
}

function formatTime(s) {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

/* ======================== PROP NOTES MODAL ======================== */
function openPropNotesModal(propName) {
  const note = propNotes[propName];
  const canEdit = isOwner();
  const prop = props.find(p => p.name === propName);
  if (!prop) return;
  const cues = prop.cues || [];
  const cueSummary = cues.map((c, i) =>
    'Cue ' + (i+1) + ': pg ' + c.enterPage + '\u2013' + c.exitPage + ' \u2192 ' + escapeHtml(c.exitLocation) +
    (c.carrierOn ? ' (on: ' + escapeHtml(c.carrierOn) + ')' : '') + (c.carrierOff ? ' (off: ' + escapeHtml(c.carrierOff) + ')' : '')
  ).join('<br/>') || 'No cues';

  const existing = document.querySelector('.prop-notes-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.className = 'prop-notes-modal';
  modal.innerHTML = `<div class="prop-notes-card">
    <h3>${escapeHtml(propName)}</h3>
    <div class="cue-summary">${cueSummary}</div>
    <textarea id="prop-notes-text" ${canEdit ? '' : 'disabled'} placeholder="Add notes about this prop...">${escapeHtml(note?.notes || '')}</textarea>
    <div class="modal-btns" style="margin-top:12px;">
      <button class="modal-btn-cancel" id="close-prop-notes">Close</button>
      ${canEdit ? '<button class="modal-btn-primary" id="save-prop-notes">Save</button>' : ''}
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#close-prop-notes').addEventListener('click', () => modal.remove());
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

/* ======================== PRE/POST CHECK TAB ======================== */
function renderCheckTab() {
  const renderCheckGrid = (type, checked, setChecked) => {
    const items = props.map(p => {
      const isPreShow = type === 'pre';
      const loc = isPreShow ? p.start : ((p.cues || []).length > 0 ? p.cues[p.cues.length - 1].exitLocation : (p.endLocation || p.start));
      const carrier = isPreShow
        ? ((p.cues || [])[0]?.carrierOn || '')
        : ((p.cues || []).length > 0 ? p.cues[p.cues.length - 1].carrierOff : '');
      return { name: p.name, loc, carrier };
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
            <div class="check-name">${escapeHtml(it.name)}</div>
            <div class="check-detail">${escapeHtml(it.loc)}${it.carrier ? ' \u00b7 ' + escapeHtml(it.carrier) : ''}</div>
          </div>
        `).join('')}</div>
        <button class="reset-checks-btn" data-type="${type}">Reset All</button>
      </div>`;
  };

  content.innerHTML = renderCheckGrid('pre', preChecked, preChecked) + renderCheckGrid('post', postChecked, postChecked);

  content.querySelectorAll('.check-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.dataset.name;
      const type = card.dataset.type;
      if (type === 'pre') preChecked[name] = !preChecked[name];
      else postChecked[name] = !postChecked[name];
      renderContent();
    });
  });
  content.querySelectorAll('.reset-checks-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.type === 'pre') preChecked = {};
      else postChecked = {};
      renderContent();
    });
  });
}
