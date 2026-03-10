#!/usr/bin/env node
// cue-p3456-tracking.mjs — Phases 3+4+5+6: Full Tracking System
// Creates actors, scenic, costumes modules + stage widget.
// Wires tracking-tab.js to real modules.
// Replaces Runshow.js stage columns with tabbed tracking widget.
//
// Usage: node cue-p3456-tracking.mjs          (dry run)
//        node cue-p3456-tracking.mjs --apply   (apply changes)

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

function createFile(file, content, label) {
  if (fs.existsSync(file) && !FORCE) {
    console.log(`  [SKIP] ${label} — file exists`);
    return;
  }
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) { if (!DRY) fs.mkdirSync(dir, { recursive: true }); }
  if (!DRY) fs.writeFileSync(file, content, 'utf8');
  console.log(`  [✓] ${label}`);
  patchCount++;
}

console.log(`\nCUE P3456: Full Tracking System ${DRY ? '(DRY RUN)' : '(APPLYING)'}\n`);

const INDEX_PATH = 'index.html';
const RUNSHOW_PATH = 'src/runshow/Runshow.js';
const TRACKING_TAB_PATH = 'src/tracking/tracking-tab.js';


// ═══════════════════════════════════════════════════════════
// PHASE 3: Create src/tracking/actors.js
// ═══════════════════════════════════════════════════════════
createFile('src/tracking/actors.js', `/**
 * actors.js — Actor Tracking Module (3-state: Off → Hold → On)
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import { getCastMembers } from '../cast/cast.js';
import { getItemStatus, computeBadgeCounts } from './core.js';
import { getProductionLocations, buildLocationDropdown } from './locations.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

let actorCues = [];
let _unsub = null;
let activeInnerTab = 'manage';

export function getActorCues() { return actorCues; }

export function subscribeToActorCues(productionId) {
  if (_unsub) { _unsub(); _unsub = null; }
  _unsub = onSnapshot(collection(db, 'productions', productionId, 'actorCues'), snap => {
    actorCues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
  state.unsubscribers.push(() => { if (_unsub) { _unsub(); _unsub = null; } });
}

export function setActorInnerTab(tab) { activeInnerTab = tab; }
export function getActorInnerTab() { return activeInnerTab; }

export function renderActorsContent(container) {
  if (!container) return;
  switch (activeInnerTab) {
    case 'manage': _renderManage(container); break;
    case 'view': _renderView(container); break;
    default: _renderView(container);
  }
}

function _renderManage(el) {
  if (!isOwner()) { activeInnerTab = 'view'; _renderView(el); return; }
  const cast = getCastMembers();
  const rows = actorCues.map(a => {
    const cueCount = (a.cues || []).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--track-actor);font-weight:600;flex:1;">' + escapeHtml(a.characterName || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + cueCount + ' cue' + (cueCount !== 1 ? 's' : '') + '</span>' +
      '<button class="settings-btn actor-edit-btn" data-id="' + escapeHtml(a.id) + '">Edit</button>' +
      '<button class="settings-btn settings-btn--danger actor-del-btn" data-id="' + escapeHtml(a.id) + '">Delete</button>' +
      '</div>';
  }).join('') || '<div style="color:var(--text-muted);padding:16px 0;">No actors tracked yet.</div>';

  const castOptions = cast.map(m => {
    const chars = m.characters?.length > 0 ? m.characters : [m.name];
    return chars.map(ch => '<option value="' + escapeHtml(m.id + '::' + ch) + '">' + escapeHtml(ch) + ' (' + escapeHtml(m.name) + ')</option>').join('');
  }).join('');

  el.innerHTML = '<div style="padding:24px;">' +
    '<h3 style="font-size:16px;color:var(--track-actor);margin-bottom:16px;">Manage Actors</h3>' +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:20px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
    '<select class="form-select" id="actor-char-select"><option value="">Select character…</option>' + castOptions + '</select>' +
    '<button class="modal-btn-primary" id="actor-add-btn">+ Add Actor</button>' +
    '</div></div>' +
    '<div id="actor-list">' + rows + '</div></div>';

  el.querySelector('#actor-add-btn')?.addEventListener('click', async () => {
    const val = el.querySelector('#actor-char-select')?.value;
    if (!val) { toast('Select a character.', 'error'); return; }
    const [castId, charName] = val.split('::');
    const member = cast.find(m => m.id === castId);
    const pid = state.activeProduction.id;
    try {
      await addDoc(collection(db, 'productions', pid, 'actorCues'), {
        characterName: charName, castId, actorName: member?.name || '', color: member?.color || '#5B9BD4',
        trackingType: 'actor', cues: [], defaultHoldLocation: 'backstage-left', notes: '', createdAt: serverTimestamp(),
      });
      toast('Actor added!', 'success');
    } catch (e) { toast('Failed to add actor.', 'error'); }
  });
  el.querySelectorAll('.actor-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirmDialog('Delete this actor tracking?')) return;
      try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'actorCues', btn.dataset.id)); toast('Deleted.', 'success'); }
      catch (e) { toast('Failed.', 'error'); }
    });
  });
}

function _renderView(el) {
  const page = _currentPage();
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
    '<div><h4 style="font-size:11px;text-transform:uppercase;color:var(--state-on);margin-bottom:8px;">On Stage (' + onActors.length + ')</h4>' + (onActors.map(i => pill(i, 'var(--state-on)')).join('') || '<div style="color:var(--text-muted);font-size:12px;">—</div>') + '</div>' +
    '</div></div>';
}

function _currentPage() {
  return state.runSession?.currentPage || 1;
}
`, 'Create src/tracking/actors.js');


