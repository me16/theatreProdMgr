#!/usr/bin/env node
/**
 * patch-actor-assignments.mjs
 *
 * Two adjustments:
 *   1. Character-name zones can have actor assignments, and those actors
 *      appear as pills in the Run Show tab even though the charName zone
 *      itself is hidden.
 *   2. Multiple actors can be assigned to a single zone (ensemble /
 *      musical unison lines).
 *
 * Data model change:
 *   Zones gain an `assignedActors` array: [{castId, charName}, …]
 *   Old `assignedCastId` / `assignedCharName` kept for backward compat
 *   (first entry, or null).
 *
 * Usage:  node patch-actor-assignments.mjs          (dry run)
 *         node patch-actor-assignments.mjs --apply  (write files)
 */

import { readFileSync, writeFileSync } from 'fs';

const DRY = !process.argv.includes('--apply');
const log = msg => console.log(msg);
const ok  = msg => console.log(`  ✅ ${msg}`);
const err = msg => { console.error(`  ❌ ${msg}`); process.exit(1); };

function applyPatch(file, label, oldStr, newStr) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(newStr.trim().slice(0, 80))) { ok(`${label} — already applied (idempotent)`); return src; }
  const idx = src.indexOf(oldStr);
  if (idx === -1) err(`${label} — old string not found in ${file}`);
  if (src.indexOf(oldStr, idx + 1) !== -1) err(`${label} — old string not unique in ${file}`);
  const out = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  if (!DRY) writeFileSync(file, out, 'utf8');
  ok(`${label}`);
  return out;
}

/* Helper: apply patch on already-modified content (chained patches on same file) */
function applyPatchBuf(buf, file, label, oldStr, newStr) {
  if (buf.includes(newStr.trim().slice(0, 80))) { ok(`${label} — already applied (idempotent)`); return buf; }
  const idx = buf.indexOf(oldStr);
  if (idx === -1) err(`${label} — old string not found in ${file}`);
  if (buf.indexOf(oldStr, idx + 1) !== -1) err(`${label} — old string not unique in ${file}`);
  const out = buf.slice(0, idx) + newStr + buf.slice(idx + oldStr.length);
  if (!DRY) writeFileSync(file, out, 'utf8');
  ok(`${label}`);
  return out;
}

log(`\n🎭 Patch: Actor Assignment Adjustments (${DRY ? 'DRY RUN' : 'APPLYING'})\n`);

/* ══════════════════════════════════════════════════════════════
   FILE 1: index.html
   ══════════════════════════════════════════════════════════════ */
const HTML = 'index.html';
log(`── ${HTML} ──`);

// 1a. Replace <select> with a scrollable checkbox container
let htmlBuf = readFileSync(HTML, 'utf8');
htmlBuf = applyPatchBuf(htmlBuf, HTML, '1a: Replace actor select with checkbox container',
  `            <div style="margin-bottom:10px;" id="zd-actor-section">
              <div class="ze-label">Assign Actor</div>
              <select class="ze-input" id="zd-actor" style="font-size:11px;padding:4px 6px;">
                <option value="">— none —</option>
              </select>
            </div>`,
  `            <div style="margin-bottom:10px;" id="zd-actor-section">
              <div class="ze-label">Assign Actor(s)</div>
              <div id="zd-actor-list" style="max-height:120px;overflow-y:auto;border:1px solid var(--bg-border);border-radius:4px;padding:4px 6px;font-size:11px;background:var(--bg-deep);"></div>
            </div>`
);

// 1b. CSS: support stacked multi-pills and charName floating pills
const RS_PILL_CSS = `    .rs-actor-pill {
      position: absolute; left: -3px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
    }`;

htmlBuf = applyPatchBuf(htmlBuf, HTML, '1b: Update rs-actor-pill CSS for multi-pill + charName pills',
  RS_PILL_CSS,
  `    .rs-actor-pill {
      position: absolute; left: -3px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
    }
    /* Stacked pills when multiple actors assigned */
    .rs-actor-pill + .rs-actor-pill { top: calc(50% + 14px); }
    .rs-actor-pill + .rs-actor-pill + .rs-actor-pill { top: calc(50% + 28px); }
    /* Floating pill for hidden charName zones */
    .rs-actor-pill--charname {
      position: absolute;
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
      color: #fff; opacity: 0.85;
    }
    .rs-actor-pill--charname + .rs-actor-pill--charname { margin-top: 2px; }`
);

