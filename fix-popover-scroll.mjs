#!/usr/bin/env node
/**
 * fix-popover-scroll.mjs
 * ──────────────────────
 * Fixes the Run Show line-note popovers (FAB + zone-click) overflowing the
 * viewport when the cast list is long.  The .popover-chars container had no
 * max-height or overflow, so 15+ actors pushed the popover above the screen.
 *
 * Changes:
 *   1. .popover-chars  — add max-height + overflow-y: auto (scrollable cast)
 *   2. .run-note-popover — add max-height so FAB popover stays in viewport
 *   3. .run-note-popover-inner — make it flex-column + overflow-hidden so
 *      the chars area can shrink while header/types/buttons stay pinned
 *   4. .note-popover — add max-height so zone-click popover stays in viewport
 *
 * Usage:
 *   node fix-popover-scroll.mjs            # dry-run (prints what would change)
 *   node fix-popover-scroll.mjs --apply    # writes changes to disk
 */

import { readFileSync, writeFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--apply');
const FILE = 'index.html';
let src = readFileSync(FILE, 'utf8');
let patchCount = 0;

function applyPatch(label, oldStr, newStr) {
  if (src.includes(newStr)) {
    console.log(`  ✔ [${label}] already applied — skipping`);
    return;
  }
  if (!src.includes(oldStr)) {
    console.error(`  ✖ [${label}] old string not found — MANUAL CHECK NEEDED`);
    console.error(`    Looking for:\n${oldStr.slice(0, 120)}…`);
    process.exit(1);
  }
  src = src.replace(oldStr, newStr);
  patchCount++;
  console.log(`  ✔ [${label}] patched`);
}

console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '🔧 APPLYING'} — fix-popover-scroll\n`);

// ─── PATCH 1: .popover-chars — add max-height + scroll ─────────────────────
applyPatch(
  'popover-chars: add max-height + scroll',
  '.popover-chars { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 6px; }',
  '.popover-chars { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 6px; max-height: 40vh; overflow-y: auto; }'
);

// ─── PATCH 2: .run-note-popover — constrain to viewport ────────────────────
applyPatch(
  'run-note-popover: add max-height',
  `.run-note-popover {
      position:fixed; bottom:80px; right:24px; z-index:600;
      background:var(--bg-card); border:1px solid var(--bg-border); border-radius:10px;
      width:300px; box-shadow:0 12px 40px rgba(0,0,0,0.7);
      font-family:'Inter',sans-serif; overflow:hidden;
    }`,
  `.run-note-popover {
      position:fixed; bottom:80px; right:24px; z-index:600;
      background:var(--bg-card); border:1px solid var(--bg-border); border-radius:10px;
      width:300px; box-shadow:0 12px 40px rgba(0,0,0,0.7);
      font-family:'Inter',sans-serif; overflow:hidden;
      max-height:calc(100vh - 100px); display:flex; flex-direction:column;
    }`
);

// ─── PATCH 3: .run-note-popover-inner — flex column overflow ────────────────
applyPatch(
  'run-note-popover-inner: flex overflow',
  ".run-note-popover-inner { padding:14px; display:flex; flex-direction:column; gap:10px; }",
  ".run-note-popover-inner { padding:14px; display:flex; flex-direction:column; gap:10px; overflow:hidden; flex:1; min-height:0; }"
);

// ─── PATCH 4: .note-popover (zone-click) — constrain to viewport ───────────
applyPatch(
  'note-popover: add max-height',
  `.note-popover {
      position: fixed; z-index: 600; background: var(--bg-card); border: 1px solid var(--bg-border);
      border-radius: 8px; padding: 0; width: 260px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7); display: none;
      font-family: 'Inter', sans-serif; overflow: hidden;
      flex-direction: column;
    }`,
  `.note-popover {
      position: fixed; z-index: 600; background: var(--bg-card); border: 1px solid var(--bg-border);
      border-radius: 8px; padding: 0; width: 260px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7); display: none;
      font-family: 'Inter', sans-serif; overflow: hidden;
      flex-direction: column; max-height: calc(100vh - 40px);
    }`
);

// ─── Write or report ────────────────────────────────────────────────────────
if (patchCount === 0) {
  console.log('\n✅ All patches already applied — nothing to do.\n');
} else if (DRY_RUN) {
  console.log(`\n📋 ${patchCount} patch(es) ready. Re-run with --apply to write.\n`);
} else {
  writeFileSync(FILE, src, 'utf8');
  console.log(`\n✅ ${patchCount} patch(es) written to ${FILE}\n`);
}

console.log(`Verification checklist:
  1. Open Run Show with a production that has 10+ cast members
  2. Click a line zone on the script — the zone-click popover should
     show a scrollable cast list, not overflow the screen
  3. Click the FAB "Log Note" button — same behavior, scrollable cast
  4. Confirm the note type strip, text input, and buttons remain
     visible and accessible below the scrollable cast list
  5. With fewer actors (e.g. 4–5), confirm no unnecessary scrollbar appears
`);
