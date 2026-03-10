/**
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
