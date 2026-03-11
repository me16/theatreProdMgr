#!/usr/bin/env node
/**
 * cue-actor-fix.mjs
 * Fixes: actor dropdown reverts to "none" after Apply.
 *
 * Root cause: zePopulateDetail rebuilds the <select> via innerHTML with a
 * `selected` attribute on the correct <option>, but some browsers don't
 * reliably honour `selected` when set through innerHTML on a <select>.
 * Fix: explicitly set actorSelect.value after innerHTML assignment.
 *
 * Usage:
 *   node cue-actor-fix.mjs --dry-run
 *   node cue-actor-fix.mjs --apply
 *   node cue-actor-fix.mjs --apply --project-root /path/to/project
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

console.log(`\n🔧 Actor dropdown fix — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`   File: ${fullPath}\n`);

if (!fs.existsSync(fullPath)) {
  console.error(`❌ File not found: ${fullPath}`);
  process.exit(1);
}

let src = fs.readFileSync(fullPath, 'utf8');

// ── Fix: add explicit .value set after innerHTML in zePopulateDetail ──
const OLD = `    actorSelect.innerHTML = opts;
  }
  if (focusText && t) requestAnimationFrame`;

const NEW = `    actorSelect.innerHTML = opts;
    // Explicitly set value — innerHTML + selected attribute is unreliable in some browsers
    if (z.assignedCastId && z.assignedCharName) {
      actorSelect.value = z.assignedCastId + '::' + z.assignedCharName;
    }
  }
  if (focusText && t) requestAnimationFrame`;

const SKIP = 'Explicitly set value';

if (src.includes(SKIP)) {
  console.log('  ⏭️  Already applied.');
  process.exit(0);
}

const idx = src.indexOf(OLD);
if (idx === -1) {
  console.error('  ❌ Anchor not found. Check that patch 1C was applied to zePopulateDetail.');
  console.error('     Looking for: actorSelect.innerHTML = opts;');

  // Diagnostic: check if the actor dropdown code exists at all
  if (!src.includes('zd-actor-section')) {
    console.error('     ⚠️  zd-actor-section not found — patch 1C may not have been applied.');
  }
  if (!src.includes('actorSelect.innerHTML')) {
    console.error('     ⚠️  actorSelect.innerHTML not found — the dropdown rebuild code is missing.');
  }
  if (!src.includes('assignedCastId')) {
    console.error('     ⚠️  assignedCastId not found — patch 1D may not have been applied either.');
  }

  process.exit(1);
}

src = src.slice(0, idx) + NEW + src.slice(idx + OLD.length);

if (APPLY) {
  fs.writeFileSync(fullPath, src, 'utf8');
  console.log('  ✅ Fix applied.');
  console.log('\n  Verify: select an actor → Apply → dropdown should stay on the selected actor.');
} else {
  console.log('  ✅ Anchor found, fix ready.');
  console.log('  ⚠️  DRY RUN — re-run with --apply to write.');
}
