#!/usr/bin/env node
/**
 * patch-runshow-bugs.mjs
 *
 * Fixes keyboard page navigation (Arrow keys / [ ]) in the Run Show tab.
 *
 * ROOT CAUSE (index.html):
 *   #rs-canvas-area has overflow:auto, making it a scroll container. After the
 *   user clicks into the script area, the browser routes Arrow keys to that
 *   scroll container BEFORE document-level keydown listeners fire — so
 *   rsHandleKeydown never sees them. [ and ] reach the handler but rsChangePage
 *   is async and was called without await, causing render races.
 *
 * PATCH 1 — index.html
 *   Add tabindex="-1" and outline:none to #rs-canvas-area so JS can focus it
 *   programmatically after a click, keeping key events on the document.
 *
 * PATCH 2 — src/runshow/Runshow.js  (3 changes)
 *   a) Add a click listener on #rs-canvas-area that calls .focus() on it.
 *   b) Make rsHandleKeydown async.
 *   c) await rsChangePage() and call preventDefault() for Arrow/bracket keys.
 *
 * Usage — run from the project root (cue-stage-manager/):
 *   node patch-runshow-bugs.mjs [--dry-run]
 */

import fs   from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');

// ── colours ───────────────────────────────────────────────────────────────────
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
const ok   = m => console.log(`${G}✔${X}  ${m}`);
const warn = m => console.log(`${Y}⚠${X}  ${m}`);
const fail = m => console.error(`${R}✖${X}  ${m}`);
const hdr  = m => console.log(`\n${B}${C}${m}${X}`);
const show = (a, b) => { console.log(`  ${R}- ${a}${X}`); console.log(`  ${G}+ ${b}${X}`); };

// ── patches ───────────────────────────────────────────────────────────────────

const PATCH_1_SEARCH  = '<div id="rs-canvas-area" style="flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px;background:var(--bg-deep);position:relative;min-height:0;">';
const PATCH_1_REPLACE = '<div id="rs-canvas-area" tabindex="-1" style="flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px;background:var(--bg-deep);position:relative;min-height:0;outline:none;">';

const PATCH_2A_SEARCH = [
  "  // Hit overlay click-to-close popover",
  "  document.getElementById('rs-hit-overlay')?.addEventListener('click', e => {",
  "    if (e.target === document.getElementById('rs-hit-overlay')) rsClosePopover();",
  "  });",
].join('\n');

const PATCH_2A_REPLACE = [
  "  // Hit overlay click-to-close popover",
  "  document.getElementById('rs-hit-overlay')?.addEventListener('click', e => {",
  "    if (e.target === document.getElementById('rs-hit-overlay')) rsClosePopover();",
  "  });",
  "",
  "  // Focus the canvas area on click so the document-level keydown handler",
  "  // receives Arrow/bracket keys instead of the scroll container eating them.",
  "  document.getElementById('rs-canvas-area')?.addEventListener('click', () => {",
  "    document.getElementById('rs-canvas-area')?.focus({ preventScroll: true });",
  "  });",
].join('\n');

const PATCH_2B_SEARCH = [
  "/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "   KEYBOARD SHORTCUTS",
  "   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */",
  "function rsHandleKeydown(e) {",
].join('\n');

const PATCH_2B_REPLACE = [
  "/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "   KEYBOARD SHORTCUTS",
  "   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */",
  "async function rsHandleKeydown(e) {",
].join('\n');

const PATCH_2C_SEARCH  = "  if (e.key === 'ArrowRight' || e.key === ']') rsChangePage(1);";
const PATCH_2C_REPLACE = "  if (e.key === 'ArrowRight' || e.key === ']') { e.preventDefault(); await rsChangePage(1); }";

const PATCH_2D_SEARCH  = "  if (e.key === 'ArrowLeft' || e.key === '[') rsChangePage(-1);";
const PATCH_2D_REPLACE = "  if (e.key === 'ArrowLeft' || e.key === '[') { e.preventDefault(); await rsChangePage(-1); }";

const PATCHES = [
  { file: 'index.html',                description: 'tabindex="-1" + outline:none on #rs-canvas-area (ROOT CAUSE)', search: PATCH_1_SEARCH,  replace: PATCH_1_REPLACE  },
  { file: 'src/runshow/Runshow.js',    description: 'Focus #rs-canvas-area on click',                               search: PATCH_2A_SEARCH, replace: PATCH_2A_REPLACE },
  { file: 'src/runshow/Runshow.js',    description: 'Make rsHandleKeydown async',                                   search: PATCH_2B_SEARCH, replace: PATCH_2B_REPLACE },
  { file: 'src/runshow/Runshow.js',    description: 'await rsChangePage + preventDefault for ArrowRight / ]',       search: PATCH_2C_SEARCH, replace: PATCH_2C_REPLACE },
  { file: 'src/runshow/Runshow.js',    description: 'await rsChangePage + preventDefault for ArrowLeft / [',        search: PATCH_2D_SEARCH, replace: PATCH_2D_REPLACE },
];

// ── engine ────────────────────────────────────────────────────────────────────

let totalApplied = 0, totalSkipped = 0, totalMissing = 0;

const byFile = {};
for (const p of PATCHES) (byFile[p.file] = byFile[p.file] || []).push(p);

console.log(`\n${B}patch-runshow-bugs.mjs${X}${DRY_RUN ? `  ${Y}[DRY RUN]${X}` : ''}`);

for (const [relPath, patches] of Object.entries(byFile)) {
  hdr(`Patching ${relPath}  (${patches.length} patch${patches.length !== 1 ? 'es' : ''})`);

  const absPath = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(absPath)) {
    fail(`File not found: ${absPath}`);
    fail(`Run this script from the cue-stage-manager/ project root.`);
    totalMissing += patches.length;
    continue;
  }

  const original = fs.readFileSync(absPath, 'utf8');
  let source = original;
  let changed = false;

  for (const patch of patches) {
    console.log(`\n  ${B}→ ${patch.description}${X}`);

    if (!source.includes(patch.search)) {
      if (source.includes(patch.replace)) {
        warn('Already patched — skipping.');
        totalSkipped++;
      } else {
        fail('Search string not found.');
        totalMissing++;
      }
      continue;
    }

    const count = source.split(patch.search).length - 1;
    if (count > 1) {
      fail(`Search string appears ${count} times — refusing to apply to avoid corruption.`);
      totalMissing++;
      continue;
    }

    show(patch.search.split('\n')[0], patch.replace.split('\n')[0]);
    source = source.replace(patch.search, patch.replace);
    changed = true;
    totalApplied++;
  }

  if (!DRY_RUN && changed) {
    fs.writeFileSync(absPath + '.bak', original, 'utf8');
    ok(`Backup → ${relPath}.bak`);
    fs.writeFileSync(absPath, source, 'utf8');
    ok(`Patched → ${absPath}`);
  }
}

console.log(`\n${'─'.repeat(54)}`);
console.log(`${B}Summary${X}`);
console.log(`  Applied : ${G}${totalApplied}${X}`);
if (totalSkipped) console.log(`  Skipped : ${Y}${totalSkipped}${X}  (already patched)`);
if (totalMissing) console.log(`  Missing : ${R}${totalMissing}${X}  (search string not found)`);

if (totalMissing > 0) { console.log(`\n${Y}One or more patches failed.${X}`); process.exit(1); }
if (DRY_RUN) { console.log(`\n${Y}Dry run complete. Re-run without --dry-run to apply.${X}`); }
else          { console.log(`\n${G}${B}All patches applied successfully.${X}`); }
