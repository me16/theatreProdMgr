#!/usr/bin/env node
/**
 * patch-actor-fix-html.mjs
 *
 * Fixes the HTML that the previous patch skipped due to a false-positive
 * idempotency check. Replaces the <select id="zd-actor"> with the
 * checkbox <div id="zd-actor-list">.
 *
 * Usage:  node patch-actor-fix-html.mjs          (dry run)
 *         node patch-actor-fix-html.mjs --apply  (write)
 */

import { readFileSync, writeFileSync } from 'fs';

const DRY = !process.argv.includes('--apply');
const log = msg => console.log(msg);
const ok  = msg => console.log(`  ✅ ${msg}`);
const err = msg => { console.error(`  ❌ ${msg}`); process.exit(1); };

log(`\n🔧 Hotfix: Actor checkbox HTML (${DRY ? 'DRY RUN' : 'APPLYING'})\n`);

const HTML = 'index.html';
let buf = readFileSync(HTML, 'utf8');

// Check if already fixed (the div version exists)
if (buf.includes('id="zd-actor-list"')) {
  ok('Already patched — zd-actor-list div exists.');
  process.exit(0);
}

// Check the select still exists
const OLD = `              <select class="ze-input" id="zd-actor" style="font-size:11px;padding:4px 6px;">
                <option value="">— none —</option>
              </select>`;

const NEW = `              <div id="zd-actor-list" style="max-height:120px;overflow-y:auto;border:1px solid var(--bg-border);border-radius:4px;padding:4px 6px;font-size:11px;background:var(--bg-deep);"></div>`;

const idx = buf.indexOf(OLD);
if (idx === -1) err('Could not find the <select id="zd-actor"> element. Was index.html modified?');

// Also update the label from "Assign Actor" to "Assign Actor(s)"
buf = buf.slice(0, idx) + NEW + buf.slice(idx + OLD.length);
buf = buf.replace(
  '<div class="ze-label">Assign Actor</div>',
  '<div class="ze-label">Assign Actor(s)</div>'
);
ok('Replaced <select> with checkbox <div> and updated label');

if (!DRY) {
  writeFileSync(HTML, buf, 'utf8');
  log('\n✅ Written. Reload the app and the actor checkboxes should appear.\n');
} else {
  log('\n🔍 Dry run OK — run with --apply to write.\n');
}