// ═══════════════════════════════════════════════════════════
// PHASE 4: Create src/tracking/scenic.js
// ═══════════════════════════════════════════════════════════
createFile('src/tracking/scenic.js', `/**
 * scenic.js — Scenic Element Tracking with Cue Group Bundling
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import { getItemStatus, computeBadgeCounts } from './core.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

let scenicPieces = [];
let scenicCueGroups = [];
let _unsubPieces = null;
let _unsubGroups = null;
let activeInnerTab = 'manage';

export function getScenicPieces() { return scenicPieces; }
export function getScenicCueGroups() { return scenicCueGroups; }

export function subscribeToScenic(productionId) {
  if (_unsubPieces) { _unsubPieces(); _unsubPieces = null; }
  if (_unsubGroups) { _unsubGroups(); _unsubGroups = null; }
  _unsubPieces = onSnapshot(collection(db, 'productions', productionId, 'scenicPieces'), snap => {
    scenicPieces = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
  _unsubGroups = onSnapshot(collection(db, 'productions', productionId, 'scenicCueGroups'), snap => {
    scenicCueGroups = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
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
  switch (activeInnerTab) {
    case 'manage': _renderManage(container); break;
    case 'view': _renderView(container); break;
    default: _renderView(container);
  }
}

function _renderManage(el) {
  if (!isOwner()) { activeInnerTab = 'view'; _renderView(el); return; }
  const rows = scenicPieces.map(p => {
    const cueCount = (p.cues || []).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--track-scenic);font-weight:600;flex:1;">' + escapeHtml(p.name || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + (p.weight ? p.weight + ' lbs' : '') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + cueCount + ' cue' + (cueCount !== 1 ? 's' : '') + '</span>' +
      '<button class="settings-btn scenic-del-btn" data-id="' + escapeHtml(p.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:16px 0;">No scenic pieces yet.</div>';

  const groupRows = scenicCueGroups.map(g => {
    const memberCount = (g.memberCues || []).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--gold);font-weight:600;flex:1;">' + escapeHtml(g.name || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">pg ' + (g.startPage || '?') + '–' + (g.endPage || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + memberCount + ' piece' + (memberCount !== 1 ? 's' : '') + '</span>' +
      '<button class="settings-btn group-del-btn" data-id="' + escapeHtml(g.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:8px 0;">No cue groups yet.</div>';

  el.innerHTML = '<div style="padding:24px;">' +
    '<h3 style="font-size:16px;color:var(--track-scenic);margin-bottom:16px;">Scenic Pieces</h3>' +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
    '<input class="form-input" id="scenic-name-input" placeholder="Piece name" maxlength="100" style="flex:1;" />' +
    '<input class="form-input" id="scenic-weight-input" type="number" placeholder="Weight (lbs)" style="width:100px;" />' +
    '<button class="modal-btn-primary" id="scenic-add-btn">+ Add Piece</button></div></div>' +
    '<div id="scenic-list">' + rows + '</div>' +
    '<h3 style="font-size:16px;color:var(--gold);margin:24px 0 16px;">Cue Groups</h3>' +
    '<div id="scenic-groups">' + groupRows + '</div></div>';

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
  el.querySelectorAll('.scenic-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this scenic piece?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'scenicPieces', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));
  el.querySelectorAll('.group-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this cue group?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'scenicCueGroups', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));
}

function _renderView(el) {
  const page = state.runSession?.currentPage || 1;
  const warnPgs = state.runSession?.timerWarnPages || 5;

  // Pieces by location
  const slPieces = [], onPieces = [], srPieces = [];
  scenicPieces.forEach(p => {
    const r = getItemStatus(p, page, { stateModel: 'two-state' });
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPgs && (r.upcomingEnter - page) > 0;
    const item = { piece: p, ...r, warn };
    if (r.status === 'ON') onPieces.push(item);
    else if ((r.location || '').includes('right')) srPieces.push(item);
    else slPieces.push(item);
  });

  // Upcoming cue groups
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
`, 'Create src/tracking/scenic.js');


