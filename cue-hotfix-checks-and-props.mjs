#!/usr/bin/env node
/**
 * cue-hotfix-checks-and-props.mjs
 *
 * Fixes:
 *  1. Check tab "buttons do nothing" — loadCheckState() was called on every
 *     re-render, clobbering optimistic local state before the debounced save.
 *     Fix: only load from Firestore once per tab activation.
 *
 *  2. Zero-cue prop save crashes — cues[cues.length-1].exitLocation throws
 *     when cues array is empty. Fix: handle empty cues gracefully.
 *
 *  3. "No cues yet. Add at least one." text still shown even though zero-cue
 *     props are now allowed. Fix: update the helper text.
 *
 * Usage:  node cue-hotfix-checks-and-props.mjs           (dry-run)
 *         node cue-hotfix-checks-and-props.mjs --apply    (writes to disk)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const DRY = !process.argv.includes('--apply');
const ROOT = process.cwd();
let stats = { patched: 0, failed: 0 };

function read(f) {
  const p = ROOT + '/' + f;
  if (!existsSync(p)) { console.error('✗ Not found: ' + f); return null; }
  return readFileSync(p, 'utf-8');
}

function write(f, content) {
  if (DRY) { console.log('  [DRY] Would write ' + f + ' (' + content.length + ' bytes)'); return; }
  writeFileSync(ROOT + '/' + f, content, 'utf-8');
}

function patch(f, needle, replacement, label) {
  let src = read(f);
  if (!src) { stats.failed++; return null; }
  const idx = src.indexOf(needle);
  if (idx === -1) { console.error('✗ "' + label + '" — needle not found in ' + f); stats.failed++; return null; }
  src = src.slice(0, idx) + replacement + src.slice(idx + needle.length);
  write(f, src);
  stats.patched++;
  console.log('✓ ' + f + ' — ' + label);
  return src;
}

function patchAll(f, needle, replacement, label) {
  let src = read(f);
  if (!src) { stats.failed++; return null; }
  const count = src.split(needle).length - 1;
  if (count === 0) { console.error('✗ "' + label + '" — no matches in ' + f); stats.failed++; return null; }
  src = src.replaceAll(needle, replacement);
  write(f, src);
  stats.patched++;
  console.log('✓ ' + f + ' — ' + label + ' (' + count + '×)');
  return src;
}

// Helper: apply multiple patches to same file sequentially (re-read between)
function patchSeq(f, patches) {
  for (const [needle, replacement, label] of patches) {
    patch(f, needle, replacement, label);
  }
}

const FILE = 'src/props/props.js';

console.log('');
console.log('  CUE Hotfix — Check Tab + Zero-Cue Props');
console.log(DRY ? '  Mode: DRY RUN' : '  Mode: APPLY');
console.log('');

// ─────────────────────────────────────────────────
// FIX 1: Check tab — only load from Firestore on FIRST render
// ─────────────────────────────────────────────────

// 1a. Add _checkStateLoaded flag near other module-level vars
patch(FILE,
  `let preChecked = {};\nlet postChecked = {};`,
  `let preChecked = {};\nlet postChecked = {};\nlet _checkStateLoaded = false;`,
  'Add _checkStateLoaded flag'
);

// 1b. Guard the Firestore load so it only runs once
patch(FILE,
  `async function renderCheckTab() {\n  // P0: Load persisted check state from Firestore\n  const _saved = await loadCheckState();\n  preChecked = _saved.preChecked;\n  postChecked = _saved.postChecked;`,
  `async function renderCheckTab() {\n  // P0: Load persisted check state from Firestore (only on first render)\n  if (!_checkStateLoaded) {\n    const _saved = await loadCheckState();\n    preChecked = _saved.preChecked;\n    postChecked = _saved.postChecked;\n    _checkStateLoaded = true;\n  }`,
  'Guard check state load with _checkStateLoaded'
);

// 1c. Reset the flag when production changes (in showApp)
patch(FILE,
  `  preChecked = {}; postChecked = {};`,
  `  preChecked = {}; postChecked = {}; _checkStateLoaded = false;`,
  'Reset _checkStateLoaded in showApp()'
);


// ─────────────────────────────────────────────────
// FIX 2: Zero-cue prop save crash
// ─────────────────────────────────────────────────

// 2a. The endLocation line crashes when cues is empty:
//     const endLocation = cues[cues.length - 1].exitLocation;
//     Fix: fallback to prop start location when no cues
patch(FILE,
  `  const endLocation = cues[cues.length - 1].exitLocation;`,
  `  const endLocation = cues.length > 0 ? cues[cues.length - 1].exitLocation : start;`,
  'Fix endLocation crash on zero-cue props'
);


// ─────────────────────────────────────────────────
// FIX 3: Update "no cues" helper text (no longer required)
// ─────────────────────────────────────────────────

patch(FILE,
  `No cues yet. Add at least one.`,
  `No cues added. Prop will stay in its starting location.`,
  'Update no-cues helper text'
);


// ─────────────────────────────────────────────────
// FIX 4: Import JSON — also allow zero-cue props
// ─────────────────────────────────────────────────

patch(FILE,
  `        if (!Array.isArray(p.cues) || p.cues.length === 0) { toast('Item ' + (i+1) + ': at least one cue required.', 'error'); return; }`,
  `        if (p.cues && !Array.isArray(p.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }`,
  'Allow zero-cue props in JSON import'
);


// ─────────────────────────────────────────────────
// FIX 5: Import JSON — handle empty cues in endLocation
// ─────────────────────────────────────────────────

patch(FILE,
  `        const cues = p.cues.map(c => ({ enterPage: c.enterPage, exitPage: c.exitPage, enterLocation: c.enterLocation || '', exitLocation: c.exitLocation || 'SL', carrierOn: c.carrierOn || '', carrierOnCastId: '', carrierOff: c.carrierOff || '', carrierOffCastId: '', mover: c.mover || '', moverCastId: '' }));
        await addDoc(collection(db, 'productions', pid, 'props'), { name: sanitizeName(p.name), start: p.start, cues, enters: cues.map(c => c.enterPage), exits: cues.map(c => c.exitPage), endLocation: cues[cues.length - 1].exitLocation, createdAt: serverTimestamp() });`,
  `        const cues = (p.cues || []).map(c => ({ enterPage: c.enterPage, exitPage: c.exitPage, enterLocation: c.enterLocation || '', exitLocation: c.exitLocation || 'SL', carrierOn: c.carrierOn || '', carrierOnCastId: '', carrierOff: c.carrierOff || '', carrierOffCastId: '', mover: c.mover || '', moverCastId: '' }));
        await addDoc(collection(db, 'productions', pid, 'props'), { name: sanitizeName(p.name), start: p.start, cues, enters: cues.map(c => c.enterPage), exits: cues.map(c => c.exitPage), endLocation: cues.length > 0 ? cues[cues.length - 1].exitLocation : p.start, createdAt: serverTimestamp() });`,
  'Fix import endLocation for zero-cue props'
);


// ─────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────

console.log('');
console.log('  Patched: ' + stats.patched + '  Failed: ' + stats.failed);
if (DRY) console.log('  DRY RUN — no files changed. Run with --apply to write.');
if (stats.failed) console.log('  ⚠ Some patches failed — review above.');
console.log('');
