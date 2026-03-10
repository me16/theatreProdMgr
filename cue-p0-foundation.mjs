#!/usr/bin/env node
// cue-p0-foundation.mjs — Phase 0: Foundation
// Establishes shared tracking core, venue location system, Firestore rules, Settings UI, and CSS vars.
//
// Usage: node cue-p0-foundation.mjs          (dry run)
//        node cue-p0-foundation.mjs --apply   (apply changes)

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
  // Verify unique match
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

console.log(`\nCUE P0: Foundation ${DRY ? '(DRY RUN)' : '(APPLYING)'}\n`);

// ─────────────────────────────────────────────────────────────
// 1. Create src/tracking/core.js
// ─────────────────────────────────────────────────────────────
createFile('src/tracking/core.js', `/**
 * core.js — Shared Tracking Status Computation
 *
 * Exports a generalized item status function used by all four tracking types
 * (props, actors, scenic, costumes). Backward-compatible with the existing
 * getPropStatus() behavior when stateModel === 'two-state'.
 */

/**
 * Resolve a location value (possibly a legacy alias) to a canonical location object.
 *
 * @param {string} locationValue  — legacy code ('SL','SR','ON') or canonical ID
 * @param {Array}  productionLocations — array of { id, name, shortName, side, ... }
 * @returns {{ id: string, name: string, shortName: string, side: string }}
 */
export function resolveLocation(locationValue, productionLocations) {
  const LEGACY_MAP = { 'SL': 'backstage-left', 'SR': 'backstage-right', 'ON': 'on-stage' };
  const canonId = LEGACY_MAP[locationValue] || locationValue;

  if (productionLocations && productionLocations.length > 0) {
    const found = productionLocations.find(l => l.id === canonId);
    if (found) return { id: found.id, name: found.name, shortName: found.shortName, side: found.side };
  }

  // Fallback for legacy or unresolved values
  if (canonId === 'backstage-left')  return { id: 'backstage-left',  name: 'Backstage Left',  shortName: 'BSL', side: 'left' };
  if (canonId === 'backstage-right') return { id: 'backstage-right', name: 'Backstage Right', shortName: 'BSR', side: 'right' };
  if (canonId === 'on-stage')        return { id: 'on-stage',        name: 'On Stage',        shortName: 'ON',  side: 'center' };

  // Unknown location — return as-is
  return { id: canonId, name: locationValue, shortName: locationValue, side: 'other' };
}

/**
 * Compute the current status of a tracked item at a given script page.
 *
 * @param {Object} item   — the tracked item document (prop, actor, scenic piece, costume)
 * @param {number} page   — current script page (1-based)
 * @param {Object} opts
 * @param {Function} [opts.locationResolver] — (locationValue) => resolved location obj
 * @param {'two-state'|'three-state'} [opts.stateModel='two-state']
 *    - two-state: OFF / ON (props, scenic, costumes)
 *    - three-state: OFF / HOLD / ON (actors)
 * @returns {Object} { location, status, activeCue, upcomingEnter, crossover, upcomingHold?, holdLocation? }
 */
export function getItemStatus(item, page, opts = {}) {
  const stateModel = opts.stateModel || 'two-state';
  const cues = item.cues || [];

  let location = item.start || item.defaultHoldLocation || 'SL';
  let status = 'Off Stage';
  let activeCue = null;
  let upcomingEnter = null;
  let crossover = null;
  let upcomingHold = null;
  let holdLocation = null;

  if (cues.length === 0) {
    // Legacy prop format: enters[] / exits[] arrays
    const enters = item.enters || [];
    const exits = item.exits || [];
    for (let i = 0; i < enters.length; i++) {
      if (page >= enters[i] && page <= (exits[i] || 9999)) {
        status = 'ON';
        location = 'ON';
        break;
      } else if (page > (exits[i] || 9999)) {
        location = item.endLocation || 'SL';
      }
    }
    if (status !== 'ON') {
      for (const ep of enters) {
        if (ep > page) { upcomingEnter = ep; break; }
      }
    }
    return { location, status, activeCue, upcomingEnter, crossover };
  }

  if (stateModel === 'three-state') {
    // ── Three-state model (actors): OFF → HOLD → ON → OFF ──
    for (const cue of cues) {
      const hp = cue.holdPage != null ? cue.holdPage : cue.enterPage;
      const ep = cue.enterPage;
      const xp = cue.exitPage;

      if (page >= hp && page < ep) {
        // HOLD state
        status = 'HOLD';
        holdLocation = cue.holdLocation || cue.enterLocation || location;
        location = holdLocation;
        activeCue = cue;
        break;
      } else if (page >= ep && page <= xp) {
        // ON state
        status = 'ON';
        location = 'ON';
        activeCue = cue;
        break;
      } else if (page > xp) {
        // Past this cue — update location
        location = cue.exitLocation || 'SL';
        status = 'Off Stage';
      }
    }

    if (status === 'Off Stage') {
      // Find next upcoming hold or enter
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const hp = cue.holdPage != null ? cue.holdPage : cue.enterPage;
        if (hp > page) {
          upcomingHold = hp;
          holdLocation = cue.holdLocation || cue.enterLocation || location;
          upcomingEnter = cue.enterPage;
          // Check for crossover
          const enterLoc = cue.enterLocation || location;
          if (enterLoc !== location) {
            crossover = {
              from: location,
              to: enterLoc,
              mover: cue.mover || '',
              cueIndex: i,
            };
          }
          break;
        }
        if (cue.enterPage > page) {
          upcomingEnter = cue.enterPage;
          const enterLoc = cue.enterLocation || location;
          if (enterLoc !== location) {
            crossover = {
              from: location,
              to: enterLoc,
              mover: cue.mover || '',
              cueIndex: i,
            };
          }
          break;
        }
      }
    }

    return { location, status, activeCue, upcomingEnter, crossover, upcomingHold, holdLocation };
  }

  // ── Two-state model (props, scenic, costumes): OFF / ON ──
  for (const cue of cues) {
    if (page >= cue.enterPage && page <= cue.exitPage) {
      status = 'ON';
      location = 'ON';
      activeCue = cue;
      break;
    } else if (page > cue.exitPage) {
      location = cue.exitLocation || 'SL';
      status = 'Off Stage';
    }
  }

  if (status !== 'ON') {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (cue.enterPage > page) {
        upcomingEnter = cue.enterPage;
        const currentLoc = location;
        const enterLoc = cue.enterLocation || currentLoc;
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

  return { location, status, activeCue, upcomingEnter, crossover };
}

/**
 * Compute badge counts and alert state for a tracking type.
 *
 * @param {string} trackingType — 'props' | 'actors' | 'scenic' | 'costumes'
 * @param {Array}  items       — array of tracked item documents
 * @param {number} page        — current script page
 * @param {number} warnPages   — warning threshold (pages ahead)
 * @returns {{ count: number, alert: boolean }}
 */
export function computeBadgeCounts(trackingType, items, page, warnPages) {
  const stateModel = trackingType === 'actors' ? 'three-state' : 'two-state';
  let count = 0;
  let alert = false;

  for (const item of items) {
    const result = getItemStatus(item, page, { stateModel });

    if (result.status === 'ON' || result.status === 'HOLD') {
      count++;
    }

    // Alert if any item has an upcoming enter/hold within warnPages
    if (result.upcomingEnter && (result.upcomingEnter - page) <= warnPages && (result.upcomingEnter - page) > 0) {
      alert = true;
    }
    if (result.upcomingHold && (result.upcomingHold - page) <= warnPages && (result.upcomingHold - page) > 0) {
      alert = true;
    }
    if (result.crossover) {
      alert = true;
    }
  }

  return { count, alert };
}
`, 'Create src/tracking/core.js');