// ═══════════════════════════════════════════════════════════
// PHASE 5: Create src/tracking/costumes.js
// ═══════════════════════════════════════════════════════════
createFile('src/tracking/costumes.js', `/**
 * costumes.js — Costume Tracking with Quick-Change Alerts
 */
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import { getCastMembers } from '../cast/cast.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';

let costumes = [];
let _unsub = null;
let activeInnerTab = 'manage';

export function getCostumes() { return costumes; }

export function subscribeToCostumes(productionId) {
  if (_unsub) { _unsub(); _unsub = null; }
  _unsub = onSnapshot(collection(db, 'productions', productionId, 'costumes'), snap => {
    costumes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
  state.unsubscribers.push(() => { if (_unsub) { _unsub(); _unsub = null; } });
}

export function setCostumeInnerTab(tab) { activeInnerTab = tab; }
export function getCostumeInnerTab() { return activeInnerTab; }

export function renderCostumesContent(container) {
  if (!container) return;
  switch (activeInnerTab) {
    case 'manage': _renderManage(container); break;
    case 'view': _renderView(container); break;
    default: _renderView(container);
  }
}

function _renderManage(el) {
  if (!isOwner()) { activeInnerTab = 'view'; _renderView(el); return; }
  const cast = getCastMembers();
  const rows = costumes.map(c => {
    const qcCount = (c.cues || []).filter(q => q.isQuickChange).length;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-border);">' +
      '<span style="color:var(--track-costume);font-weight:600;flex:1;">' + escapeHtml(c.name || '?') + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + escapeHtml(c.characterName || '') + '</span>' +
      (qcCount > 0 ? '<span style="color:var(--qc-alert);font-size:11px;">⚡' + qcCount + ' QC</span>' : '') +
      '<button class="settings-btn costume-del-btn" data-id="' + escapeHtml(c.id) + '">Delete</button></div>';
  }).join('') || '<div style="color:var(--text-muted);padding:16px 0;">No costumes tracked yet.</div>';

  const castOptions = cast.map(m => {
    const chars = m.characters?.length > 0 ? m.characters : [m.name];
    return chars.map(ch => '<option value="' + escapeHtml(m.id + '::' + ch) + '">' + escapeHtml(ch) + '</option>').join('');
  }).join('');

  el.innerHTML = '<div style="padding:24px;">' +
    '<h3 style="font-size:16px;color:var(--track-costume);margin-bottom:16px;">Manage Costumes</h3>' +
    '<div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
    '<input class="form-input" id="costume-name-input" placeholder="Costume name" maxlength="100" style="flex:1;" />' +
    '<select class="form-select" id="costume-char-select"><option value="">Character…</option>' + castOptions + '</select>' +
    '<button class="modal-btn-primary" id="costume-add-btn">+ Add Costume</button></div></div>' +
    '<div id="costume-list">' + rows + '</div></div>';

  el.querySelector('#costume-add-btn')?.addEventListener('click', async () => {
    const name = sanitizeName(el.querySelector('#costume-name-input')?.value);
    if (!name) { toast('Name required.', 'error'); return; }
    const charVal = el.querySelector('#costume-char-select')?.value || '';
    const [castId, charName] = charVal ? charVal.split('::') : ['', ''];
    try {
      await addDoc(collection(db, 'productions', state.activeProduction.id, 'costumes'), {
        name, characterName: charName || '', castId: castId || '', trackingType: 'costume',
        description: '', photoUrl: '', presetLocation: 'backstage-left',
        cues: [], createdAt: serverTimestamp(),
      });
      toast('Costume added!', 'success');
    } catch (e) { toast('Failed.', 'error'); }
  });
  el.querySelectorAll('.costume-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirmDialog('Delete this costume?')) return;
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'costumes', btn.dataset.id)); toast('Deleted.', 'success'); } catch (e) { toast('Failed.', 'error'); }
  }));
}

function _renderView(el) {
  const page = state.runSession?.currentPage || 1;
  const warnPgs = state.runSession?.timerWarnPages || 5;

  // Currently wearing
  const wearing = [];
  // Upcoming changes
  const upcoming = [];
  // Quick changes
  const quickChanges = [];

  costumes.forEach(c => {
    const cues = c.cues || [];
    let currentCostume = null;
    for (const cue of cues) {
      if (page >= (cue.startPage || 0) && page <= (cue.endPage || 9999)) { currentCostume = cue; break; }
    }
    if (currentCostume) wearing.push({ costume: c, cue: currentCostume });

    // Find next change
    for (const cue of cues) {
      if ((cue.startPage || 0) > page && (cue.startPage - page) <= warnPgs * 2) {
        upcoming.push({ costume: c, cue, pagesUntil: cue.startPage - page });
        if (cue.isQuickChange) quickChanges.push({ costume: c, cue, pagesUntil: cue.startPage - page });
        break;
      }
    }
  });

  const qcHtml = quickChanges.length > 0 ? quickChanges.map(({ costume: c, cue, pagesUntil }) =>
    '<div style="padding:8px 10px;background:rgba(232,155,62,0.1);border:1px solid var(--qc-alert);border-radius:6px;margin-bottom:6px;' + (pagesUntil <= warnPgs ? 'animation:badge-pulse 1.5s ease-in-out infinite;' : '') + '">' +
    '<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">⚡</span><span style="color:var(--qc-alert);font-weight:600;font-size:13px;">' + escapeHtml(c.characterName || c.name) + '</span>' +
    '<span style="color:var(--text-muted);font-size:11px;margin-left:auto;">in ' + pagesUntil + ' pg' + (pagesUntil !== 1 ? 's' : '') + '</span></div>' +
    (cue.quickChangeDetails?.dresserName ? '<div style="color:var(--text-secondary);font-size:11px;margin-top:4px;">Dresser: ' + escapeHtml(cue.quickChangeDetails.dresserName) + '</div>' : '') +
    '</div>'
  ).join('') : '<div style="color:var(--text-muted);font-size:12px;">No upcoming quick changes.</div>';

  el.innerHTML = '<div style="padding:24px;">' +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--qc-alert);margin-bottom:8px;">Quick Change Alerts</h4>' + qcHtml +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);margin:20px 0 8px;">Currently Wearing (' + wearing.length + ')</h4>' +
    (wearing.map(({ costume: c }) => '<div style="padding:4px 8px;background:var(--bg-card);border-radius:5px;margin-bottom:3px;font-size:12px;border-left:3px solid var(--track-costume);">' +
      '<span style="color:var(--text-primary);">' + escapeHtml(c.characterName || '') + '</span> — ' +
      '<span style="color:var(--text-secondary);">' + escapeHtml(c.name) + '</span></div>').join('') || '<div style="color:var(--text-muted);font-size:12px;">—</div>') +
    '<h4 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);margin:20px 0 8px;">Upcoming Changes (' + upcoming.length + ')</h4>' +
    (upcoming.map(({ costume: c, pagesUntil }) => '<div style="padding:4px 8px;background:var(--bg-card);border-radius:5px;margin-bottom:3px;font-size:12px;">' +
      escapeHtml(c.characterName || '') + ' → ' + escapeHtml(c.name) + ' <span style="color:var(--text-muted);">(' + pagesUntil + ' pg)</span></div>').join('') || '<div style="color:var(--text-muted);font-size:12px;">—</div>') +
    '</div>';
}
`, 'Create src/tracking/costumes.js');