// 1c. CSS: zone editor multi-badge stacking
const ZE_BADGE_CSS = `    .ze-zone-actor-badge {
      position: absolute; left: -3px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      color: #fff; pointer-events: none; white-space: nowrap;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
      z-index: 6;
    }`;

htmlBuf = applyPatchBuf(htmlBuf, HTML, '1c: Update ze-zone-actor-badge CSS for multi-badge',
  ZE_BADGE_CSS,
  `    .ze-zone-actor-badge {
      position: absolute; left: -3px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      color: #fff; pointer-events: none; white-space: nowrap;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
      z-index: 6;
    }
    .ze-zone-actor-badge + .ze-zone-actor-badge { top: calc(50% + 14px); }
    .ze-zone-actor-badge + .ze-zone-actor-badge + .ze-zone-actor-badge { top: calc(50% + 28px); }
    /* Actor checkbox list in zone editor */
    .zd-actor-cb-row { display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer; }
    .zd-actor-cb-row:hover { background:rgba(200,169,110,0.06); }
    .zd-actor-cb-row input[type="checkbox"] { accent-color:#5b9bd4; margin:0; }
    .zd-actor-cb-label { font-family:'DM Mono',monospace; font-size:11px; color:var(--text-secondary); }
    .zd-actor-cb-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }`
);

if (!DRY) writeFileSync(HTML, htmlBuf, 'utf8');


/* ══════════════════════════════════════════════════════════════
   FILE 2: src/linenotes/linenotes.js
   ══════════════════════════════════════════════════════════════ */
const LN = 'src/linenotes/linenotes.js';
log(`── ${LN} ──`);

// 2a. zePopulateDetail: replace actor dropdown with checkbox list, show for charName zones
let lnBuf = readFileSync(LN, 'utf8');

const OLD_POPULATE_ACTOR = `  // Actor assignment dropdown
  const actorSelect = document.getElementById('zd-actor');
  const actorSection = document.getElementById('zd-actor-section');
  if (actorSelect && actorSection) {
    // Hide for charName/stageDir zones, show for dialogue/music
    actorSection.style.display = (z.isCharName || z.isStageDirection) ? 'none' : '';
    const cast = getCastMembers();
    let opts = '<option value="">— none —</option>';
    cast.forEach(m => {
      const chars = m.characters?.length > 0 ? m.characters : [m.name];
      chars.forEach(ch => {
        const val = m.id + '::' + ch;
        const sel = (m.id === z.assignedCastId && ch === z.assignedCharName) ? ' selected' : '';
        opts += '<option value="' + escapeHtml(val) + '"' + sel + '>' + escapeHtml(ch) + ' (' + escapeHtml(m.name) + ')</option>';
      });
    });
    actorSelect.innerHTML = opts;
    // Explicitly set value — innerHTML + selected attribute is unreliable in some browsers
    if (z.assignedCastId && z.assignedCharName) {
      actorSelect.value = z.assignedCastId + '::' + z.assignedCharName;
    }
  }`;

const NEW_POPULATE_ACTOR = `  // Actor assignment checkbox list (supports multiple actors per zone)
  const actorListEl = document.getElementById('zd-actor-list');
  const actorSection = document.getElementById('zd-actor-section');
  if (actorListEl && actorSection) {
    // Show for all zone types except stageDir
    actorSection.style.display = z.isStageDirection ? 'none' : '';
    const cast = getCastMembers();
    // Normalise: read assignedActors array, fall back to legacy single fields
    const assigned = z.assignedActors && z.assignedActors.length > 0
      ? z.assignedActors
      : (z.assignedCastId && z.assignedCharName ? [{ castId: z.assignedCastId, charName: z.assignedCharName }] : []);
    let html = '';
    cast.forEach(m => {
      const chars = m.characters?.length > 0 ? m.characters : [m.name];
      chars.forEach(ch => {
        const val = m.id + '::' + ch;
        const checked = assigned.some(a => a.castId === m.id && a.charName === ch) ? ' checked' : '';
        html += '<label class="zd-actor-cb-row">'
          + '<input type="checkbox" class="zd-actor-cb" value="' + escapeHtml(val) + '"' + checked + '>'
          + '<span class="zd-actor-cb-dot" style="background:' + escapeHtml(m.color || '#5b9bd4') + '"></span>'
          + '<span class="zd-actor-cb-label">' + escapeHtml(ch) + ' (' + escapeHtml(m.name) + ')</span>'
          + '</label>';
      });
    });
    actorListEl.innerHTML = html || '<div style="color:var(--text-muted);font-size:10px;padding:2px;">No cast members</div>';
  }`;

