#!/usr/bin/env node
/**
 * patch-cue-size-combined.mjs
 *
 * Replaces the bare numeric size input with S (125) / M (200) / L (300)
 * preset buttons plus a "Custom" option that reveals a freeform number input.
 *
 * Applies on top of the previous patches (patch-cue-markers-unified,
 * patch-cue-size-numeric, patch-cue-size-quote-fix).
 *
 * UI pattern:
 *   - Place Cue popover & Cues panel form: <select> with S/M/L/Custom,
 *     custom row shown/hidden based on selection.
 *   - Action popover (click existing cue): S/M/L instant-save buttons +
 *     number input + Set button for arbitrary custom values.
 *
 * Rendering code (zeRenderCueMarkers, cue-margin.js) is untouched — it
 * already works with any numeric value.
 *
 * Usage:
 *   node patch-cue-size-combined.mjs          # dry-run
 *   node patch-cue-size-combined.mjs --apply   # apply
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = !process.argv.includes('--apply');
const ROOT = process.cwd();

let patchCount = 0;
let failCount = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function write(rel, content) {
  if (DRY_RUN) { console.log(`  [dry-run] Would write ${rel}`); return; }
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
  console.log(`  ✓ Wrote ${rel}`);
}

function applyPatch(file, label, oldStr, newStr) {
  let content = read(file);
  if (content.includes(newStr) && !content.includes(oldStr)) {
    console.log(`  ⏭  "${label}" — already applied`);
    patchCount++;
    return content;
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    console.error(`  ✗ "${label}" — old string not found in ${file}`);
    failCount++;
    return null;
  }
  if (content.indexOf(oldStr, idx + 1) !== -1) {
    console.error(`  ✗ "${label}" — old string found multiple times in ${file}`);
    failCount++;
    return null;
  }
  content = content.replace(oldStr, newStr);
  write(file, content);
  patchCount++;
  console.log(`  ✓ "${label}" applied`);
  return content;
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  Patch: S/M/L Presets + Custom Size Input`);
console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
console.log(`${'='.repeat(60)}\n`);


/* ═══════════════════════════════════════════════════════════
   1. index.html — Place-cue popover: number input → select + custom
   ═══════════════════════════════════════════════════════════ */
console.log('[1/11] index.html — ze-cue-popover: select with S/M/L/Custom');

applyPatch('index.html',
  'ze-cue-popover: replace number input with select+custom',
  `              <div style="margin-bottom:10px;">
                <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Size (100 = default)</label>
                <input id="ze-cue-size" type="number" min="25" max="500" step="25" value="100" class="ze-input" style="width:100%;box-sizing:border-box;">
              </div>`,
  `              <div style="margin-bottom:10px;">
                <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Size</label>
                <select id="ze-cue-size-preset" class="form-select" style="width:100%;padding:5px 8px;background:var(--bg-raised);border:1px solid var(--bg-border);color:var(--text-primary);border-radius:4px;font-size:12px;" onchange="document.getElementById('ze-cue-size-custom-row').style.display=this.value==='custom'?'block':'none'">
                  <option value="125">S (125)</option>
                  <option value="200" selected>M (200)</option>
                  <option value="300">L (300)</option>
                  <option value="custom">Custom</option>
                </select>
                <div id="ze-cue-size-custom-row" style="display:none;margin-top:4px;">
                  <input id="ze-cue-size-custom" type="number" min="25" max="999" step="1" value="100" class="ze-input" style="width:100%;box-sizing:border-box;" placeholder="Enter size">
                </div>
              </div>`
);


/* ═══════════════════════════════════════════════════════════
   2. index.html — Action popover: number+Set → S/M/L buttons + number+Set
   ═══════════════════════════════════════════════════════════ */
console.log('\n[2/11] index.html — ze-cue-action-popover: S/M/L instant buttons + custom input');

applyPatch('index.html',
  'ze-cue-action-popover: add S/M/L preset buttons above custom input',
  `              <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
                <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;">Size</span>
                <input id="ze-cue-action-size" type="number" min="25" max="500" step="25" value="100" class="ze-input" style="width:60px;text-align:center;padding:3px 4px;font-size:11px;">
                <button id="ze-cue-action-set-size" class="ze-tool-btn ze-accent" style="padding:3px 8px;font-size:10px;">Set</button>
              </div>`,
  `              <div style="margin-bottom:4px;">
                <div style="display:flex;gap:3px;margin-bottom:3px;">
                  <button type="button" class="ze-tool-btn ze-cue-action-preset" data-val="125" style="flex:1;padding:3px 0;font-size:10px;">S</button>
                  <button type="button" class="ze-tool-btn ze-cue-action-preset" data-val="200" style="flex:1;padding:3px 0;font-size:10px;">M</button>
                  <button type="button" class="ze-tool-btn ze-cue-action-preset" data-val="300" style="flex:1;padding:3px 0;font-size:10px;">L</button>
                </div>
                <div style="display:flex;gap:3px;align-items:center;">
                  <input id="ze-cue-action-size" type="number" min="25" max="999" step="1" value="100" class="ze-input" style="flex:1;text-align:center;padding:3px 4px;font-size:11px;" placeholder="Custom">
                  <button id="ze-cue-action-set-size" class="ze-tool-btn ze-accent" style="padding:3px 8px;font-size:10px;">Set</button>
                </div>
              </div>`
);


