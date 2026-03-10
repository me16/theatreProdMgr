#!/usr/bin/env node
// cue-fix-issues.mjs — Fix Issues 1-6
// 1. Props location dropdowns use dynamic locations
// 2/4. Actors/scenic/costumes re-render on Firestore changes
// 3. Scenic cue group creation form
// 5. Cue management for actors, scenic, costumes
// 6. Better labels on Edit Script cue form
//
// Usage: node cue-fix-issues.mjs          (dry run)
//        node cue-fix-issues.mjs --apply   (apply changes)

import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
let patchCount = 0;

function applyPatch(file, oldStr, newStr, label) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(newStr) && !FORCE) {
    console.log(`  [SKIP] ${label} — already applied`);
    return content;
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    console.error(`  [FAIL] ${label}`);
    console.error(`    Expected (first 200 chars): ${oldStr.slice(0, 200)}`);
    const nearby = content.slice(Math.max(0, content.length / 2 - 100), content.length / 2 + 100);
    console.error(`    File midpoint sample: ${nearby.slice(0, 200)}`);
    process.exit(1);
  }
  if (content.indexOf(oldStr, idx + 1) !== -1) {
    console.error(`  [FAIL] ${label} — multiple matches found. Use a more specific anchor.`);
    process.exit(1);
  }
  const updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
  if (!DRY) fs.writeFileSync(file, updated, 'utf8');
  console.log(`  [✓] ${label}`);
  patchCount++;
  return updated;
}

function overwriteFile(file, content, label) {
  if (!fs.existsSync(file)) {
    console.error(`  [FAIL] ${label} — file does not exist (expected from prior phase)`);
    process.exit(1);
  }
  if (!DRY) fs.writeFileSync(file, content, 'utf8');
  console.log(`  [✓] ${label}`);
  patchCount++;
}

console.log(`\nCUE Fix: Issues 1-6 ${DRY ? '(DRY RUN)' : '(APPLYING)'}\n`);

const PROPS_PATH = 'src/props/props.js';
const LINENOTES_PATH = 'src/linenotes/linenotes.js';

// ═══════════════════════════════════════════════════════════
// Issue 1: Props — dynamic location dropdowns
// Add import + helper function + replace hardcoded selects
// ═══════════════════════════════════════════════════════════

// 1a. Add locations import to props.js
applyPatch(PROPS_PATH,
  `import { updateRouteParams } from '../shared/router.js';`,
  `import { updateRouteParams } from '../shared/router.js';
import { getProductionLocations } from '../tracking/locations.js';

function _locOptions(selectedVal) {
  const locs = getProductionLocations();
  const legacy = { 'SL': 'backstage-left', 'SR': 'backstage-right', 'ON': 'on-stage' };
  const resolvedSel = legacy[selectedVal] || selectedVal || 'backstage-left';
  return locs.map(l => '<option value="' + l.id + '"' + (l.id === resolvedSel ? ' selected' : '') + '>' + l.shortName + '</option>').join('');
}`,
  'props.js: Add locations import + _locOptions helper');

// 1b. Replace starting location hardcoded select
applyPatch(PROPS_PATH,
  `<select class="form-select" id="prop-start-select">
          <option value="SL" \${(editProp?.start || 'SL') === 'SL' ? 'selected' : ''}>Stage Left</option>
          <option value="SR" \${editProp?.start === 'SR' ? 'selected' : ''}>Stage Right</option>
        </select>`,
  `<select class="form-select" id="prop-start-select">
          \${_locOptions(editProp?.start || 'SL')}
        </select>`,
  'props.js: Dynamic starting location dropdown');

// 1c. Replace cue enter location hardcoded select
applyPatch(PROPS_PATH,
  `<select class="form-select cue-enter-loc" title="Enter from">
          <option value="SL" \${enterLoc === 'SL' ? 'selected' : ''}>SL</option>
          <option value="SR" \${enterLoc === 'SR' ? 'selected' : ''}>SR</option>
        </select>`,
  `<select class="form-select cue-enter-loc" title="Enter from">
          \${_locOptions(enterLoc)}
        </select>`,
  'props.js: Dynamic cue enter location dropdown');

