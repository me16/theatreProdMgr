#!/usr/bin/env node
// cue-p2-script-cues.mjs — Phase 2: Script Cue Redesign
// Replaces the banner-bar cue rendering with margin-pinned cues,
// adds the cue detail panel to the diagram area, and enhances
// the Edit Script cue placement with click-to-place.
//
// Usage: node cue-p2-script-cues.mjs          (dry run)
//        node cue-p2-script-cues.mjs --apply   (apply changes)

import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
let patchCount = 0;

function applyPatch(file, oldStr, newStr, label) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(newStr) && !FORCE) {
    console.log(`  [SKIP] ${label} — already applied`);
    return content;
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    console.error(`  [FAIL] ${label}`);
    console.error(`    Expected (first 200 chars): ${oldStr.slice(0, 200)}`);
    const nearby = content.slice(Math.max(0, content.length / 2 - 100), content.length / 2 + 100);
    console.error(`    File midpoint sample: ${nearby.slice(0, 200)}`);
    process.exit(1);
  }
  if (content.indexOf(oldStr, idx + 1) !== -1) {
    console.error(`  [FAIL] ${label} — multiple matches found. Use a more specific anchor.`);
    process.exit(1);
  }
  const updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
  if (!DRY) fs.writeFileSync(file, updated, 'utf8');
  console.log(`  [✓] ${label}`);
  patchCount++;
  return updated;
}

function createFile(file, content, label) {
  if (fs.existsSync(file) && !FORCE) {
    console.log(`  [SKIP] ${label} — file exists`);
    return;
  }
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) { if (!DRY) fs.mkdirSync(dir, { recursive: true }); }
  if (!DRY) fs.writeFileSync(file, content, 'utf8');
  console.log(`  [✓] ${label}`);
  patchCount++;
}

console.log(`\nCUE P2: Script Cue Redesign ${DRY ? '(DRY RUN)' : '(APPLYING)'}\n`);

const INDEX_PATH = 'index.html';
const RUNSHOW_PATH = 'src/runshow/Runshow.js';
const LINENOTES_PATH = 'src/linenotes/linenotes.js';