// ═══════════════════════════════════════════════════════════
// PHASE 6: Create src/tracking/stage-widget.js
// ═══════════════════════════════════════════════════════════
createFile('src/tracking/stage-widget.js', `/**
 * stage-widget.js — Tabbed Tracking Widget for Run Show Right Panel
 *
 * Replaces the old 3-column SL/ON/SR stage columns with a tabbed widget
 * showing Props | Actors | Scenic | Costumes with alert badges.
 */
import { escapeHtml } from '../shared/ui.js';
import { state } from '../shared/state.js';
import { getItemStatus, computeBadgeCounts } from './core.js';
import { getPropStatus, getProps } from '../props/props.js';
import { getActorCues } from './actors.js';
import { getScenicPieces, getScenicCueGroups } from './scenic.js';
import { getCostumes } from './costumes.js';
import { getProductionLocations } from './locations.js';

let _activeWidgetTab = 'props';

/**
 * Render the full tracking widget into a container.
 * Called from renderRunShowControls and on each timer tick for the active tab.
 */
export function renderTrackingWidget(container, page, warnPages) {
  if (!container) return;
  const tabs = ['props', 'actors', 'scenic', 'costumes'];
  const labels = { props: 'Props', actors: 'Actors', scenic: 'Scenic', costumes: 'Costumes' };
  const colors = { props: 'var(--track-prop)', actors: 'var(--track-actor)', scenic: 'var(--track-scenic)', costumes: 'var(--track-costume)' };

  // Compute badge counts
  const badges = {};
  badges.props = computeBadgeCounts('props', getProps(), page, warnPages);
  badges.actors = computeBadgeCounts('actors', getActorCues(), page, warnPages);
  badges.scenic = computeBadgeCounts('scenic', getScenicPieces(), page, warnPages);
  badges.costumes = computeBadgeCounts('costumes', getCostumes(), page, warnPages);

  // Tab bar
  let tabBarHtml = '<div class="sw-tab-bar">';
  tabs.forEach(t => {
    const active = t === _activeWidgetTab;
    const b = badges[t];
    const badgeHtml = b.count > 0
      ? '<span class="sw-badge' + (b.alert ? ' sw-badge--alert' : '') + '">' + b.count + '</span>'
      : '';
    tabBarHtml += '<button class="sw-tab' + (active ? ' sw-tab--active' : '') + '" data-sw-tab="' + t + '" style="' + (active ? 'color:' + colors[t] + ';border-bottom-color:' + colors[t] + ';' : '') + '">' + labels[t] + badgeHtml + '</button>';
  });
  tabBarHtml += '</div>';

  // Content
  let contentHtml = '<div class="sw-content">';
  switch (_activeWidgetTab) {
    case 'props': contentHtml += _renderPropsView(page, warnPages); break;
    case 'actors': contentHtml += _renderActorsView(page, warnPages); break;
    case 'scenic': contentHtml += _renderScenicView(page, warnPages); break;
    case 'costumes': contentHtml += _renderCostumesView(page, warnPages); break;
  }
  contentHtml += '</div>';

  container.innerHTML = tabBarHtml + contentHtml;

  // Wire tab clicks
  container.querySelectorAll('.sw-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeWidgetTab = btn.dataset.swTab;
      renderTrackingWidget(container, page, warnPages);
    });
  });
}

/** Refresh only badge counts (called on tick for inactive tabs). */
export function refreshWidgetBadges(container, page, warnPages) {
  if (!container) return;
  const badges = {
    props: computeBadgeCounts('props', getProps(), page, warnPages),
    actors: computeBadgeCounts('actors', getActorCues(), page, warnPages),
    scenic: computeBadgeCounts('scenic', getScenicPieces(), page, warnPages),
    costumes: computeBadgeCounts('costumes', getCostumes(), page, warnPages),
  };
  container.querySelectorAll('.sw-tab').forEach(btn => {
    const t = btn.dataset.swTab;
    const b = badges[t];
    let badge = btn.querySelector('.sw-badge');
    if (b.count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'sw-badge'; btn.appendChild(badge); }
      badge.textContent = b.count;
      badge.classList.toggle('sw-badge--alert', b.alert);
    } else if (badge) {
      badge.remove();
    }
  });
}

/** Refresh only the active tab content (called on tick). */
export function refreshWidgetContent(container, page, warnPages) {
  if (!container) return;
  const contentEl = container.querySelector('.sw-content');
  if (!contentEl) return;
  switch (_activeWidgetTab) {
    case 'props': contentEl.innerHTML = _renderPropsView(page, warnPages); break;
    case 'actors': contentEl.innerHTML = _renderActorsView(page, warnPages); break;
    case 'scenic': contentEl.innerHTML = _renderScenicView(page, warnPages); break;
    case 'costumes': contentEl.innerHTML = _renderCostumesView(page, warnPages); break;
  }
}

// ── Props view (replaces old renderStageColumnsHtml) ──
function _renderPropsView(page, warnPages) {
  const props = getProps();
  if (!props.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No props yet.</div>';
  const sl = [], on = [], sr = [];
  props.forEach(p => {
    const r = getPropStatus(p, page);
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPages && (r.upcomingEnter - page) > 0;
    const item = { name: p.name || '?', ...r, warn };
    const loc = (r.location || '').toUpperCase().replace('STAGE LEFT','SL').replace('STAGE RIGHT','SR').replace('ON STAGE','ON').replace('ONSTAGE','ON');
    if (r.status === 'ON') on.push(item);
    else if (loc === 'SR' || loc === 'BACKSTAGE-RIGHT') sr.push(item);
    else sl.push(item);
  });
  const col = (items) => items.length === 0 ? '<div style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;">—</div>'
    : items.map(it => {
      let extra = '';
      if (it.activeCue?.carrierOn) extra += '<div style="font-size:10px;color:var(--text-muted);">↑ ' + escapeHtml(it.activeCue.carrierOn) + '</div>';
      if (it.crossover) extra += '<div style="font-size:10px;color:var(--qc-alert);">⚠ ' + escapeHtml(it.crossover.from) + '→' + escapeHtml(it.crossover.to) + '</div>';
      return '<div class="stage-prop' + (it.warn ? ' stage-prop--warn' : '') + (it.crossover ? ' stage-prop--crossover' : '') + '"><div class="prop-name">' + escapeHtml(it.name) + (it.warn ? ' <span style="color:var(--gold);font-size:10px;">(pg ' + it.upcomingEnter + ')</span>' : '') + '</div>' + extra + '</div>';
    }).join('');
  return '<div class="rs-stage-columns"><div class="stage-col stage-col--sl"><h4>SL</h4>' + col(sl) + '</div><div class="stage-col stage-col--on"><h4>ON</h4>' + col(on) + '</div><div class="stage-col stage-col--sr"><h4>SR</h4>' + col(sr) + '</div></div>';
}

// ── Actors view ──
function _renderActorsView(page, warnPages) {
  const actors = getActorCues();
  if (!actors.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No actors tracked.</div>';
  const off = [], hold = [], on = [];
  actors.forEach(a => {
    const r = getItemStatus(a, page, { stateModel: 'three-state' });
    const warn = r.upcomingHold && (r.upcomingHold - page) <= warnPages && (r.upcomingHold - page) > 0;
    const item = { name: a.characterName || '?', color: a.color || '#5B9BD4', ...r, warn };
    if (r.status === 'ON') on.push(item);
    else if (r.status === 'HOLD') hold.push(item);
    else off.push(item);
  });
  const pill = (it, border) => '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;color:var(--text-primary);border-left:3px solid ' + border + ';">' + escapeHtml(it.name) + (it.warn ? ' <span style="color:var(--state-hold);font-size:9px;">hold pg ' + (it.upcomingHold || '?') + '</span>' : '') + '</div>';
  return '<div class="rs-stage-columns">' +
    '<div class="stage-col stage-col--sl"><h4>Off (' + off.length + ')</h4>' + (off.map(i => pill(i, 'var(--state-off)')).join('') || '—') + '</div>' +
    '<div class="stage-col stage-col--on" style="background:rgba(212,175,55,0.04);"><h4 style="color:var(--state-hold);">Hold (' + hold.length + ')</h4>' + (hold.map(i => pill(i, 'var(--state-hold)')).join('') || '—') + '</div>' +
    '<div class="stage-col stage-col--sr"><h4 style="color:var(--state-on);">On (' + on.length + ')</h4>' + (on.map(i => pill(i, 'var(--state-on)')).join('') || '—') + '</div></div>';
}

// ── Scenic view ──
function _renderScenicView(page, warnPages) {
  const pieces = getScenicPieces();
  const groups = getScenicCueGroups();
  if (!pieces.length && !groups.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No scenic elements.</div>';
  const sl = [], on = [], sr = [];
  pieces.forEach(p => {
    const r = getItemStatus(p, page, { stateModel: 'two-state' });
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPages && (r.upcomingEnter - page) > 0;
    const item = { name: p.name || '?', ...r, warn };
    if (r.status === 'ON') on.push(item);
    else if ((r.location || '').includes('right')) sr.push(item);
    else sl.push(item);
  });
  const pill = it => '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;color:var(--text-primary);' + (it.warn ? 'border-left:3px solid var(--state-hold);' : '') + '">' + escapeHtml(it.name) + '</div>';

  let groupHtml = '';
  const upcoming = groups.filter(g => g.startPage && g.startPage >= page && g.startPage <= page + warnPages * 2);
  if (upcoming.length > 0) {
    groupHtml = '<div style="border-top:1px solid var(--bg-border);margin-top:6px;padding-top:6px;">' +
      upcoming.map(g => '<div style="font-size:10px;color:' + (page >= g.startPage && page <= g.endPage ? 'var(--gold)' : 'var(--text-muted)') + ';">▸ ' + escapeHtml(g.name) + ' pg ' + g.startPage + '</div>').join('') + '</div>';
  }

  return '<div class="rs-stage-columns"><div class="stage-col stage-col--sl"><h4>BSL</h4>' + (sl.map(pill).join('') || '—') + '</div><div class="stage-col stage-col--on"><h4>ON</h4>' + (on.map(pill).join('') || '—') + '</div><div class="stage-col stage-col--sr"><h4>BSR</h4>' + (sr.map(pill).join('') || '—') + '</div></div>' + groupHtml;
}

// ── Costumes view ──
function _renderCostumesView(page, warnPages) {
  const all = getCostumes();
  if (!all.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No costumes tracked.</div>';
  const quickChanges = [];
  const wearing = [];
  all.forEach(c => {
    const cues = c.cues || [];
    for (const cue of cues) {
      if (page >= (cue.startPage || 0) && page <= (cue.endPage || 9999)) { wearing.push(c); break; }
    }
    for (const cue of cues) {
      if ((cue.startPage || 0) > page && (cue.startPage - page) <= warnPages && cue.isQuickChange) {
        quickChanges.push({ costume: c, cue, pagesUntil: cue.startPage - page }); break;
      }
    }
  });
  let html = '';
  if (quickChanges.length > 0) {
    html += quickChanges.map(({ costume: c, pagesUntil }) =>
      '<div style="padding:4px 8px;background:rgba(232,155,62,0.12);border-left:3px solid var(--qc-alert);border-radius:4px;margin-bottom:4px;font-size:11px;' + (pagesUntil <= 2 ? 'animation:badge-pulse 1.5s ease-in-out infinite;' : '') + '">⚡ ' + escapeHtml(c.characterName || c.name) + ' <span style="color:var(--text-muted);">(' + pagesUntil + ' pg)</span></div>'
    ).join('');
    html += '<div style="border-top:1px solid var(--bg-border);margin:6px 0;"></div>';
  }
  html += wearing.map(c => '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;border-left:3px solid var(--track-costume);">' + escapeHtml(c.characterName || '') + ' — ' + escapeHtml(c.name) + '</div>').join('') || '<div style="color:var(--text-muted);font-size:11px;">No active costumes.</div>';
  return html;
}
`, 'Create src/tracking/stage-widget.js');


