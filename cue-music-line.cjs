#!/usr/bin/env node
/**
 * cue-music-line.cjs
 * Adds "Music Line" zone type to CUE Stage Manager.
 *
 * Music lines are functionally identical to dialogue lines (they appear in the
 * run show interface, are clickable for line notes, and are keyboard-navigable)
 * but are highlighted in a distinct teal/cyan color so sound operators can
 * clearly see which lines are sung vs spoken.
 *
 * Touch points:
 *   1. index.html       — checkbox in zone detail panel, multi-bar button, CSS
 *   2. linenotes.js     — apply, populate, render, list, keyboard M, multi-toggle
 *   3. Runshow.js       — render music lines with distinct highlight color
 *
 * Usage:
 *   node cue-music-line.cjs                  # dry-run (no writes)
 *   node cue-music-line.cjs --apply          # write changes
 *   node cue-music-line.cjs --apply --project-root /path/to/cue
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootIdx = args.indexOf('--project-root');
const PROJECT_ROOT = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : process.cwd();

let patchCount = 0;
let skipCount = 0;
const results = [];

function readFile(relPath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf8');
}

function writeFile(relPath, content) {
  if (APPLY) fs.writeFileSync(path.join(PROJECT_ROOT, relPath), content, 'utf8');
}

function applyPatch(file, label, oldStr, newStr) {
  let content = readFile(file);
  if (content.includes(newStr) && !content.includes(oldStr)) {
    console.log(`  [ALREADY_PRESENT] ${label}`);
    skipCount++;
    results.push({ file, label, status: 'ALREADY_PRESENT' });
    return content;
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    console.error(`  [FAILED] ${label} — anchor string not found in ${file}`);
    console.error(`    Expected to find:\n${oldStr.substring(0, 200)}...`);
    process.exit(1);
  }
  // Ensure unique match
  const secondIdx = content.indexOf(oldStr, idx + 1);
  if (secondIdx !== -1) {
    console.error(`  [FAILED] ${label} — anchor string found multiple times in ${file}`);
    process.exit(1);
  }
  content = content.replace(oldStr, newStr);
  writeFile(file, content);
  patchCount++;
  results.push({ file, label, status: 'APPLIED' });
  console.log(`  [OK] ${label}`);
  return content;
}

// ─────────────────────────────────────────────────────────
// PATCH 1: index.html — Add Music Line checkbox in zone detail panel
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 1: index.html — Music Line checkbox ===');
applyPatch('index.html', 'Add isMusicLine checkbox after stage direction checkbox',
  `<label style="display:flex;align-items:center;gap:7px;margin-bottom:10px;cursor:pointer;">
              <input type="checkbox" id="zd-stagedir" style="accent-color:#5b9bd4;">
              <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);">Stage direction <kbd>S</kbd></span>
            </label>`,
  `<label style="display:flex;align-items:center;gap:7px;margin-bottom:10px;cursor:pointer;">
              <input type="checkbox" id="zd-stagedir" style="accent-color:#5b9bd4;">
              <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);">Stage direction <kbd>S</kbd></span>
            </label>
            <label style="display:flex;align-items:center;gap:7px;margin-bottom:10px;cursor:pointer;">
              <input type="checkbox" id="zd-musicline" style="accent-color:#4ecdc4;">
              <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);">Music line <kbd>M</kbd></span>
            </label>`
);

// ─────────────────────────────────────────────────────────
// PATCH 2: index.html — Add Music Line button in multi-select bar
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 2: index.html — Multi-bar music button ===');
applyPatch('index.html', 'Add Music Line button to multi-select toolbar',
  `<button class="ze-tool-btn" id="ze-btn-multi-dir">Stage Dir <kbd>S</kbd></button>`,
  `<button class="ze-tool-btn" id="ze-btn-multi-dir">Stage Dir <kbd>S</kbd></button>
            <button class="ze-tool-btn" id="ze-btn-multi-music">Music <kbd>M</kbd></button>`
);

// ─────────────────────────────────────────────────────────
// PATCH 3: index.html — CSS for music line zones in zone editor
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 3: index.html — CSS for ze-music-line zones ===');
applyPatch('index.html', 'Add ze-music-line CSS after ze-stage-dir styles',
  `.ze-zone.ze-stage-dir .ze-zone-label { color: rgba(196,92,74,0.7); }`,
  `.ze-zone.ze-stage-dir .ze-zone-label { color: rgba(196,92,74,0.7); }
    .ze-zone.ze-music-line { border-color: rgba(78,205,196,0.5); background: rgba(78,205,196,0.06); }
    .ze-zone.ze-music-line:hover { background: rgba(78,205,196,0.15); border-color: rgba(78,205,196,0.9); }
    .ze-zone.selected.ze-music-line { border-color: #4ecdc4; }
    .ze-zone.ze-music-line .ze-zone-label { color: rgba(78,205,196,0.7); }`
);

// ─────────────────────────────────────────────────────────
// PATCH 4: index.html — CSS for music line list items in zone editor
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 4: index.html — CSS for ze-ml-item list items ===');
applyPatch('index.html', 'Add ze-ml-item CSS after ze-cn-item styles',
  `.ze-list-item.ze-cn-item.selected { border-left-color: #5b9bd4; }`,
  `.ze-list-item.ze-cn-item.selected { border-left-color: #5b9bd4; }
    .ze-list-item.ze-ml-item { border-left: 2px solid rgba(78,205,196,0.4); padding-left: 6px; }
    .ze-list-item.ze-ml-item.selected { border-left-color: #4ecdc4; }`
);

// ─────────────────────────────────────────────────────────
// PATCH 5: index.html — CSS for music line zones in run show overlay
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 5: index.html — CSS for run show music line zones ===');
applyPatch('index.html', 'Add music-line run show CSS after line-zone--has-note',
  `.line-zone--has-note { border-bottom: 2px solid; }`,
  `.line-zone--has-note { border-bottom: 2px solid; }
    .line-zone--music { background: rgba(78,205,196,0.12); border-left: 3px solid rgba(78,205,196,0.6); }
    .line-zone--music:hover { background: rgba(78,205,196,0.22) !important; outline-color: rgba(78,205,196,0.5); }
    .line-zone--music .zone-label { color: rgba(78,205,196,0.8); }`
);

// ─────────────────────────────────────────────────────────
// PATCH 6: linenotes.js — zePopulateDetail: populate music line checkbox
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 6: linenotes.js — zePopulateDetail music checkbox ===');
applyPatch('src/linenotes/linenotes.js', 'Populate isMusicLine checkbox in zePopulateDetail',
  `const sd = getValue('zd-stagedir'); if (sd) sd.checked = !!z.isStageDirection;
  if (focusText && t) requestAnimationFrame(() => { t.focus(); t.select(); });`,
  `const sd = getValue('zd-stagedir'); if (sd) sd.checked = !!z.isStageDirection;
  const ml = getValue('zd-musicline'); if (ml) ml.checked = !!z.isMusicLine;
  if (focusText && t) requestAnimationFrame(() => { t.focus(); t.select(); });`
);

// ─────────────────────────────────────────────────────────
// PATCH 7: linenotes.js — zeApplyDetail: read music checkbox + mutual exclusivity
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 7: linenotes.js — zeApplyDetail music logic ===');
applyPatch('src/linenotes/linenotes.js', 'Handle isMusicLine in zeApplyDetail',
  `z.isCharName = document.getElementById('zd-charname')?.checked || false;
  z.isStageDirection = document.getElementById('zd-stagedir')?.checked || false;
  if (z.isCharName) z.isStageDirection = false;
  if (z.isStageDirection) z.isCharName = false;`,
  `z.isCharName = document.getElementById('zd-charname')?.checked || false;
  z.isStageDirection = document.getElementById('zd-stagedir')?.checked || false;
  z.isMusicLine = document.getElementById('zd-musicline')?.checked || false;
  if (z.isCharName) { z.isStageDirection = false; z.isMusicLine = false; }
  if (z.isStageDirection) { z.isCharName = false; z.isMusicLine = false; }
  if (z.isMusicLine) { z.isCharName = false; z.isStageDirection = false; }`
);

// ─────────────────────────────────────────────────────────
// PATCH 8: linenotes.js — wireZeToolbar: wire music checkbox change + multi button
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 8: linenotes.js — wireZeToolbar music wiring ===');
applyPatch('src/linenotes/linenotes.js', 'Wire zd-musicline change and multi-music button',
  `document.getElementById('zd-charname')?.addEventListener('change', zeApplyDetail);
  document.getElementById('zd-stagedir')?.addEventListener('change', zeApplyDetail);`,
  `document.getElementById('zd-charname')?.addEventListener('change', zeApplyDetail);
  document.getElementById('zd-stagedir')?.addEventListener('change', zeApplyDetail);
  document.getElementById('zd-musicline')?.addEventListener('change', zeApplyDetail);`
);

// ─────────────────────────────────────────────────────────
// PATCH 9: linenotes.js — Add multi-music button wiring in wireZeToolbar
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 9: linenotes.js — Wire multi-music button ===');
applyPatch('src/linenotes/linenotes.js', 'Wire ze-btn-multi-music click handler',
  `document.getElementById('ze-btn-multi-dir')?.addEventListener('click', zeMultiToggleStagDir);`,
  `document.getElementById('ze-btn-multi-dir')?.addEventListener('click', zeMultiToggleStagDir);
  document.getElementById('ze-btn-multi-music')?.addEventListener('click', zeMultiToggleMusicLine);`
);

// ─────────────────────────────────────────────────────────
// PATCH 10: linenotes.js — Add zeMultiToggleMusicLine function
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 10: linenotes.js — zeMultiToggleMusicLine function ===');
applyPatch('src/linenotes/linenotes.js', 'Add zeMultiToggleMusicLine after zeMultiToggleStagDir',
  `function zeMultiToggleStagDir() {
  const zones = zeCurrentZones();
  const anyNon = [...zeMultiSelected].some(i => !zones[i]?.isStageDirection);
  zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isStageDirection = anyNon; if (anyNon) zones[i].isCharName = false; } });
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
}`,
  `function zeMultiToggleStagDir() {
  const zones = zeCurrentZones();
  const anyNon = [...zeMultiSelected].some(i => !zones[i]?.isStageDirection);
  zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isStageDirection = anyNon; if (anyNon) { zones[i].isCharName = false; zones[i].isMusicLine = false; } } });
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
}

function zeMultiToggleMusicLine() {
  const zones = zeCurrentZones();
  const anyNon = [...zeMultiSelected].some(i => !zones[i]?.isMusicLine);
  zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isMusicLine = anyNon; if (anyNon) { zones[i].isCharName = false; zones[i].isStageDirection = false; } } });
  zeRenderZones(); zeUpdateListPanel(); debounceSaveZones();
}`
);

// ─────────────────────────────────────────────────────────
// PATCH 11: linenotes.js — Fix zeMultiToggleCharName to clear isMusicLine
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 11: linenotes.js — zeMultiToggleCharName clears music ===');
applyPatch('src/linenotes/linenotes.js', 'Clear isMusicLine in zeMultiToggleCharName',
  `zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isCharName = anyNon; if (anyNon) zones[i].isStageDirection = false; } });`,
  `zeMultiSelected.forEach(i => { if (zones[i]) { zones[i].isCharName = anyNon; if (anyNon) { zones[i].isStageDirection = false; zones[i].isMusicLine = false; } } });`
);

// ─────────────────────────────────────────────────────────
// PATCH 12: linenotes.js — zeRenderZones: add ze-music-line CSS class
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 12: linenotes.js — zeRenderZones music class ===');
applyPatch('src/linenotes/linenotes.js', 'Add ze-music-line class in zeRenderZones',
  `div.className = 'ze-zone' + (zone.isCharName ? ' ze-char-name' : zone.isStageDirection ? ' ze-stage-dir' : '') + (idx === zeSelectedIdx ? ' selected' : '') + (isMulti ? ' ze-multi-selected' : '');`,
  `div.className = 'ze-zone' + (zone.isCharName ? ' ze-char-name' : zone.isStageDirection ? ' ze-stage-dir' : zone.isMusicLine ? ' ze-music-line' : '') + (idx === zeSelectedIdx ? ' selected' : '') + (isMulti ? ' ze-multi-selected' : '');`
);

// ─────────────────────────────────────────────────────────
// PATCH 13: linenotes.js — zeUpdateListPanel: show 'music' type label + list item class
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 13: linenotes.js — zeUpdateListPanel music type ===');
applyPatch('src/linenotes/linenotes.js', 'Add music line type label and list item class',
  `const type = z.isCharName ? 'char name' : z.isStageDirection ? 'stage dir' : 'dialogue';
    const textEl = z.text ? \`<div class="ze-item-text">\${escapeHtml(z.text.substring(0, 60))}\${z.text.length > 60 ? '\\u2026' : ''}</div>\` : \`<div class="ze-item-no-text">[no text]</div>\`;
    const isSel = idx === zeSelectedIdx, isMulti = zeMultiSelected.has(idx);
    const cls = ['ze-list-item', isSel ? 'selected' : '', isMulti ? 'ze-multi-selected' : '', z.isCharName ? 'ze-cn-item' : ''].filter(Boolean).join(' ');`,
  `const type = z.isCharName ? 'char name' : z.isStageDirection ? 'stage dir' : z.isMusicLine ? 'music' : 'dialogue';
    const textEl = z.text ? \`<div class="ze-item-text">\${escapeHtml(z.text.substring(0, 60))}\${z.text.length > 60 ? '\\u2026' : ''}</div>\` : \`<div class="ze-item-no-text">[no text]</div>\`;
    const isSel = idx === zeSelectedIdx, isMulti = zeMultiSelected.has(idx);
    const cls = ['ze-list-item', isSel ? 'selected' : '', isMulti ? 'ze-multi-selected' : '', z.isCharName ? 'ze-cn-item' : z.isMusicLine ? 'ze-ml-item' : ''].filter(Boolean).join(' ');`
);

// ─────────────────────────────────────────────────────────
// PATCH 14: linenotes.js — Keyboard shortcut M for music line toggle
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 14: linenotes.js — Keyboard shortcut M ===');
applyPatch('src/linenotes/linenotes.js', 'Add M keyboard shortcut for music line toggle',
  `if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
    if (zeMultiSelected.size > 0) { zeMultiToggleStagDir(); return; }
    if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isStageDirection = !z.isStageDirection; if (z.isStageDirection) z.isCharName = false; zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }
    return;
  }`,
  `if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
    if (zeMultiSelected.size > 0) { zeMultiToggleStagDir(); return; }
    if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isStageDirection = !z.isStageDirection; if (z.isStageDirection) { z.isCharName = false; z.isMusicLine = false; } zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }
    return;
  }
  if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey) {
    if (zeMultiSelected.size > 0) { zeMultiToggleMusicLine(); return; }
    if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isMusicLine = !z.isMusicLine; if (z.isMusicLine) { z.isCharName = false; z.isStageDirection = false; } zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }
    return;
  }`
);

// ─────────────────────────────────────────────────────────
// PATCH 15: linenotes.js — Fix C shortcut to also clear isMusicLine
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 15: linenotes.js — C shortcut clears music ===');
applyPatch('src/linenotes/linenotes.js', 'Clear isMusicLine when toggling charName via C key',
  `if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isCharName = !z.isCharName; if (z.isCharName) z.isStageDirection = false; zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }`,
  `if (zeSelectedIdx !== null) { const z = zeCurrentZones()[zeSelectedIdx]; if (z) { z.isCharName = !z.isCharName; if (z.isCharName) { z.isStageDirection = false; z.isMusicLine = false; } zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones(); } }`
);

// ─────────────────────────────────────────────────────────
// PATCH 16: Runshow.js — Render music lines with distinct highlight color
//           (NOT skipped like stage dirs — they are clickable + navigable)
// ─────────────────────────────────────────────────────────
console.log('\n=== PATCH 16: Runshow.js — Music line rendering in rsRenderLineZones ===');
applyPatch('src/runshow/Runshow.js', 'Add music line class in rsRenderLineZones',
  `const div = document.createElement('div');
    div.className = 'line-zone' + (existingZoneIdxs.has(idx) ? ' has-note' : '');
    div.style.left = Math.max(0, zone.x - 0.5) + '%'; div.style.top = zone.y + '%';`,
  `const div = document.createElement('div');
    div.className = 'line-zone' + (existingZoneIdxs.has(idx) ? ' has-note' : '') + (zone.isMusicLine ? ' line-zone--music' : '');
    div.style.left = Math.max(0, zone.x - 0.5) + '%'; div.style.top = zone.y + '%';`
);

// ─────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`  Music Line feature: ${patchCount} applied, ${skipCount} already present`);
console.log('═'.repeat(60));

if (!APPLY) {
  console.log('\n  ⚠  DRY RUN — no files modified.');
  console.log('  Run with --apply to write changes.\n');
} else {
  console.log('\n  ✅  All patches written to disk.\n');
}

console.log('VERIFICATION CHECKLIST:');
console.log('  1. Open Line Notes → Zone Editor. Select a zone.');
console.log('     → Confirm "Music line (M)" checkbox appears below Stage direction.');
console.log('  2. Check the checkbox. Confirm the zone turns teal/cyan in the editor.');
console.log('     → Confirm Character Name and Stage Direction uncheck automatically.');
console.log('  3. Press M key with a zone selected → toggles Music Line on/off.');
console.log('  4. Multi-select zones → confirm "Music (M)" button in multi-bar.');
console.log('  5. In the list panel, music lines should show type "music" with teal border.');
console.log('  6. Open Run Show → navigate to a page with music lines.');
console.log('     → Music lines should appear with teal left border + teal background.');
console.log('     → They should be clickable (open note popover) just like dialogue.');
console.log('     → They should be keyboard-navigable (arrow keys).');
console.log('  7. Stage directions should still be non-interactive (pointer-events:none).');
console.log('  8. Character names should still be hidden in run show.\n');

if (patchCount === 0 && skipCount > 0) {
  console.log('  ℹ  All patches already present — nothing to do.\n');
}

results.forEach(r => {
  console.log(`  ${r.status.padEnd(17)} ${r.file.padEnd(30)} ${r.label}`);
});
console.log('');