// 1d. Replace cue exit location hardcoded select
applyPatch(PROPS_PATH,
  `<select class="form-select cue-loc">
          <option value="SL" \${c.exitLocation === 'SL' ? 'selected' : ''}>SL</option>
          <option value="SR" \${c.exitLocation === 'SR' ? 'selected' : ''}>SR</option>
        </select>`,
  `<select class="form-select cue-loc">
          \${_locOptions(c.exitLocation || 'SL')}
        </select>`,
  'props.js: Dynamic cue exit location dropdown');


// ═══════════════════════════════════════════════════════════
// Issues 2/4/5: Overwrite actors.js with re-render + cue management
// ═══════════════════════════════════════════════════════════
overwriteFile('src/tracking/actors.js', `/**
 * actors.js — Actor Tracking Module (3-state: Off → Hold → On)
 * Fixed: re-renders on snapshot, includes cue management
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
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
    '<h3 style="font-size:16px;color:var(--track-actor);margin-bottom:16px;">Manage Actors</h3>' +
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
`, 'Overwrite actors.js: re-render on snapshot + cue management');


// ═══════════════════════════════════════════════════════════
// Issues 2/3/5: Overwrite scenic.js with re-render + cue groups + cues
// ═══════════════════════════════════════════════════════════
overwriteFile('src/tracking/scenic.js', `/**
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
`, 'Overwrite scenic.js: re-render + cue group creation + piece cue editing');


// ═══════════════════════════════════════════════════════════
// Issues 2/5: Overwrite costumes.js with re-render + cue management
// ═══════════════════════════════════════════════════════════
overwriteFile('src/tracking/costumes.js', `/**
 * costumes.js — Costume Tracking with Quick-Change Alerts
 * Fixed: re-renders on snapshot, includes cue management
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
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
  html += '</div><div id="costumes-inner-content" style="flex:1;overflow-y:auto;"></div>';
  container.innerHTML = html;
  container.querySelectorAll('.costume-inner-tab').forEach(btn => {
    btn.addEventListener('click', () => { activeInnerTab = btn.dataset.tab; renderCostumesContent(container); });
  });
  const inner = container.querySelector('#costumes-inner-content');
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

  // Cue editing
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

  el.innerHTML = '<div style="padding:24px;">' +
    '<h3 style="font-size:16px;color:var(--track-costume);margin-bottom:16px;">Manage Costumes</h3>' +
    cueEditHtml +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<input class="form-input" id="costume-name-input" placeholder="Costume name" maxlength="100" style="flex:1;" />' +
    '<select class="form-select" id="costume-char-select"><option value="">Character…</option>' + castOptions + '</select>' +
    '<button class="modal-btn-primary" id="costume-add-btn">+ Add Costume</button></div></div>' +
    '<div id="costume-list">' + rows + '</div></div>';

  // Wire add
  el.querySelector('#costume-add-btn')?.addEventListener('click', async () => {
    const name = sanitizeName(el.querySelector('#costume-name-input')?.value);
    if (!name) { toast('Name required.', 'error'); return; }
    const charVal = el.querySelector('#costume-char-select')?.value || '';
    const [castId, charName] = charVal ? charVal.split('::') : ['', ''];
    try {
      await addDoc(collection(db, 'productions', state.activeProduction.id, 'costumes'), {
        name, characterName: charName || '', castId: castId || '', trackingType: 'costume',
        description: '', photoUrl: '', presetLocation: 'backstage-left', cues: [], createdAt: serverTimestamp(),
      });
      toast('Costume added!', 'success');
    } catch (e) { toast('Failed.', 'error'); }
  });
  el.querySelectorAll('.costume-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this costume?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'costumes', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));

  // Wire cue editing
  el.querySelectorAll('.costume-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const costume = costumes.find(c => c.id === btn.dataset.id);
    if (!costume) return;
    _editingCostumeId = btn.dataset.id;
    _costumeCueRows = (costume.cues || []).map(c => ({ ...c }));
    renderCostumesContent(document.getElementById('props-content'));
  }));
  el.querySelector('#costume-add-cue-btn')?.addEventListener('click', () => {
    _syncCostumeCueRows(el); _costumeCueRows.push({ startPage: '', endPage: '', changeLocation: 'backstage-left', isQuickChange: false });
    renderCostumesContent(document.getElementById('props-content'));
  });
  el.querySelectorAll('.remove-cue-btn').forEach(btn => btn.addEventListener('click', () => {
    _syncCostumeCueRows(el); _costumeCueRows.splice(parseInt(btn.dataset.idx), 1);
    renderCostumesContent(document.getElementById('props-content'));
  }));
  el.querySelector('#costume-save-cues-btn')?.addEventListener('click', async () => {
    _syncCostumeCueRows(el);
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
    } catch (e) { toast('Failed.', 'error'); }
  });
  el.querySelector('#costume-cancel-edit-btn')?.addEventListener('click', () => {
    _editingCostumeId = null; _costumeCueRows = [];
    renderCostumesContent(document.getElementById('props-content'));
  });
}

function _syncCostumeCueRows(el) {
  el.querySelectorAll('.cue-row').forEach((row, i) => {
    if (_costumeCueRows[i]) {
      _costumeCueRows[i].startPage = row.querySelector('.co-start')?.value || '';
      _costumeCueRows[i].endPage = row.querySelector('.co-end')?.value || '';
      _costumeCueRows[i].changeLocation = row.querySelector('.co-loc')?.value || '';
      _costumeCueRows[i].isQuickChange = !!row.querySelector('.co-qc')?.checked;
    }
  });
}

function _renderView(el) {
  if (!el) return;
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

  el.innerHTML = '<div style="padding:24px;">' +
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
`, 'Overwrite costumes.js: re-render + cue management');