lnBuf = applyPatchBuf(lnBuf, LN, '2a: zePopulateDetail — checkbox list, show for charName',
  OLD_POPULATE_ACTOR, NEW_POPULATE_ACTOR);

// 2b. zeApplyDetail: read checkboxes → assignedActors array, keep legacy compat, allow charName
const OLD_APPLY_ACTOR = `  // Actor assignment
  const actorVal = document.getElementById('zd-actor')?.value || '';
  if (actorVal) {
    const [cid, cname] = actorVal.split('::');
    z.assignedCastId = cid;
    z.assignedCharName = cname;
  } else {
    z.assignedCastId = null;
    z.assignedCharName = null;
  }
  // Clear actor if zone is charName or stageDir
  if (z.isCharName || z.isStageDirection) { z.assignedCastId = null; z.assignedCharName = null; }`;

const NEW_APPLY_ACTOR = `  // Actor assignment — multi-select via checkboxes
  const actorCbs = document.querySelectorAll('#zd-actor-list .zd-actor-cb:checked');
  const actors = [];
  actorCbs.forEach(cb => {
    const [cid, cname] = cb.value.split('::');
    if (cid && cname) actors.push({ castId: cid, charName: cname });
  });
  z.assignedActors = actors;
  // Legacy compat: first actor or null
  if (actors.length > 0) {
    z.assignedCastId = actors[0].castId;
    z.assignedCharName = actors[0].charName;
  } else {
    z.assignedCastId = null;
    z.assignedCharName = null;
  }
  // Clear actor only for stageDir (charName zones CAN have actor assignments)
  if (z.isStageDirection) { z.assignedActors = []; z.assignedCastId = null; z.assignedCharName = null; }`;

lnBuf = applyPatchBuf(lnBuf, LN, '2b: zeApplyDetail — multi-actor + allow charName assignment',
  OLD_APPLY_ACTOR, NEW_APPLY_ACTOR);

// 2c. zeRenderZones: multi-badge support
const OLD_ZE_BADGE = `    if (zone.assignedCharName) {
      const ab = document.createElement('span');
      ab.className = 'ze-zone-actor-badge';
      ab.textContent = zone.assignedCharName;
      const _cast = getCastMembers();
      const _member = _cast.find(m => m.id === zone.assignedCastId);
      ab.style.background = _member?.color || '#5b9bd4';
      div.appendChild(ab);
    }`;

const NEW_ZE_BADGE = `    // Render actor badges (supports multiple)
    const _zeActors = zone.assignedActors && zone.assignedActors.length > 0
      ? zone.assignedActors
      : (zone.assignedCastId && zone.assignedCharName ? [{ castId: zone.assignedCastId, charName: zone.assignedCharName }] : []);
    if (_zeActors.length > 0) {
      const _cast = getCastMembers();
      _zeActors.forEach(a => {
        const ab = document.createElement('span');
        ab.className = 'ze-zone-actor-badge';
        ab.textContent = a.charName;
        const _member = _cast.find(m => m.id === a.castId);
        ab.style.background = _member?.color || '#5b9bd4';
        div.appendChild(ab);
      });
    }`;

lnBuf = applyPatchBuf(lnBuf, LN, '2c: zeRenderZones — multi-actor badges',
  OLD_ZE_BADGE, NEW_ZE_BADGE);

if (!DRY) writeFileSync(LN, lnBuf, 'utf8');


/* ══════════════════════════════════════════════════════════════
   FILE 3: src/runshow/Runshow.js
   ══════════════════════════════════════════════════════════════ */
const RS = 'src/runshow/Runshow.js';
log(`── ${RS} ──`);

let rsBuf = readFileSync(RS, 'utf8');

// 3a. rsRenderLineZones — charName zones: render floating pill(s) instead of early return
const OLD_CHARNAME_RETURN = `    if (zone.isCharName) return;`;

const NEW_CHARNAME_RETURN = `    if (zone.isCharName) {
      // Render floating actor pill(s) for charName zones (zone div itself stays hidden)
      if (rsShowActorPills) {
        const _cnActors = zone.assignedActors && zone.assignedActors.length > 0
          ? zone.assignedActors
          : (zone.assignedCastId && zone.assignedCharName ? [{ castId: zone.assignedCastId, charName: zone.assignedCharName }] : []);
        if (_cnActors.length > 0) {
          const _cnCast = getCastMembers();
          const pillWrap = document.createElement('div');
          pillWrap.style.cssText = 'position:absolute;left:' + Math.max(0, zone.x - 0.5) + '%;top:' + zone.y + '%;display:flex;flex-direction:column;align-items:flex-end;pointer-events:none;z-index:4;';
          _cnActors.forEach(a => {
            const pill = document.createElement('span');
            pill.className = 'rs-actor-pill--charname';
            const _m = _cnCast.find(m => m.id === a.castId);
            pill.style.background = _m?.color || '#5b9bd4';
            pill.style.color = '#fff';
            pill.textContent = a.charName;
            pillWrap.appendChild(pill);
          });
          hitOverlay.appendChild(pillWrap);
        }
      }
      return;
    }`;