// ─────────────────────────────────────────────────────────────
// 2. Create src/tracking/locations.js
// ─────────────────────────────────────────────────────────────
createFile('src/tracking/locations.js', `/**
 * locations.js — Venue Location System
 *
 * Manages the production's configured venue locations.
 * Replaces hardcoded SL/SR with a dynamic, user-configurable location system.
 */

import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { escapeHtml } from '../shared/ui.js';
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy
} from 'firebase/firestore';

export const DEFAULT_LOCATIONS = [
  { id: 'backstage-left',  name: 'Backstage Left',  shortName: 'BSL', side: 'left',   isDefault: true, sortOrder: 1 },
  { id: 'on-stage',        name: 'On Stage',        shortName: 'ON',  side: 'center', isDefault: true, sortOrder: 2 },
  { id: 'backstage-right', name: 'Backstage Right', shortName: 'BSR', side: 'right',  isDefault: true, sortOrder: 3 },
];

export const LEGACY_ALIASES = {
  'SL': 'backstage-left',
  'SR': 'backstage-right',
  'ON': 'on-stage',
};

// Module-level cache of production locations
let _productionLocations = [];
let _locationsUnsub = null;

/**
 * Get the currently cached production locations.
 * @returns {Array}
 */
export function getProductionLocations() {
  return _productionLocations.length > 0 ? _productionLocations : [...DEFAULT_LOCATIONS];
}

/**
 * Build an HTML <select> dropdown for locations.
 *
 * @param {Array}  locations   — array of location objects
 * @param {string} selectedId  — currently selected location ID
 * @param {Object} [opts]
 * @param {boolean} [opts.includeCustom=true] — include a "Custom…" option
 * @param {string}  [opts.name]     — name attribute for the select
 * @param {string}  [opts.cssClass] — CSS class for the select
 * @returns {string} HTML string
 */
export function buildLocationDropdown(locations, selectedId, opts = {}) {
  const { includeCustom = true, name = '', cssClass = 'form-select' } = opts;
  const locs = locations && locations.length > 0 ? locations : DEFAULT_LOCATIONS;

  // Resolve legacy alias to canonical ID for comparison
  const legacyMap = { 'SL': 'backstage-left', 'SR': 'backstage-right', 'ON': 'on-stage' };
  const resolvedSelectedId = legacyMap[selectedId] || selectedId;

  let html = \`<select class="\${escapeHtml(cssClass)}"\${name ? ' name="' + escapeHtml(name) + '"' : ''}>\`;

  for (const loc of locs) {
    const sel = loc.id === resolvedSelectedId ? ' selected' : '';
    html += \`<option value="\${escapeHtml(loc.id)}"\${sel}>\${escapeHtml(loc.shortName)}</option>\`;
  }

  if (includeCustom) {
    html += '<option value="__custom__">Custom…</option>';
  }

  html += '</select>';
  return html;
}

/**
 * Initialize default locations subcollection for a production if none exist.
 *
 * @param {string} productionId
 */
export async function initProductionLocations(productionId) {
  const locCol = collection(db, 'productions', productionId, 'locations');
  const snap = await getDocs(locCol);
  if (snap.size > 0) return; // Already has locations

  // Write default locations
  for (const loc of DEFAULT_LOCATIONS) {
    await setDoc(doc(locCol, loc.id), {
      name: loc.name,
      shortName: loc.shortName,
      side: loc.side,
      isDefault: loc.isDefault,
      sortOrder: loc.sortOrder,
      createdAt: serverTimestamp(),
    });
  }
}

/**
 * Subscribe to the locations subcollection for a production.
 * Updates the module-level cache and calls the callback on each change.
 *
 * @param {string}   productionId
 * @param {Function} callback — (locations: Array) => void
 */
export function subscribeToLocations(productionId, callback) {
  if (_locationsUnsub) {
    _locationsUnsub();
    _locationsUnsub = null;
  }

  const locCol = collection(db, 'productions', productionId, 'locations');
  _locationsUnsub = onSnapshot(locCol, snap => {
    _productionLocations = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    if (_productionLocations.length === 0) {
      _productionLocations = [...DEFAULT_LOCATIONS];
    }

    if (callback) callback(_productionLocations);
  });

  state.unsubscribers.push(() => {
    if (_locationsUnsub) {
      _locationsUnsub();
      _locationsUnsub = null;
    }
  });
}

/**
 * Save a location document (create or update).
 *
 * @param {string} productionId
 * @param {Object} locationData — { id, name, shortName, side, sortOrder }
 */
export async function saveLocation(productionId, locationData) {
  const locRef = doc(db, 'productions', productionId, 'locations', locationData.id);
  await setDoc(locRef, {
    name: locationData.name,
    shortName: locationData.shortName,
    side: locationData.side,
    sortOrder: locationData.sortOrder || 99,
    isDefault: locationData.isDefault || false,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Delete a location.
 *
 * @param {string} productionId
 * @param {string} locationId
 */
export async function deleteLocation(productionId, locationId) {
  await deleteDoc(doc(db, 'productions', productionId, 'locations', locationId));
}

/**
 * Update sort order for all locations.
 *
 * @param {string} productionId
 * @param {Array}  orderedIds — array of location IDs in desired order
 */
export async function reorderLocations(productionId, orderedIds) {
  const locCol = collection(db, 'productions', productionId, 'locations');
  for (let i = 0; i < orderedIds.length; i++) {
    await setDoc(doc(locCol, orderedIds[i]), { sortOrder: i + 1 }, { merge: true });
  }
}
`, 'Create src/tracking/locations.js');


