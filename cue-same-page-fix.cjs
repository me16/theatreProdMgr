#!/usr/bin/env node
/**
 * cue-same-page-fix.cjs
 * 
 * Allows a prop cue's exit page to equal its enter page (same-page enter/exit).
 * 
 * Targets:
 *   1. saveProp() validation — change `exitPage <= enterPage` to `exitPage < enterPage`
 *   2. getPropStatus() — verify same-page logic works (enterPage === exitPage should show ON)
 * 
 * Usage:
 *   node cue-same-page-fix.cjs [--apply] [--project-root /path/to/project]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const rootIdx = args.indexOf('--project-root');
const PROJECT_ROOT = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd();

const PROPS_FILE = path.join(PROJECT_ROOT, 'src', 'props', 'props.js');

function readFile(fp) {
  if (!fs.existsSync(fp)) {
    console.error(`❌ File not found: ${fp}`);
    process.exit(1);
  }
  return fs.readFileSync(fp, 'utf8');
}

function writeFile(fp, content) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${fp}`);
  } else {
    fs.writeFileSync(fp, content, 'utf8');
    console.log(`  ✅ Wrote ${fp}`);
  }
}

// ── Patch helpers ──

function applyPatch(src, label, oldStr, newStr) {
  if (src.includes(newStr)) {
    console.log(`  ⏭  ${label}: ALREADY_PRESENT`);
    return src;
  }
  if (!src.includes(oldStr)) {
    console.error(`  ❌ ${label}: Could not find target string.`);
    console.error(`     Looking for: ${JSON.stringify(oldStr).slice(0, 120)}`);
    process.exit(1);
  }
  const count = src.split(oldStr).length - 1;
  if (count > 1) {
    console.error(`  ❌ ${label}: Found ${count} matches (expected 1). Aborting.`);
    process.exit(1);
  }
  console.log(`  ✔  ${label}: Patched`);
  return src.replace(oldStr, newStr);
}

// Try multiple candidate patterns for the validation check
function applyPatchEither(src, label, candidates, newStr) {
  if (src.includes(newStr)) {
    console.log(`  ⏭  ${label}: ALREADY_PRESENT`);
    return src;
  }
  for (const oldStr of candidates) {
    if (src.includes(oldStr)) {
      const count = src.split(oldStr).length - 1;
      if (count === 1) {
        console.log(`  ✔  ${label}: Patched (matched candidate: ${JSON.stringify(oldStr).slice(0, 80)})`);
        return src.replace(oldStr, newStr);
      }
    }
  }
  console.error(`  ❌ ${label}: None of ${candidates.length} candidates matched.`);
  candidates.forEach((c, i) => console.error(`     Candidate ${i + 1}: ${JSON.stringify(c).slice(0, 120)}`));
  process.exit(1);
}

// ══════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════

console.log(`\n🔧 cue-same-page-fix — Allow exit page == enter page`);
console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
console.log(`   Root: ${PROJECT_ROOT}\n`);

let src = readFile(PROPS_FILE);
const originalSrc = src;

// ── FIX 1: saveProp() validation ──────────────────────────
// Current code might be either:
//   cues[i].exitPage <= cues[i].enterPage  (strict: exit must be greater)
//   cues[i].exitPage < cues[i].enterPage   (already allows equal — skip)
//
// We also fix the toast message to be accurate.

const validationCandidates = [
  // Pattern A: <= with "exit must be > enter" message
  `if (cues[i].exitPage <= cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit must be > enter.', 'error'); return; }`,
  // Pattern B: <= with "> enter" phrasing
  `if (cues[i].exitPage <= cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit page must be greater than enter.', 'error'); return; }`,
  // Pattern C: <= with ">= enter" message (contradictory but possible)
  `if (cues[i].exitPage <= cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit must be >= enter.', 'error'); return; }`,
  // Pattern D: < with wrong message (already correct logic but let's normalize message)
  `if (cues[i].exitPage < cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit must be > enter.', 'error'); return; }`,
];

const validationFixed = `if (cues[i].exitPage < cues[i].enterPage) { toast('Cue #' + (i+1) + ': exit must be >= enter.', 'error'); return; }`;

src = applyPatchEither(src, 'FIX 1 — saveProp validation (allow exit == enter)', validationCandidates, validationFixed);

// ── FIX 2: Verify getPropStatus handles same-page correctly ──
// The condition `page >= cue.enterPage && page <= cue.exitPage` naturally
// handles enterPage === exitPage (e.g. both = 5, page 5 → 5>=5 && 5<=5 → ON).
// Just verify it exists and uses >= / <= (not > / <).

const statusCheckOk = src.includes('page >= cue.enterPage && page <= cue.exitPage');
if (statusCheckOk) {
  console.log(`  ✔  FIX 2 — getPropStatus: Same-page logic already correct (>= / <=)`);
} else {
  // Check if there's a stricter version
  const strictCandidates = [
    { old: 'page > cue.enterPage && page < cue.exitPage', label: '> / <' },
    { old: 'page > cue.enterPage && page <= cue.exitPage', label: '> / <=' },
    { old: 'page >= cue.enterPage && page < cue.exitPage', label: '>= / <' },
  ];
  let fixed = false;
  for (const { old, label } of strictCandidates) {
    if (src.includes(old)) {
      src = applyPatch(src, `FIX 2 — getPropStatus: Relax ${label} to >= / <=`, old, 'page >= cue.enterPage && page <= cue.exitPage');
      fixed = true;
      break;
    }
  }
  if (!fixed) {
    console.error(`  ❌ FIX 2 — Could not locate getPropStatus ON-stage condition.`);
    process.exit(1);
  }
}

// ── FIX 3: Legacy enters/exits array path in getPropStatus ──
// Check the fallback path too: `page >= enters[i] && page <= (exits[i] || 9999)`
const legacyCheckOk = src.includes('page >= enters[i] && page <= (exits[i] || 9999)');
if (legacyCheckOk) {
  console.log(`  ✔  FIX 3 — getPropStatus legacy path: Already correct (>= / <=)`);
} else {
  console.log(`  ⚠  FIX 3 — Legacy enters/exits path not found (may have been removed). Skipping.`);
}

// ── Write ──
if (src === originalSrc) {
  console.log(`\n✅ No changes needed — all fixes already present.`);
} else {
  writeFile(PROPS_FILE, src);
}

// ── Summary ──
console.log(`
╔══════════════════════════════════════════════════════╗
║  Verification Checklist                              ║
╠══════════════════════════════════════════════════════╣
║  1. Add a prop with a cue where enter = exit = 5    ║
║  2. Save should succeed (no validation error)        ║
║  3. In View Show on page 5, prop should show ON      ║
║  4. On page 4 and 6, prop should show Off Stage      ║
║  5. Existing props with exit > enter still work      ║
╚══════════════════════════════════════════════════════╝
`);

if (DRY_RUN) {
  console.log('Run with --apply to write changes.\n');
}