// ═══════════════════════════════════════════════════════════
// Update tracking-tab.js: Wire real modules instead of placeholders
// ═══════════════════════════════════════════════════════════
applyPatch(TRACKING_TAB_PATH,
  `import { onPropsTabActivated } from '../props/props.js';`,
  `import { onPropsTabActivated } from '../props/props.js';
import { subscribeToActorCues, renderActorsContent, setActorInnerTab, getActorInnerTab } from './actors.js';
import { subscribeToScenic, renderScenicContent, setScenicInnerTab, getScenicInnerTab } from './scenic.js';
import { subscribeToCostumes, renderCostumesContent, setCostumeInnerTab, getCostumeInnerTab } from './costumes.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';`,
  'tracking-tab.js: Add actors/scenic/costumes imports');

// Replace the placeholder case block with real wiring
applyPatch(TRACKING_TAB_PATH,
  `    case 'actors':
    case 'scenic':
    case 'costumes':
      // Future tracking types — show placeholder
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) {
        propsContent.style.display = '';
        propsContent.innerHTML =
          '<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:14px;">' +
          '<div style="font-size:32px;margin-bottom:12px;">' +
          (type === 'actors' ? '🎭' : type === 'scenic' ? '🏗️' : '👗') +
          '</div>' +
          '<div>' + type.charAt(0).toUpperCase() + type.slice(1) + ' tracking coming soon.</div>' +
          '</div>';
      }
      break;`,
  `    case 'actors':
      _ensureTrackingSubs();
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) { propsContent.style.display = ''; renderActorsContent(propsContent); }
      break;
    case 'scenic':
      _ensureTrackingSubs();
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) { propsContent.style.display = ''; renderScenicContent(propsContent); }
      break;
    case 'costumes':
      _ensureTrackingSubs();
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) { propsContent.style.display = ''; renderCostumesContent(propsContent); }
      break;`,
  'tracking-tab.js: Replace placeholders with real module wiring');

