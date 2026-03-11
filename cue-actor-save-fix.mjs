#!/usr/bin/env node
/**
 * cue-actor-save-fix.mjs
 * Fixes: patch 1D (actor save in zeApplyDetail) was skipped due to
 * a non-unique idempotency check — 1C introduced 'assignedCastId' first.
 *
 * This script adds the actor-save logic to zeApplyDetail directly.
 *
 * Usage:
 *   node cue-actor-save-fix.mjs --dry-run
 *   node cue-actor-save-fix.mjs --apply
 *   node cue-actor-save-fix.mjs --apply --project-root /path/to/project
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROJECT_ROOT = (() => {
  const idx = args.indexOf('--project-root');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : process.cwd();
})();

const FILE = 'src/linenotes/linenotes.js';
const fullPath = path.join(PROJECT_ROOT, FILE);

console.log(`\n🔧 Actor save fix (1D) — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`   File: ${fullPath}\n`);

if (!fs.existsSync(fullPath)) {
  console.error(`❌ File not found: ${fullPath}`);
  process.exit(1);
}

let src = fs.readFileSync(fullPath, 'utf8');

// Skip check: unique string from the 1D replacement
const SKIP = "const actorVal = document.getElementById('zd-actor')";

if (src.includes(SKIP)) {
  console.log('  ⏭️  Patch 1D already applied — zeApplyDetail has actor save logic.');
  process.exit(0);
}

// The anchor: the mutual-exclusion block followed by the render/save calls in zeApplyDetail.
// This is the UNPATCHED version — 1D was skipped, so the original code is intact.
const OLD = `  if (z.isCharName) { z.isStageDirection = false; z.isMusicLine = false; }
  if (z.isStageDirection) { z.isCharName = false; z.isMusicLine = false; }
  if (z.isMusicLine) { z.isCharName = false; z.isStageDirection = false; }
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones();`;

const NEW = `  if (z.isCharName) { z.isStageDirection = false; z.isMusicLine = false; }
  if (z.isStageDirection) { z.isCharName = false; z.isMusicLine = false; }
  if (z.isMusicLine) { z.isCharName = false; z.isStageDirection = false; }
  // Actor assignment
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
  if (z.isCharName || z.isStageDirection) { z.assignedCastId = null; z.assignedCharName = null; }
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones();`;

const idx = src.indexOf(OLD);
if (idx === -1) {
  console.error('  ❌ Anchor not found in zeApplyDetail.');
  console.error('     This means either:');
  console.error('     a) 1D was already applied (but the skip check didn\'t find it)');
  console.error('     b) The mutual-exclusion code has different whitespace/formatting');
  console.error('');

  // Diagnostic
  if (src.includes('z.isCharName') && src.includes('zeApplyDetail')) {
    console.error('     zeApplyDetail exists. Dumping context around mutual-exclusion...');
    const fnIdx = src.indexOf('function zeApplyDetail');
    if (fnIdx !== -1) {
      const snippet = src.substring(fnIdx, fnIdx + 800);
      console.error('\n--- zeApplyDetail (first 800 chars) ---');
      console.error(snippet);
      console.error('--- end ---\n');
    }
  }
  process.exit(1);
}

// Check uniqueness
const secondIdx = src.indexOf(OLD, idx + 1);
if (secondIdx !== -1) {
  console.error('  ❌ Anchor found multiple times — cannot safely patch.');
  process.exit(1);
}

src = src.slice(0, idx) + NEW + src.slice(idx + OLD.length);

if (APPLY) {
  fs.writeFileSync(fullPath, src, 'utf8');
  console.log('  ✅ Patch 1D applied — zeApplyDetail now saves actor assignment.');
  console.log('');
  console.log('  Verify:');
  console.log('  1. Select a dialogue zone');
  console.log('  2. Pick an actor from the dropdown');
  console.log('  3. Click Apply');
  console.log('  4. Dropdown should remain on the selected actor');
  console.log('  5. Zone overlay should show actor badge');
  console.log('  6. Change page and return — assignment should persist');
} else {
  console.log('  ✅ Anchor found, patch ready.');
  console.log('  ⚠️  DRY RUN — re-run with --apply to write.');
}