rsBuf = applyPatchBuf(rsBuf, RS, '3a: charName zones — render floating pills before early return',
  OLD_CHARNAME_RETURN, NEW_CHARNAME_RETURN);

// 3b. rsRenderLineZones — multi-actor pills on regular zones
const OLD_RS_PILL = `    // Actor pill (when toggled on and zone has assignment)
    if (rsShowActorPills && zone.assignedCharName) {
      const cast = getCastMembers();
      const member = cast.find(m => m.id === zone.assignedCastId);
      const pillColor = member?.color || '#5b9bd4';
      const pill = document.createElement('span');
      pill.className = 'rs-actor-pill';
      pill.style.background = pillColor;
      pill.style.color = '#fff';
      pill.textContent = zone.assignedCharName;
      div.appendChild(pill);
    }`;

const NEW_RS_PILL = `    // Actor pill(s) (when toggled on — supports multiple actors)
    if (rsShowActorPills) {
      const _rsActors = zone.assignedActors && zone.assignedActors.length > 0
        ? zone.assignedActors
        : (zone.assignedCastId && zone.assignedCharName ? [{ castId: zone.assignedCastId, charName: zone.assignedCharName }] : []);
      if (_rsActors.length > 0) {
        const cast = getCastMembers();
        _rsActors.forEach(a => {
          const member = cast.find(m => m.id === a.castId);
          const pill = document.createElement('span');
          pill.className = 'rs-actor-pill';
          pill.style.background = member?.color || '#5b9bd4';
          pill.style.color = '#fff';
          pill.textContent = a.charName;
          div.appendChild(pill);
        });
      }
    }`;

rsBuf = applyPatchBuf(rsBuf, RS, '3b: multi-actor pills on dialogue zones',
  OLD_RS_PILL, NEW_RS_PILL);

if (!DRY) writeFileSync(RS, rsBuf, 'utf8');


/* ══════════════════════════════════════════════════════════════
   FILE 4: src/cast/cast.js
   ══════════════════════════════════════════════════════════════ */
const CAST = 'src/cast/cast.js';
log(`── ${CAST} ──`);

// 4a. buildActorLineReport — also check assignedActors array
const OLD_CAST_FILTER = `      const matching = zones.filter(z =>
        z.assignedCastId === castId && charNames.includes(z.assignedCharName)
        && !z.isCharName && !z.isStageDirection
      );`;

const NEW_CAST_FILTER = `      const matching = zones.filter(z => {
        if (z.isStageDirection) return false;
        // Check new multi-actor array first, fall back to legacy fields
        const actors = z.assignedActors && z.assignedActors.length > 0
          ? z.assignedActors
          : (z.assignedCastId && z.assignedCharName ? [{ castId: z.assignedCastId, charName: z.assignedCharName }] : []);
        return actors.some(a => a.castId === castId && charNames.includes(a.charName));
      });`;

applyPatch(CAST, '4a: buildActorLineReport — support assignedActors array + charName zones',
  OLD_CAST_FILTER, NEW_CAST_FILTER);


/* ══════════════════════════════════════════════════════════════
   DONE
   ══════════════════════════════════════════════════════════════ */
log('');
if (DRY) {
  log('🔍 Dry run complete — all anchors found. Run with --apply to write.\n');
} else {
  log('✅ All patches applied!\n');
  log('Verification checklist:');
  log('  1. Edit Script tab → select a Character Name zone → "Assign Actor(s)" section visible');
  log('  2. Check multiple actors on a dialogue zone → Apply → multiple badges appear');
  log('  3. Run Show → toggle Actors button ON → charName zone pills visible at zone position');
  log('  4. Run Show → dialogue zone with 2+ actors → stacked pills appear');
  log('  5. Cast & Crew → actor line report includes lines from charName-assigned zones');
  log('  6. Old zones with single assignedCastId/assignedCharName still render correctly');
  log('');
}