/* ═══════════════════════════════════════════════════════════
   3. linenotes.js — zeShowCuePopover: reset size select when popover opens
   ═══════════════════════════════════════════════════════════ */
console.log('\n[3/11] linenotes.js — zeShowCuePopover: reset size select on open');

applyPatch('src/linenotes/linenotes.js',
  'zeShowCuePopover: reset size preset and custom row',
  `  if (descEl) descEl.value = '';
}

function zeCloseCuePopover() {`,
  `  if (descEl) descEl.value = '';
  // Reset size to default preset
  const _szPre = document.getElementById('ze-cue-size-preset');
  if (_szPre) _szPre.value = '200';
  const _szCRow = document.getElementById('ze-cue-size-custom-row');
  if (_szCRow) _szCRow.style.display = 'none';
  const _szCust = document.getElementById('ze-cue-size-custom');
  if (_szCust) _szCust.value = '100';
}

function zeCloseCuePopover() {`
);


/* ═══════════════════════════════════════════════════════════
   4. linenotes.js — zeSavePlacedCue: read from select or custom
   ═══════════════════════════════════════════════════════════ */
console.log('\n[4/11] linenotes.js — zeSavePlacedCue: read select/custom');

applyPatch('src/linenotes/linenotes.js',
  'zeSavePlacedCue: read size from select or custom input',
  `  const size = parseInt(document.getElementById('ze-cue-size')?.value, 10) || 100;`,
  `  const _szPre = document.getElementById('ze-cue-size-preset');
  const size = _szPre?.value === 'custom' ? (parseInt(document.getElementById('ze-cue-size-custom')?.value, 10) || 100) : (parseInt(_szPre?.value, 10) || 200);`
);


/* ═══════════════════════════════════════════════════════════
   5. linenotes.js — zeShowCueActionPopover: wire S/M/L + custom Set
   ═══════════════════════════════════════════════════════════ */
console.log('\n[5/11] linenotes.js — zeShowCueActionPopover: wire preset buttons + Set');

applyPatch('src/linenotes/linenotes.js',
  'zeShowCueActionPopover: replace numeric-only wiring with presets+custom',
  `  // Size number input — populate with current value and wire Set button
  const sizeInput = document.getElementById('ze-cue-action-size');
  const _curRaw = cue.size;
  const _curNum = typeof _curRaw === 'number' ? _curRaw : ({ sm: 75, md: 100, lg: 130 }[_curRaw] || 100);
  if (sizeInput) sizeInput.value = _curNum;
  const setBtn = document.getElementById('ze-cue-action-set-size');
  if (setBtn) {
    const freshBtn = setBtn.cloneNode(true);
    freshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newSize = parseInt(sizeInput?.value, 10);
      if (!newSize || newSize < 25 || newSize > 500) { toast('Size must be 25–500.', 'error'); return; }
      const pid = state.activeProduction?.id;
      if (!pid || !isOwner()) { toast('Only the owner can resize cues.', 'error'); return; }
      try {
        await updateDoc(doc(db, 'productions', pid, 'scriptCues', cue.id), { size: newSize });
        toast('Cue size set to ' + newSize, 'success');
        zeCloseCueActionPopover();
      } catch (err) { toast('Failed to resize cue.', 'error'); }
    });
    setBtn.parentNode.replaceChild(freshBtn, setBtn);
  }`,
  `  // Size controls — S/M/L instant-save presets + custom input + Set
  const _curRaw = cue.size;
  const _curNum = typeof _curRaw === 'number' ? _curRaw : ({ sm: 75, md: 100, lg: 130 }[_curRaw] || 100);
  // Populate custom input
  const sizeInput = document.getElementById('ze-cue-action-size');
  if (sizeInput) sizeInput.value = _curNum;
  // Highlight matching preset, wire instant-save
  const presetBtns = pop.querySelectorAll('.ze-cue-action-preset');
  presetBtns.forEach(btn => {
    const match = parseInt(btn.dataset.val, 10) === _curNum;
    btn.style.background = match ? 'var(--gold)' : '';
    btn.style.color = match ? 'var(--bg-deep)' : '';
    const fresh = btn.cloneNode(true);
    fresh.style.background = btn.style.background;
    fresh.style.color = btn.style.color;
    fresh.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newSize = parseInt(fresh.dataset.val, 10);
      const pid = state.activeProduction?.id;
      if (!pid || !isOwner()) { toast('Only the owner can resize cues.', 'error'); return; }
      try {
        await updateDoc(doc(db, 'productions', pid, 'scriptCues', cue.id), { size: newSize });
        toast('Cue size set to ' + newSize, 'success');
        zeCloseCueActionPopover();
      } catch (err) { toast('Failed to resize cue.', 'error'); }
    });
    btn.parentNode.replaceChild(fresh, btn);
  });
  // Wire Set button for custom value
  const setBtn = document.getElementById('ze-cue-action-set-size');
  if (setBtn) {
    const freshBtn = setBtn.cloneNode(true);
    freshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newSize = parseInt(sizeInput?.value, 10);
      if (!newSize || newSize < 25 || newSize > 999) { toast('Size must be 25\\u2013999.', 'error'); return; }
      const pid = state.activeProduction?.id;
      if (!pid || !isOwner()) { toast('Only the owner can resize cues.', 'error'); return; }
      try {
        await updateDoc(doc(db, 'productions', pid, 'scriptCues', cue.id), { size: newSize });
        toast('Cue size set to ' + newSize, 'success');
        zeCloseCueActionPopover();
      } catch (err) { toast('Failed to resize cue.', 'error'); }
    });
    setBtn.parentNode.replaceChild(freshBtn, setBtn);
  }`
);