// ─────────────────────────────────────────────────────────────
// 3. Patch firestore.rules — add new collection rules
// ─────────────────────────────────────────────────────────────
const FIRESTORE_RULES_PATH = 'firestore.rules';

const RULES_ANCHOR = `match /checkState/{uid} {
        allow read, write: if request.auth.uid == uid && isMember(productionId);
      }`;

const RULES_REPLACEMENT = `match /checkState/{uid} {
        allow read, write: if request.auth.uid == uid && isMember(productionId);
      }
      // Venue locations
      match /locations/{locationId} {
        allow read: if isMember(productionId) || isSuperAdmin();
        allow create, update, delete: if isOwner(productionId) || isSuperAdmin();
      }
      // Actor cues
      match /actorCues/{docId} {
        allow read: if isMember(productionId) || isSuperAdmin();
        allow create, update, delete: if isOwner(productionId) || isSuperAdmin();
      }
      // Scenic pieces and cue groups
      match /scenicPieces/{pieceId} {
        allow read: if isMember(productionId) || isSuperAdmin();
        allow create, update, delete: if isOwner(productionId) || isSuperAdmin();
      }
      match /scenicCueGroups/{groupId} {
        allow read: if isMember(productionId) || isSuperAdmin();
        allow create, update, delete: if isOwner(productionId) || isSuperAdmin();
      }
      // Costumes
      match /costumes/{costumeId} {
        allow read: if isMember(productionId) || isSuperAdmin();
        allow create, update, delete: if isOwner(productionId) || isSuperAdmin();
      }`;