// ─────────────────────────────────────────────────────────────
// 1. Create src/runshow/cue-margin.js
// ─────────────────────────────────────────────────────────────
createFile('src/runshow/cue-margin.js', `/**
 * cue-margin.js — Margin-Pinned Cue Rendering
 *
 * Renders script cues as positioned pill markers in the PDF overlay margins,
 * replacing the old banner-bar approach. Each marker is placed at the cue's
 * Y position (or distributed evenly if no yPosition is set).
 *
 * Also renders the Cue Detail panel and Cue Summary panel for the diagram
 * panel's Cue Details tab.
 */

import { escapeHtml } from '../shared/ui.js';
import { state } from '../shared/state.js';

// Department → color mapping (matches cue type badge colors)
const TYPE_COLORS = {
  LX:    { bg: '#1A2E50', fg: '#5B9BD4' },
  SQ:    { bg: '#2D1A14', fg: '#E63946' },
  PX:    { bg: '#1A2A1A', fg: '#2D8A4E' },
  FLY:   { bg: '#2E2C29', fg: '#9A9488' },
  CARP:  { bg: '#2E2C29', fg: '#9A9488' },
  OTHER: { bg: '#2E2C29', fg: '#9A9488' },
};

function _typeColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.OTHER;
}

/**
 * Distribute default Y positions for cues without explicit yPosition.
 * Spaces them evenly in the top 80% of the page.
 */
function _assignDefaultPositions(cues) {
  const needsY = cues.filter(c => c.yPosition == null);
  if (needsY.length === 0) return;
  const step = 80 / (needsY.length + 1);
  needsY.forEach((c, i) => {
    c._computedY = step * (i + 1);
  });
}

/**
 * Render margin cue markers as positioned elements inside the hit overlay.
 *
 * @param {Array}  cues         — scriptCues for the current page
 * @param {number} page         — current script page number
 * @param {string} half         — 'L'|'R'|'' for split mode
 * @param {HTMLElement} overlayEl — the rs-hit-overlay element
 * @param {number} canvasWidth  — rendered canvas width in px (for margin offset)
 * @param {Function} onCueClick — callback(cue) when a marker is clicked
 */
export function renderMarginCues(cues, page, half, overlayEl, canvasWidth, onCueClick) {
  if (!overlayEl || !cues.length) return;

  // Remove any existing margin cues before rendering
  overlayEl.querySelectorAll('.rs-cue-marker').forEach(el => el.remove());

  _assignDefaultPositions(cues);

  cues.forEach(cue => {
    const y = cue.yPosition != null ? cue.yPosition : (cue._computedY || 10);
    const side = cue.xSide || 'left';
    const { bg, fg } = _typeColor(cue.type);

    const marker = document.createElement('div');
    marker.className = 'rs-cue-marker';
    marker.dataset.cueId = cue.id;
    marker.style.cssText = [
      'position:absolute',
      'top:' + y + '%',
      side === 'right' ? 'right:-52px' : 'left:-52px',
      'width:46px',
      'height:18px',
      'border-radius:9px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-family:"DM Mono",monospace',
      'font-size:10px',
      'font-weight:500',
      'cursor:pointer',
      'z-index:15',
      'pointer-events:all',
      'transition:transform 0.15s,box-shadow 0.15s',
      'background:' + bg,
      'color:' + fg,
    ].join(';');

    marker.textContent = cue.label || cue.type;
    marker.title = (cue.label || cue.type) + (cue.description ? ' — ' + cue.description : '');

    // Called indicator
    if (cue.goTimestamp) {
      marker.classList.add('rs-cue-marker--called');
      marker.style.background = 'var(--green)';
      marker.style.color = '#fff';
    }

    // Connector line from marker to page edge
    const connector = document.createElement('div');
    connector.className = 'rs-cue-connector';
    connector.style.cssText = [
      'position:absolute',
      'top:50%',
      side === 'right' ? 'left:-6px' : 'right:-6px',
      'width:6px',
      'height:0',
      'border-top:1px dashed ' + fg,
      'opacity:0.4',
    ].join(';');
    marker.appendChild(connector);

    marker.addEventListener('click', e => {
      e.stopPropagation();
      // Highlight selected
      overlayEl.querySelectorAll('.rs-cue-marker').forEach(el => el.classList.remove('rs-cue-marker--selected'));
      marker.classList.add('rs-cue-marker--selected');
      if (onCueClick) onCueClick(cue);
    });

    overlayEl.appendChild(marker);
  });
}

/**
 * Render a detail view for a single selected cue.
 *
 * @param {Object} cue       — the scriptCue document
 * @param {HTMLElement} panelEl — the container element
 * @param {Object|null} session — current run session (for GO button)
 * @param {Function} onGo     — callback when GO is pressed
 */
export function renderCueDetailPanel(cue, panelEl, session, onGo) {
  if (!panelEl) return;
  const { bg, fg } = _typeColor(cue.type);
  const isActiveRun = !!session;
  const alreadyCalled = !!cue.goTimestamp;

  panelEl.innerHTML = \`
    <div style="padding:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="background:\${bg};color:\${fg};padding:2px 10px;border-radius:9px;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;">\${escapeHtml(cue.type)}</span>
        <span style="color:var(--text-primary);font-size:14px;font-weight:500;">\${escapeHtml(cue.label || '')}</span>
      </div>
      \${cue.description ? \`<div style="color:var(--text-secondary);font-size:13px;line-height:1.5;margin-bottom:12px;">\${escapeHtml(cue.description)}</div>\` : ''}
      <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);margin-bottom:12px;">
        Page \${cue.page}\${cue.xSide ? ' · ' + cue.xSide : ''}\${cue.yPosition != null ? ' · y:' + Math.round(cue.yPosition) + '%' : ''}
      </div>
      \${alreadyCalled
        ? \`<div style="padding:8px 12px;background:#1a3a2a;border-radius:6px;color:#4caf50;font-size:12px;font-weight:500;">✓ Called</div>\`
        : isActiveRun
          ? \`<button class="rs-cue-go-btn" data-cue-id="\${escapeHtml(cue.id)}">▶ GO</button>\`
          : '<div style="color:var(--text-muted);font-size:12px;">Start a run to enable GO</div>'
      }
    </div>
  \`;

  if (isActiveRun && !alreadyCalled) {
    panelEl.querySelector('.rs-cue-go-btn')?.addEventListener('click', () => {
      if (onGo) onGo(cue);
    });
  }
}

/**
 * Render a summary of all cues on the current page.
 *
 * @param {Array} cues        — scriptCues for the current page
 * @param {number} page       — current script page
 * @param {HTMLElement} panelEl — container element
 * @param {Function} onCueClick — callback(cue) when a row is clicked
 */
export function renderCueSummaryPanel(cues, page, panelEl, onCueClick) {
  if (!panelEl) return;
  if (cues.length === 0) {
    panelEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No cues on this page.</div>';
    return;
  }
  panelEl.innerHTML = \`
    <div style="padding:8px 12px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--bg-border);">
      Page \${page} · \${cues.length} cue\${cues.length !== 1 ? 's' : ''}
    </div>
    <div class="rs-cue-summary-list">
      \${cues.map(c => {
        const { bg, fg } = _typeColor(c.type);
        const calledClass = c.goTimestamp ? 'rs-cue-summary-row--called' : '';
        return \`<div class="rs-cue-summary-row \${calledClass}" data-cue-id="\${escapeHtml(c.id)}" style="cursor:pointer;">
          <span style="background:\${bg};color:\${fg};padding:1px 8px;border-radius:9px;font-family:'DM Mono',monospace;font-size:10px;">\${escapeHtml(c.type)}</span>
          <span style="flex:1;color:var(--text-primary);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${escapeHtml(c.label || '')}</span>
          \${c.goTimestamp ? '<span style="color:#4caf50;font-size:11px;">✓</span>' : ''}
        </div>\`;
      }).join('')}
    </div>
  \`;
  panelEl.querySelectorAll('.rs-cue-summary-row').forEach(row => {
    row.addEventListener('click', () => {
      const cue = cues.find(c => c.id === row.dataset.cueId);
      if (cue && onCueClick) onCueClick(cue);
    });
  });
}
`, 'Create src/runshow/cue-margin.js');


