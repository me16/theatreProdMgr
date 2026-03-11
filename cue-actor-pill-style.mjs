#!/usr/bin/env node
/**
 * cue-actor-pill-style.mjs
 * UI update: actor indicator becomes an opaque colored pill pinned to the
 * left of the line zone — prominent and obvious in both Zone Editor and Run Show.
 *
 * Changes:
 *   1. index.html CSS — .ze-zone-actor-badge repositioned left, opaque, larger
 *   2. index.html CSS — .rs-actor-pill fully opaque
 *   3. linenotes.js  — zeRenderZones badge uses cast member color inline
 *
 * Usage:
 *   node cue-actor-pill-style.mjs --dry-run
 *   node cue-actor-pill-style.mjs --apply
 *   node cue-actor-pill-style.mjs --apply --project-root /path/to/project
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROJECT_ROOT = (() => {
  const idx = args.indexOf('--project-root');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : process.cwd();
})();

const results = [];
let hadError = false;

function log(msg) { console.log(msg); }
function logOk(tag) { results.push({ tag, status: 'OK' }); log(`  ✅ ${tag}`); }
function logSkip(tag) { results.push({ tag, status: 'SKIP' }); log(`  ⏭️  ${tag} — already applied`); }
function logFail(tag, reason) { results.push({ tag, status: 'FAIL', reason }); log(`  ❌ ${tag} — ${reason}`); hadError = true; }

function readFile(relPath) {
  const full = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  return fs.readFileSync(full, 'utf8');
}
function writeFile(relPath, content) {
  if (!APPLY) return;
  fs.writeFileSync(path.join(PROJECT_ROOT, relPath), content, 'utf8');
}
function patch(src, old, repl, tag, skipIf) {
  if (skipIf && src.includes(skipIf)) { logSkip(tag); return null; }
  const i = src.indexOf(old);
  if (i === -1) { logFail(tag, `Anchor not found`); return null; }
  if (src.indexOf(old, i + 1) !== -1) { logFail(tag, `Anchor not unique`); return null; }
  logOk(tag);
  return src.slice(0, i) + repl + src.slice(i + old.length);
}

log(`\n🎨 Actor pill styling — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
log(`   Project root: ${PROJECT_ROOT}`);

// ═══════════════════════════════════════════════════════════
// 1. index.html — CSS for both badges
// ═══════════════════════════════════════════════════════════
log('\n📄 index.html');
let html;
try { html = readFile('index.html'); } catch(e) { logFail('html:read', e.message); }

if (html) {
  // ── Zone editor badge: reposition to left, opaque, larger ──
  const oldZeBadge = `    /* Actor assignment badge on zones */
    .ze-zone-actor-badge {
      position: absolute; top: -1px; right: 2px;
      font-family: 'DM Mono', monospace; font-size: 8px;
      background: rgba(91,155,212,0.25); color: #5b9bd4;
      padding: 0 4px; border-radius: 2px; line-height: 14px;
      pointer-events: none; white-space: nowrap; max-width: 80px;
      overflow: hidden; text-overflow: ellipsis;
    }`;

  const newZeBadge = `    /* Actor assignment pill on zones — left-pinned, opaque */
    .ze-zone-actor-badge {
      position: absolute; left: -3px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      color: #fff; pointer-events: none; white-space: nowrap;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
      z-index: 6;
    }`;

  let r = patch(html, oldZeBadge, newZeBadge, 'CSS: ze-zone-actor-badge → left opaque pill',
    'left-pinned, opaque');
  if (r !== null) html = r;

  // ── Run Show pill: fully opaque ──
  const oldRsPill = `    /* Run Show actor pill on line zones */
    .rs-actor-pill {
      position: absolute; left: -2px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px;
      padding: 1px 5px; border-radius: 3px; line-height: 14px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 90px; overflow: hidden; text-overflow: ellipsis;
      opacity: 0.85;
    }`;

  const newRsPill = `    /* Run Show actor pill on line zones — opaque */
    .rs-actor-pill {
      position: absolute; left: -3px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      padding: 1px 6px; border-radius: 3px; line-height: 15px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis;
    }`;

  r = patch(html, oldRsPill, newRsPill, 'CSS: rs-actor-pill → fully opaque',
    'opaque */\n    .rs-actor-pill');
  if (r !== null) html = r;

  writeFile('index.html', html);
}

// ═══════════════════════════════════════════════════════════
// 2. linenotes.js — badge uses cast member color
// ═══════════════════════════════════════════════════════════
log('\n📄 src/linenotes/linenotes.js');
let ln;
try { ln = readFile('src/linenotes/linenotes.js'); } catch(e) { logFail('ln:read', e.message); }

if (ln) {
  const oldBadgeJs = `    if (zone.assignedCharName) {
      const ab = document.createElement('span');
      ab.className = 'ze-zone-actor-badge';
      ab.textContent = zone.assignedCharName;
      div.appendChild(ab);
    }`;

  const newBadgeJs = `    if (zone.assignedCharName) {
      const ab = document.createElement('span');
      ab.className = 'ze-zone-actor-badge';
      ab.textContent = zone.assignedCharName;
      const _cast = getCastMembers();
      const _member = _cast.find(m => m.id === zone.assignedCastId);
      ab.style.background = _member?.color || '#5b9bd4';
      div.appendChild(ab);
    }`;

  const r = patch(ln, oldBadgeJs, newBadgeJs, 'JS: badge uses cast member color',
    '_member?.color');
  if (r !== null) ln = r;

  writeFile('src/linenotes/linenotes.js', ln);
}

// ── Summary ──
log('\n' + '═'.repeat(50));
const ok = results.filter(r => r.status === 'OK').length;
const skip = results.filter(r => r.status === 'SKIP').length;
const fail = results.filter(r => r.status === 'FAIL').length;
log(`  ✅ ${ok}  ⏭️ ${skip}  ❌ ${fail}`);

if (!APPLY && ok > 0) log('\n  ⚠️  DRY RUN — re-run with --apply to write.');
if (APPLY && ok > 0 && fail === 0) {
  log('\n  ✅ Done. Both zone editor and run show pills are now opaque,');
  log('     colored per cast member, and pinned to the left of each line.');
}

process.exit(hadError ? 1 : 0);