if (fs.existsSync(FIRESTORE_RULES_PATH)) {
  applyPatch(FIRESTORE_RULES_PATH, RULES_ANCHOR, RULES_REPLACEMENT, 'firestore.rules: Add tracking collection rules');
} else {
  console.log(`  [WARN] ${FIRESTORE_RULES_PATH} not found — skipping (deploy rules manually)`);
}


// ─────────────────────────────────────────────────────────────
// 4. Patch index.html — add tracking CSS custom properties
// ─────────────────────────────────────────────────────────────
const INDEX_PATH = 'index.html';

const CSS_ANCHOR = `--blue: #5b9bd4;`;

const CSS_REPLACEMENT = `--blue: #5b9bd4;
    /* Tracking type colors */
    --track-prop: #C8A96E; --track-actor: #5B9BD4; --track-scenic: #6B8F4E; --track-costume: #9B7BC8;
    /* Tracking state colors */
    --state-hold: #D4AF37; --state-on: #4CAF50; --state-off: #555555; --qc-alert: #E89B3E;
    /* Tracking widget layout */
    --widget-tab-height: 30px;`;

applyPatch(INDEX_PATH, CSS_ANCHOR, CSS_REPLACEMENT, 'index.html: Add tracking CSS custom properties to :root');


// ─────────────────────────────────────────────────────────────
// 5. Patch settings.js — add Venue Locations section + imports
// ─────────────────────────────────────────────────────────────
const SETTINGS_PATH = 'src/settings/settings.js';