// ─────────────────────────────────────────────────────────────
// 2. Runshow.js: Add cue-margin import
// ─────────────────────────────────────────────────────────────
applyPatch(RUNSHOW_PATH,
  `import { detectActiveSession, showRecoveryDialog, hydrateSessionFromFirestore, abandonSession, startSessionSync, syncSessionToFirestore } from '../shared/session-sync.js';`,
  `import { detectActiveSession, showRecoveryDialog, hydrateSessionFromFirestore, abandonSession, startSessionSync, syncSessionToFirestore } from '../shared/session-sync.js';
import { renderMarginCues, renderCueDetailPanel, renderCueSummaryPanel } from './cue-margin.js';`,
  'Runshow.js: Add cue-margin imports');


// ─────────────────────────────────────────────────────────────
// 3. Runshow.js: Add panel mode state variable
//    Insert after the existing diagram zoom variable
// ─────────────────────────────────────────────────────────────
applyPatch(RUNSHOW_PATH,
  `let rsDiagramZoomLevel = 1;`,
  `let rsDiagramZoomLevel = 1;

// Cue margin state
let rsSelectedCue = null;
let rsDiagramPanelMode = 'diagrams'; // 'diagrams' | 'cues'`,
  'Runshow.js: Add cue margin state variables');


// ─────────────────────────────────────────────────────────────
// 4. Runshow.js: Replace rsRenderCueBanner — now renders margin
//    cues into the overlay AND updates the cue summary panel
// ─────────────────────────────────────────────────────────────
applyPatch(RUNSHOW_PATH,
  `function rsRenderCueBanner() {
  const banner = document.getElementById('rs-cue-banner');
  if (!banner) return;
  const pageCues = rsScriptCues.filter(c => c.page === rsCurrentScriptPage());
  if (pageCues.length === 0) { banner.innerHTML = ''; return; }
  banner.innerHTML = pageCues.map(c => {
    const typeClass = ['LX', 'SQ', 'PX'].includes(c.type) ? c.type : 'OTHER';
    return \`<span class="rs-cue-pill rs-cue-pill--\${escapeHtml(typeClass)}" title="\${escapeHtml(c.label || '')}">\${escapeHtml(c.label || c.type)}</span>\`;
  }).join('');
}`,
  `function rsRenderCueBanner() {
  // Render margin cues in the overlay (replaces old banner pills)
  const overlay = document.getElementById('rs-hit-overlay');
  const pageCues = rsScriptCues.filter(c => c.page === rsCurrentScriptPage());
  if (overlay) {
    const canvasW = document.getElementById('rs-canvas')?.offsetWidth || 600;
    renderMarginCues(pageCues, rsCurrentScriptPage(), rsCurrentHalf, overlay, canvasW, (cue) => {
      rsSelectedCue = cue;
      rsDiagramPanelMode = 'cues';
      rsRenderDiagramPanelTabs();
      const detailEl = document.getElementById('rs-cue-detail-content');
      if (detailEl) renderCueDetailPanel(cue, detailEl, state.runSession, rsHandleCueGo);
    });
  }
  // Also update the cue summary if that panel tab is active
  if (rsDiagramPanelMode === 'cues') {
    const detailEl = document.getElementById('rs-cue-detail-content');
    if (detailEl && !rsSelectedCue) {
      renderCueSummaryPanel(pageCues, rsCurrentScriptPage(), detailEl, (cue) => {
        rsSelectedCue = cue;
        renderCueDetailPanel(cue, detailEl, state.runSession, rsHandleCueGo);
        // Highlight the marker
        overlay?.querySelectorAll('.rs-cue-marker').forEach(el => {
          el.classList.toggle('rs-cue-marker--selected', el.dataset.cueId === cue.id);
        });
      });
    }
  }
  // Keep the old banner element clear (backward compat)
  const banner = document.getElementById('rs-cue-banner');
  if (banner) banner.innerHTML = '';
}

/** Handle GO button press on a cue — marks it as called in Firestore. */
async function rsHandleCueGo(cue) {
  if (!state.runSession || !cue) return;
  const pid = state.activeProduction.id;
  try {
    await updateDoc(doc(db, 'productions', pid, 'scriptCues', cue.id), {
      goTimestamp: Date.now(),
      goSessionId: state.runSession.sessionId,
    });
    toast('Cue called: ' + (cue.label || cue.type), 'success');
  } catch (e) {
    toast('Failed to mark cue.', 'error');
  }
}

/** Render the Diagrams | Cue Details tab toggle in the diagram panel header. */
function rsRenderDiagramPanelTabs() {
  const panel = document.getElementById('rs-diagram-panel');
  if (!panel) return;
  let tabBar = panel.querySelector('.rs-diagram-tab-bar');
  if (!tabBar) {
    // Create tab bar — insert after the toggle button
    tabBar = document.createElement('div');
    tabBar.className = 'rs-diagram-tab-bar';
    const toggleBtn = document.getElementById('rs-diagram-toggle');
    if (toggleBtn) toggleBtn.after(tabBar);
    else panel.prepend(tabBar);
  }
  tabBar.innerHTML = \`
    <button class="rs-diagram-tab-btn \${rsDiagramPanelMode === 'diagrams' ? 'rs-diagram-tab-btn--active' : ''}" data-panel-mode="diagrams">Diagrams</button>
    <button class="rs-diagram-tab-btn \${rsDiagramPanelMode === 'cues' ? 'rs-diagram-tab-btn--active' : ''}" data-panel-mode="cues">Cue Details</button>
  \`;
  tabBar.querySelectorAll('.rs-diagram-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      rsDiagramPanelMode = btn.dataset.panelMode;
      rsRenderDiagramPanelTabs();
      rsUpdateDiagramPanelContent();
    });
  });
  rsUpdateDiagramPanelContent();
}

/** Show/hide diagram viewer vs cue detail content based on active panel mode. */
function rsUpdateDiagramPanelContent() {
  const viewer = document.getElementById('rs-diagram-viewer');
  const zoomCtrl = document.getElementById('rs-diagram-zoom-controls');
  let cueDetail = document.getElementById('rs-cue-detail-content');
  const panel = document.getElementById('rs-diagram-panel');

  // Ensure cue detail container exists
  if (!cueDetail && panel) {
    cueDetail = document.createElement('div');
    cueDetail.id = 'rs-cue-detail-content';
    cueDetail.style.cssText = 'flex:1;overflow-y:auto;';
    panel.appendChild(cueDetail);
  }

  if (rsDiagramPanelMode === 'diagrams') {
    if (viewer) viewer.style.display = '';
    if (zoomCtrl) zoomCtrl.style.display = panel?.classList.contains('collapsed') ? 'none' : 'flex';
    if (cueDetail) cueDetail.style.display = 'none';
  } else {
    if (viewer) viewer.style.display = 'none';
    if (zoomCtrl) zoomCtrl.style.display = 'none';
    if (cueDetail) cueDetail.style.display = '';
    // Expand diagram panel if collapsed to show cue details
    if (panel?.classList.contains('collapsed')) {
      panel.classList.remove('collapsed');
      const toggleBtn = document.getElementById('rs-diagram-toggle');
      if (toggleBtn) toggleBtn.textContent = '«';
    }
    // Render cue content
    const pageCues = rsScriptCues.filter(c => c.page === rsCurrentScriptPage());
    if (rsSelectedCue) {
      renderCueDetailPanel(rsSelectedCue, cueDetail, state.runSession, rsHandleCueGo);
    } else {
      renderCueSummaryPanel(pageCues, rsCurrentScriptPage(), cueDetail, (cue) => {
        rsSelectedCue = cue;
        renderCueDetailPanel(cue, cueDetail, state.runSession, rsHandleCueGo);
      });
    }
  }
}`,
  'Runshow.js: Replace rsRenderCueBanner with margin cues + panel tabs');


