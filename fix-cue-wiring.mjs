#!/usr/bin/env node
/**
 * fix-cue-wiring.mjs
 * 
 * Hotfix: wires the Place Cue button + popover event listeners in initLineNotes()
 * using the robust anchor "setTimeout(() => wireZeToolbar(), 0);".
 * 
 * Also removes any stale wiring that may have been injected into wireZeToolbar
 * by the previous patch (idempotency-safe — skips if already wired in initLineNotes).
 * 
 * Usage:  node fix-cue-wiring.mjs           (dry run)
 *         node fix-cue-wiring.mjs --apply    (write changes)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DRY = !process.argv.includes('--apply');
const OK = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
let allGood = true;

const LN_FILE = 'src/linenotes/linenotes.js';

let ln = existsSync(LN_FILE) ? readFileSync(LN_FILE, 'utf8') : null;
if (!ln) { console.log(`${FAIL} File not found: ${LN_FILE}`); process.exit(1); }

// ── Step 1: Remove any stale cue wiring that got into wireZeToolbar ──
// Look for the block "// Cue placement mode wiring" inside wireZeToolbar
// and remove it if present.
const staleMarker = '  // Cue placement mode wiring\n';
if (ln.includes(staleMarker)) {
  // Find the full stale block — from the comment through the closing });
  const staleStart = ln.indexOf(staleMarker);
  // The block ends after "if (e.key === 'Escape') zeCloseCuePopover();\n  });"
  const staleEndMarker = "if (e.key === 'Escape') zeCloseCuePopover();\n  });";
  const staleEnd = ln.indexOf(staleEndMarker, staleStart);
  if (staleEnd !== -1) {
    const removeEnd = staleEnd + staleEndMarker.length;
    ln = ln.slice(0, staleStart) + ln.slice(removeEnd);
    console.log(`${OK} Removed stale cue wiring from wireZeToolbar`);
  } else {
    console.log(`${INFO} Found stale marker but couldn't find end — leaving it`);
  }
} else {
  console.log(`${INFO} No stale wireZeToolbar cue wiring found (clean)`);
}

// ── Step 2: Add cue button + popover wiring in initLineNotes ──
// Anchor: the setTimeout line that calls wireZeToolbar — unique, never touched by other patches
const anchor = `setTimeout(() => wireZeToolbar(), 0);`;
const wiringCheck = `document.getElementById('ln-place-cue-btn')?.addEventListener('click', zeToggleCueMode);`;

if (ln.includes(wiringCheck)) {
  console.log(`${INFO} [SKIP] Cue button wiring already present in initLineNotes`);
} else {
  const idx = ln.indexOf(anchor);
  if (idx === -1) {
    console.log(`${FAIL} Anchor not found: "${anchor}"`);
    allGood = false;
  } else {
    const replacement = `setTimeout(() => wireZeToolbar(), 0);

  // Cue placement mode: button + popover wiring
  document.getElementById('ln-place-cue-btn')?.addEventListener('click', zeToggleCueMode);
  document.getElementById('ze-cue-save')?.addEventListener('click', zeSavePlacedCue);
  document.getElementById('ze-cue-cancel')?.addEventListener('click', zeCloseCuePopover);
  document.getElementById('ze-cue-label')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); zeSavePlacedCue(); }
    if (e.key === 'Escape') zeCloseCuePopover();
  });`;
    ln = ln.slice(0, idx) + replacement + ln.slice(idx + anchor.length);
    console.log(`${OK} Wired cue button + popover in initLineNotes`);
  }
}

// ── Write ──
if (!allGood) {
  console.log(`\n${FAIL} Fix failed — see above`);
  process.exit(1);
}
if (DRY) {
  console.log(`\n${INFO} [DRY RUN] Would write ${LN_FILE}. Run with --apply to write.`);
} else {
  writeFileSync(LN_FILE, ln, 'utf8');
  console.log(`\n${OK} Wrote ${LN_FILE}`);
  console.log('\nVerify: Open Edit Script tab → click "Place Cue" → button should highlight gold');
}
