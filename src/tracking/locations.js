/**
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

  let html = `<select class="${escapeHtml(cssClass)}"${name ? ' name="' + escapeHtml(name) + '"' : ''}>`;

  for (const loc of locs) {
    const sel = loc.id === resolvedSelectedId ? ' selected' : '';
    html += `<option value="${escapeHtml(loc.id)}"${sel}>${escapeHtml(loc.shortName)}</option>`;
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