// ─────────────────────────────────────────────────────────────
// 5. Runshow.js: Update rsRedrawOverlay to also render margin cues
// ─────────────────────────────────────────────────────────────
applyPatch(RUNSHOW_PATH,
  `function rsRedrawOverlay(num) {
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (!hitOverlay) return;
  hitOverlay.innerHTML = '';
  rsRenderLineZones(rsPk());
  rsRenderNoteMarkers(num, rsCurrentHalf);
}`,
  `function rsRedrawOverlay(num) {
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (!hitOverlay) return;
  hitOverlay.innerHTML = '';
  rsRenderLineZones(rsPk());
  rsRenderNoteMarkers(num, rsCurrentHalf);
  // Render margin cues on overlay (after zones & notes so they layer on top)
  rsRenderCueBanner();
}`,
  'Runshow.js: Add margin cue rendering to rsRedrawOverlay');


// ─────────────────────────────────────────────────────────────
// 6. Runshow.js: Clear selected cue on page change
//    Anchor: the rsChangePage function's render call
// ─────────────────────────────────────────────────────────────
applyPatch(RUNSHOW_PATH,
  `function rsChangePage(delta) {`,
  `function rsChangePage(delta) {
  rsSelectedCue = null; // Clear cue selection on page change`,
  'Runshow.js: Clear selected cue on page change');