// Add subscription bootstrap function
applyPatch(TRACKING_TAB_PATH,
  `export function getActiveTrackingType() {
  return activeTrackingType;
}`,
  `export function getActiveTrackingType() {
  return activeTrackingType;
}

// Ensure Firestore subscriptions are active for all tracking types
let _trackingSubbed = false;
function _ensureTrackingSubs() {
  if (_trackingSubbed) return;
  const pid = state.activeProduction?.id;
  if (!pid) return;
  _trackingSubbed = true;
  subscribeToActorCues(pid);
  subscribeToScenic(pid);
  subscribeToCostumes(pid);
}

// Reset subscription flag on production change (called from cleanup)
export function resetTrackingSubs() { _trackingSubbed = false; }`,
  'tracking-tab.js: Add subscription bootstrap');


// ═══════════════════════════════════════════════════════════
// Runshow.js: Import stage-widget (after P2's cue-margin import)
// ═══════════════════════════════════════════════════════════
applyPatch(RUNSHOW_PATH,
  `import { renderMarginCues, renderCueDetailPanel, renderCueSummaryPanel } from './cue-margin.js';`,
  `import { renderMarginCues, renderCueDetailPanel, renderCueSummaryPanel } from './cue-margin.js';
import { renderTrackingWidget, refreshWidgetBadges, refreshWidgetContent } from '../tracking/stage-widget.js';`,
  'Runshow.js: Import stage-widget');


