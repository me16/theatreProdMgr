#!/usr/bin/env node
/**
 * patch-actor-css-fix.mjs
 *
 * Fixes all CSS that was skipped by the false-positive idempotency check
 * in the original patch:
 *   1. Checkbox list layout (each actor on its own row)
 *   2. Stacked pills for multi-actor zones
 *   3. Floating charName pills in Run Show
 *
 * Usage:  node patch-actor-css-fix.mjs          (dry run)
 *         node patch-actor-css-fix.mjs --apply  (write)
 */

import { readFileSync, writeFileSync } from 'fs';

const DRY = !process.argv.includes('--apply');
const log = msg => console.log(msg);
const ok  = msg => console.log(`  ✅ ${msg}`);
const err = msg => { console.error(`  ❌ ${msg}`); process.exit(1); };

log(`\n🎨 Patch: Actor CSS Fixes (${DRY ? 'DRY RUN' : 'APPLYING'})\n`);

const HTML = 'index.html';
let buf = readFileSync(HTML, 'utf8');

// ── 1. Inject new CSS block before </style> ──
// We'll add all the missing styles in one clean block at the end of <style>
const NEW_CSS_BLOCK = `
    /* ===== ACTOR ASSIGNMENT FIXES ===== */
    /* Stacked pills when multiple actors assigned to a zone */
    .rs-actor-pill + .rs-actor-pill { top: calc(50% + 14px); }
    .rs-actor-pill + .rs-actor-pill + .rs-actor-pill { top: calc(50% + 28px); }

    /* Floating pill for charName zones (zone itself is hidden) */
    .rs-actor-pill--charname {
      position: absolute;
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
      color: #fff; opacity: 0.85;
    }
    .rs-actor-pill--charname + .rs-actor-pill--charname { margin-top: 2px; }

    /* Stacked badges in zone editor */
    .ze-zone-actor-badge + .ze-zone-actor-badge { top: calc(50% + 14px); }
    .ze-zone-actor-badge + .ze-zone-actor-badge + .ze-zone-actor-badge { top: calc(50% + 28px); }

    /* Actor checkbox list in zone detail panel */
    .zd-actor-cb-row {
      display: flex; align-items: center; gap: 6px;
      padding: 3px 2px; cursor: pointer; border-radius: 3px;
    }
    .zd-actor-cb-row:hover { background: rgba(200,169,110,0.08); }
    .zd-actor-cb-row input[type="checkbox"] { accent-color: #5b9bd4; margin: 0; flex-shrink: 0; }
    .zd-actor-cb-label {
      font-family: 'DM Mono', monospace; font-size: 11px;
      color: var(--text-secondary); line-height: 1.3;
    }
    .zd-actor-cb-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }`;

// Check idempotency
if (buf.includes('.rs-actor-pill--charname {')) {
  ok('CSS block already present (idempotent).');
} else {
  // Find the last </style> tag
  const styleCloseIdx = buf.lastIndexOf('</style>');
  if (styleCloseIdx === -1) err('Could not find </style> in index.html');
  buf = buf.slice(0, styleCloseIdx) + NEW_CSS_BLOCK + '\n    ' + buf.slice(styleCloseIdx);
  ok('Injected actor CSS block before </style>');
}

if (!DRY) writeFileSync(HTML, buf, 'utf8');

log('');
if (DRY) {
  log('🔍 Dry run complete. Run with --apply to write.\n');
} else {
  log('✅ CSS applied!\n');
  log('Verification:');
  log('  1. Edit Script → zone detail → actor checkboxes should stack vertically');
  log('  2. Run Show → Actors ON → charName zones show floating pills');
  log('  3. Run Show → multi-actor zones show stacked pills');
  log('');
}