// ─────────────────────────────────────────────────────────────
// 7. index.html: Add margin cue CSS after the existing cue banner CSS
// ─────────────────────────────────────────────────────────────
applyPatch(INDEX_PATH,
  `    /* ===== FEATURE 4: Diagram panel ===== */`,
  `    /* ===== Margin Cue Markers ===== */
    .rs-cue-marker { box-shadow:0 2px 8px rgba(0,0,0,0.3); }
    .rs-cue-marker:hover { transform:scale(1.08); box-shadow:0 4px 12px rgba(0,0,0,0.4); z-index:20; }
    .rs-cue-marker--selected { outline:2px solid #fff; outline-offset:1px; z-index:21; }
    .rs-cue-marker--called { opacity:0.7; }
    .rs-cue-go-btn {
      width:100%; padding:10px; margin-top:8px; background:var(--green); color:#fff; border:none;
      border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; transition:background 0.2s;
    }
    .rs-cue-go-btn:hover { background:#38a05e; }
    .rs-cue-summary-list { display:flex; flex-direction:column; }
    .rs-cue-summary-row {
      display:flex; align-items:center; gap:8px; padding:8px 12px;
      border-bottom:1px solid var(--bg-border); transition:background 0.15s;
    }
    .rs-cue-summary-row:hover { background:var(--bg-raised); }
    .rs-cue-summary-row--called { opacity:0.6; }
    /* Diagram panel tab bar */
    .rs-diagram-tab-bar {
      display:flex; border-bottom:1px solid var(--bg-border); flex-shrink:0;
    }
    .rs-diagram-tab-btn {
      flex:1; padding:5px 8px; background:none; border:none; border-bottom:2px solid transparent;
      color:var(--text-muted); font-size:11px; font-weight:500; cursor:pointer; transition:all 0.2s;
    }
    .rs-diagram-tab-btn:hover { color:var(--text-secondary); }
    .rs-diagram-tab-btn--active { color:var(--gold); border-bottom-color:var(--gold); }

    /* ===== FEATURE 4: Diagram panel ===== */`,
  'index.html: Add margin cue + diagram tab CSS');


