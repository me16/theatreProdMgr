#!/usr/bin/env node
/**
 * patch-connector-thickness.mjs
 *
 * Thickens connector lines in both Zone Editor and Run Show.
 *
 * Usage:
 *   node patch-connector-thickness.mjs          # dry-run
 *   node patch-connector-thickness.mjs --apply  # write to disk
 */

import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const ROOT = process.cwd();
let patchCount = 0;
let failCount = 0;

function readFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.error(`  ✗ File not found: ${rel}`); return null; }
  return fs.readFileSync(abs, 'utf-8');
}
function writeFile(rel, content) {
  if (APPLY) {
    fs.writeFileSync(path.join(ROOT, rel), content, 'utf-8');
    console.log(`  ✔ Wrote ${rel}`);
  } else {
    console.log(`  [dry-run] Would write ${rel}`);
  }
}
function replaceAll(content, oldStr, newStr, label) {
  if (content == null) { failCount++; return content; }
  if (!content.includes(oldStr)) {
    console.error(`  ✗ Not found: ${label}`);
    failCount++;
    return content;
  }
  const count = content.split(oldStr).length - 1;
  patchCount++;
  console.log(`  ✓ ${label} (${count} occurrence${count > 1 ? 's' : ''})`);
  return content.split(oldStr).join(newStr);
}

// ── Zone Editor (linenotes.js) ──
console.log('\n═══ src/linenotes/linenotes.js ═══');
let ln = readFile('src/linenotes/linenotes.js');
if (ln) {
  ln = replaceAll(ln,
    `line.setAttribute('stroke-width', '0.25');`,
    `line.setAttribute('stroke-width', '0.4');`,
    'ZE line stroke-width 0.25→0.4'
  );
  ln = replaceAll(ln,
    `line.setAttribute('stroke-dasharray', '0.6,0.4');`,
    `line.setAttribute('stroke-dasharray', '1.2,0.6');`,
    'ZE line dash pattern wider'
  );
  ln = replaceAll(ln,
    `dot.setAttribute('r', '0.8');`,
    `dot.setAttribute('r', '1');`,
    'ZE dot radius 0.8→1'
  );
  writeFile('src/linenotes/linenotes.js', ln);
}

// ── Run Show (cue-margin.js) ──
console.log('\n═══ src/runshow/cue-margin.js ═══');
let cm = readFile('src/runshow/cue-margin.js');
if (cm) {
  cm = replaceAll(cm,
    `line.setAttribute('stroke-width', '0.25');`,
    `line.setAttribute('stroke-width', '0.4');`,
    'RS line stroke-width 0.25→0.4'
  );
  cm = replaceAll(cm,
    `line.setAttribute('stroke-dasharray', '0.8,0.5');`,
    `line.setAttribute('stroke-dasharray', '1.2,0.6');`,
    'RS line dash pattern wider'
  );
  cm = replaceAll(cm,
    `dot.setAttribute('r', '0.8');`,
    `dot.setAttribute('r', '1');`,
    'RS dot radius 0.8→1'
  );
  writeFile('src/runshow/cue-margin.js', cm);
}

// ── Summary ──
console.log('\n' + '═'.repeat(40));
console.log(`Patches: ${patchCount}  |  Failures: ${failCount}`);
if (!APPLY) console.log('Dry-run. Re-run with --apply to write.');