// ═══════════════════════════════════════════════════════════
// Runshow.js: Replace stageCols in idle mode template
// ═══════════════════════════════════════════════════════════
applyPatch(RUNSHOW_PATH,
  `        <div class="rs-stage-widget">\${stageCols}</div>
        <div class="rs-reports-section" id="rs-reports-section"></div>`,
  `        <div class="rs-tracking-widget"></div>
        <div class="rs-reports-section" id="rs-reports-section"></div>`,
  'Runshow.js: Replace stage-widget div in idle mode');


// ═══════════════════════════════════════════════════════════
// Runshow.js: Replace stageCols in active mode template
// ═══════════════════════════════════════════════════════════
applyPatch(RUNSHOW_PATH,
  `        <div class="rs-stage-widget">\${stageCols}</div>
        <div class="rs-scratchpad-section">`,
  `        <div class="rs-tracking-widget"></div>
        <div class="rs-scratchpad-section">`,
  'Runshow.js: Replace stage-widget div in active mode');


// ═══════════════════════════════════════════════════════════
// Runshow.js: Add widget population after renderRunShowControls if/else
// ═══════════════════════════════════════════════════════════
applyPatch(RUNSHOW_PATH,
  `    // FAB visibility
    const fab = document.getElementById('run-show-fab');
    if (fab) fab.classList.remove('hidden');
  }
}



/* ═══════════════════════════════════════════════════════════
   TIMER TICK`,
  `    // FAB visibility
    const fab = document.getElementById('run-show-fab');
    if (fab) fab.classList.remove('hidden');
  }

  // P6: Populate tracking widget after either branch renders
  const _twContainer = container.querySelector('.rs-tracking-widget');
  if (_twContainer) {
    renderTrackingWidget(_twContainer, rsCurrentScriptPage(), state.runSession?.timerWarnPages || 5);
  }
}



/* ═══════════════════════════════════════════════════════════
   TIMER TICK`,
  'Runshow.js: Add tracking widget population after controls render');