// ─────────────────────────────────────────────────────────────
// 8. linenotes.js: Enhance cue form with placement fields
//    Add xSide and description fields to the cue add/edit form.
//    We extend the saveCue function's cueData to include new fields.
// ─────────────────────────────────────────────────────────────
applyPatch(LINENOTES_PATH,
  `const cueData = { page, half: '', type, label, zoneIdx: null, bounds: null, createdAt: serverTimestamp() };`,
  `const description = sanitizeName(document.getElementById('cue-desc-input')?.value || '');
  const xSide = document.getElementById('cue-side-select')?.value || 'left';
  const yPositionRaw = document.getElementById('cue-y-input')?.value;
  const yPosition = yPositionRaw ? parseFloat(yPositionRaw) : null;
  const cueData = { page, half: '', type, label, description, xSide, yPosition, zoneIdx: null, bounds: null, createdAt: serverTimestamp() };`,
  'linenotes.js: Extend cue data with description, xSide, yPosition');


// ─────────────────────────────────────────────────────────────
// 9. linenotes.js: Add description/side/yPosition fields to
//    the cue form HTML. We patch the existing form inputs.
// ─────────────────────────────────────────────────────────────
applyPatch(LINENOTES_PATH,
  `placeholder="Label (e.g. LX 42)" style="flex:1;min-width:150px;" /></div><div style="display:flex;gap:8px;"><button class="modal-btn-primary" id="cue-save-btn">Add Cue</button>`,
  `placeholder="Label (e.g. LX 42)" style="flex:1;min-width:150px;" /></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"><input class="form-input" id="cue-desc-input" type="text" maxlength="200" placeholder="Description (optional)" style="flex:1;min-width:200px;" /><select class="form-select" id="cue-side-select" style="width:80px;"><option value="left">Left</option><option value="right">Right</option></select><input class="form-input" id="cue-y-input" type="number" min="0" max="100" step="1" placeholder="Y %" style="width:60px;" title="Vertical position on page (0-100%)" /></div><div style="display:flex;gap:8px;"><button class="modal-btn-primary" id="cue-save-btn">Add Cue</button>`,
  'linenotes.js: Add description/side/yPosition fields to cue form');


