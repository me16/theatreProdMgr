/**
 * costumes.js — Costume Tracking with Quick-Change Alerts
 * Fixed: re-renders on snapshot, includes cue management
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import { downloadCSV } from '../shared/ui.js';
import { showImportModal } from '../shared/import-modal.js';
import { getCastMembers } from '../cast/cast.js';
import { getProductionLocations } from './locations.js';
import { getActiveTrackingType } from './tracking-tab.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

let costumes = [];
let _unsub = null;
let activeInnerTab = 'view';
let _editingCostumeId = null;
let _costumeCueRows = [];

export function getCostumes() { return costumes; }

export function subscribeToCostumes(productionId) {
  if (_unsub) { _unsub(); _unsub = null; }
  _unsub = onSnapshot(collection(db, 'productions', productionId, 'costumes'), snap => {
    costumes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (getActiveTrackingType() === 'costumes' && !_editingCostumeId) {
      const el = document.getElementById('props-content');
      if (el) renderCostumesContent(el);
    }
  });
  state.unsubscribers.push(() => { if (_unsub) { _unsub(); _unsub = null; } });
}

export function setCostumeInnerTab(tab) { activeInnerTab = tab; }
export function getCostumeInnerTab() { return activeInnerTab; }

export function renderCostumesContent(container) {
  if (!container) return;
  const owner = isOwner();
  const tabs = owner ? ['manage', 'view'] : ['view'];
  let html = '<div class="props-subtabs" style="display:flex;border-bottom:1px solid var(--bg-border);background:var(--bg-base);flex-shrink:0;">';
  tabs.forEach(t => {
    const label = t === 'manage' ? 'Manage Costumes' : 'View Show';
    html += '<button class="props-subtab costume-inner-tab' + (activeInnerTab === t ? ' props-subtab--active' : '') + '" data-tab="' + t + '">' + label + '</button>';
  });
  html += '</div>';

  if (activeInnerTab === 'manage' && owner) html += _buildManageHtml();
  else html += _buildViewHtml();

  container.innerHTML = html;

  container.querySelectorAll('.costume-inner-tab').forEach(btn => {
    btn.addEventListener('click', () => { activeInnerTab = btn.dataset.tab; renderCostumesContent(container); });
  });

  if (activeInnerTab === 'manage' && owner) _wireManageEvents(container);
}

function _locOpts(selected) {
  const locs = getProductionLocations();
  const legacy = { 'SL': 'backstage-left', 'SR': 'backstage-right', 'ON': 'on-stage' };
  const res = legacy[selected] || selected || 'backstage-left';
  return locs.map(l => '<option value="' + l.id + '"' + (l.id === res ? ' selected' : '') + '>' + l.shortName + '</option>').join('');
}

function _buildManageHtml() {
  const cast = getCastMembers();
  const rows = costumes.map(c => {
    const cueCount = (c.cues || []).length;
    const qcCount = (c.cues || []).filter(q => q.isQuickChange).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--track-costume);font-weight:600;flex:1;">' + escapeHtml(c.name || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + escapeHtml(c.characterName || '') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + cueCount + ' cue' + (cueCount !== 1 ? 's' : '') + '</span>' +
      (qcCount > 0 ? '<span style="color:var(--qc-alert);font-size:11px;">⚡' + qcCount + ' QC</span>' : '') +
      '<button class="settings-btn costume-edit-btn" data-id="' + escapeHtml(c.id) + '">Edit Cues</button>' +
      '<button class="settings-btn settings-btn--danger costume-del-btn" data-id="' + escapeHtml(c.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:16px 0;">No costumes tracked yet.</div>';

  const castOptions = cast.map(m => {
    const chars = m.characters?.length > 0 ? m.characters : [m.name];
    return chars.map(ch => '<option value="' + escapeHtml(m.id + '::' + ch) + '">' + escapeHtml(ch) + '</option>').join('');
  }).join('');

  let cueEditHtml = '';
  if (_editingCostumeId) {
    const costume = costumes.find(c => c.id === _editingCostumeId);
    if (costume) {
      const cueRowsHtml = _costumeCueRows.length === 0
        ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No cues.</div>'
        : _costumeCueRows.map((c, i) => '<div class="cue-row" data-idx="' + i + '">' +
            '<span class="cue-num">#' + (i + 1) + '</span>' +
            '<label style="font-size:11px;color:var(--text-muted);">Start pg</label><input class="form-input co-start" type="number" min="1" value="' + (c.startPage || '') + '" style="width:60px;" />' +
            '<span class="arrow">→</span>' +
            '<label style="font-size:11px;color:var(--text-muted);">End pg</label><input class="form-input co-end" type="number" min="1" value="' + (c.endPage || '') + '" style="width:60px;" />' +
            '<label style="font-size:11px;color:var(--text-muted);">Change at</label><select class="form-select co-loc">' + _locOpts(c.changeLocation) + '</select>' +
            '<label style="font-size:11px;color:var(--text-muted);"><input type="checkbox" class="co-qc"' + (c.isQuickChange ? ' checked' : '') + ' style="margin-right:4px;" />Quick Change</label>' +
            '<button class="remove-cue-btn" data-idx="' + i + '" title="Remove">×</button></div>').join('');
      cueEditHtml = '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
        '<h4 style="color:var(--track-costume);font-size:14px;margin-bottom:12px;">Cues for ' + escapeHtml(costume.name) + '</h4>' +
        '<div class="cue-rows">' + cueRowsHtml + '</div>' +
        '<button class="add-cue-btn" id="costume-add-cue-btn">+ Add Cue</button>' +
        '<div style="display:flex;gap:8px;margin-top:12px;"><button class="modal-btn-primary" id="costume-save-cues-btn">Save Cues</button>' +
        '<button class="modal-btn-cancel" id="costume-cancel-edit-btn">Cancel</button></div></div>';
    }
  }

  return '<div style="padding:24px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="font-size:16px;color:var(--track-costume);margin:0;">Manage Costumes</h3><div style="display:flex;gap:8px;"><button class="settings-btn" id="costumes-import-btn">Import JSON</button><button class="settings-btn" id="costumes-export-btn">Export CSV</button></div></div>' +
    cueEditHtml +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<input class="form-input" id="costume-name-input" placeholder="Costume name" maxlength="100" style="flex:1;" />' +
    '<select class="form-select" id="costume-char-select"><option value="">Character…</option>' + castOptions + '</select>' +
    '<button class="modal-btn-primary" id="costume-add-btn">+ Add Costume</button></div></div>' +
    '<div id="costume-list">' + rows + '</div></div>';
}

function _wireManageEvents(container) {
  container.querySelector('#costume-add-btn')?.addEventListener('click', async () => {
    const name = sanitizeName(container.querySelector('#costume-name-input')?.value);
    if (!name) { toast('Name required.', 'error'); return; }
    const charVal = container.querySelector('#costume-char-select')?.value || '';
    const [castId, charName] = charVal ? charVal.split('::') : ['', ''];
    try {
      await addDoc(collection(db, 'productions', state.activeProduction.id, 'costumes'), {
        name, characterName: charName || '', castId: castId || '', trackingType: 'costume',
        description: '', photoUrl: '', presetLocation: 'backstage-left', cues: [], createdAt: serverTimestamp(),
      });
      toast('Costume added!', 'success');
    } catch (e) { toast('Failed.', 'error'); }
  });

  container.querySelectorAll('.costume-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this costume?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'costumes', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));

  container.querySelectorAll('.costume-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const costume = costumes.find(c => c.id === btn.dataset.id);
    if (!costume) return;
    _editingCostumeId = btn.dataset.id;
    _costumeCueRows = (costume.cues || []).map(c => ({ ...c }));
    const cont = document.getElementById('props-content');
    renderCostumesContent(cont);
    if (cont) cont.scrollTop = 0;
  }));

  container.querySelector('#costume-add-cue-btn')?.addEventListener('click', () => {
    _syncCostumeCueRows(container);
    _costumeCueRows.push({ startPage: '', endPage: '', changeLocation: 'backstage-left', isQuickChange: false });
    renderCostumesContent(document.getElementById('props-content'));
  });
  container.querySelectorAll('.remove-cue-btn').forEach(btn => btn.addEventListener('click', () => {
    _syncCostumeCueRows(container); _costumeCueRows.splice(parseInt(btn.dataset.idx), 1);
    renderCostumesContent(document.getElementById('props-content'));
  }));
  container.querySelector('#costume-save-cues-btn')?.addEventListener('click', async () => {
    _syncCostumeCueRows(container);
    const cues = _costumeCueRows.map(c => ({
      startPage: parseInt(c.startPage) || 0, endPage: parseInt(c.endPage) || 0,
      changeLocation: c.changeLocation || 'backstage-left', isQuickChange: !!c.isQuickChange,
      quickChangeDetails: c.isQuickChange ? (c.quickChangeDetails || { dresserCastId: '', dresserName: '', estimatedSeconds: 0, notes: '' }) : null,
    }));
    for (let i = 0; i < cues.length; i++) {
      if (!cues[i].startPage || !cues[i].endPage) { toast('Cue #' + (i + 1) + ': pages required.', 'error'); return; }
    }
    try {
      await updateDoc(doc(db, 'productions', state.activeProduction.id, 'costumes', _editingCostumeId), { cues });
      toast('Cues saved!', 'success'); _editingCostumeId = null; _costumeCueRows = [];
    } catch (e) { toast('Failed to save.', 'error'); }
  });
  container.querySelector('#costume-cancel-edit-btn')?.addEventListener('click', () => {
    _editingCostumeId = null; _costumeCueRows = [];
    renderCostumesContent(document.getElementById('props-content'));
  });

  container.querySelector('#costumes-export-btn')?.addEventListener('click', () => _exportCostumesCSV());
  container.querySelector('#costumes-import-btn')?.addEventListener('click', () => _importCostumesJSON());
}

function _exportCostumesCSV() {
  if (costumes.length === 0) { toast('No costumes to export.', 'warn'); return; }
  const maxCues = Math.max(1, ...costumes.map(c => (c.cues || []).length));
  const header = ['name', 'characterName', 'presetLocation'];
  for (let i = 1; i <= maxCues; i++) { header.push('cue_' + i + '_startPage', 'cue_' + i + '_endPage', 'cue_' + i + '_changeLocation', 'cue_' + i + '_isQuickChange'); }
  const rows = [header];
  costumes.forEach(c => {
    const cues = c.cues || [];
    const row = [c.name || '', c.characterName || '', c.presetLocation || ''];
    for (let i = 0; i < maxCues; i++) { const q = cues[i]; if (q) { row.push(q.startPage || '', q.endPage || '', q.changeLocation || '', q.isQuickChange ? 'YES' : ''); } else { row.push('', '', '', ''); } }
    rows.push(row);
  });
  const title = (state.activeProduction?.title || 'production').replace(/[^a-zA-Z0-9]/g, '_');
  downloadCSV(rows, 'costumes_' + title + '_' + new Date().toISOString().split('T')[0] + '.csv');
  toast('Costumes exported.', 'success');
}

function _importCostumesJSON() {
  if (!isOwner()) return;
  showImportModal({
    type: 'costumes',
    schemaHtml: 'Your JSON must be an <strong>array of objects</strong>. Each object needs a <code>name</code> (string). Optionally include <code>characterName</code>, <code>presetLocation</code>, and a <code>cues</code> array with start/end pages, change location, and quick-change flag.',
    exampleJson: JSON.stringify([
      {
        name: "Ophelia's Gown",
        characterName: "Ophelia",
        presetLocation: "backstage-left",
        cues: [
          { startPage: 12, endPage: 20, changeLocation: "backstage-left", isQuickChange: false },
          { startPage: 28, endPage: 35, changeLocation: "backstage-right", isQuickChange: true }
        ]
      },
      {
        name: "Hamlet's Mourning Cloak",
        characterName: "Hamlet",
        cues: [
          { startPage: 1, endPage: 18, changeLocation: "backstage-left", isQuickChange: false }
        ]
      }
    ], null, 2),
    claudePrompt: `I have a costume tracking spreadsheet for a theater production. Please convert it to a JSON array with this exact format:

[
  {
    "name": "Costume Name",
    "characterName": "Character Name",
    "presetLocation": "backstage-left",
    "cues": [
      {
        "startPage": 12,
        "endPage": 20,
        "changeLocation": "backstage-left",
        "isQuickChange": false
      }
    ]
  }
]

Rules:
- "name" is required for each entry
- "characterName" is optional but recommended
- "presetLocation" defaults to "backstage-left" — values: "backstage-left", "backstage-right", "on-stage"
- "startPage" and "endPage" must be positive integers
- "isQuickChange" is a boolean (true/false) — set true for fast costume changes
- Output ONLY the raw JSON array, no markdown or explanation`,
    onFile: async (data) => {
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (!c.name || typeof c.name !== 'string') { toast('Item ' + (i+1) + ': name is required.', 'error'); return; }
        if (c.cues && !Array.isArray(c.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        if (c.cues) {
          for (let j = 0; j < c.cues.length; j++) {
            if (!Number.isInteger(c.cues[j].startPage) || c.cues[j].startPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': startPage must be a positive integer.', 'error'); return; }
            if (!Number.isInteger(c.cues[j].endPage) || c.cues[j].endPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': endPage must be a positive integer.', 'error'); return; }
          }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' costumes. Import will ADD to existing — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const c of data) {
        const cues = (c.cues || []).map(q => ({
          startPage: q.startPage, endPage: q.endPage,
          changeLocation: q.changeLocation || 'backstage-left', isQuickChange: !!q.isQuickChange,
          quickChangeDetails: q.isQuickChange ? { dresserCastId: '', dresserName: '', estimatedSeconds: 0, notes: '' } : null,
        }));
        await addDoc(collection(db, 'productions', pid, 'costumes'), {
          name: sanitizeName(c.name), characterName: c.characterName || '', castId: '', trackingType: 'costume',
          description: '', photoUrl: '', presetLocation: c.presetLocation || 'backstage-left', cues, createdAt: serverTimestamp(),
        });
      }
      toast('Imported ' + data.length + ' costumes.', 'success');
    }
  });
}

function _syncCostumeCueRows(container) {
  container.querySelectorAll('.cue-row').forEach((row, i) => {
    if (_costumeCueRows[i]) {
      _costumeCueRows[i].startPage = row.querySelector('.co-start')?.value || '';
      _costumeCueRows[i].endPage = row.querySelector('.co-end')?.value || '';
      _costumeCueRows[i].changeLocation = row.querySelector('.co-loc')?.value || '';
      _costumeCueRows[i].isQuickChange = !!row.querySelector('.co-qc')?.checked;
    }
  });
}

function _buildViewHtml() {
  const page = state.runSession?.currentPage || 1;
  const warnPgs = state.runSession?.timerWarnPages || 5;
  const wearing = [], upcoming = [], quickChanges = [];
  costumes.forEach(c => {
    const cues = c.cues || [];
    for (const cue of cues) {
      if (page >= (cue.startPage || 0) && page <= (cue.endPage || 9999)) { wearing.push({ costume: c, cue }); break; }
    }
    for (const cue of cues) {
      if ((cue.startPage || 0) > page && (cue.startPage - page) <= warnPgs * 2) {
        upcoming.push({ costume: c, cue, pagesUntil: cue.startPage - page });
        if (cue.isQuickChange) quickChanges.push({ costume: c, cue, pagesUntil: cue.startPage - page });
        break;
      }
    }
  });
  const qcHtml = quickChanges.length > 0 ? quickChanges.map(({ costume: c, pagesUntil }) =>
    '<div style="padding:8px 10px;background:rgba(232,155,62,0.1);border:1px solid var(--qc-alert);border-radius:6px;margin-bottom:6px;' + (pagesUntil <= warnPgs ? 'animation:badge-pulse 1.5s ease-in-out infinite;' : '') + '">' +
    '<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">⚡</span><span style="color:var(--qc-alert);font-weight:600;font-size:13px;">' + escapeHtml(c.characterName || c.name) + '</span>' +
    '<span style="color:var(--text-muted);font-size:11px;margin-left:auto;">in ' + pagesUntil + ' pg' + (pagesUntil !== 1 ? 's' : '') + '</span></div></div>'
  ).join('') : '<div style="color:var(--text-muted);font-size:12px;">No upcoming quick changes.</div>';

  return '<div style="padding:24px;">' +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--qc-alert);margin-bottom:8px;">Quick Change Alerts</h4>' + qcHtml +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);margin:20px 0 8px;">Currently Wearing (' + wearing.length + ')</h4>' +
    (wearing.map(({ costume: c }) => '<div style="padding:4px 8px;background:var(--bg-card);border-radius:5px;margin-bottom:3px;font-size:12px;border-left:3px solid var(--track-costume);">' +
      '<span style="color:var(--text-primary);">' + escapeHtml(c.characterName || '') + '</span> — ' +
      '<span style="color:var(--text-secondary);">' + escapeHtml(c.name) + '</span></div>').join('') || '—') +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);margin:20px 0 8px;">Upcoming Changes (' + upcoming.length + ')</h4>' +
    (upcoming.map(({ costume: c, pagesUntil }) => '<div style="padding:4px 8px;background:var(--bg-card);border-radius:5px;margin-bottom:3px;font-size:12px;">' +
      escapeHtml(c.characterName || '') + ' → ' + escapeHtml(c.name) + ' <span style="color:var(--text-muted);">(' + pagesUntil + ' pg)</span></div>').join('') || '—') +
    '</div>';
}