// ═══════════════════════════════════════════════════════════
// Runshow.js: Replace stage column refresh in rsTickTimerDisplay
// ═══════════════════════════════════════════════════════════
applyPatch(RUNSHOW_PATH,
  `  // Update stage columns — always based on the actual visible page
  const stageWidget = document.querySelector('.rs-stage-widget');
  if (stageWidget) stageWidget.innerHTML = renderStageColumnsHtml(rsCurrentScriptPage());`,
  `  // P6: Update tracking widget — refresh active tab content + badges
  const _twEl = document.querySelector('.rs-tracking-widget');
  if (_twEl) {
    refreshWidgetContent(_twEl, rsCurrentScriptPage(), state.runSession?.timerWarnPages || 5);
    refreshWidgetBadges(_twEl, rsCurrentScriptPage(), state.runSession?.timerWarnPages || 5);
  }`,
  'Runshow.js: Replace stage column refresh with tracking widget refresh in tick');


// ═══════════════════════════════════════════════════════════
// index.html: Add stage widget CSS
// ═══════════════════════════════════════════════════════════
applyPatch(INDEX_PATH,
  `    /* Run Show — stage columns widget */`,
  `    /* Run Show — tracking widget (P6) */
    .rs-tracking-widget { border-radius:8px; overflow:hidden; border:1px solid var(--bg-border); }
    .sw-tab-bar { display:flex; height:var(--widget-tab-height); background:var(--bg-raised); }
    .sw-tab {
      flex:1; background:none; border:none; border-bottom:2px solid transparent; color:var(--text-muted);
      font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; cursor:pointer;
      transition:all 0.2s; position:relative; padding:0 4px;
    }
    .sw-tab:hover { color:var(--text-secondary); }
    .sw-tab--active { border-bottom-color:currentColor; }
    .sw-badge {
      display:inline-block; min-width:14px; height:14px; line-height:14px; border-radius:7px;
      font-size:9px; text-align:center; background:var(--text-muted); color:var(--bg-deep);
      margin-left:3px; vertical-align:middle;
    }
    .sw-badge--alert { background:var(--gold); animation:badge-pulse 1.5s ease-in-out infinite; }
    .sw-content { max-height:320px; overflow-y:auto; }

    /* Run Show — stage columns widget */`,
  'index.html: Add tracking widget CSS');


// ═══════════════════════════════════════════════════════════
// DONE
// ═══════════════════════════════════════════════════════════
console.log(`\n✔ ${patchCount} operations ${DRY ? 'would be applied' : 'applied'}.`);

if (!DRY) {
  console.log('\nVerification checklist:');
  console.log('  1. App loads without console errors');
  console.log('  2. Run Show right panel: stage columns replaced by tabbed widget (Props | Actors | Scenic | Costumes)');
  console.log('  3. Props tab in widget shows same SL/ON/SR columns as before with warnings');
  console.log('  4. Actors tab shows Off/Hold/On columns with 3-state tracking');
  console.log('  5. Scenic tab shows BSL/ON/BSR columns + upcoming scene changes');
  console.log('  6. Costumes tab shows quick-change alerts + currently wearing list');
  console.log('  7. Badge counts appear on each widget tab, pulsing gold when alerts are active');
  console.log('  8. During active run, widget refreshes on every tick (1/sec) with correct page');
  console.log('  9. Tracking tab > Actors: Manage shows add/delete, View shows 3-column layout');
  console.log(' 10. Tracking tab > Scenic: Manage shows add piece + cue groups, View shows columns');
  console.log(' 11. Tracking tab > Costumes: Manage shows add costume, View shows quick changes');
  console.log(' 12. All Firestore subscriptions clean up on production change (no ghost listeners)');
  console.log(' 13. Timer engine, session lifecycle, props CRUD completely unaffected');
  console.log(' 14. Existing props View Show + Pre/Post Check tabs work as before');
}