// ═══════════════════════════════════════════════════════════
// Issue 6: Better labels on Edit Script cue form fields
// ═══════════════════════════════════════════════════════════
applyPatch(LINENOTES_PATH,
  `placeholder="Description (optional)" style="flex:1;min-width:200px;" /><select class="form-select" id="cue-side-select" style="width:80px;"><option value="left">Left</option><option value="right">Right</option></select><input class="form-input" id="cue-y-input" type="number" min="0" max="100" step="1" placeholder="Y %" style="width:60px;" title="Vertical position on page (0-100%)" />`,
  `placeholder="Description (optional)" style="flex:1;min-width:200px;" /><label style="font-size:11px;color:#888;margin-left:4px;">Margin:</label><select class="form-select" id="cue-side-select" style="width:80px;" title="Which margin of the page to show this cue"><option value="left">Left</option><option value="right">Right</option></select><label style="font-size:11px;color:#888;margin-left:4px;">Position:</label><input class="form-input" id="cue-y-input" type="number" min="0" max="100" step="1" placeholder="Y%" style="width:55px;" title="Vertical position on page margin (0%=top, 100%=bottom). Leave empty for auto-placement." />`,
  'linenotes.js: Better labels for cue margin/position fields');


// ═══════════════════════════════════════════════════════════
// DONE
// ═══════════════════════════════════════════════════════════
console.log(`\n✔ ${patchCount} operations ${DRY ? 'would be applied' : 'applied'}.`);

if (!DRY) {
  console.log('\nVerification checklist:');
  console.log('  1. Props manage form: Starting Location, cue Enter/Exit dropdowns show all venue locations (BSL, ON, BSR + custom)');
  console.log('  2. Actors manage: "Edit Cues" button opens inline cue rows with Hold/Enter/Exit pages + location dropdowns');
  console.log('  3. Scenic manage: "Edit Cues" on pieces, "Add Group" form for cue groups with name + page range');
  console.log('  4. Costumes manage: "Edit Cues" with Start/End pages, change location, Quick Change checkbox');
  console.log('  5. Adding items in actors/scenic/costumes tabs immediately shows them (no tab switch needed)');
  console.log('  6. Edit Script cue form: "Margin:" label before Left/Right, "Position:" label before Y% with clearer tooltip');
  console.log('  7. All existing props, Run Show, timer functionality unaffected');
}
