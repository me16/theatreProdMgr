/**
 * actors.js — Actor Tracking Module (3-state: Off → Hold → On)
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
import { getItemStatus, computeBadgeCounts } from './core.js';
import { getProductionLocations } from './locations.js';
import { getActiveTrackingType } from './tracking-tab.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

let actorCues = [];
let _unsub = null;
let activeInnerTab = 'view';
let _editingActorId = null;
let _actorCueRows = [];

export function getActorCues() { return actorCues; }

export function subscribeToActorCues(productionId) {
  if (_unsub) { _unsub(); _unsub = null; }
  _unsub = onSnapshot(collection(db, 'productions', productionId, 'actorCues'), snap => {
    actorCues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Re-render if actors tab is active
    if (getActiveTrackingType() === 'actors') {
      const el = document.getElementById('props-content');
      if (el && !_editingActorId) renderActorsContent(el);
    }
  });
  state.unsubscribers.push(() => { if (_unsub) { _unsub(); _unsub = null; } });
}

export function setActorInnerTab(tab) { activeInnerTab = tab; }
export function getActorInnerTab() { return activeInnerTab; }

export function renderActorsContent(container) {
  if (!container) return;
  // Inner subtab bar
  const owner = isOwner();
  const tabs = owner ? ['manage', 'view'] : ['view'];
  let html = '<div class="props-subtabs" style="display:flex;border-bottom:1px solid var(--bg-border);background:var(--bg-base);flex-shrink:0;">';
  tabs.forEach(t => {
    const label = t === 'manage' ? 'Manage Actors' : 'View Show';
    html += '<button class="props-subtab actor-inner-tab' + (activeInnerTab === t ? ' props-subtab--active' : '') + '" data-tab="' + t + '">' + label + '</button>';
  });
  html += '</div><div id="actors-inner-content" style="flex:1;overflow-y:auto;"></div>';
  container.innerHTML = html;

  container.querySelectorAll('.actor-inner-tab').forEach(btn => {
    btn.addEventListener('click', () => { activeInnerTab = btn.dataset.tab; renderActorsContent(container); });
  });

  const inner = container.querySelector('#actors-inner-content');
  if (activeInnerTab === 'manage' && owner) _renderManage(inner);
  else _renderView(inner);
}

function _locOpts(selected) {
  const locs = getProductionLocations();
  const legacy = { 'SL': 'backstage-left', 'SR': 'backstage-right', 'ON': 'on-stage' };
  const res = legacy[selected] || selected || 'backstage-left';
  return locs.map(l => '<option value="' + l.id + '"' + (l.id === res ? ' selected' : '') + '>' + l.shortName + '</option>').join('');
}

function _renderManage(el) {
  if (!el) return;
  const cast = getCastMembers();

  // Actor list
  const rows = actorCues.map(a => {
    const cueCount = (a.cues || []).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--track-actor);font-weight:600;flex:1;">' + escapeHtml(a.characterName || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + cueCount + ' cue' + (cueCount !== 1 ? 's' : '') + '</span>' +
      '<button class="settings-btn actor-edit-btn" data-id="' + escapeHtml(a.id) + '">Edit Cues</button>' +
      '<button class="settings-btn settings-btn--danger actor-del-btn" data-id="' + escapeHtml(a.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:16px 0;">No actors tracked yet.</div>';

  const castOptions = cast.map(m => {
    const chars = m.characters?.length > 0 ? m.characters : [m.name];
    return chars.map(ch => '<option value="' + escapeHtml(m.id + '::' + ch) + '">' + escapeHtml(ch) + ' (' + escapeHtml(m.name) + ')</option>').join('');
  }).join('');

  // Cue editing form (if editing)
  let cueEditHtml = '';
  if (_editingActorId) {
    const actor = actorCues.find(a => a.id === _editingActorId);
    if (actor) {
      const cueRowsHtml = _actorCueRows.length === 0
        ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No cues. Actor will stay off stage.</div>'
        : _actorCueRows.map((c, i) => '<div class="cue-row" data-idx="' + i + '">' +
            '<span class="cue-num">#' + (i + 1) + '</span>' +
            '<label style="font-size:11px;color:var(--text-muted);">Hold pg</label><input class="form-input ac-hold" type="number" min="1" placeholder="Hold" value="' + (c.holdPage || '') + '" style="width:60px;" />' +
            '<label style="font-size:11px;color:var(--text-muted);">Enter pg</label><input class="form-input ac-enter" type="number" min="1" placeholder="Enter" value="' + (c.enterPage || '') + '" style="width:60px;" />' +
            '<span class="arrow">→</span>' +
            '<label style="font-size:11px;color:var(--text-muted);">Exit pg</label><input class="form-input ac-exit" type="number" min="1" placeholder="Exit" value="' + (c.exitPage || '') + '" style="width:60px;" />' +
            '<label style="font-size:11px;color:var(--text-muted);">From</label><select class="form-select ac-enter-loc">' + _locOpts(c.enterLocation) + '</select>' +
            '<label style="font-size:11px;color:var(--text-muted);">To</label><select class="form-select ac-exit-loc">' + _locOpts(c.exitLocation) + '</select>' +
            '<button class="remove-cue-btn" data-idx="' + i + '" title="Remove">×</button></div>').join('');

      cueEditHtml = '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
        '<h4 style="color:var(--track-actor);font-size:14px;margin-bottom:12px;">Cues for ' + escapeHtml(actor.characterName) + '</h4>' +
        '<div class="cue-rows" id="actor-cue-rows">' + cueRowsHtml + '</div>' +
        '<button class="add-cue-btn" id="actor-add-cue-btn">+ Add Cue</button>' +
        '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="modal-btn-primary" id="actor-save-cues-btn">Save Cues</button>' +
        '<button class="modal-btn-cancel" id="actor-cancel-edit-btn">Cancel</button></div></div>';
    }
  }

  el.innerHTML = '<div style="padding:24px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="font-size:16px;color:var(--track-actor);margin:0;">Manage Actors</h3><div style="display:flex;gap:8px;"><button class="settings-btn" id="actors-import-btn">Import JSON</button><button class="settings-btn" id="actors-export-btn">Export CSV</button></div></div>' +
    cueEditHtml +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:20px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<select class="form-select" id="actor-char-select"><option value="">Select character…</option>' + castOptions + '</select>' +
    '<button class="modal-btn-primary" id="actor-add-btn">+ Add Actor</button></div></div>' +
    '<div id="actor-list">' + rows + '</div></div>';

  // Wire events
  el.querySelector('#actor-add-btn')?.addEventListener('click', async () => {
    const val = el.querySelector('#actor-char-select')?.value;
    if (!val) { toast('Select a character.', 'error'); return; }
    const [castId, charName] = val.split('::');
    const member = cast.find(m => m.id === castId);
    try {
      await addDoc(collection(db, 'productions', state.activeProduction.id, 'actorCues'), {
        characterName: charName, castId, actorName: member?.name || '', color: member?.color || '#5B9BD4',
        trackingType: 'actor', cues: [], defaultHoldLocation: 'backstage-left', notes: '', createdAt: serverTimestamp(),
      });
      toast('Actor added!', 'success');
    } catch (e) { toast('Failed.', 'error'); }
  });

  el.querySelectorAll('.actor-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const actor = actorCues.find(a => a.id === btn.dataset.id);
    if (!actor) return;
    _editingActorId = btn.dataset.id;
    _actorCueRows = (actor.cues || []).map(c => ({ ...c }));
    renderActorsContent(document.getElementById('props-content'));
  }));

  el.querySelectorAll('.actor-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this actor tracking?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'actorCues', btn.dataset.id)); toast('Deleted.', 'success'); }
    catch (e) { toast('Failed.', 'error'); }
  }));

  // Cue editing wiring
  el.querySelector('#actor-add-cue-btn')?.addEventListener('click', () => {
    _actorCueRows.push({ holdPage: '', enterPage: '', exitPage: '', enterLocation: 'backstage-left', exitLocation: 'backstage-right', holdLocation: '' });
    renderActorsContent(document.getElementById('props-content'));
  });
  el.querySelectorAll('.remove-cue-btn').forEach(btn => btn.addEventListener('click', () => {
    _syncActorCueRows(el); _actorCueRows.splice(parseInt(btn.dataset.idx), 1);
    renderActorsContent(document.getElementById('props-content'));
  }));
  el.querySelector('#actor-save-cues-btn')?.addEventListener('click', async () => {
    _syncActorCueRows(el);
    const cues = _actorCueRows.map(c => ({
      holdPage: parseInt(c.holdPage) || 0, enterPage: parseInt(c.enterPage) || 0, exitPage: parseInt(c.exitPage) || 0,
      enterLocation: c.enterLocation || 'backstage-left', exitLocation: c.exitLocation || 'backstage-right',
      holdLocation: c.holdLocation || c.enterLocation || '', notes: '', linkedPropIds: [], linkedCostumeId: '',
    }));
    for (let i = 0; i < cues.length; i++) {
      if (!cues[i].enterPage || !cues[i].exitPage) { toast('Cue #' + (i + 1) + ': enter and exit pages required.', 'error'); return; }
    }
    try {
      await updateDoc(doc(db, 'productions', state.activeProduction.id, 'actorCues', _editingActorId), { cues });
      toast('Cues saved!', 'success'); _editingActorId = null; _actorCueRows = [];
    } catch (e) { toast('Failed to save.', 'error'); }
  });
  el.querySelector('#actor-cancel-edit-btn')?.addEventListener('click', () => {
    _editingActorId = null; _actorCueRows = [];
    renderActorsContent(document.getElementById('props-content'));
  });

  // Import / Export
  el.querySelector('#actors-export-btn')?.addEventListener('click', () => _exportActorsCSV());
  el.querySelector('#actors-import-btn')?.addEventListener('click', () => _importActorsJSON());
}

function _exportActorsCSV() {
  if (actorCues.length === 0) { toast('No actors to export.', 'warn'); return; }
  const maxCues = Math.max(1, ...actorCues.map(a => (a.cues || []).length));
  const header = ['characterName', 'actorName', 'color', 'defaultHoldLocation'];
  for (let i = 1; i <= maxCues; i++) { header.push('cue_' + i + '_holdPage', 'cue_' + i + '_enterPage', 'cue_' + i + '_exitPage', 'cue_' + i + '_enterLocation', 'cue_' + i + '_exitLocation'); }
  const rows = [header];
  actorCues.forEach(a => {
    const cues = a.cues || [];
    const row = [a.characterName || '', a.actorName || '', a.color || '', a.defaultHoldLocation || ''];
    for (let i = 0; i < maxCues; i++) { const c = cues[i]; if (c) { row.push(c.holdPage || '', c.enterPage || '', c.exitPage || '', c.enterLocation || '', c.exitLocation || ''); } else { row.push('', '', '', '', ''); } }
    rows.push(row);
  });
  const title = (state.activeProduction?.title || 'production').replace(/[^a-zA-Z0-9]/g, '_');
  downloadCSV(rows, 'actors_' + title + '_' + new Date().toISOString().split('T')[0] + '.csv');
  toast('Actors exported.', 'success');
}

function _importActorsJSON() {
  if (!isOwner()) return;
  showImportModal({
    type: 'actors',
    schemaHtml: 'Your JSON must be an <strong>array of objects</strong>. Each object needs a <code>characterName</code> (string). Optionally include <code>actorName</code>, <code>color</code> (hex), and a <code>cues</code> array with hold/enter/exit pages and locations.',
    exampleJson: JSON.stringify([
      {
        characterName: "Hamlet",
        actorName: "John Smith",
        color: "#5B9BD4",
        defaultHoldLocation: "backstage-left",
        cues: [
          { holdPage: 3, enterPage: 5, exitPage: 18, enterLocation: "backstage-left", exitLocation: "backstage-right" },
          { holdPage: 20, enterPage: 22, exitPage: 35, enterLocation: "backstage-right", exitLocation: "backstage-left" }
        ]
      },
      {
        characterName: "Ophelia",
        actorName: "Jane Doe",
        color: "#E63946",
        cues: [
          { holdPage: 10, enterPage: 12, exitPage: 20, enterLocation: "backstage-right", exitLocation: "backstage-left" }
        ]
      }
    ], null, 2),
    claudePrompt: `I have a cast/actor tracking spreadsheet for a theater production. Please convert it to a JSON array with this exact format:

[
  {
    "characterName": "Character Name",
    "actorName": "Actor Real Name",
    "color": "#5B9BD4",
    "defaultHoldLocation": "backstage-left",
    "cues": [
      {
        "holdPage": 3,
        "enterPage": 5,
        "exitPage": 18,
        "enterLocation": "backstage-left",
        "exitLocation": "backstage-right"
      }
    ]
  }
]

Rules:
- "characterName" is required for each entry
- "holdPage" is the page where the actor goes to their hold position (optional, set to 0 if unknown)
- "enterPage" and "exitPage" must be positive integers
- Location values: "backstage-left", "backstage-right", "on-stage"
- "color" should be a hex color code (optional)
- Output ONLY the raw JSON array, no markdown or explanation`,
    onFile: async (data) => {
      for (let i = 0; i < data.length; i++) {
        const a = data[i];
        if (!a.characterName || typeof a.characterName !== 'string') { toast('Item ' + (i+1) + ': characterName is required.', 'error'); return; }
        if (a.cues && !Array.isArray(a.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        if (a.cues) {
          for (let j = 0; j < a.cues.length; j++) {
            if (!Number.isInteger(a.cues[j].enterPage) || a.cues[j].enterPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': enterPage must be a positive integer.', 'error'); return; }
            if (!Number.isInteger(a.cues[j].exitPage) || a.cues[j].exitPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': exitPage must be a positive integer.', 'error'); return; }
          }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' actors. Import will ADD to existing actors — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const a of data) {
        const cues = (a.cues || []).map(c => ({
          holdPage: parseInt(c.holdPage) || 0, enterPage: c.enterPage, exitPage: c.exitPage,
          enterLocation: c.enterLocation || 'backstage-left', exitLocation: c.exitLocation || 'backstage-right',
          holdLocation: c.holdLocation || c.enterLocation || '', notes: '', linkedPropIds: [], linkedCostumeId: '',
        }));
        await addDoc(collection(db, 'productions', pid, 'actorCues'), {
          characterName: sanitizeName(a.characterName), castId: '', actorName: a.actorName || '', color: a.color || '#5B9BD4',
          trackingType: 'actor', cues, defaultHoldLocation: a.defaultHoldLocation || 'backstage-left', notes: '', createdAt: serverTimestamp(),
        });
      }
      toast('Imported ' + data.length + ' actors.', 'success');
    }
  });
}

function _syncActorCueRows(el) {
  el.querySelectorAll('.cue-row').forEach((row, i) => {
    if (_actorCueRows[i]) {
      _actorCueRows[i].holdPage = row.querySelector('.ac-hold')?.value || '';
      _actorCueRows[i].enterPage = row.querySelector('.ac-enter')?.value || '';
      _actorCueRows[i].exitPage = row.querySelector('.ac-exit')?.value || '';
      _actorCueRows[i].enterLocation = row.querySelector('.ac-enter-loc')?.value || '';
      _actorCueRows[i].exitLocation = row.querySelector('.ac-exit-loc')?.value || '';
    }
  });
}

function _renderView(el) {
  if (!el) return;
  const page = state.runSession?.currentPage || 1;
  const warnPgs = state.runSession?.timerWarnPages || 5;
  const offActors = [], holdActors = [], onActors = [];
  actorCues.forEach(a => {
    const r = getItemStatus(a, page, { stateModel: 'three-state' });
    const warn = r.upcomingHold && (r.upcomingHold - page) <= warnPgs && (r.upcomingHold - page) > 0;
    const item = { actor: a, ...r, warn };
    if (r.status === 'ON') onActors.push(item);
    else if (r.status === 'HOLD') holdActors.push(item);
    else offActors.push(item);
  });

  const pill = (item, colorVar) => {
    const a = item.actor;
    const warnHtml = item.warn ? ' <span style="color:var(--state-hold);font-size:10px;">(hold pg ' + (item.upcomingHold || '?') + ')</span>' : '';
    return '<div style="padding:6px 10px;background:var(--bg-card);border-radius:6px;margin-bottom:4px;border-left:3px solid ' + colorVar + ';">' +
      '<div style="color:var(--text-primary);font-size:13px;">' + escapeHtml(a.characterName || '?') + warnHtml + '</div>' +
      '<div style="color:var(--text-muted);font-size:11px;">' + escapeHtml(a.actorName || '') + '</div></div>';
  };

  el.innerHTML = '<div style="padding:24px;">' +
    '<div style="display:flex;gap:12px;margin-bottom:16px;font-size:12px;color:var(--text-muted);">Page: <strong style="color:var(--text-primary);">' + page + '</strong></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">' +
    '<div><h4 style="font-size:11px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Off Stage (' + offActors.length + ')</h4>' + (offActors.map(i => pill(i, 'var(--state-off)')).join('') || '<div style="color:var(--text-muted);font-size:12px;">—</div>') + '</div>' +
    '<div style="background:rgba(212,175,55,0.05);border-radius:8px;padding:8px;"><h4 style="font-size:11px;text-transform:uppercase;color:var(--state-hold);margin-bottom:8px;">Hold (' + holdActors.length + ')</h4>' + (holdActors.map(i => pill(i, 'var(--state-hold)')).join('') || '<div style="color:var(--text-muted);font-size:12px;">—</div>') + '</div>' +
    '<div><h4 style="font-size:11px;text-transform:uppercase;color:var(--state-on);margin-bottom:8px;">On Stage (' + onActors.length + ')</h4>' + (onActors.map(i => pill(i, 'var(--state-on)')).join('') || '<div style="color:var(--text-muted);font-size:12px;">—</div>') + '</div></div></div>';
}
