/**
 * scenic.js — Scenic Element Tracking with Cue Group Bundling
 * Fixed: re-renders on snapshot, cue group creation, piece cue editing
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import { getItemStatus } from './core.js';
import { getProductionLocations } from './locations.js';
import { getActiveTrackingType } from './tracking-tab.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

let scenicPieces = [];
let scenicCueGroups = [];
let _unsubPieces = null;
let _unsubGroups = null;
let activeInnerTab = 'view';
let _editingPieceId = null;
let _pieceCueRows = [];

export function getScenicPieces() { return scenicPieces; }
export function getScenicCueGroups() { return scenicCueGroups; }

export function subscribeToScenic(productionId) {
  if (_unsubPieces) { _unsubPieces(); _unsubPieces = null; }
  if (_unsubGroups) { _unsubGroups(); _unsubGroups = null; }
  _unsubPieces = onSnapshot(collection(db, 'productions', productionId, 'scenicPieces'), snap => {
    scenicPieces = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (getActiveTrackingType() === 'scenic' && !_editingPieceId) {
      const el = document.getElementById('props-content');
      if (el) renderScenicContent(el);
    }
  });
  _unsubGroups = onSnapshot(collection(db, 'productions', productionId, 'scenicCueGroups'), snap => {
    scenicCueGroups = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    if (getActiveTrackingType() === 'scenic' && !_editingPieceId) {
      const el = document.getElementById('props-content');
      if (el) renderScenicContent(el);
    }
  });
  state.unsubscribers.push(
    () => { if (_unsubPieces) { _unsubPieces(); _unsubPieces = null; } },
    () => { if (_unsubGroups) { _unsubGroups(); _unsubGroups = null; } }
  );
}

export function setScenicInnerTab(tab) { activeInnerTab = tab; }
export function getScenicInnerTab() { return activeInnerTab; }

export function renderScenicContent(container) {
  if (!container) return;
  const owner = isOwner();
  const tabs = owner ? ['manage', 'view'] : ['view'];
  let html = '<div class="props-subtabs" style="display:flex;border-bottom:1px solid var(--bg-border);background:var(--bg-base);flex-shrink:0;">';
  tabs.forEach(t => {
    const label = t === 'manage' ? 'Manage Scenic' : 'View Show';
    html += '<button class="props-subtab scenic-inner-tab' + (activeInnerTab === t ? ' props-subtab--active' : '') + '" data-tab="' + t + '">' + label + '</button>';
  });
  html += '</div><div id="scenic-inner-content" style="flex:1;overflow-y:auto;"></div>';
  container.innerHTML = html;
  container.querySelectorAll('.scenic-inner-tab').forEach(btn => {
    btn.addEventListener('click', () => { activeInnerTab = btn.dataset.tab; renderScenicContent(container); });
  });
  const inner = container.querySelector('#scenic-inner-content');
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
  // Piece list
  const rows = scenicPieces.map(p => {
    const cueCount = (p.cues || []).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--track-scenic);font-weight:600;flex:1;">' + escapeHtml(p.name || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + cueCount + ' cue' + (cueCount !== 1 ? 's' : '') + '</span>' +
      '<button class="settings-btn scenic-edit-btn" data-id="' + escapeHtml(p.id) + '">Edit Cues</button>' +
      '<button class="settings-btn settings-btn--danger scenic-del-btn" data-id="' + escapeHtml(p.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:16px 0;">No scenic pieces yet.</div>';

  // Cue group list
  const groupRows = scenicCueGroups.map(g => {
    const memberCount = (g.memberCues || []).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--gold);font-weight:600;flex:1;">' + escapeHtml(g.name || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">pg ' + (g.startPage || '?') + '–' + (g.endPage || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + memberCount + ' piece' + (memberCount !== 1 ? 's' : '') + '</span>' +
      '<button class="settings-btn settings-btn--danger group-del-btn" data-id="' + escapeHtml(g.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:8px 0;">No cue groups yet.</div>';

  // Cue editing for a piece
  let cueEditHtml = '';
  if (_editingPieceId) {
    const piece = scenicPieces.find(p => p.id === _editingPieceId);
    if (piece) {
      const cueRowsHtml = _pieceCueRows.length === 0
        ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No cues. Piece stays in starting location.</div>'
        : _pieceCueRows.map((c, i) => '<div class="cue-row" data-idx="' + i + '">' +
            '<span class="cue-num">#' + (i + 1) + '</span>' +
            '<label style="font-size:11px;color:var(--text-muted);">Enter pg</label><input class="form-input sc-enter" type="number" min="1" value="' + (c.enterPage || '') + '" style="width:60px;" />' +
            '<span class="arrow">→</span>' +
            '<label style="font-size:11px;color:var(--text-muted);">Exit pg</label><input class="form-input sc-exit" type="number" min="1" value="' + (c.exitPage || '') + '" style="width:60px;" />' +
            '<label style="font-size:11px;color:var(--text-muted);">From</label><select class="form-select sc-enter-loc">' + _locOpts(c.enterLocation) + '</select>' +
            '<label style="font-size:11px;color:var(--text-muted);">To</label><select class="form-select sc-exit-loc">' + _locOpts(c.exitLocation) + '</select>' +
            '<button class="remove-cue-btn" data-idx="' + i + '" title="Remove">×</button></div>').join('');
      cueEditHtml = '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
        '<h4 style="color:var(--track-scenic);font-size:14px;margin-bottom:12px;">Cues for ' + escapeHtml(piece.name) + '</h4>' +
        '<div class="cue-rows">' + cueRowsHtml + '</div>' +
        '<button class="add-cue-btn" id="scenic-add-cue-btn">+ Add Cue</button>' +
        '<div style="display:flex;gap:8px;margin-top:12px;"><button class="modal-btn-primary" id="scenic-save-cues-btn">Save Cues</button>' +
        '<button class="modal-btn-cancel" id="scenic-cancel-edit-btn">Cancel</button></div></div>';
    }
  }

  el.innerHTML = '<div style="padding:24px;">' +
    '<h3 style="font-size:16px;color:var(--track-scenic);margin-bottom:16px;">Scenic Pieces</h3>' +
    cueEditHtml +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<input class="form-input" id="scenic-name-input" placeholder="Piece name" maxlength="100" style="flex:1;" />' +
    '<input class="form-input" id="scenic-weight-input" type="number" placeholder="Weight (lbs)" style="width:100px;" />' +
    '<button class="modal-btn-primary" id="scenic-add-btn">+ Add Piece</button></div></div>' +
    '<div id="scenic-list">' + rows + '</div>' +
    '<h3 style="font-size:16px;color:var(--gold);margin:24px 0 16px;">Cue Groups</h3>' +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<input class="form-input" id="group-name-input" placeholder="Group name (e.g. Act 2 Scene Change)" maxlength="100" style="flex:1;" />' +
    '<input class="form-input" id="group-start-input" type="number" min="1" placeholder="Start pg" style="width:80px;" />' +
    '<input class="form-input" id="group-end-input" type="number" min="1" placeholder="End pg" style="width:80px;" />' +
    '<button class="modal-btn-primary" id="group-add-btn">+ Add Group</button></div></div>' +
    '<div id="scenic-groups">' + groupRows + '</div></div>';

  // Wire add piece
  el.querySelector('#scenic-add-btn')?.addEventListener('click', async () => {
    const name = sanitizeName(el.querySelector('#scenic-name-input')?.value);
    if (!name) { toast('Name required.', 'error'); return; }
    const weight = parseInt(el.querySelector('#scenic-weight-input')?.value) || null;
    try {
      await addDoc(collection(db, 'productions', state.activeProduction.id, 'scenicPieces'), {
        name, weight, trackingType: 'scenic', start: 'backstage-left', cues: [], moveMethod: '', notes: '', createdAt: serverTimestamp(),
      });
      toast('Scenic piece added!', 'success');
    } catch (e) { toast('Failed.', 'error'); }
  });

  // Wire add cue group
  el.querySelector('#group-add-btn')?.addEventListener('click', async () => {
    const name = sanitizeName(el.querySelector('#group-name-input')?.value);
    const startPage = parseInt(el.querySelector('#group-start-input')?.value) || 0;
    const endPage = parseInt(el.querySelector('#group-end-input')?.value) || 0;
    if (!name) { toast('Group name required.', 'error'); return; }
    if (!startPage || !endPage) { toast('Start and end pages required.', 'error'); return; }
    try {
      await addDoc(collection(db, 'productions', state.activeProduction.id, 'scenicCueGroups'), {
        name, startPage, endPage, description: '', crewLeadCastId: '', sortOrder: scenicCueGroups.length + 1,
        memberCues: [], createdAt: serverTimestamp(),
      });
      toast('Cue group added!', 'success');
    } catch (e) { toast('Failed.', 'error'); }
  });

  // Wire deletes
  el.querySelectorAll('.scenic-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this scenic piece?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'scenicPieces', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));
  el.querySelectorAll('.group-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this cue group?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'scenicCueGroups', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));

  // Wire cue editing
  el.querySelectorAll('.scenic-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const piece = scenicPieces.find(p => p.id === btn.dataset.id);
    if (!piece) return;
    _editingPieceId = btn.dataset.id;
    _pieceCueRows = (piece.cues || []).map(c => ({ ...c }));
    renderScenicContent(document.getElementById('props-content'));
  }));
  el.querySelector('#scenic-add-cue-btn')?.addEventListener('click', () => {
    _syncPieceCueRows(el); _pieceCueRows.push({ enterPage: '', exitPage: '', enterLocation: 'backstage-left', exitLocation: 'backstage-right' });
    renderScenicContent(document.getElementById('props-content'));
  });
  el.querySelectorAll('.remove-cue-btn').forEach(btn => btn.addEventListener('click', () => {
    _syncPieceCueRows(el); _pieceCueRows.splice(parseInt(btn.dataset.idx), 1);
    renderScenicContent(document.getElementById('props-content'));
  }));
  el.querySelector('#scenic-save-cues-btn')?.addEventListener('click', async () => {
    _syncPieceCueRows(el);
    const cues = _pieceCueRows.map(c => ({
      enterPage: parseInt(c.enterPage) || 0, exitPage: parseInt(c.exitPage) || 0,
      enterLocation: c.enterLocation || 'backstage-left', exitLocation: c.exitLocation || 'backstage-right',
    }));
    for (let i = 0; i < cues.length; i++) {
      if (!cues[i].enterPage || !cues[i].exitPage) { toast('Cue #' + (i + 1) + ': pages required.', 'error'); return; }
    }
    try {
      await updateDoc(doc(db, 'productions', state.activeProduction.id, 'scenicPieces', _editingPieceId), { cues });
      toast('Cues saved!', 'success'); _editingPieceId = null; _pieceCueRows = [];
    } catch (e) { toast('Failed.', 'error'); }
  });
  el.querySelector('#scenic-cancel-edit-btn')?.addEventListener('click', () => {
    _editingPieceId = null; _pieceCueRows = [];
    renderScenicContent(document.getElementById('props-content'));
  });
}

function _syncPieceCueRows(el) {
  el.querySelectorAll('.cue-row').forEach((row, i) => {
    if (_pieceCueRows[i]) {
      _pieceCueRows[i].enterPage = row.querySelector('.sc-enter')?.value || '';
      _pieceCueRows[i].exitPage = row.querySelector('.sc-exit')?.value || '';
      _pieceCueRows[i].enterLocation = row.querySelector('.sc-enter-loc')?.value || '';
      _pieceCueRows[i].exitLocation = row.querySelector('.sc-exit-loc')?.value || '';
    }
  });
}

function _renderView(el) {
  if (!el) return;
  const page = state.runSession?.currentPage || 1;
  const warnPgs = state.runSession?.timerWarnPages || 5;
  const slPieces = [], onPieces = [], srPieces = [];
  scenicPieces.forEach(p => {
    const r = getItemStatus(p, page, { stateModel: 'two-state' });
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPgs && (r.upcomingEnter - page) > 0;
    const item = { piece: p, ...r, warn };
    if (r.status === 'ON') onPieces.push(item);
    else if ((r.location || '').includes('right')) srPieces.push(item);
    else slPieces.push(item);
  });
  const upcomingGroups = scenicCueGroups.filter(g => g.startPage && g.startPage >= page - warnPgs && g.startPage <= page + warnPgs * 2);
  const pill = (item) => '<div style="padding:4px 8px;background:var(--bg-card);border-radius:5px;margin-bottom:3px;font-size:12px;color:var(--text-primary);' + (item.warn ? 'border-left:3px solid var(--state-hold);' : '') + '">' + escapeHtml(item.piece.name) + (item.warn ? ' <span style="color:var(--state-hold);font-size:10px;">(pg ' + item.upcomingEnter + ')</span>' : '') + '</div>';
  const groupHtml = upcomingGroups.length > 0 ? upcomingGroups.map(g => {
    const active = page >= (g.startPage || 0) && page <= (g.endPage || 0);
    return '<div style="padding:8px;background:' + (active ? 'rgba(212,175,55,0.1)' : 'var(--bg-card)') + ';border-radius:6px;margin-bottom:6px;border-left:3px solid ' + (active ? 'var(--gold)' : 'var(--bg-border)') + ';">' +
      '<div style="font-size:13px;font-weight:600;color:' + (active ? 'var(--gold)' : 'var(--text-primary)') + ';">' + escapeHtml(g.name) + '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);">pg ' + (g.startPage || '?') + '–' + (g.endPage || '?') + ' · ' + ((g.memberCues || []).length) + ' moves</div></div>';
  }).join('') : '<div style="color:var(--text-muted);font-size:12px;">No upcoming scene changes.</div>';

  el.innerHTML = '<div style="padding:24px;">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">' +
    '<div><h4 style="font-size:11px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">BSL (' + slPieces.length + ')</h4>' + (slPieces.map(pill).join('') || '—') + '</div>' +
    '<div><h4 style="font-size:11px;text-transform:uppercase;color:var(--state-on);margin-bottom:8px;">On Stage (' + onPieces.length + ')</h4>' + (onPieces.map(pill).join('') || '—') + '</div>' +
    '<div><h4 style="font-size:11px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">BSR (' + srPieces.length + ')</h4>' + (srPieces.map(pill).join('') || '—') + '</div></div>' +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;">Upcoming Scene Changes</h4>' + groupHtml + '</div>';
}