// 5a. Add imports for locations module
const SETTINGS_IMPORT_ANCHOR = `import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';`;

const SETTINGS_IMPORT_REPLACEMENT = `import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import {
  getProductionLocations, initProductionLocations, subscribeToLocations,
  saveLocation, deleteLocation, reorderLocations, DEFAULT_LOCATIONS
} from '../tracking/locations.js';`;

applyPatch(SETTINGS_PATH, SETTINGS_IMPORT_ANCHOR, SETTINGS_IMPORT_REPLACEMENT, 'settings.js: Add locations imports');

// 5b. Add Venue Locations section in renderSettingsTab() HTML — insert between Script PDF and Members
const SETTINGS_HTML_ANCHOR = `    <div class="settings-section">
      <h3>Members</h3>
      <div id="settings-members-list"><div style="color:var(--text-muted);font-size:13px;">Loading…</div></div>
    </div>
  \`;`;

const SETTINGS_HTML_REPLACEMENT = `    <div class="settings-section">
      <h3>Venue Locations</h3>
      <div id="settings-locations-list"><div style="color:var(--text-muted);font-size:13px;">Loading…</div></div>
      \${owner ? \`
        <button class="settings-btn settings-btn--primary" id="settings-add-location-btn" style="margin-top:10px;">+ Add Location</button>
      \` : ''}
    </div>

    <div class="settings-section">
      <h3>Members</h3>
      <div id="settings-members-list"><div style="color:var(--text-muted);font-size:13px;">Loading…</div></div>
    </div>
  \`;`;

applyPatch(SETTINGS_PATH, SETTINGS_HTML_ANCHOR, SETTINGS_HTML_REPLACEMENT, 'settings.js: Add Venue Locations section HTML');

// 5c. Add event wiring and location rendering logic after loadSettingsMembers() call
const SETTINGS_LOAD_ANCHOR = `  // Load members
  await loadSettingsMembers();
}`;