/* ═══════════════════════════════════════════════════════════
   6. linenotes.js — renderCuesPanel: number input → select + custom in form HTML
   ═══════════════════════════════════════════════════════════ */
console.log('\n[6/11] linenotes.js — renderCuesPanel: select+custom in cue form');

applyPatch('src/linenotes/linenotes.js',
  'renderCuesPanel: replace number input with select+custom in form HTML',
  `<div style="margin-bottom:8px;"><label style="font-size:11px;color:#9a9488;display:block;margin-bottom:2px;">Size (100 = default)</label><input id="cue-size-input" type="number" min="25" max="500" step="25" value="100" style="width:100%;padding:5px 8px;background:#1e1d1b;border:1px solid #3d3a36;color:#e8e4dc;border-radius:4px;font-size:12px;font-family:monospace;box-sizing:border-box;"></div>`,
  `<div style="margin-bottom:8px;"><label style="font-size:11px;color:#9a9488;display:block;margin-bottom:2px;">Size</label><select id="cue-size-preset" class="form-select" style="width:100%;padding:5px 8px;background:#1e1d1b;border:1px solid #3d3a36;color:#e8e4dc;border-radius:4px;font-size:12px;"><option value="125">S (125)</option><option value="200" selected>M (200)</option><option value="300">L (300)</option><option value="custom">Custom</option></select><div id="cue-size-custom-row" style="display:none;margin-top:4px;"><input id="cue-size-custom" type="number" min="25" max="999" step="1" value="100" style="width:100%;padding:5px 8px;background:#1e1d1b;border:1px solid #3d3a36;color:#e8e4dc;border-radius:4px;font-size:12px;font-family:monospace;box-sizing:border-box;" placeholder="Enter size"></div></div>`
);


/* ═══════════════════════════════════════════════════════════
   7. linenotes.js — renderCuesPanel: wire select onchange after innerHTML
   ═══════════════════════════════════════════════════════════ */
console.log('\n[7/11] linenotes.js — renderCuesPanel: wire size select change handler');

applyPatch('src/linenotes/linenotes.js',
  'renderCuesPanel: add select onchange wiring',
  `  if (owner) {
    panel.querySelector('#cue-save-btn')?.addEventListener('click', saveCue);
    panel.querySelector('#cue-cancel-btn')?.addEventListener('click', cancelCueEdit);`,
  `  if (owner) {
    panel.querySelector('#cue-size-preset')?.addEventListener('change', function() {
      const row = document.getElementById('cue-size-custom-row');
      if (row) row.style.display = this.value === 'custom' ? 'block' : 'none';
    });
    panel.querySelector('#cue-save-btn')?.addEventListener('click', saveCue);
    panel.querySelector('#cue-cancel-btn')?.addEventListener('click', cancelCueEdit);`
);


/* ═══════════════════════════════════════════════════════════
   8. linenotes.js — saveCue: read from select or custom
   ═══════════════════════════════════════════════════════════ */
console.log('\n[8/11] linenotes.js — saveCue: read size from select/custom');

applyPatch('src/linenotes/linenotes.js',
  'saveCue: read size from preset select or custom input',
  `  const size = parseInt(document.getElementById('cue-size-input')?.value, 10) || 100;`,
  `  const _szSel = document.getElementById('cue-size-preset')?.value;
  const size = _szSel === 'custom' ? (parseInt(document.getElementById('cue-size-custom')?.value, 10) || 100) : (parseInt(_szSel, 10) || 200);`
);


