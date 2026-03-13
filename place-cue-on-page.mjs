#!/usr/bin/env node
/**
 * place-cue-on-page.mjs
 * 
 * Adds click-to-place cue functionality in the Zone Editor (Edit Script tab).
 * 
 * Changes:
 *   1. index.html  — "Place Cue" toolbar button, cue popover element, CSS for
 *                     ze-cue-marker and ze-cue-popover
 *   2. src/linenotes/linenotes.js — cue mode state, overlay click intercept,
 *                     popover show/save/cancel, cue markers rendered in zeRenderZones
 *   3. src/runshow/cue-margin.js — Y position fallback: bounds.y when yPosition is null
 * 
 * Usage:  node place-cue-on-page.mjs           (dry run)
 *         node place-cue-on-page.mjs --apply    (write changes)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DRY = !process.argv.includes('--apply');
const OK = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
let allGood = true;

function read(p) {
  if (!existsSync(p)) { console.log(`${FAIL} File not found: ${p}`); allGood = false; return null; }
  return readFileSync(p, 'utf8');
}

function write(p, content) {
  if (DRY) { console.log(`${INFO} [DRY] Would write ${p} (${content.length} bytes)`); return; }
  writeFileSync(p, content, 'utf8');
  console.log(`${OK} Wrote ${p}`);
}

function applyPatch(file, anchor, replacement, label) {
  let src = read(file);
  if (src === null) return null;
  // Idempotency: if replacement text is already present, skip
  const idempotencySnippet = replacement.substring(0, Math.min(80, replacement.length)).trim();
  if (src.includes(idempotencySnippet)) {
    console.log(`${INFO} [SKIP] "${label}" — already applied in ${file}`);
    return src;
  }
  const idx = src.indexOf(anchor);
  if (idx === -1) {
    console.log(`${FAIL} Anchor not found for "${label}" in ${file}`);
    console.log(`    Anchor (first 120 chars): ${anchor.substring(0, 120)}`);
    allGood = false;
    return src;
  }
  src = src.slice(0, idx) + replacement + src.slice(idx + anchor.length);
  console.log(`${OK} Patched "${label}" in ${file}`);
  return src;
}

// ═══════════════════════════════════════════════════════════
// PATCH 1: index.html — toolbar button + popover + CSS
// ═══════════════════════════════════════════════════════════
console.log('\n── Patch 1: index.html ──');

const HTML_FILE = 'index.html';
let html = read(HTML_FILE);

if (html !== null) {
  // 1a. Add "Place Cue" button after the "Zones" toggle button in ln-header
  const btnAnchor = `<button class="ln-header-btn ln-header-btn--active" id="ln-view-zones-btn">Zones</button>`;
  const btnReplacement = `<button class="ln-header-btn ln-header-btn--active" id="ln-view-zones-btn">Zones</button>
      <button class="ln-header-btn" id="ln-place-cue-btn" title="Click a spot on the page to place a script cue">Place Cue</button>`;

  if (html.includes('id="ln-place-cue-btn"')) {
    console.log(`${INFO} [SKIP] "Place Cue button" — already applied`);
  } else {
    const btnIdx = html.indexOf(btnAnchor);
    if (btnIdx === -1) {
      console.log(`${FAIL} Anchor not found for "Place Cue button" in ${HTML_FILE}`);
      allGood = false;
    } else {
      html = html.slice(0, btnIdx) + btnReplacement + html.slice(btnIdx + btnAnchor.length);
      console.log(`${OK} Patched "Place Cue button" in ${HTML_FILE}`);
    }
  }

  // 1b. Add cue popover element after ze-edit-overlay's closing div (inside ze-page-wrapper)
  //     We'll place it right after the ze-edit-overlay div, inside ze-page-wrapper
  const popoverAnchor = `<div id="ze-edit-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:all;">
              <div id="ze-rubber-band" style="position:absolute;border:1.5px dashed #e8c98e;background:rgba(232,201,142,0.1);border-radius:2px;pointer-events:none;display:none;z-index:30;"></div>
            </div>`;
  const popoverReplacement = `<div id="ze-edit-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:all;">
              <div id="ze-rubber-band" style="position:absolute;border:1.5px dashed #e8c98e;background:rgba(232,201,142,0.1);border-radius:2px;pointer-events:none;display:none;z-index:30;"></div>
            </div>
            <!-- Cue placement popover -->
            <div id="ze-cue-popover" style="display:none;position:absolute;z-index:50;background:var(--bg-card);border:1px solid var(--bg-border);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);padding:14px;width:240px;">
              <div style="font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;">Place Cue</div>
              <div style="margin-bottom:8px;">
                <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Type</label>
                <select id="ze-cue-type" class="form-select" style="width:100%;padding:5px 8px;background:var(--bg-raised);border:1px solid var(--bg-border);color:var(--text-primary);border-radius:4px;font-size:12px;">
                  <option value="LX">LX</option><option value="SQ">SQ</option><option value="PX">PX</option>
                  <option value="FLY">FLY</option><option value="CARP">CARP</option><option value="OTHER">OTHER</option>
                </select>
              </div>
              <div style="margin-bottom:8px;">
                <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Label</label>
                <input id="ze-cue-label" type="text" maxlength="100" placeholder="e.g. LX 42" class="ze-input" style="width:100%;box-sizing:border-box;">
              </div>
              <div style="margin-bottom:10px;">
                <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Description (optional)</label>
                <input id="ze-cue-desc" type="text" maxlength="250" placeholder="" class="ze-input" style="width:100%;box-sizing:border-box;">
              </div>
              <div style="display:flex;gap:6px;justify-content:flex-end;">
                <button id="ze-cue-cancel" class="ze-tool-btn" style="padding:5px 12px;">Cancel</button>
                <button id="ze-cue-save" class="ze-tool-btn ze-accent" style="padding:5px 12px;">Add Cue</button>
              </div>
            </div>`;

  if (html.includes('id="ze-cue-popover"')) {
    console.log(`${INFO} [SKIP] "Cue popover HTML" — already applied`);
  } else {
    const popIdx = html.indexOf(popoverAnchor);
    if (popIdx === -1) {
      console.log(`${FAIL} Anchor not found for "Cue popover HTML" in ${HTML_FILE}`);
      allGood = false;
    } else {
      html = html.slice(0, popIdx) + popoverReplacement + html.slice(popIdx + popoverAnchor.length);
      console.log(`${OK} Patched "Cue popover HTML" in ${HTML_FILE}`);
    }
  }

  // 1c. Add CSS for ze-cue-marker and ze-cue-popover (insert before the closing </style>)
  const cssToAdd = `
    /* ===== CUE PLACEMENT MARKERS (Zone Editor) ===== */
    .ze-cue-marker {
      position: absolute; left: 0; height: 18px; display: flex; align-items: center;
      padding: 0 8px 0 4px; border-radius: 0 9px 9px 0; cursor: pointer;
      font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
      white-space: nowrap; z-index: 15; pointer-events: all;
      transition: opacity 0.15s, transform 0.15s; transform-origin: left center;
      border: 1px solid; border-left: 3px solid;
    }
    .ze-cue-marker:hover { transform: scale(1.05); z-index: 20; }
    .ze-cue-marker .ze-cue-type-tag {
      font-size: 8px; opacity: 0.7; margin-right: 4px;
    }
    .ze-cue-marker--selected { outline: 2px solid var(--gold); outline-offset: 1px; }

    /* Place-Cue mode cursor */
    .ze-cue-mode-active { cursor: crosshair !important; }
    .ze-cue-mode-active .ze-zone { pointer-events: none !important; }
    .ze-cue-mode-active .ze-resize { pointer-events: none !important; }
    #ln-place-cue-btn.ln-header-btn--active { background: var(--gold); color: var(--bg-deep); }`;

  const cssAnchor = '    </style>';
  // Find the LAST </style> before </head>
  const headEnd = html.indexOf('</head>');
  const lastStyleClose = html.lastIndexOf('    </style>', headEnd);
  if (html.includes('.ze-cue-marker {')) {
    console.log(`${INFO} [SKIP] "Cue CSS" — already applied`);
  } else if (lastStyleClose === -1) {
    console.log(`${FAIL} Anchor not found for "Cue CSS" in ${HTML_FILE}`);
    allGood = false;
  } else {
    html = html.slice(0, lastStyleClose) + cssToAdd + '\n    </style>' + html.slice(lastStyleClose + cssAnchor.length);
    console.log(`${OK} Patched "Cue CSS" in ${HTML_FILE}`);
  }

  if (allGood || !DRY) write(HTML_FILE, html);
}