const SETTINGS_LOAD_REPLACEMENT = `  // Load members
  await loadSettingsMembers();

  // Load venue locations
  await loadSettingsLocations();

  // Wire add-location button
  if (owner) {
    container.querySelector('#settings-add-location-btn')?.addEventListener('click', () => {
      showAddLocationForm(prod.id);
    });
  }
}

async function loadSettingsLocations() {
  const container = document.getElementById('settings-locations-list');
  if (!container) return;
  const owner = isOwner();
  const pid = state.activeProduction.id;

  // Ensure default locations exist
  try {
    await initProductionLocations(pid);
  } catch (e) {
    console.warn('initProductionLocations error:', e);
  }

  const locations = getProductionLocations();

  if (locations.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted)">No locations configured.</div>';
    return;
  }

  container.innerHTML = locations.map((loc, idx) => \`
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bg-border);" data-loc-id="\${escapeHtml(loc.id)}">
      <span style="color:var(--gold);font-family:'DM Mono',monospace;font-size:12px;min-width:36px;">\${escapeHtml(loc.shortName)}</span>
      <span style="color:var(--text-primary);font-size:14px;flex:1;">\${escapeHtml(loc.name)}</span>
      <span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;">\${escapeHtml(loc.side || '')}</span>
      \${owner ? \`
        <button class="settings-btn loc-move-up-btn" data-loc-id="\${escapeHtml(loc.id)}" \${idx === 0 ? 'disabled style="opacity:0.3"' : ''} title="Move up">↑</button>
        <button class="settings-btn loc-move-down-btn" data-loc-id="\${escapeHtml(loc.id)}" \${idx === locations.length - 1 ? 'disabled style="opacity:0.3"' : ''} title="Move down">↓</button>
        \${!loc.isDefault ? \`<button class="settings-btn settings-btn--danger loc-delete-btn" data-loc-id="\${escapeHtml(loc.id)}" data-loc-name="\${escapeHtml(loc.name)}">Delete</button>\` : ''}
      \` : ''}
    </div>\`).join('');

  // Wire reorder buttons
  if (owner) {
    container.querySelectorAll('.loc-move-up-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const locId = btn.dataset.locId;
        const locs = getProductionLocations();
        const curIdx = locs.findIndex(l => l.id === locId);
        if (curIdx <= 0) return;
        const ids = locs.map(l => l.id);
        [ids[curIdx - 1], ids[curIdx]] = [ids[curIdx], ids[curIdx - 1]];
        try {
          await reorderLocations(pid, ids);
          toast('Location moved.', 'success');
          setTimeout(() => loadSettingsLocations(), 300);
        } catch (e) { toast('Failed to reorder.', 'error'); }
      });
    });

    container.querySelectorAll('.loc-move-down-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const locId = btn.dataset.locId;
        const locs = getProductionLocations();
        const curIdx = locs.findIndex(l => l.id === locId);
        if (curIdx < 0 || curIdx >= locs.length - 1) return;
        const ids = locs.map(l => l.id);
        [ids[curIdx], ids[curIdx + 1]] = [ids[curIdx + 1], ids[curIdx]];
        try {
          await reorderLocations(pid, ids);
          toast('Location moved.', 'success');
          setTimeout(() => loadSettingsLocations(), 300);
        } catch (e) { toast('Failed to reorder.', 'error'); }
      });
    });

    container.querySelectorAll('.loc-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirmDialog(\`Delete location "\${btn.dataset.locName}"? Items using this location will need reassignment.\`)) return;
        try {
          await deleteLocation(pid, btn.dataset.locId);
          toast('Location deleted.', 'success');
          setTimeout(() => loadSettingsLocations(), 300);
        } catch (e) { toast('Failed to delete.', 'error'); }
      });
    });
  }
}

function showAddLocationForm(productionId) {
  const container = document.getElementById('settings-locations-list');
  if (!container) return;

  // Check if form already exists
  if (document.getElementById('settings-add-loc-form')) return;

  const form = document.createElement('div');
  form.id = 'settings-add-loc-form';
  form.style.cssText = 'padding:12px;background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;margin-top:10px;';
  form.innerHTML = \`
    <div style="font-size:13px;color:var(--gold);margin-bottom:8px;font-weight:600;">New Location</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input type="text" id="new-loc-name" class="form-input" placeholder="Name (e.g. Balcony)" maxlength="50" style="flex:1;min-width:120px;" />
      <input type="text" id="new-loc-short" class="form-input" placeholder="Short (e.g. BAL)" maxlength="8" style="width:80px;" />
      <select id="new-loc-side" class="form-select" style="width:100px;">
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
        <option value="other">Other</option>
      </select>
      <button class="settings-btn settings-btn--primary" id="new-loc-save">Add</button>
      <button class="settings-btn" id="new-loc-cancel">Cancel</button>
    </div>
  \`;

  container.parentElement.insertBefore(form, container.parentElement.querySelector('#settings-add-location-btn')?.nextSibling || null);

  form.querySelector('#new-loc-cancel').addEventListener('click', () => form.remove());
  form.querySelector('#new-loc-save').addEventListener('click', async () => {
    const name = form.querySelector('#new-loc-name').value.trim();
    const shortName = form.querySelector('#new-loc-short').value.trim().toUpperCase();
    const side = form.querySelector('#new-loc-side').value;

    if (!name) { toast('Location name is required.', 'error'); return; }
    if (!shortName) { toast('Short name is required.', 'error'); return; }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const locs = getProductionLocations();
    const sortOrder = locs.length > 0 ? Math.max(...locs.map(l => l.sortOrder || 0)) + 1 : 1;

    try {
      await saveLocation(productionId, { id, name, shortName, side, sortOrder, isDefault: false });
      toast('Location added!', 'success');
      form.remove();
      setTimeout(() => loadSettingsLocations(), 300);
    } catch (e) {
      toast('Failed to add location.', 'error');
    }
  });
}`;