/* ═══════════════════════════════════════════════════════════
   9. linenotes.js — startCueEdit: populate select or show custom
   ═══════════════════════════════════════════════════════════ */
console.log('\n[9/11] linenotes.js — startCueEdit: populate size select/custom');

applyPatch('src/linenotes/linenotes.js',
  'startCueEdit: set select to matching preset or custom',
  `  const sizeEl = document.getElementById('cue-size-input');
  if (sizeEl) {
    const _rs = cue.size;
    sizeEl.value = typeof _rs === 'number' ? _rs : ({ sm: 75, md: 100, lg: 130 }[_rs] || 100);
  }`,
  `  const _szPresetEl = document.getElementById('cue-size-preset');
  const _szCustomEl = document.getElementById('cue-size-custom');
  const _szCustomRow = document.getElementById('cue-size-custom-row');
  if (_szPresetEl) {
    const _rs = cue.size;
    const _num = typeof _rs === 'number' ? _rs : ({ sm: 75, md: 100, lg: 130 }[_rs] || 100);
    if ([125, 200, 300].includes(_num)) {
      _szPresetEl.value = String(_num);
      if (_szCustomRow) _szCustomRow.style.display = 'none';
    } else {
      _szPresetEl.value = 'custom';
      if (_szCustomEl) _szCustomEl.value = _num;
      if (_szCustomRow) _szCustomRow.style.display = 'block';
    }
  }`
);


/* ═══════════════════════════════════════════════════════════
   10. linenotes.js — cancelCueEdit: reset select + hide custom
   ═══════════════════════════════════════════════════════════ */
console.log('\n[10/11] linenotes.js — cancelCueEdit: reset size controls');

applyPatch('src/linenotes/linenotes.js',
  'cancelCueEdit: reset size preset select and hide custom row',
  `  const sizeEl = document.getElementById('cue-size-input');
  if (sizeEl) sizeEl.value = '100';`,
  `  const _szPre = document.getElementById('cue-size-preset');
  if (_szPre) _szPre.value = '200';
  const _szCRow = document.getElementById('cue-size-custom-row');
  if (_szCRow) _szCRow.style.display = 'none';
  const _szCust = document.getElementById('cue-size-custom');
  if (_szCust) _szCust.value = '100';`
);


/* ═══════════════════════════════════════════════════════════
   11. linenotes.js — Backward compat: update default in render fallback
       (zeRenderCueMarkers uses || 100 which is fine — no change needed)
       Instead, update the backward compat map to include new presets
   ═══════════════════════════════════════════════════════════ */
console.log('\n[11/11] No-op — rendering code already handles any numeric value');
patchCount++;
console.log('  ⏭  Rendering unchanged (zeRenderCueMarkers + cue-margin.js work with any number)');


/* ═══════════════════════════════════════════════════════════
   SUMMARY
   ═══════════════════════════════════════════════════════════ */
console.log(`\n${'─'.repeat(60)}`);
console.log(`  Results: ${patchCount} patches applied, ${failCount} failures`);
if (failCount > 0) {
  console.log('  ⚠  Some patches failed — review output above.');
}
if (DRY_RUN) {
  console.log('  🔍 Dry-run complete. Re-run with --apply to write changes.');
} else {
  console.log('  ✅ All changes written.');
  console.log(`\n  VERIFICATION CHECKLIST:`);
  console.log(`  ──────────────────────`);
  console.log(`  1. Edit Script → Line Notes → Place Cue mode → click page`);
  console.log(`     → Popover shows "Size" dropdown: S (125) / M (200) / L (300) / Custom`);
  console.log(`     → Default selection: M (200)`);
  console.log(`     → Selecting "Custom" reveals number input (type any value 25–999)`);
  console.log(`  2. Edit Script → Cues & Diagrams → Add Cue form`);
  console.log(`     → Same S/M/L/Custom dropdown + conditional number input`);
  console.log(`     → Edit existing cue → correct preset selected (or Custom + value shown)`);
  console.log(`  3. Click existing cue marker → action popover`);
  console.log(`     → S / M / L buttons (matching preset highlighted in gold)`);
  console.log(`     → Click S/M/L → saves immediately to Firestore`);
  console.log(`     → Custom input below + Set button for arbitrary values`);
  console.log(`  4. Run Show tab → cue pills reflect saved numeric sizes`);
  console.log(`     → L (300) renders as 138×54px — significantly larger than old "lg"`);
  console.log(`     → Custom 500 renders as 230×90px for maximum visibility`);
  console.log(`  5. Backward compat: old string sizes ('sm'/'md'/'lg') still render correctly`);
  console.log(`     → Editing such cues shows "Custom" with the mapped numeric value`);
}
console.log(`${'─'.repeat(60)}\n`);