// ═══════════════════════════════════════════════════════════
// PATCH 2: src/linenotes/linenotes.js
// ═══════════════════════════════════════════════════════════
console.log('\n── Patch 2: src/linenotes/linenotes.js ──');

const LN_FILE = 'src/linenotes/linenotes.js';
let ln = read(LN_FILE);

if (ln !== null) {
  // 2a. Add cue-mode state variables after the existing zone editor state vars.
  //     Anchor: the line "let zeRenderGen = 0;"
  const stateAnchor = 'let zeRenderGen = 0;';
  const stateAdd = `let zeRenderGen = 0;

// Cue placement mode state
let zeCueMode = false;
let zeCuePending = null; // { xPct, yPct } — click position awaiting popover save`;

  if (ln.includes('let zeCueMode = false;')) {
    console.log(`${INFO} [SKIP] "Cue mode state vars" — already applied`);
  } else {
    const stIdx = ln.indexOf(stateAnchor);
    if (stIdx === -1) {
      console.log(`${FAIL} Anchor not found for "Cue mode state vars"`);
      allGood = false;
    } else {
      ln = ln.slice(0, stIdx) + stateAdd + ln.slice(stIdx + stateAnchor.length);
      console.log(`${OK} Patched "Cue mode state vars"`);
    }
  }

  // 2b. Modify zeOverlayMouseDown to intercept clicks when in cue mode.
  //     The function starts with: if (e.target !== document.getElementById('ze-edit-overlay')) return;
  //     We insert a cue-mode intercept right after the target check.
  const overlayAnchor = `if (e.target !== document.getElementById('ze-edit-overlay')) return;
  if (e.button !== 0) return;`;
  const overlayReplacement = `if (e.target !== document.getElementById('ze-edit-overlay')) return;
  if (e.button !== 0) return;
  // Cue placement mode: intercept click to place a cue marker
  if (zeCueMode) {
    e.preventDefault(); e.stopPropagation();
    const wrapper = document.getElementById('ze-page-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / wrapper.offsetWidth) * 100;
    const yPct = ((e.clientY - rect.top) / wrapper.offsetHeight) * 100;
    zeCuePending = { xPct, yPct };
    zeShowCuePopover(e.clientX - rect.left, e.clientY - rect.top);
    return;
  }`;

  if (ln.includes('if (zeCueMode) {')) {
    console.log(`${INFO} [SKIP] "Cue mode intercept in zeOverlayMouseDown" — already applied`);
  } else {
    const olIdx = ln.indexOf(overlayAnchor);
    if (olIdx === -1) {
      console.log(`${FAIL} Anchor not found for "Cue mode intercept in zeOverlayMouseDown"`);
      allGood = false;
    } else {
      ln = ln.slice(0, olIdx) + overlayReplacement + ln.slice(olIdx + overlayAnchor.length);
      console.log(`${OK} Patched "Cue mode intercept in zeOverlayMouseDown"`);
    }
  }

  // 2c. Add cue popover functions + cue marker rendering + toolbar wiring.
  //     Insert before the "FEATURE 5: SCRIPT CUES" section.
  const feat5Anchor = `/* ═══════════════════════════════════════════════════════════
   FEATURE 5: SCRIPT CUES
   ═══════════════════════════════════════════════════════════ */`;
  const cueFunctionsBlock = `/* ═══════════════════════════════════════════════════════════
   CUE PLACEMENT MODE (click-to-place on zone editor canvas)
   ═══════════════════════════════════════════════════════════ */
const ZE_CUE_COLORS = {
  LX:    { bg: '#1A2E50', fg: '#5B9BD4', border: '#5B9BD4' },
  SQ:    { bg: '#2D1A14', fg: '#E63946', border: '#E63946' },
  PX:    { bg: '#1A2A1A', fg: '#2D8A4E', border: '#2D8A4E' },
  FLY:   { bg: '#2E2C29', fg: '#9A9488', border: '#9A9488' },
  CARP:  { bg: '#2E2C29', fg: '#9A9488', border: '#9A9488' },
  OTHER: { bg: '#2E2C29', fg: '#9A9488', border: '#9A9488' },
};

function zeToggleCueMode() {
  zeCueMode = !zeCueMode;
  const btn = document.getElementById('ln-place-cue-btn');
  if (btn) btn.classList.toggle('ln-header-btn--active', zeCueMode);
  const overlay = document.getElementById('ze-edit-overlay');
  if (overlay) overlay.classList.toggle('ze-cue-mode-active', zeCueMode);
  // Close any open popover when toggling off
  if (!zeCueMode) zeCloseCuePopover();
  toast(zeCueMode ? 'Cue mode ON — click the page to place a cue' : 'Cue mode OFF');
}

function zeShowCuePopover(pxX, pxY) {
  const pop = document.getElementById('ze-cue-popover');
  if (!pop) return;
  // Position the popover near the click, but keep it within the wrapper
  const wrapper = document.getElementById('ze-page-wrapper');
  if (!wrapper) return;
  const wW = wrapper.offsetWidth, wH = wrapper.offsetHeight;
  // Default: place to the right and slightly above the click
  let left = pxX + 12, top = pxY - 20;
  // If it would overflow right, flip to left side of click
  if (left + 250 > wW) left = Math.max(4, pxX - 256);
  // If it would overflow bottom, push up
  if (top + 220 > wH) top = Math.max(4, wH - 224);
  if (top < 4) top = 4;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.display = 'block';
  // Clear fields
  const labelEl = document.getElementById('ze-cue-label');
  if (labelEl) { labelEl.value = ''; labelEl.focus(); }
  const descEl = document.getElementById('ze-cue-desc');
  if (descEl) descEl.value = '';
}

function zeCloseCuePopover() {
  const pop = document.getElementById('ze-cue-popover');
  if (pop) pop.style.display = 'none';
  zeCuePending = null;
}

async function zeSavePlacedCue() {
  if (!zeCuePending) { zeCloseCuePopover(); return; }
  if (!isOwner()) { toast('Only the owner can add cues.', 'error'); zeCloseCuePopover(); return; }
  const pid = state.activeProduction?.id;
  if (!pid) { zeCloseCuePopover(); return; }
  const type = document.getElementById('ze-cue-type')?.value || 'OTHER';
  const label = sanitizeName(document.getElementById('ze-cue-label')?.value || '');
  if (!label) { toast('Label is required.', 'error'); return; }
  const description = sanitizeName(document.getElementById('ze-cue-desc')?.value || '');
  const page = parseInt(pdfPageToScriptLabel(currentPage, currentHalf), 10);
  if (isNaN(page) || page < 1) { toast('Cannot place cue on a pre-script page.', 'error'); zeCloseCuePopover(); return; }
  const bounds = {
    x: zeCuePending.xPct,
    y: zeCuePending.yPct,
    w: 2,
    h: 2,
  };
  const cueData = {
    page,
    half: '',
    type,
    label,
    description,
    xSide: zeCuePending.xPct < 50 ? 'left' : 'right',
    yPosition: zeCuePending.yPct,
    zoneIdx: null,
    bounds,
    createdAt: serverTimestamp(),
  };
  try {
    await addDoc(collection(db, 'productions', pid, 'scriptCues'), cueData);
    toast('Cue placed: ' + label, 'success');
  } catch(e) {
    console.error('Failed to save placed cue:', e);
    toast('Failed to save cue.', 'error');
  }
  zeCloseCuePopover();
  // scriptCues snapshot listener will re-render markers automatically
}

/**
 * Render cue markers on the zone editor canvas overlay.
 * Called from zeRenderZones (appended to end).
 */
function zeRenderCueMarkers() {
  const ovl = document.getElementById('ze-edit-overlay');
  if (!ovl) return;
  // Remove old cue markers
  ovl.querySelectorAll('.ze-cue-marker').forEach(el => el.remove());
  // Determine current script page
  const scriptLabel = pdfPageToScriptLabel(currentPage, currentHalf);
  const scriptPageNum = parseInt(scriptLabel, 10);
  if (isNaN(scriptPageNum) || scriptPageNum < 1) return;
  const pageCues = scriptCues.filter(c => c.page === scriptPageNum);
  if (pageCues.length === 0) return;

  pageCues.forEach(cue => {
    const colors = ZE_CUE_COLORS[cue.type] || ZE_CUE_COLORS.OTHER;
    const yPct = cue.bounds?.y ?? cue.yPosition ?? 10;
    const marker = document.createElement('div');
    marker.className = 'ze-cue-marker';
    marker.dataset.cueId = cue.id;
    marker.style.top = yPct + '%';
    marker.style.background = colors.bg;
    marker.style.color = colors.fg;
    marker.style.borderColor = colors.border;
    marker.innerHTML = '<span class="ze-cue-type-tag">' + escapeHtml(cue.type) + '</span> ' + escapeHtml(cue.label || '');
    marker.title = (cue.type || '') + ' ' + (cue.label || '') + (cue.description ? ' — ' + cue.description : '');
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      // Highlight selected
      ovl.querySelectorAll('.ze-cue-marker').forEach(el => el.classList.remove('ze-cue-marker--selected'));
      marker.classList.add('ze-cue-marker--selected');
    });
    ovl.appendChild(marker);
  });
}

${feat5Anchor}`;

  if (ln.includes('function zeToggleCueMode()')) {
    console.log(`${INFO} [SKIP] "Cue placement functions" — already applied`);
  } else {
    const f5Idx = ln.indexOf(feat5Anchor);
    if (f5Idx === -1) {
      console.log(`${FAIL} Anchor not found for "Cue placement functions"`);
      allGood = false;
    } else {
      ln = ln.slice(0, f5Idx) + cueFunctionsBlock + ln.slice(f5Idx + feat5Anchor.length);
      console.log(`${OK} Patched "Cue placement functions"`);
    }
  }

  // 2d. Call zeRenderCueMarkers() at the end of zeRenderZones.
  //     zeRenderZones ends by appending zone divs. We'll anchor on the closing
  //     of the forEach loop inside zeRenderZones — specifically the resize handle
  //     addEventListener block. Instead, let's find where zeRenderZones is called
  //     and add a call after it, OR insert at the end of zeRenderZones itself.
  //     Safest: add call after every zeRenderZones() invocation.
  //     Actually even simpler: just put the call inside renderZoneEditorPage
  //     right after zeRenderZones().
  //     
  //     Anchor: "zeRenderZones();\n  zeUpdateListPanel();" inside renderZoneEditorPage
  //     But this pattern appears in multiple places. Let's pick the one inside
  //     renderZoneEditorPage specifically.

  //     Better approach: add zeRenderCueMarkers() call inside zeRenderZones itself,
  //     at the very end. The function ends with:  ovl.insertBefore(div, rb);  });  }
  //     That's inside a forEach. Let's instead patch the function to call
  //     zeRenderCueMarkers after the zones forEach.
  //     
  //     The cleanest anchor: the closing of zeRenderZones where it appends the
  //     resize handle listener. But that's inside a forEach which is hard to anchor.
  //     
  //     Alternative: just add the call after every zeRenderZones() call site.
  //     There are multiple call sites, so let's use a wrapper approach instead.
  //     
  //     Simplest: add at the bottom of zeRenderZones. The function's last line
  //     before the closing brace is: ovl.insertBefore(div, rb);  });
  //     But that's the end of the forEach. After it, the function closes with }.
  //     
  //     Let me use a different approach: patch the function declaration itself
  //     to wrap it. Actually, the simplest and least fragile approach:
  //     find "zeRenderZones(); zeUpdateListPanel();" (which appears in several
  //     places like zeFinishDraw, zeReExtract, etc.) and add zeRenderCueMarkers after.
  //     
  //     But that's many call sites. Instead let's add it at the very end of
  //     the zeRenderZones function body by finding a unique anchor near the end.

  //     Actually the BEST approach: just search for the function closing.
  //     zeRenderZones is defined as:
  //       function zeRenderZones() {
  //         ...
  //         ovl.insertBefore(div, rb);
  //       });
  //     }
  //     
  //     The }) is closing the forEach, then } closes zeRenderZones.
  //     But there are many }); } patterns. Let me find the unique bit:
  //     "handle.addEventListener('mousedown', e => {" ... close of forEach ... close of func
  //     
  //     I'll use the approach of wrapping: rename zeRenderZones and add a wrapper.
  //     No, too complex. Let me just add zeRenderCueMarkers() to each call site.
  //     
  //     Actually, I just realized: the most robust approach is to add a single
  //     call inside renderZoneEditorPage, which is the main entry point that
  //     calls zeRenderZones + zeUpdateListPanel. Other call sites (zeFinishDraw etc.)
  //     also call zeRenderZones but cue markers don't need refreshing there since
  //     they're about zones, not cues. The Firestore subscription re-calls
  //     renderCuesPanel, but we also need to re-render markers on the canvas
  //     when cues change.
  //     
  //     Plan: 
  //     (A) Add zeRenderCueMarkers() call in renderZoneEditorPage after zeRenderZones
  //     (B) Add zeRenderCueMarkers() call in the scriptCues onSnapshot callback

  // 2d(A). Add zeRenderCueMarkers() in renderZoneEditorPage after zeRenderZones();
  const renderPageAnchor = `zeRenderZones();
  zeUpdateListPanel();
}`;
  // This pattern appears at the end of renderZoneEditorPage. But it might also
  // appear elsewhere. Let's look for the unique context near the page rendering:
  // "if (gen !== zeRenderGen) return;\n\n  zeRenderZones();\n  zeUpdateListPanel();\n}"
  const renderPageAnchorFull = `if (gen !== zeRenderGen) return;

  zeRenderZones();
  zeUpdateListPanel();
}`;
  const renderPageReplacement = `if (gen !== zeRenderGen) return;

  zeRenderZones();
  zeRenderCueMarkers();
  zeUpdateListPanel();
}`;

  if (ln.includes('zeRenderCueMarkers();')) {
    console.log(`${INFO} [SKIP] "zeRenderCueMarkers call in renderZoneEditorPage" — already applied`);
  } else {
    const rpIdx = ln.indexOf(renderPageAnchorFull);
    if (rpIdx === -1) {
      console.log(`${FAIL} Anchor not found for "zeRenderCueMarkers call in renderZoneEditorPage"`);
      allGood = false;
    } else {
      ln = ln.slice(0, rpIdx) + renderPageReplacement + ln.slice(rpIdx + renderPageAnchorFull.length);
      console.log(`${OK} Patched "zeRenderCueMarkers call in renderZoneEditorPage"`);
    }
  }

  // 2d(B). Add zeRenderCueMarkers() in the scriptCues onSnapshot callback.
  //        The callback currently has: "if (activeLnSubtab === 'cues') renderCuesPanel();"
  const snapAnchor = `if (activeLnSubtab === 'cues') renderCuesPanel();`;
  const snapReplacement = `if (activeLnSubtab === 'cues') renderCuesPanel();
    // Always refresh cue markers on the zone editor canvas
    zeRenderCueMarkers();`;

  if (ln.includes('// Always refresh cue markers on the zone editor canvas')) {
    console.log(`${INFO} [SKIP] "zeRenderCueMarkers in onSnapshot" — already applied`);
  } else {
    const snIdx = ln.indexOf(snapAnchor);
    if (snIdx === -1) {
      console.log(`${FAIL} Anchor not found for "zeRenderCueMarkers in onSnapshot"`);
      allGood = false;
    } else {
      ln = ln.slice(0, snIdx) + snapReplacement + ln.slice(snIdx + snapAnchor.length);
      console.log(`${OK} Patched "zeRenderCueMarkers in onSnapshot"`);
    }
  }

  // 2e. Wire the "Place Cue" button and popover buttons in initLineNotes or wireZeToolbar.
  //     Best spot: wireZeToolbar, since it already wires toolbar buttons.
  //     Anchor: end of wireZeToolbar — find the last line that adds an event listener.
  //     The function ends with listeners for zd-text, zd-charname, etc.
  //     Let's anchor on the zd-musicline listener line:
  const toolbarAnchor = `document.getElementById('zd-musicline')?.addEventListener('change', zeApplyDetail);`;
  const toolbarReplacement = `document.getElementById('zd-musicline')?.addEventListener('change', zeApplyDetail);

  // Cue placement mode wiring
  document.getElementById('ln-place-cue-btn')?.addEventListener('click', zeToggleCueMode);
  document.getElementById('ze-cue-save')?.addEventListener('click', zeSavePlacedCue);
  document.getElementById('ze-cue-cancel')?.addEventListener('click', zeCloseCuePopover);
  document.getElementById('ze-cue-label')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); zeSavePlacedCue(); }
    if (e.key === 'Escape') zeCloseCuePopover();
  });`;

  if (ln.includes("document.getElementById('ln-place-cue-btn')")) {
    console.log(`${INFO} [SKIP] "Cue button wiring in wireZeToolbar" — already applied`);
  } else {
    const twIdx = ln.indexOf(toolbarAnchor);
    if (twIdx === -1) {
      console.log(`${FAIL} Anchor not found for "Cue button wiring in wireZeToolbar"`);
      allGood = false;
    } else {
      ln = ln.slice(0, twIdx) + toolbarReplacement + ln.slice(twIdx + toolbarAnchor.length);
      console.log(`${OK} Patched "Cue button wiring in wireZeToolbar"`);
    }
  }

  // 2f. Ensure cue mode is turned off when switching pages or subtabs.
  //     In changeZonePage, add zeCueMode reset. Anchor on: "await renderZoneEditorPage(currentPage);" at the end of changeZonePage
  //     Actually it's cleaner to reset in renderZoneEditorPage itself — at the top:
  //     "zeSelectedIdx = null;" → add cue mode reset after it.
  const pageResetAnchor = `zeSelectedIdx = null;
  zeMultiSelected.clear();
  document.getElementById('ze-detail')?.classList.remove('visible');
  document.getElementById('ze-multi-bar')?.classList.remove('visible');`;
  const pageResetReplacement = `zeSelectedIdx = null;
  zeMultiSelected.clear();
  // Close cue popover on page change (but don't exit cue mode)
  zeCloseCuePopover();
  document.getElementById('ze-detail')?.classList.remove('visible');
  document.getElementById('ze-multi-bar')?.classList.remove('visible');`;

  if (ln.includes('// Close cue popover on page change')) {
    console.log(`${INFO} [SKIP] "Close cue popover on page change" — already applied`);
  } else {
    const prIdx = ln.indexOf(pageResetAnchor);
    if (prIdx === -1) {
      console.log(`${FAIL} Anchor not found for "Close cue popover on page change"`);
      allGood = false;
    } else {
      ln = ln.slice(0, prIdx) + pageResetReplacement + ln.slice(prIdx + pageResetAnchor.length);
      console.log(`${OK} Patched "Close cue popover on page change"`);
    }
  }

  if (allGood || !DRY) write(LN_FILE, ln);
}