applyPatch(SETTINGS_PATH, SETTINGS_LOAD_ANCHOR, SETTINGS_LOAD_REPLACEMENT, 'settings.js: Add venue location loading + event wiring');


// ─────────────────────────────────────────────────────────────
// 6. Add location subscription initialization to settings init
//    (subscribe when settings tab opens so locations cache stays fresh)
// ─────────────────────────────────────────────────────────────

// We need the locations subscription to start when a production opens.
// The cleanest place is inside the existing renderSettingsTab, which already runs.
// The initProductionLocations call in loadSettingsLocations handles creation.
// The subscribeToLocations is best started from showApp in props.js (production open).
// But to keep P0 minimal and self-contained, we start it in settings on first render.

const SETTINGS_INIT_ANCHOR = `export function initSettings() {
  // no-op
}`;

const SETTINGS_INIT_REPLACEMENT = `let _locationsSubbed = false;

export function initSettings() {
  // no-op — location subscription is started on first renderSettingsTab()
}

function _ensureLocationsSub() {
  if (_locationsSubbed) return;
  const pid = state.activeProduction?.id;
  if (!pid) return;
  _locationsSubbed = true;
  subscribeToLocations(pid, () => {
    // Refresh settings locations list if visible
    if (document.getElementById('settings-locations-list')) {
      loadSettingsLocations();
    }
  });
}`;

applyPatch(SETTINGS_PATH, SETTINGS_INIT_ANCHOR, SETTINGS_INIT_REPLACEMENT, 'settings.js: Add location subscription bootstrap');

// Wire _ensureLocationsSub into renderSettingsTab
const ENSURE_LOC_ANCHOR = `export async function renderSettingsTab() {
  const container = document.getElementById('settings-content');
  if (!container) return;`;

const ENSURE_LOC_REPLACEMENT = `export async function renderSettingsTab() {
  const container = document.getElementById('settings-content');
  if (!container) return;

  _ensureLocationsSub();`;

applyPatch(SETTINGS_PATH, ENSURE_LOC_ANCHOR, ENSURE_LOC_REPLACEMENT, 'settings.js: Wire _ensureLocationsSub into renderSettingsTab');


// ─────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────
console.log(`\n✔ ${patchCount} operations ${DRY ? 'would be applied' : 'applied'}.`);

if (!DRY) {
  console.log('\nVerification checklist:');
  console.log('  1. src/tracking/core.js exists and exports getItemStatus, resolveLocation, computeBadgeCounts');
  console.log('  2. src/tracking/locations.js exists and exports DEFAULT_LOCATIONS, buildLocationDropdown, etc.');
  console.log('  3. Open the app in browser — no console errors on load');
  console.log('  4. Navigate to Settings tab — "Venue Locations" section appears between Script PDF and Members');
  console.log('  5. For owners: BSL, ON, BSR default locations are shown; +Add Location button is visible');
  console.log('  6. For members: locations are shown read-only (no reorder/delete/add buttons)');
  console.log('  7. Verify firestore.rules contains new rules for locations, actorCues, scenicPieces, scenicCueGroups, costumes');
  console.log('  8. Run: firebase deploy --only firestore:rules (and verify success)');
  console.log('  9. Existing Props tab functionality is completely unaffected');
  console.log(' 10. Inspect :root in DevTools — --track-prop, --state-hold, etc. are present');
}