// ─────────────────────────────────────────────────────────────
// 10. linenotes.js: Populate new fields on edit
// ─────────────────────────────────────────────────────────────
applyPatch(LINENOTES_PATH,
  `function startCueEdit(cueId) {
  const cue = scriptCues.find(c => c.id === cueId); if (!cue) return;
  document.getElementById('cue-page-input').value = cue.page || '';
  document.getElementById('cue-type-select').value = cue.type || 'OTHER';
  document.getElementById('cue-label-input').value = cue.label || '';
  document.getElementById('cue-edit-id').value = cueId;`,
  `function startCueEdit(cueId) {
  const cue = scriptCues.find(c => c.id === cueId); if (!cue) return;
  document.getElementById('cue-page-input').value = cue.page || '';
  document.getElementById('cue-type-select').value = cue.type || 'OTHER';
  document.getElementById('cue-label-input').value = cue.label || '';
  document.getElementById('cue-edit-id').value = cueId;
  const descEl = document.getElementById('cue-desc-input');
  if (descEl) descEl.value = cue.description || '';
  const sideEl = document.getElementById('cue-side-select');
  if (sideEl) sideEl.value = cue.xSide || 'left';
  const yEl = document.getElementById('cue-y-input');
  if (yEl) yEl.value = cue.yPosition != null ? cue.yPosition : '';`,
  'linenotes.js: Populate description/side/yPosition on cue edit');


// ─────────────────────────────────────────────────────────────
// 11. linenotes.js: Clear new fields on cancel
// ─────────────────────────────────────────────────────────────
applyPatch(LINENOTES_PATH,
  `function cancelCueEdit() {
  document.getElementById('cue-page-input').value = '';
  document.getElementById('cue-label-input').value = '';
  document.getElementById('cue-edit-id').value = '';`,
  `function cancelCueEdit() {
  document.getElementById('cue-page-input').value = '';
  document.getElementById('cue-label-input').value = '';
  document.getElementById('cue-edit-id').value = '';
  const descEl = document.getElementById('cue-desc-input');
  if (descEl) descEl.value = '';
  const sideEl = document.getElementById('cue-side-select');
  if (sideEl) sideEl.value = 'left';
  const yEl = document.getElementById('cue-y-input');
  if (yEl) yEl.value = '';`,
  'linenotes.js: Clear new fields on cue cancel');


// ─────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────
console.log(`\n✔ ${patchCount} operations ${DRY ? 'would be applied' : 'applied'}.`);

if (!DRY) {
  console.log('\nVerification checklist:');
  console.log('  1. App loads without console errors');
  console.log('  2. Run Show tab: script cues appear as positioned pill markers in the page margins (not banner)');
  console.log('  3. Cue pills show correct department colors (LX=blue, SQ=red, PX=green, etc.)');
  console.log('  4. Clicking a cue marker opens the Cue Details panel in the diagram panel area');
  console.log('  5. Diagram panel header shows Diagrams | Cue Details toggle tabs');
  console.log('  6. Switching between Diagrams and Cue Details preserves each view\'s content');
  console.log('  7. During an active run, the GO button appears in cue detail view');
  console.log('  8. Pressing GO marks the cue as called (green pill, "✓ Called" status)');
  console.log('  9. Edit Script > Cues & Diagrams: cue form now has Description, Side, and Y% fields');
  console.log(' 10. Editing an existing cue populates the new fields correctly');
  console.log(' 11. Cue banner div still exists but is empty (backward compat)');
  console.log(' 12. Page navigation clears cue selection');
  console.log(' 13. Diagrams panel still works normally when in Diagrams mode');
}