// ═══════════════════════════════════════════════════════════
// PATCH 3: src/runshow/cue-margin.js — bounds.y fallback
// ═══════════════════════════════════════════════════════════
console.log('\n── Patch 3: src/runshow/cue-margin.js ──');

const CM_FILE = 'src/runshow/cue-margin.js';
let cm = read(CM_FILE);

if (cm !== null) {
  // The Y position line in renderMarginCues:
  const yAnchor = `const y = cue.yPosition != null ? cue.yPosition : (cue._computedY || 10);`;
  const yReplacement = `const y = cue.yPosition != null ? cue.yPosition : (cue.bounds?.y ?? cue._computedY ?? 10);`;

  if (cm.includes('cue.bounds?.y')) {
    console.log(`${INFO} [SKIP] "bounds.y fallback" — already applied`);
  } else {
    const yIdx = cm.indexOf(yAnchor);
    if (yIdx === -1) {
      console.log(`${FAIL} Anchor not found for "bounds.y fallback"`);
      allGood = false;
    } else {
      cm = cm.slice(0, yIdx) + yReplacement + cm.slice(yIdx + yAnchor.length);
      console.log(`${OK} Patched "bounds.y fallback"`);
    }
  }

  // Also update _assignDefaultPositions to skip cues that have bounds
  const assignAnchor = `const needsY = cues.filter(c => c.yPosition == null);`;
  const assignReplacement = `const needsY = cues.filter(c => c.yPosition == null && c.bounds?.y == null);`;

  if (cm.includes('c.bounds?.y == null')) {
    console.log(`${INFO} [SKIP] "_assignDefaultPositions bounds check" — already applied`);
  } else {
    const aIdx = cm.indexOf(assignAnchor);
    if (aIdx === -1) {
      console.log(`${FAIL} Anchor not found for "_assignDefaultPositions bounds check"`);
      allGood = false;
    } else {
      cm = cm.slice(0, aIdx) + assignReplacement + cm.slice(aIdx + assignAnchor.length);
      console.log(`${OK} Patched "_assignDefaultPositions bounds check"`);
    }
  }

  if (allGood || !DRY) write(CM_FILE, cm);
}

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log('\n' + (DRY ? '═══ DRY RUN COMPLETE ═══' : '═══ PATCHES APPLIED ═══'));
if (!allGood) {
  console.log(`${FAIL} Some patches failed — review output above`);
  process.exit(1);
} else if (DRY) {
  console.log(`${OK} All anchors found. Run with --apply to write changes.\n`);
  console.log('Verification checklist after applying:');
  console.log('  1. Open Edit Script tab — "Place Cue" button should appear in the header toolbar');
  console.log('  2. Click "Place Cue" — button highlights gold, cursor changes to crosshair');
  console.log('  3. Click anywhere on the PDF page — popover appears with Type/Label/Desc fields');
  console.log('  4. Fill in Label (required) and click "Add Cue" — cue marker pill appears on left margin');
  console.log('  5. Navigate to another page and back — cue markers persist (Firestore)');
  console.log('  6. Switch to Run Show tab, go to same page — cue appears positioned at the correct Y');
  console.log('  7. Existing cues (created via old form) still render correctly in both views');
  console.log('  8. Zone drawing still works normally when not in cue mode');
} else {
  console.log(`${OK} All patches written successfully.\n`);
}
