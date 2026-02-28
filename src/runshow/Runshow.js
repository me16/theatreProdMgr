/**
 * runshow.js — Run Show Tab
 *
 * Owns the entire Run Show tab: pre-run/idle mode, active session mode,
 * script PDF rendering with zone-click note entry, note sidebar, timer UI,
 * stage columns widget, session lifecycle, and post-run report.
 *
 * Firestore writes to sessions subcollection:
 *   - readable by all production members (same pattern as props and lineNotes)
 *   - create: any production member
 *   - update/delete: creator (createdBy == request.auth.uid) or owner role
 *
 * lineNotes: no change to existing rules; sessionId is just an additive data field.
 */

import { db, storage } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, genId, confirmDialog, downloadCSV } from '../shared/ui.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, getDoc, getDocs,
  serverTimestamp, query, where, orderBy
} from 'firebase/firestore';
import { ref, getDownloadURL, uploadBytesResumable } from 'firebase/storage';
import { getCastMembers } from '../cast/cast.js';
import {
  getPropStatus, getProps, startTimer, holdTimer, stopTimer,
  startRunSession, endRunSession, setRunShowNotifyCallback,
} from '../props/props.js';
// Zone extraction is self-contained in runshow.js — no linenotes imports needed for rendering
// Script page label helpers are defined locally below (rsScriptLabel / rsScriptOffset).

/* ═══════════════════════════════════════════════════════════
   MODULE STATE
   ═══════════════════════════════════════════════════════════ */
let rsInitialized = false;
let rsPdfDoc = null;         // local pdf doc handle (separate from linenotes' copy)
let rsTotalPages = 0;
let rsCurrentPage = 1;
let rsSplitMode = false;
let rsCurrentHalf = 'L';
let rsPdfScale = 1.4;
let rsLineZones = {};        // local cache { pageKey → zones[] }
let rsNotes = [];
let rsFlatChars = [];
let rsActiveCharIdx = 0;
let rsActiveNoteType = 'skp';
let rsNotesUnsub = null;
let rsRenderGen = 0;
let rsNotesHoveredZoneIdx = null;
let rsCurrentRenderTask = null; // active pdf.js render task — cancelled before starting a new one

// Drawing state
let rsDrawStart = null;
let rsDrawing = false;

// Popover state
let rsPopoverOpen = false;
let _rsPopCloseGuard = false;
let rsPendingNote = null;

// Feature 3: persists between runs so we can show last session's notes
let rsLastSessionId = null;

// Feature 5: script cues subscription
let rsScriptCues = [];
let rsScriptCuesUnsub = null;

// Feature 4: diagrams subscription
let rsDiagrams = [];
let rsDiagramsUnsub = null;
let rsDiagramZoomLevel = 1;

// Timer-driven page tracking — last script page the timer navigated to
let rsLastTimerScriptPage = 0;

const NOTE_TYPES_MAP = {
  'skp': 'Skipped',
  'para': 'Paraphrase',
  'line': 'Called line',
  'add': 'Added words',
  'gen': 'General',
};
const NOTE_TYPES = [
  { key: 'skp', label: 'Skip', color: '#e63946' },
  { key: 'para', label: 'Para', color: '#e89b3e' },
  { key: 'line', label: 'Line', color: '#5b9bd4' },
  { key: 'add', label: 'Add', color: '#6b8f4e' },
  { key: 'gen', label: 'Gen', color: '#9b7bc8' },
];

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function rsPageZoneKey(num, half) { return rsSplitMode ? `${num}${half}` : `${num}`; }
function rsPk() { return rsPageZoneKey(rsCurrentPage, rsCurrentHalf); }

/**
 * Compute the signed integer offset (0 = first script page) for a (pdfPage, half)
 * position, using the production's saved scriptPageStart values.
 *
 * In split mode each half is a separate script page.
 * In non-split mode each PDF page is one script page (half ignored).
 */
function rsScriptOffset(pdfPage, half, useSplit) {
  const startPage = state.activeProduction?.scriptPageStartPage || 1;
  const startHalf = state.activeProduction?.scriptPageStartHalf || '';
  if (useSplit) {
    const halfPos = (p, h) => (p - 1) * 2 + (h === 'R' ? 1 : 0);
    return halfPos(pdfPage, half || 'L') - halfPos(startPage, startHalf || 'L');
  }
  return pdfPage - startPage;
}

/**
 * Return the human-readable script page label for a (pdfPage, half) position.
 * In split mode each half is a distinct numbered page (no L/R suffix in label).
 * Pages before the script start get "i-N" labels.
 */
function rsScriptLabel(pdfPage, half) {
  const offset = rsScriptOffset(pdfPage, half, rsSplitMode);
  return offset < 0 ? ('i' + offset) : String(offset + 1);
}

/** Return the current script page number as an integer (1-based). */
function rsCurrentScriptPage() {
  const offset = rsScriptOffset(rsCurrentPage, rsCurrentHalf, rsSplitMode);
  return offset + 1;
}

/**
 * Navigate the PDF view to a given script page number (1-based).
 * Converts script page → PDF page using the page offset, then renders.
 */
function rsNavigateToScriptPage(scriptPage) {
  if (!rsPdfDoc) return;
  const startPage = state.activeProduction?.scriptPageStartPage || 1;
  const startHalf = state.activeProduction?.scriptPageStartHalf || '';
  const scriptNum = scriptPage - 1; // convert 1-based to 0-based offset
  let pdfPage, half;
  if (rsSplitMode) {
    const startHalfPos = (startPage - 1) * 2 + (startHalf === 'R' ? 1 : 0);
    const targetHalfPos = startHalfPos + scriptNum;
    pdfPage = Math.floor(targetHalfPos / 2) + 1;
    half = (targetHalfPos % 2 === 0) ? 'L' : 'R';
  } else {
    pdfPage = startPage + scriptNum;
    half = 'L';
  }
  const clamped = Math.max(1, Math.min(rsTotalPages, pdfPage));
  if (clamped === rsCurrentPage && (!rsSplitMode || half === rsCurrentHalf)) return; // already there
  rsCurrentPage = clamped;
  rsCurrentHalf = rsSplitMode ? half : 'L';
  rsRenderPage(rsCurrentPage);
}

function rsBuildFlatChars() {
  const cast = getCastMembers();
  rsFlatChars = [];
  cast.forEach(member => {
    const chars = member.characters?.length > 0 ? member.characters : [member.name];
    chars.forEach(charName => {
      rsFlatChars.push({
        id: `${member.id}::${charName}`,
        castId: member.id,
        name: charName,
        actorName: member.name,
        color: member.color || '#888',
        email: member.email || '',
      });
    });
  });
  if (rsActiveCharIdx >= rsFlatChars.length) rsActiveCharIdx = 0;
}

function formatTime(s) {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */
export function initRunShow() {
  // Register the timer re-render callback with props.js
  setRunShowNotifyCallback(() => {
    if (document.getElementById('tab-runshow')?.classList.contains('tab-panel--active')) {
      rsTickTimerDisplay(); // lightweight update — no full re-render
    }
  });

  // Run Show is the default active tab, so tabs.js never fires its activation
  // callback on first production open. Watch for when app-view becomes visible
  // and trigger initialization ourselves if Run Show is still the active tab.
  const appView = document.getElementById('app-view');
  if (appView) {
    const observer = new MutationObserver(() => {
      const visible = appView.style.display !== '' && appView.style.display !== 'none';
      if (visible && document.getElementById('tab-runshow')?.classList.contains('tab-panel--active')) {
        observer.disconnect();
        // Defer one tick so dashboard.js finishes setting state.activeProduction
        setTimeout(() => {
          if (!rsInitialized && state.activeProduction) onRunShowTabActivated();
        }, 0);
      }
    });
    observer.observe(appView, { attributes: true, attributeFilter: ['style'] });
  }

  // Hit overlay click-to-close popover
  document.getElementById('rs-hit-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('rs-hit-overlay')) rsClosePopover();
  });

  // Popover buttons
  document.getElementById('rs-pop-cancel-btn')?.addEventListener('click', e => { e.stopPropagation(); rsClosePopover(); });
  document.getElementById('rs-pop-confirm-btn')?.addEventListener('click', e => { e.stopPropagation(); rsConfirmNote(); });

  // Quick-entry FAB
  document.getElementById('run-show-fab')?.addEventListener('click', openFabPopover);
  document.getElementById('rnp-cancel')?.addEventListener('click', closeFabPopover);
  document.getElementById('rnp-confirm')?.addEventListener('click', confirmFabNote);

  // Report modal buttons
  document.getElementById('run-report-close')?.addEventListener('click', closeReportModal);
  document.getElementById('run-report-print')?.addEventListener('click', printReport);
  document.getElementById('run-report-email')?.addEventListener('click', emailReport);
  document.getElementById('run-report-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('run-report-modal')) closeReportModal();
  });

  // Draw overlay (rubber band)
  document.getElementById('rs-draw-overlay')?.addEventListener('mousedown', rsDrawDown);

  // Global mouse events for rubber band
  document.addEventListener('mousemove', rsGlobalMouseMove);
  document.addEventListener('mouseup', rsGlobalMouseUp);

  // Click-outside popover
  document.addEventListener('click', e => {
    if (_rsPopCloseGuard) return;
    const pop = document.getElementById('rs-note-popover');
    if (rsPopoverOpen && pop && !pop.contains(e.target)) rsClosePopover();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', rsHandleKeydown);

  // Page navigation
  document.getElementById('rs-prev-page')?.addEventListener('click', () => rsChangePage(-1));
  document.getElementById('rs-next-page')?.addEventListener('click', () => rsChangePage(1));
  document.getElementById('rs-split-btn')?.addEventListener('click', rsToggleSplitMode);
  document.getElementById('rs-send-btn')?.addEventListener('click', rsOpenSendNotes);

  // Feature 7: Email Notes button
  document.getElementById('rs-email-notes-btn')?.addEventListener('click', rsOpenEmailNotes);

  // Feature 4: Diagram panel toggle
  document.getElementById('rs-diagram-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('rs-diagram-panel');
    const btn = document.getElementById('rs-diagram-toggle');
    if (!panel) return;
    panel.classList.toggle('collapsed');
    if (btn) btn.textContent = panel.classList.contains('collapsed') ? '»' : '«';
    // Show/hide zoom controls
    const zoomControls = document.getElementById('rs-diagram-zoom-controls');
    if (zoomControls) zoomControls.style.display = panel.classList.contains('collapsed') ? 'none' : 'flex';
  });

  // Collapsible left sidebar
  document.getElementById('rs-collapse-left')?.addEventListener('click', () => {
    const sidebar = document.getElementById('rs-sidebar');
    const btn = document.getElementById('rs-collapse-left');
    if (!sidebar || !btn) return;
    sidebar.classList.toggle('rs-collapsed');
    btn.textContent = sidebar.classList.contains('rs-collapsed') ? '›' : '‹';
    btn.title = sidebar.classList.contains('rs-collapsed') ? 'Show left panel' : 'Hide left panel';
    // When sidebar collapses and diagrams exist, expand diagram panel
    rsUpdateDiagramExpand();
  });

  // Collapsible right controls
  document.getElementById('rs-collapse-right')?.addEventListener('click', () => {
    const controls = document.getElementById('rs-controls');
    const btn = document.getElementById('rs-collapse-right');
    if (!controls || !btn) return;
    controls.classList.toggle('rs-collapsed');
    btn.textContent = controls.classList.contains('rs-collapsed') ? '‹' : '›';
    btn.title = controls.classList.contains('rs-collapsed') ? 'Show right panel' : 'Hide right panel';
    rsUpdateDiagramExpand();
  });

  // Diagram zoom controls
  document.getElementById('rs-diagram-zoom-in')?.addEventListener('click', () => rsDiagramZoom(0.25));
  document.getElementById('rs-diagram-zoom-out')?.addEventListener('click', () => rsDiagramZoom(-0.25));
  document.getElementById('rs-diagram-zoom-fit')?.addEventListener('click', rsDiagramZoomFit);

  // Diagram scroll-to-zoom (mouse wheel)
  document.getElementById('rs-diagram-viewer')?.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      rsDiagramZoom(e.deltaY < 0 ? 0.15 : -0.15);
    }
  }, { passive: false });

  // Page input — accepts script page numbers ("1", "42", "i-1")
  const rsPageInput = document.getElementById('rs-page-input');
  if (rsPageInput) {
    rsPageInput.addEventListener('change', () => {
      if (!rsPdfDoc) return;
      const raw = rsPageInput.value.trim();
      // Parse the script page label to a (pdfPage, half) position
      const startPage = state.activeProduction?.scriptPageStartPage || 1;
      const startHalf = state.activeProduction?.scriptPageStartHalf || '';
      let scriptNum;
      if (raw.startsWith('i')) {
        scriptNum = parseInt(raw.slice(1));
      } else {
        const n = parseInt(raw);
        scriptNum = isNaN(n) ? NaN : n - 1;
      }
      if (isNaN(scriptNum)) {
        rsPageInput.value = rsScriptLabel(rsCurrentPage, rsCurrentHalf);
        return;
      }
      let pdfPage, half;
      if (rsSplitMode) {
        const startHalfPos = (startPage - 1) * 2 + (startHalf === 'R' ? 1 : 0);
        const targetHalfPos = startHalfPos + scriptNum;
        pdfPage = Math.floor(targetHalfPos / 2) + 1;
        half = (targetHalfPos % 2 === 0) ? 'L' : 'R';
      } else {
        pdfPage = startPage + scriptNum;
        half = 'L';
      }
      const clamped = Math.max(1, Math.min(rsTotalPages, pdfPage));
      rsCurrentPage = clamped;
      rsCurrentHalf = rsSplitMode ? half : 'L';
      rsPageInput.value = rsScriptLabel(rsCurrentPage, rsCurrentHalf);
      rsRenderPage(rsCurrentPage);
    });
    rsPageInput.addEventListener('keydown', e => { if (e.key === 'Enter') rsPageInput.blur(); });
  }
}

export async function onRunShowTabActivated() {
  rsBuildFlatChars();
  if (!rsInitialized) {
    rsInitialized = true;
    rsCurrentPage = 1;
    rsSplitMode = false;
    rsCurrentHalf = 'L';
    rsNotes = [];
    rsLineZones = {};
    rsPdfDoc = null;
    rsTotalPages = 0;
    rsRenderGen = 0;
    rsNotesHoveredZoneIdx = null;
    // Read the script page offset directly from Firestore so that all production
    // members automatically share the owner's p.1 setting on every session open.
    await rsLoadScriptPageOffset();
    document.getElementById('rs-show-name').textContent = state.activeProduction?.title || '';
    rsSubscribeToNotes();
    rsSubscribeToScriptCues(); // Feature 5
    rsSubscribeToDiagrams();   // Feature 4
    rsLoadScript();
  }
  renderRunShowTab();
}

/** Fetch scriptPageStart fields from Firestore and sync onto state.activeProduction. */
async function rsLoadScriptPageOffset() {
  const pid = state.activeProduction?.id;
  if (!pid) return;
  try {
    const snap = await getDoc(doc(db, 'productions', pid));
    if (snap.exists()) {
      const data = snap.data();
      // Write the canonical values back onto state.activeProduction so that
      // rsScriptOffset() (which reads state.activeProduction directly) always
      // uses the current persisted values.
      state.activeProduction.scriptPageStartPage = data.scriptPageStartPage || 1;
      state.activeProduction.scriptPageStartHalf = data.scriptPageStartHalf || '';
    }
  } catch(e) {
    console.warn('Could not load scriptPageOffset:', e);
    // Leave existing state.activeProduction values untouched
  }
}

export function resetRunShow() {
  rsInitialized = false;
  if (rsCurrentRenderTask) {
    try { rsCurrentRenderTask.cancel(); } catch(e) { /* ignore */ }
    rsCurrentRenderTask = null;
  }
  if (rsNotesUnsub) { rsNotesUnsub(); rsNotesUnsub = null; }
  rsPdfDoc = null;
  rsNotes = [];
  rsFlatChars = [];
  rsLineZones = {};
  rsRenderGen = 0;
  // Feature 5: clean up script cues
  if (rsScriptCuesUnsub) { rsScriptCuesUnsub(); rsScriptCuesUnsub = null; }
  rsScriptCues = [];
  // Feature 4: clean up diagrams
  if (rsDiagramsUnsub) { rsDiagramsUnsub(); rsDiagramsUnsub = null; }
  rsDiagrams = [];
  rsDiagramZoomLevel = 1;
  // Reset timer page tracking
  rsLastTimerScriptPage = 0;
}

/* ═══════════════════════════════════════════════════════════
   RENDER — TOP LEVEL
   ═══════════════════════════════════════════════════════════ */
export function renderRunShowTab() {
  renderRunShowSidebar();
  renderRunShowControls();
  // Script area renders via rsLoadScript / renderPage
  if (rsPdfDoc) rsRenderPage(rsCurrentPage);
}

/* ═══════════════════════════════════════════════════════════
   RIGHT PANEL — CONTROLS
   ═══════════════════════════════════════════════════════════ */
function renderRunShowControls() {
  const container = document.getElementById('rs-controls');
  if (!container) return;

  const session = state.runSession;
  const elapsed = session?.timerElapsed || 0;
  const totalSec = (session?.timerDuration || 120) * 60;
  const pct = totalSec > 0 ? Math.min(100, (elapsed / totalSec) * 100) : 0;
  const elapsedStr = formatTime(elapsed);
  const remainStr = formatTime(Math.max(0, totalSec - elapsed));
  const tp = session?.timerTotalPages || 100;
  const secPerPage = tp > 0 ? totalSec / tp : 0;
  const nextTurnSec = secPerPage > 0 ? Math.max(0, secPerPage - (elapsed % secPerPage)) : 0;

  const stageCols = renderStageColumnsHtml(rsCurrentScriptPage());

  if (!session) {
    // PRE-RUN / IDLE MODE
    const lastDuration  = localStorage.getItem('lastRunDuration')  || '120';
    const lastWarnPages = localStorage.getItem('lastRunWarnPages') || '5';
    const lastTotalPages = state.activeProduction?.scriptPageCount || '100';
    container.innerHTML = `
      <div class="rs-controls-inner">
        <button class="rs-start-run-btn" id="rs-start-run-btn">▶ Start Run</button>
        <div class="rs-timer-preview">
          <div class="rs-timer-field"><label>Total Pages</label><span>${escapeHtml(String(lastTotalPages))}</span></div>
          <div class="rs-timer-field"><label>Duration (min)</label><span>${escapeHtml(lastDuration)}</span></div>
          <div class="rs-timer-field"><label>Warn Pages</label><span>${escapeHtml(lastWarnPages)}</span></div>
        </div>
        <div class="rs-stage-widget">${stageCols}</div>
        <div class="rs-reports-section" id="rs-reports-section"></div>
      </div>`;
    container.querySelector('#rs-start-run-btn').addEventListener('click', openPreRunModal);
    loadReportsHistory();
  } else {
    // ACTIVE RUN MODE
    const timerRunning = session.timerRunning;
    const timerHeld    = session.timerHeld;
    container.innerHTML = `
      <div class="rs-controls-inner">
        <div class="rs-session-header">
          <span class="rs-session-title">${escapeHtml(session.title)}</span>
          <span class="rs-session-elapsed">${elapsedStr}</span>
          <button class="rs-end-run-btn" id="rs-end-run-btn">■ End Run</button>
        </div>
        <div class="rs-timer-panel">
          <div class="rs-timer-progress"><div class="rs-timer-progress-bar" style="width:${pct}%"></div></div>
          <div class="rs-timer-display">
            <span>Elapsed: ${elapsedStr}</span>
            <span>Remaining: ${remainStr}</span>
            <span>Next turn: ${formatTime(nextTurnSec)}</span>
          </div>
          <div class="rs-timer-btns">
            <button class="timer-btn timer-btn--start" id="rs-timer-start" ${timerRunning && !timerHeld ? 'disabled' : ''}>${timerHeld ? 'Resume' : 'Start'}</button>
            <button class="timer-btn timer-btn--hold" id="rs-timer-hold" ${!timerRunning || timerHeld ? 'disabled' : ''}>Hold Page</button>
            <button class="timer-btn timer-btn--stop" id="rs-timer-stop" ${!timerRunning && !timerHeld ? 'disabled' : ''}>Stop</button>
          </div>
          <div class="rs-timer-page">Page: <strong>${rsScriptLabel(rsCurrentPage, rsCurrentHalf)}</strong></div>
        </div>
        <div class="rs-stage-widget">${stageCols}</div>
        <div class="rs-scratchpad-section">
          <label style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">Scratchpad</label>
          <textarea id="rs-scratchpad" class="rs-scratchpad-input" placeholder="SM notes…">${escapeHtml(session.scratchpad || '')}</textarea>
        </div>
      </div>`;

    container.querySelector('#rs-end-run-btn').addEventListener('click', openEndRunModal);
    container.querySelector('#rs-timer-start')?.addEventListener('click', () => {
      startTimer();
      renderRunShowControls();
    });
    container.querySelector('#rs-timer-hold')?.addEventListener('click', () => {
      holdTimer();
      renderRunShowControls();
    });
    container.querySelector('#rs-timer-stop')?.addEventListener('click', () => {
      stopTimer();
      renderRunShowControls();
    });
    container.querySelector('#rs-scratchpad')?.addEventListener('input', e => {
      if (state.runSession) state.runSession.scratchpad = e.target.value;
    });

    // FAB visibility
    const fab = document.getElementById('run-show-fab');
    if (fab) fab.classList.remove('hidden');
  }
}



/* ═══════════════════════════════════════════════════════════
   TIMER TICK — lightweight update (no full re-render)
   Updates only the timer values without replacing the entire
   controls panel HTML, preserving scratchpad focus and state.
   ═══════════════════════════════════════════════════════════ */
function rsTickTimerDisplay() {
  const session = state.runSession;
  if (!session) return;

  const elapsed = session.timerElapsed || 0;
  const totalSec = (session.timerDuration || 120) * 60;
  const pct = totalSec > 0 ? Math.min(100, (elapsed / totalSec) * 100) : 0;
  const elapsedStr = formatTime(elapsed);
  const remainStr = formatTime(Math.max(0, totalSec - elapsed));
  const tp = session.timerTotalPages || 100;
  const secPerPage = tp > 0 ? totalSec / tp : 0;
  const nextTurnSec = secPerPage > 0 ? Math.max(0, secPerPage - (elapsed % secPerPage)) : 0;

  // Auto-advance PDF page when timer advances (unless held)
  const timerPage = session.currentPage || 1;
  if (session.timerRunning && !session.timerHeld && timerPage !== rsLastTimerScriptPage) {
    rsLastTimerScriptPage = timerPage;
    rsNavigateToScriptPage(timerPage);
  }

  // Update progress bar
  const progressBar = document.querySelector('.rs-timer-progress-bar');
  if (progressBar) progressBar.style.width = pct + '%';

  // Update timer display text
  const timerDisplay = document.querySelector('.rs-timer-display');
  if (timerDisplay) {
    timerDisplay.innerHTML = '<span>Elapsed: ' + elapsedStr + '</span><span>Remaining: ' + remainStr + '</span><span>Next turn: ' + formatTime(nextTurnSec) + '</span>';
  }

  // Update elapsed in session header
  const elapsedEl = document.querySelector('.rs-session-elapsed');
  if (elapsedEl) elapsedEl.textContent = elapsedStr;

  // Update page display
  const pageEl = document.querySelector('.rs-timer-page');
  if (pageEl) pageEl.innerHTML = 'Page: <strong>' + rsScriptLabel(rsCurrentPage, rsCurrentHalf) + '</strong>';

  // Update button states
  const timerRunning = session.timerRunning;
  const timerHeld = session.timerHeld;
  const startBtn = document.getElementById('rs-timer-start');
  const holdBtn = document.getElementById('rs-timer-hold');
  const stopBtn = document.getElementById('rs-timer-stop');
  if (startBtn) { startBtn.disabled = timerRunning && !timerHeld; startBtn.textContent = timerHeld ? 'Resume' : 'Start'; }
  if (holdBtn) holdBtn.disabled = !timerRunning || timerHeld;
  if (stopBtn) stopBtn.disabled = !timerRunning && !timerHeld;

  // Update stage columns — always based on the actual visible page
  const stageWidget = document.querySelector('.rs-stage-widget');
  if (stageWidget) stageWidget.innerHTML = renderStageColumnsHtml(rsCurrentScriptPage());
}

function renderStageColumnsHtml(page) {
  const props = getProps();
  if (!props.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;">No props yet.</div>';
  const slProps = [], onProps = [], srProps = [];
  props.forEach(p => {
    const r = getPropStatus(p, page);
    const warnPgs = state.runSession?.timerWarnPages || 5;
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPgs && (r.upcomingEnter - page) > 0;
    const item = { prop: p, ...r, warn };
    if (r.status === 'ON') onProps.push(item);
    else if (r.location === 'SL') slProps.push(item);
    else srProps.push(item);
  });

  const renderCol = (items) => {
    if (items.length === 0) return '<div style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;">—</div>';
    return items.map(({ prop: p, activeCue: ac, warn, upcomingEnter: ue, crossover: xo }) => {
      let carrier = '';
      if (ac) {
        if (ac.carrierOn) carrier += `<div class="prop-carrier">↑ ${escapeHtml(ac.carrierOn)}</div>`;
        if (ac.carrierOff) carrier += `<div class="prop-carrier">↓ ${escapeHtml(ac.carrierOff)}</div>`;
      }
      let crossoverHtml = '';
      if (xo) {
        const moverLabel = xo.mover ? escapeHtml(xo.mover) : '<em>unassigned</em>';
        crossoverHtml = `<div class="prop-crossover-alert">⚠ Move ${escapeHtml(xo.from)}→${escapeHtml(xo.to)} · ${moverLabel}</div>`;
      }
      const wt = warn ? ` <span style="color:#d4af37;font-size:11px;">(pg ${ue})</span>` : '';
      return `<div class="stage-prop ${warn ? 'stage-prop--warn' : ''} ${xo ? 'stage-prop--crossover' : ''}"><div class="prop-name">${escapeHtml(p.name)}${wt}</div>${carrier}${crossoverHtml}</div>`;
    }).join('');
  };

  return `<div class="rs-stage-columns">
    <div class="stage-col stage-col--sl"><h4>SL</h4>${renderCol(slProps)}</div>
    <div class="stage-col stage-col--on"><h4>ON</h4>${renderCol(onProps)}</div>
    <div class="stage-col stage-col--sr"><h4>SR</h4>${renderCol(srProps)}</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   LEFT PANEL — SIDEBAR (notes + cast)
   ═══════════════════════════════════════════════════════════ */
function renderRunShowSidebar() {
  rsBuildFlatChars();
  const castList = document.getElementById('rs-cast-list');
  if (!castList) return;

  if (rsFlatChars.length === 0) {
    castList.innerHTML = `
      <div style="color:var(--ln-muted);font-size:12px;padding:8px 4px;line-height:1.5;">
        No cast yet.<br>
        <span style="color:var(--ln-gold);cursor:pointer;text-decoration:underline" id="rs-go-cast">Go to Cast &amp; Crew →</span>
      </div>`;
    document.getElementById('rs-go-cast')?.addEventListener('click', () => {
      import('../shared/tabs.js').then(m => m.switchTab('cast'));
    });
  } else {
    castList.innerHTML = rsFlatChars.map((c, i) => {
      const cnt = rsNotes.filter(n => n.castId === c.castId && (n.characterName || n.charName) === c.name).length;
      return `<div class="char-item ${i === rsActiveCharIdx ? 'char-item--active' : ''}" data-idx="${i}">
        <div class="char-dot" style="background:${escapeHtml(c.color)}"></div>
        <div style="flex:1;min-width:0">
          <div>${escapeHtml(c.name)}</div>
          ${c.actorName !== c.name ? `<div class="char-actor" style="font-size:10px;color:var(--ln-muted);font-family:'DM Mono',monospace;">${escapeHtml(c.actorName)}</div>` : ''}
        </div>
        ${cnt ? `<span class="char-count">${cnt}</span>` : ''}
      </div>`;
    }).join('');
    castList.querySelectorAll('.char-item').forEach(el => el.addEventListener('click', () => {
      rsActiveCharIdx = parseInt(el.dataset.idx); renderRunShowSidebar();
    }));
  }

  const typesEl = document.getElementById('rs-note-types');
  if (typesEl) {
    typesEl.innerHTML = NOTE_TYPES.map(t => `<button class="note-type-btn ${rsActiveNoteType === t.key ? 'note-type-btn--active' : ''}" data-type="${t.key}">${t.key}</button>`).join('');
    typesEl.querySelectorAll('.note-type-btn').forEach(btn => btn.addEventListener('click', () => { rsActiveNoteType = btn.dataset.type; renderRunShowSidebar(); }));
  }

  const notesList = document.getElementById('rs-notes-list');
  if (!notesList) return;
  const sorted = [...rsNotes].sort((a, b) => a.page !== b.page ? a.page - b.page : (a.bounds?.y || 0) - (b.bounds?.y || 0));
  notesList.innerHTML = sorted.map(n => {
    const fc = rsFlatChars.find(c => c.castId === n.castId && c.name === (n.characterName || n.charName));
    const color = fc?.color || n.charColor || '#888';
    const charLabel = n.characterName || n.charName || '?';
    return `<div class="note-item" data-noteid="${escapeHtml(n.id)}">
      <div class="note-color-bar" style="background:${escapeHtml(color)}"></div>
      <div class="note-item-content">
        <div class="note-item-header">
          <span class="note-page">p.${rsScriptLabel(n.page, n.half)}</span>
          <span class="note-char-name">${escapeHtml(charLabel)}</span>
          <span class="note-type-label">${escapeHtml(n.type)}</span>
        </div>
        ${n.lineText ? `<div class="note-text-preview">&#x201c;${escapeHtml(n.lineText.slice(0, 80))}&#x201d;</div>` : ''}
        ${n.noteBody ? `<div class="note-text-preview" style="color:#c8a96e;font-style:normal;"><strong>Note:</strong> ${escapeHtml(n.noteBody.slice(0, 100))}</div>` : ''}
      </div>
      <button class="note-delete-btn" data-noteid="${escapeHtml(n.id)}">&times;</button>
    </div>`;
  }).join('') || '<div style="color:#5c5850;font-size:12px;padding:12px;">No notes yet for this run.</div>';

  notesList.querySelectorAll('.note-item').forEach(el => el.addEventListener('click', e => {
    if (e.target.classList.contains('note-delete-btn')) return;
    const note = rsNotes.find(n => n.id === el.dataset.noteid);
    if (note) { rsCurrentPage = note.page; if (rsSplitMode && note.half) rsCurrentHalf = note.half; rsRenderPage(rsCurrentPage); }
  }));
  notesList.querySelectorAll('.note-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const note = rsNotes.find(n => n.id === btn.dataset.noteid);
    if (!note) return;
    if (note.uid !== state.currentUser.uid && !isOwner()) { toast('Can only delete your own notes', 'error'); return; }
    try { await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'lineNotes', note.id)); toast('Note deleted'); } catch(e) { toast('Failed', 'error'); }
  }));
}

/* ═══════════════════════════════════════════════════════════
   NOTES SUBSCRIPTION
   ═══════════════════════════════════════════════════════════ */
function rsSubscribeToNotes() {
  if (rsNotesUnsub) rsNotesUnsub();
  const pid = state.activeProduction.id;
  // Feature 3: filter notes by session ID (client-side to avoid index)
  const sessionId = state.runSession?.sessionId || rsLastSessionId;
  const applyFilter = (allNotes) => sessionId ? allNotes.filter(n => n.sessionId === sessionId) : allNotes;
  try {
    rsNotesUnsub = onSnapshot(
      collection(db, 'productions', pid, 'lineNotes'),
      snap => {
        rsNotes = applyFilter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        renderRunShowSidebar();
        if (rsPdfDoc) rsRedrawOverlay(rsCurrentPage);
      },
      err => {
        if (rsNotesUnsub) { rsNotesUnsub(); rsNotesUnsub = null; }
        rsNotesUnsub = onSnapshot(collection(db, 'productions', pid, 'lineNotes'), snap => {
          rsNotes = applyFilter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          renderRunShowSidebar();
          if (rsPdfDoc) rsRedrawOverlay(rsCurrentPage);
        });
      }
    );
  } catch(e) {
    rsNotesUnsub = onSnapshot(collection(db, 'productions', pid, 'lineNotes'), snap => {
      rsNotes = applyFilter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderRunShowSidebar();
      if (rsPdfDoc) rsRedrawOverlay(rsCurrentPage);
    });
  }
  state.unsubscribers.push(() => { if (rsNotesUnsub) { rsNotesUnsub(); rsNotesUnsub = null; } });
}

/* ═══════════════════════════════════════════════════════════
   FEATURE 5: SCRIPT CUES SUBSCRIPTION
   ═══════════════════════════════════════════════════════════ */
function rsSubscribeToScriptCues() {
  if (rsScriptCuesUnsub) rsScriptCuesUnsub();
  const pid = state.activeProduction.id;
  rsScriptCuesUnsub = onSnapshot(collection(db, 'productions', pid, 'scriptCues'), snap => {
    rsScriptCues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rsRenderCueBanner();
  });
  state.unsubscribers.push(() => { if (rsScriptCuesUnsub) { rsScriptCuesUnsub(); rsScriptCuesUnsub = null; } });
}

function rsRenderCueBanner() {
  const banner = document.getElementById('rs-cue-banner');
  if (!banner) return;
  const pageCues = rsScriptCues.filter(c => c.page === rsCurrentScriptPage());
  if (pageCues.length === 0) { banner.innerHTML = ''; return; }
  banner.innerHTML = pageCues.map(c => {
    const typeClass = ['LX', 'SQ', 'PX'].includes(c.type) ? c.type : 'OTHER';
    return `<span class="rs-cue-pill rs-cue-pill--${escapeHtml(typeClass)}" title="${escapeHtml(c.label || '')}">${escapeHtml(c.label || c.type)}</span>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   FEATURE 4: DIAGRAMS SUBSCRIPTION
   ═══════════════════════════════════════════════════════════ */
function rsSubscribeToDiagrams() {
  if (rsDiagramsUnsub) rsDiagramsUnsub();
  const pid = state.activeProduction.id;
  rsDiagramsUnsub = onSnapshot(collection(db, 'productions', pid, 'diagrams'), snap => {
    rsDiagrams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rsRenderDiagramPanel();
  });
  state.unsubscribers.push(() => { if (rsDiagramsUnsub) { rsDiagramsUnsub(); rsDiagramsUnsub = null; } });
}

function rsRenderDiagramPanel() {
  const panel = document.getElementById('rs-diagram-panel');
  const imagesDiv = document.getElementById('rs-diagram-images');
  const zoomControls = document.getElementById('rs-diagram-zoom-controls');
  if (!panel || !imagesDiv) return;
  const pageDiagrams = rsDiagrams.filter(d => d.page === rsCurrentScriptPage());
  if (pageDiagrams.length === 0) {
    panel.classList.add('collapsed');
    panel.classList.remove('diagram-expanded');
    const toggleBtn = document.getElementById('rs-diagram-toggle');
    if (toggleBtn) toggleBtn.textContent = '»';
    if (zoomControls) zoomControls.style.display = 'none';
    imagesDiv.innerHTML = '';
    return;
  }
  panel.classList.remove('collapsed');
  rsUpdateDiagramExpand();
  const toggleBtn = document.getElementById('rs-diagram-toggle');
  if (toggleBtn) toggleBtn.textContent = '«';
  if (zoomControls) zoomControls.style.display = 'flex';
  // Reset zoom on page change
  rsDiagramZoomLevel = 1;
  rsApplyDiagramZoom();
  imagesDiv.innerHTML = pageDiagrams.map(d => `
    <div class="rs-diagram-item">
      <img src="${escapeHtml(d.url)}" draggable="false" />
      ${d.label ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:#5c5850;margin-top:4px;">${escapeHtml(d.label)}</div>` : ''}
    </div>`).join('');
}

/** Update diagram panel expansion based on whether side panels are collapsed */
function rsUpdateDiagramExpand() {
  const panel = document.getElementById('rs-diagram-panel');
  if (!panel || panel.classList.contains('collapsed')) return;
  const sidebar = document.getElementById('rs-sidebar');
  const controls = document.getElementById('rs-controls');
  const leftCollapsed = sidebar?.classList.contains('rs-collapsed');
  const rightCollapsed = controls?.classList.contains('rs-collapsed');
  if (leftCollapsed || rightCollapsed) {
    panel.classList.add('diagram-expanded');
  } else {
    panel.classList.remove('diagram-expanded');
  }
}

/** Zoom diagrams by a delta amount */
function rsDiagramZoom(delta) {
  rsDiagramZoomLevel = Math.max(0.25, Math.min(5, rsDiagramZoomLevel + delta));
  rsApplyDiagramZoom();
}

/** Fit diagrams to the viewer width */
function rsDiagramZoomFit() {
  rsDiagramZoomLevel = 1;
  rsApplyDiagramZoom();
}

/** Apply current zoom level to diagram viewer */
function rsApplyDiagramZoom() {
  const inner = document.getElementById('rs-diagram-images');
  const label = document.getElementById('rs-diagram-zoom-level');
  if (inner) {
    inner.style.transform = `scale(${rsDiagramZoomLevel})`;
    inner.style.transformOrigin = '0 0';
  }
  if (label) label.textContent = Math.round(rsDiagramZoomLevel * 100) + '%';
}

/* ═══════════════════════════════════════════════════════════
   SCRIPT LOADING
   ═══════════════════════════════════════════════════════════ */
async function rsLoadScript() {
  const scriptPath = state.activeProduction?.scriptPath;

  // Always hide the drop zone immediately — it only shows for owners without a script
  const dz = document.getElementById('rs-drop-zone');
  if (dz) dz.style.display = 'none';

  if (!scriptPath) {
    if (isOwner()) rsShowScriptUploadPrompt();
    else {
      // Non-owner, no script yet — show a plain message in the canvas area
      const pw = document.getElementById('rs-page-wrapper');
      if (pw) pw.style.display = 'none';
      const proc = document.getElementById('rs-processing');
      if (proc) proc.style.display = 'none';
      const ca = document.getElementById('rs-canvas-area');
      if (ca) {
        const msg = ca.querySelector('.rs-no-script-msg') || document.createElement('div');
        msg.className = 'rs-no-script-msg';
        msg.style.cssText = 'color:#5c5850;text-align:center;padding:60px;font-size:14px;';
        msg.textContent = 'Script not yet uploaded by the production owner.';
        if (!ca.contains(msg)) ca.appendChild(msg);
      }
    }
    return;
  }
  rsShowProcessing('Loading script\u2026');
  try {
    const url = await getDownloadURL(ref(storage, scriptPath));
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ url });
    loadingTask.onProgress = p => {
      if (p.total > 0) {
        const fill = document.getElementById('rs-progress-fill');
        if (fill) fill.style.width = Math.round((p.loaded / p.total) * 100) + '%';
      }
    };
    rsPdfDoc = await loadingTask.promise;
    rsTotalPages = rsPdfDoc.numPages;
    const totalEl = document.getElementById('rs-total-pages');
    if (totalEl) totalEl.textContent = rsTotalPages;
    if (!state.activeProduction.scriptPageCount && isOwner()) {
      try { await updateDoc(doc(db, 'productions', state.activeProduction.id), { scriptPageCount: rsTotalPages }); } catch(e) {}
    }
    rsHideProcessing();
    const dz = document.getElementById('rs-drop-zone');
    if (dz) dz.style.display = 'none';
    const pw = document.getElementById('rs-page-wrapper');
    if (pw) pw.style.display = 'block';
    const pn = document.getElementById('rs-page-nav');
    if (pn) pn.style.display = 'flex';
    await rsRenderPage(rsCurrentPage);
  } catch(e) {
    console.error('RS script load error:', e);
    rsHideProcessing();
    toast('Failed to load script: ' + e.message, 'error');
  }
}

function rsShowScriptUploadPrompt() {
  const dz = document.getElementById('rs-drop-zone');
  if (!dz) return;
  dz.style.display = 'flex'; // re-show the upload prompt for owners without a script
  dz.querySelector('#rs-upload-btn')?.addEventListener('click', () => dz.querySelector('#rs-file-input')?.click());
  dz.querySelector('#rs-file-input')?.addEventListener('change', async function() {
    const file = this.files[0];
    if (!file || file.type !== 'application/pdf') { toast('Select a PDF.', 'error'); return; }
    const pid = state.activeProduction.id;
    const storageRef = ref(storage, 'productions/' + pid + '/script.pdf');
    rsShowProcessing('Uploading\u2026');
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      s => { const fill = document.getElementById('rs-progress-fill'); if (fill) fill.style.width = Math.round((s.bytesTransferred / s.totalBytes) * 100) + '%'; },
      () => { rsHideProcessing(); toast('Upload failed.', 'error'); },
      async () => {
        await updateDoc(doc(db, 'productions', pid), { scriptPath: 'productions/' + pid + '/script.pdf', scriptPageCount: null });
        state.activeProduction.scriptPath = 'productions/' + pid + '/script.pdf';
        rsHideProcessing();
        rsLoadScript();
      }
    );
  });
}

function rsShowProcessing(msg) {
  const el = document.getElementById('rs-processing');
  if (el) { el.style.display = 'flex'; el.querySelector('.text').textContent = msg; }
  const fill = document.getElementById('rs-progress-fill');
  if (fill) fill.style.width = '0%';
}
function rsHideProcessing() {
  const el = document.getElementById('rs-processing');
  if (el) el.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════
   RENDER PAGE
   ═══════════════════════════════════════════════════════════ */
async function rsRenderPage(num) {
  const gen = ++rsRenderGen;

  // Cancel any in-progress pdf.js render task to avoid "multiple render()" error
  if (rsCurrentRenderTask) {
    try { rsCurrentRenderTask.cancel(); } catch(e) { /* ignore */ }
    rsCurrentRenderTask = null;
  }

  rsClosePopover();
  rsNotesHoveredZoneIdx = null;
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (hitOverlay) hitOverlay.innerHTML = '';

  if (!rsPdfDoc) return;
  const page = await rsPdfDoc.getPage(num);
  if (gen !== rsRenderGen) return;

  const viewport = page.getViewport({ scale: rsPdfScale });
  const canvas = document.getElementById('rs-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (rsSplitMode) {
    const halfW = Math.floor(viewport.width / 2);
    canvas.width = halfW; canvas.height = viewport.height;
    const offsetX = rsCurrentHalf === 'L' ? 0 : halfW;
    ctx.save(); ctx.translate(-offsetX, 0);
    rsCurrentRenderTask = page.render({ canvasContext: ctx, viewport });
    try { await rsCurrentRenderTask.promise; } catch(e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    ctx.restore();
  } else {
    canvas.width = viewport.width; canvas.height = viewport.height;
    rsCurrentRenderTask = page.render({ canvasContext: ctx, viewport });
    try { await rsCurrentRenderTask.promise; } catch(e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
  }
  rsCurrentRenderTask = null;
  if (gen !== rsRenderGen) return;

  const pageInput = document.getElementById('rs-page-input');
  if (pageInput) pageInput.value = rsScriptLabel(num, rsCurrentHalf);

  // Update the offset badge in Run Show header
  const rsBadge = document.getElementById('rs-script-offset-badge');
  if (rsBadge) {
    const startPage = state.activeProduction?.scriptPageStartPage || 1;
    const startHalf = state.activeProduction?.scriptPageStartHalf || '';
    const isDefault = startPage === 1 && startHalf === '';
    if (isDefault) {
      rsBadge.style.display = 'none';
    } else {
      rsBadge.textContent = `PDF p.${startPage}${startHalf} = p.1`;
      rsBadge.style.display = '';
    }
  }

  const zKey = rsPk();
  if (!rsLineZones[zKey]) {
    await loadOrExtractZonesLocal(page, num, viewport, zKey);
  }
  if (gen !== rsRenderGen) return;

  if (hitOverlay) hitOverlay.innerHTML = '';
  rsRenderLineZones(zKey);
  rsRenderNoteMarkers(num, rsCurrentHalf);
  rsRenderCueBanner();      // Feature 5
  rsRenderDiagramPanel();   // Feature 4
}

async function loadOrExtractZonesLocal(page, num, viewport, zKey) {
  // 1. Try Firestore first (fastest path — zones already curated by owner)
  const pid = state.activeProduction.id;
  try {
    const zoneDoc = await getDoc(doc(db, 'productions', pid, 'zones', zKey));
    if (zoneDoc.exists() && zoneDoc.data().zones?.length > 0) {
      rsLineZones[zKey] = zoneDoc.data().zones;
      return;
    }
  } catch(e) { /* fall through to text extraction */ }

  // 2. Extract from PDF text layer directly (no cross-module calls — avoids canvas/processing conflicts)
  try {
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(i => i.str && i.str.trim().length > 0);
    if (items.length > 2) {
      rsLineZones[zKey] = rsGroupIntoLines(items, viewport, zKey);
    } else {
      rsLineZones[zKey] = rsGenerateFallbackZones(viewport.height);
    }
  } catch(e) {
    rsLineZones[zKey] = rsGenerateFallbackZones(viewport.height);
  }
}

function rsGenerateFallbackZones(canvasHeight) {
  const lineHeightPx = 40 * (rsPdfScale / 1.4);
  const count = canvasHeight ? Math.max(10, Math.floor(canvasHeight / lineHeightPx)) : 30;
  const spacing = 90 / count;
  const h = Math.max(1.5, spacing * 0.85);
  const zones = [];
  for (let i = 0; i < count; i++) zones.push({ x: 5, y: 5 + i * spacing, w: 85, h, text: '' });
  return zones;
}

function rsGroupIntoLines(items, viewport, zKey) {
  const fullW = viewport.width;
  const halfW = fullW / 2;
  const scale = rsPdfScale;

  const mapped = items.map(item => {
    const tx = item.transform;
    const x = tx[4] * scale;
    const y = viewport.height - tx[5] * scale;
    const w = Math.abs(tx[0]) * scale * (item.width / Math.abs(tx[0]) || 1);
    const h = Math.abs(tx[3]) * scale;
    return { x, y, w, h, str: item.str, fontName: item.fontName || '' };
  });

  let filteredMapped = mapped;
  let canvasW = fullW;
  if (rsSplitMode && zKey) {
    const half = zKey.slice(-1);
    if (half === 'L') {
      filteredMapped = mapped.filter(i => i.x < halfW);
    } else {
      filteredMapped = mapped.filter(i => i.x >= halfW).map(i => ({ ...i, x: i.x - halfW }));
    }
    canvasW = halfW;
  }

  const cw = canvasW, ch = viewport.height;
  const thresh = 8 * scale;
  filteredMapped.sort((a, b) => a.y - b.y);

  const groups = [];
  for (const item of filteredMapped) {
    let placed = false;
    for (const g of groups) {
      if (Math.abs(item.y - g.cy) < thresh) {
        g.items.push(item);
        g.minX = Math.min(g.minX, item.x);
        g.maxX = Math.max(g.maxX, item.x + item.w);
        g.minY = Math.min(g.minY, item.y - item.h * 0.1);
        g.maxY = Math.max(g.maxY, item.y + item.h);
        g.cy = (g.minY + g.maxY) / 2;
        placed = true; break;
      }
    }
    if (!placed) {
      groups.push({ items: [item], minX: item.x, maxX: item.x + item.w,
        minY: item.y - item.h * 0.1, maxY: item.y + item.h, cy: item.y });
    }
  }

  const textLines = groups.filter(g => g.maxX - g.minX > 4).map(g => {
    const allFonts = g.items.map(i => i.fontName || '').join(' ');
    const isItalic = /italic|oblique|[\-,_]it[,\-,_,A-Z]/i.test(allFonts);
    const textStr = g.items.map(i => i.str).join(' ');
    const letters = textStr.replace(/[^a-zA-Z]/g, '');
    const isAllCaps = letters.length > 2 && letters === letters.toUpperCase();
    return {
      x: Math.max(0, (g.minX / cw) * 100),
      y: Math.max(0, (g.minY / ch) * 100),
      w: Math.min(100, ((g.maxX - g.minX) / cw) * 100),
      h: Math.max(1.2, Math.min(10, ((g.maxY - g.minY) / ch) * 100)),
      text: textStr, isItalic, isAllCaps,
      avgH: g.items.reduce((s, i) => s + i.h, 0) / g.items.length,
      centerX: ((g.minX + g.maxX) / 2 / cw) * 100,
      leftX: (g.minX / cw) * 100
    };
  });

  // Detect character name lines
  const heights = textLines.map(l => l.avgH || 0).filter(h => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 0;
  const candidates = [];
  textLines.forEach((line, idx) => {
    const text = (line.text || '').trim();
    if (!text || text.length < 1 || text.length > 50) return;
    if (text.startsWith('(') && text.endsWith(')')) return;
    if (line.isItalic) return;
    if (/[a-z]/.test(text) && text.split(/\s+/).length > 4) return;
    const stripped = text.replace(/[&'\-.!?,\s\d]/g, '');
    if (stripped.length === 0 || !/^[A-Z]+$/.test(stripped)) return;
    if (line.w > 62) return;
    if (medianH > 0 && (line.avgH || medianH) < medianH * 0.65) return;
    candidates.push({ idx, line });
  });

  const nameIdxs = new Set();
  if (candidates.length > 0) {
    const modalBucket = (values, size) => {
      const counts = {};
      values.forEach(v => { const b = Math.round(v / size) * size; counts[b] = (counts[b] || 0) + 1; });
      return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    };
    const modalLeft   = modalBucket(candidates.map(c => c.line.leftX ?? 0), 4);
    const modalCenter = modalBucket(candidates.map(c => c.line.centerX ?? 50), 4);
    candidates.forEach(({ idx, line }) => {
      const ld = Math.abs((line.leftX ?? 0) - modalLeft);
      const cd = Math.abs((line.centerX ?? 50) - modalCenter);
      if (ld <= 8 || cd <= 8) nameIdxs.add(idx);
    });
    if (nameIdxs.size > textLines.length * 0.4) {
      nameIdxs.clear();
      candidates.forEach(({ idx, line }) => {
        const ld = Math.abs((line.leftX ?? 0) - modalLeft);
        const cd = Math.abs((line.centerX ?? 50) - modalCenter);
        if (ld <= 4 || cd <= 4) nameIdxs.add(idx);
      });
    }
  }

  // Merge into character / dialogue / stage-direction blocks
  const result = [];
  let currentBlock = null;
  const flush = () => { if (currentBlock) { result.push(currentBlock); currentBlock = null; } };
  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    if (nameIdxs.has(i))  { flush(); result.push({ ...line, isCharName: true }); continue; }
    if (line.isItalic)    { flush(); result.push({ ...line, isStageDirection: true }); continue; }
    if (line.isAllCaps)   { flush(); result.push({ ...line }); continue; }
    if (!currentBlock) {
      currentBlock = { x: line.x, y: line.y, w: line.w, h: line.h, text: line.text || '' };
    } else {
      const r = Math.max(currentBlock.x + currentBlock.w, line.x + line.w);
      const b = Math.max(currentBlock.y + currentBlock.h, line.y + line.h);
      currentBlock.x = Math.min(currentBlock.x, line.x);
      currentBlock.y = Math.min(currentBlock.y, line.y);
      currentBlock.w = r - currentBlock.x;
      currentBlock.h = b - currentBlock.y;
      if (line.text?.trim()) currentBlock.text = currentBlock.text
        ? currentBlock.text + ' ' + line.text.trim() : line.text.trim();
    }
  }
  flush();
  return result;
}

/* ═══════════════════════════════════════════════════════════
   RENDER ZONES + NOTE MARKERS
   ═══════════════════════════════════════════════════════════ */
function rsRenderLineZones(zKey) {
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (!hitOverlay) return;
  const zones = rsLineZones[zKey] || [];
  const existingZoneIdxs = new Set(
    rsNotes.filter(n => n.page === rsCurrentPage && n.half === (rsSplitMode ? rsCurrentHalf : ''))
      .map(n => n.zoneIdx).filter(i => i !== undefined && i !== null)
  );

  zones.forEach((zone, idx) => {
    if (zone.isCharName) return;
    if (zone.isStageDirection) {
      const sd = document.createElement('div');
      sd.style.cssText = `position:absolute;left:${zone.x}%;top:${zone.y}%;width:${zone.w}%;height:${Math.max(zone.h,1.5)}%;border-left:2px solid rgba(154,148,136,0.3);pointer-events:none;`;
      hitOverlay.appendChild(sd);
      return;
    }
    const div = document.createElement('div');
    div.className = 'line-zone' + (existingZoneIdxs.has(idx) ? ' has-note' : '');
    div.style.left = Math.max(0, zone.x - 0.5) + '%'; div.style.top = zone.y + '%';
    div.style.width = Math.min(100, zone.w + 1) + '%'; div.style.height = Math.max(zone.h + 0.6, 2.2) + '%';
    div.dataset.zone = idx;
    div.title = zone.text ? zone.text.substring(0, 80) : '';
    div.addEventListener('click', e => {
      e.stopPropagation();
      const existing = rsNotes.find(n => n.page === rsCurrentPage && (rsSplitMode ? n.half === rsCurrentHalf : true) && n.zoneIdx === idx);
      if (existing) rsOpenEditPopover(e, existing);
      else rsOpenPopover(e, rsCurrentPage, rsCurrentHalf, idx, zone);
    });
    const label = document.createElement('span');
    label.className = 'zone-label';
    label.textContent = zone.text ? zone.text.substring(0, 40) : `zone ${idx}`;
    div.appendChild(label);
    hitOverlay.appendChild(div);
  });
}

function rsRenderNoteMarkers(num, half) {
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (!hitOverlay) return;
  rsNotes.filter(n => n.page === num && (rsSplitMode ? n.half === half : true)).forEach(note => {
    const fc = rsFlatChars.find(c => c.castId === note.castId && c.name === (note.characterName || note.charName));
    const color = fc?.color || note.charColor || '#c8a96e';
    if (!note.bounds) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${note.bounds.x}%;top:${note.bounds.y}%;width:${note.bounds.w}%;height:${note.bounds.h}%;z-index:5;pointer-events:all;cursor:pointer;`;
    const underline = document.createElement('div');
    underline.style.cssText = `position:absolute;bottom:0;left:0;right:0;height:2.5px;border-radius:1px;opacity:0.75;background:${color};`;
    wrap.appendChild(underline);
    const tag = document.createElement('div');
    tag.className = 'note-tag';
    tag.style.background = color;
    tag.textContent = note.type;
    wrap.appendChild(tag);
    wrap.addEventListener('click', e => { e.stopPropagation(); rsOpenEditPopover(e, note); });
    hitOverlay.appendChild(wrap);
  });
}

function rsRedrawOverlay(num) {
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (!hitOverlay) return;
  hitOverlay.innerHTML = '';
  rsRenderLineZones(rsPk());
  rsRenderNoteMarkers(num, rsCurrentHalf);
}

/* ═══════════════════════════════════════════════════════════
   POPOVER (zone-click entry)
   ═══════════════════════════════════════════════════════════ */
function rsOpenPopover(e, pageNum, half, zoneIdx, zone) {
  e.stopPropagation();
  if (rsFlatChars.length === 0) { toast('Add cast members first — go to Cast & Crew tab'); return; }
  // Feature 1: For NEW notes, route through FAB quick-note popover instead
  rsPendingNote = {
    page: pageNum, half: rsSplitMode ? half : '', zoneIdx,
    bounds: { x: zone.x, y: zone.y, w: zone.w, h: Math.max(zone.h, 1.5) },
    lineText: zone.text || ''
  };
  openFabPopover();
  // Show the zone's script text as a read-only preview
  const linePreview = document.getElementById('rnp-line-preview');
  if (linePreview) {
    const lineText = (zone.text || '').trim();
    if (lineText) {
      linePreview.textContent = '\u201c' + lineText.slice(0, 150) + '\u201d';
      linePreview.style.display = 'block';
    } else {
      linePreview.style.display = 'none';
    }
  }
  // Clear the note input (SM types fresh note here)
  const textInput = document.getElementById('rnp-text');
  if (textInput) textInput.value = '';
  const pageLabel = document.getElementById('rnp-page-label');
  if (pageLabel) pageLabel.textContent = 'Page ' + rsScriptLabel(pageNum, half);
}

function rsOpenEditPopover(e, note) {
  e.stopPropagation();
  rsPendingNote = { editId: note.id, page: note.page, half: note.half || '', bounds: note.bounds, lineText: note.lineText || '' };
  const fc = rsFlatChars.find(c => c.castId === note.castId && c.name === (note.characterName || note.charName));
  rsBuildPopover(fc?.id || note.charId || null, note.type, note.lineText);
  // Feature 2: Pre-fill the note body textarea
  const noteTextEl = document.getElementById('rs-pop-note-text');
  if (noteTextEl) noteTextEl.value = note.noteBody || '';
  rsPositionPopover(e.clientX, e.clientY);
  rsShowPopover();
}

function rsBuildPopover(selCharId, selType, lineText) {
  const popoverEl = document.getElementById('rs-note-popover');
  if (!popoverEl) return;
  const charsDiv = document.getElementById('rs-pop-chars');
  const typesDiv = document.getElementById('rs-pop-types');
  const lineEl   = document.getElementById('rs-pop-line-text');
  const castLabel = document.getElementById('rs-pop-cast-label');
  if (charsDiv) charsDiv.innerHTML = '';
  if (typesDiv) typesDiv.innerHTML = '';

  if (lineText && lineText.trim().length > 1) {
    if (lineEl) { lineEl.textContent = '\u201c' + lineText.trim() + '\u201d'; lineEl.style.display = ''; }
  } else {
    if (lineEl) lineEl.style.display = 'none';
  }
  if (castLabel) castLabel.textContent = rsFlatChars.length === 1 ? rsFlatChars[0].name : 'Cast';

  const defChar = selCharId || (rsFlatChars[rsActiveCharIdx]?.id) || rsFlatChars[0]?.id;
  rsFlatChars.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'popover-char' + (c.id === defChar ? ' popover-char--active' : '');
    div.dataset.id = c.id;
    div.innerHTML = `<div class="pop-char-dot" style="background:${c.color};width:9px;height:9px;border-radius:50%;flex-shrink:0;"></div>
      <div style="flex:1">
        <div class="char-label">${escapeHtml(c.name)}</div>
        ${c.actorName !== c.name ? `<div style="font-size:10px;color:#5c5850;font-family:'DM Mono',monospace">${escapeHtml(c.actorName)}</div>` : ''}
      </div>
      <span class="shortcut-key">${i + 1}</span>`;
    div.addEventListener('click', () => {
      charsDiv?.querySelectorAll('.popover-char').forEach(el => el.classList.remove('popover-char--active'));
      div.classList.add('popover-char--active');
      rsActiveCharIdx = i;
    });
    charsDiv?.appendChild(div);
  });
  if (defChar) { const ci = rsFlatChars.findIndex(c => c.id === defChar); if (ci >= 0) rsActiveCharIdx = ci; }

  const defType = selType || rsActiveNoteType;
  const TYPE_KEYS = { skp: 'S', para: 'P', line: 'L', add: 'A', gen: 'G' };
  Object.entries(NOTE_TYPES_MAP).forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'popover-type' + (key === defType ? ' popover-type--active' : '');
    btn.dataset.type = key;
    btn.title = label;
    btn.innerHTML = `<span>${key}</span><span class="type-key">${TYPE_KEYS[key] || key[0].toUpperCase()}</span>`;
    btn.addEventListener('click', () => {
      typesDiv?.querySelectorAll('.popover-type').forEach(el => el.classList.remove('popover-type--active'));
      btn.classList.add('popover-type--active');
      rsActiveNoteType = key;
    });
    typesDiv?.appendChild(btn);
  });
  if (defType) rsActiveNoteType = defType;

  const confirmBtn = document.getElementById('rs-pop-confirm-btn');
  if (confirmBtn) confirmBtn.textContent = rsPendingNote?.editId ? 'Update \u21b5' : 'Add Note \u21b5';
}

function rsPositionPopover(mx, my) {
  const popoverEl = document.getElementById('rs-note-popover');
  if (!popoverEl) return;
  popoverEl.style.visibility = 'hidden';
  popoverEl.style.display = 'flex';
  popoverEl.style.flexDirection = 'column';
  const pw = popoverEl.offsetWidth || 260, ph = popoverEl.offsetHeight || 200;
  popoverEl.style.display = 'none';
  popoverEl.style.visibility = '';
  let left = mx + 14, top = my - 24;
  if (left + pw > window.innerWidth - 16) left = mx - pw - 14;
  if (top + ph > window.innerHeight - 16) top = window.innerHeight - ph - 16;
  popoverEl.style.left = left + 'px'; popoverEl.style.top = Math.max(8, top) + 'px';
}

function rsShowPopover() {
  const popoverEl = document.getElementById('rs-note-popover');
  if (!popoverEl) return;
  popoverEl.style.display = 'flex';
  popoverEl.style.flexDirection = 'column';
  rsPopoverOpen = true;
  _rsPopCloseGuard = true;
  requestAnimationFrame(() => { _rsPopCloseGuard = false; });
}

function rsClosePopover() {
  const popoverEl = document.getElementById('rs-note-popover');
  if (popoverEl) popoverEl.style.display = 'none';
  // Feature 2: Clear the note text textarea
  const noteTextEl = document.getElementById('rs-pop-note-text');
  if (noteTextEl) noteTextEl.value = '';
  rsPendingNote = null;
  rsPopoverOpen = false;
}

async function rsConfirmNote() {
  if (!rsPendingNote || rsActiveCharIdx < 0 || !rsFlatChars[rsActiveCharIdx]) return;
  const fc = rsFlatChars[rsActiveCharIdx];
  const pid = state.activeProduction.id;
  // Feature 2: Read the optional note text from the zone popover textarea
  const noteTextEl = document.getElementById('rs-pop-note-text');
  const noteBody = noteTextEl ? noteTextEl.value.trim() : '';
  const noteData = {
    uid: state.currentUser.uid,
    castId: fc.castId,
    characterName: fc.name,
    charColor: fc.color,
    type: rsActiveNoteType,
    page: rsPendingNote.page,
    half: rsPendingNote.half || '',
    zoneIdx: rsPendingNote.zoneIdx ?? null,
    bounds: rsPendingNote.bounds,
    lineText: rsPendingNote.lineText || '',
    noteBody: noteBody, // Feature 2: SM's typed remark
    productionId: pid,
    sessionId: state.runSession?.sessionId || null,
  };
  try {
    if (rsPendingNote.editId) {
      await updateDoc(doc(db, 'productions', pid, 'lineNotes', rsPendingNote.editId), { ...noteData, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, 'productions', pid, 'lineNotes'), { ...noteData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    toast('Note ' + (rsPendingNote.editId ? 'updated' : 'added'));
  } catch(e) { toast('Failed to save note', 'error'); }
  rsClosePopover();
}

/* ═══════════════════════════════════════════════════════════
   RUBBER BAND DRAW
   ═══════════════════════════════════════════════════════════ */
function rsDrawDown(e) {
  if (e.button !== 0 || rsFlatChars.length === 0) return;
  const wrapper = document.getElementById('rs-page-wrapper');
  if (!wrapper) return;
  const wRect = wrapper.getBoundingClientRect();
  const clickX = e.clientX - wRect.left, clickY = e.clientY - wRect.top;
  const pw = wrapper.offsetWidth, ph = wrapper.offsetHeight;
  const xPct = (clickX / pw) * 100, yPct = (clickY / ph) * 100;
  const zKey = rsPk();
  const zones = rsLineZones[zKey] || [];
  if (zones.some(z => !z.isCharName && xPct >= z.x && xPct <= z.x + z.w && yPct >= z.y && yPct <= z.y + Math.max(z.h, 1.5))) return;
  if (rsNotes.some(n => { const b = n.bounds; return b && n.page === rsCurrentPage && xPct >= b.x && xPct <= b.x + b.w && yPct >= b.y && yPct <= b.y + b.h; })) return;
  rsDrawStart = { x: clickX, y: clickY };
  rsDrawing = true;
  const rb = document.getElementById('rs-rubber-band');
  if (rb) { rb.style.display = 'block'; rb.style.left = rsDrawStart.x + 'px'; rb.style.top = rsDrawStart.y + 'px'; rb.style.width = '0'; rb.style.height = '0'; }
}

function rsGlobalMouseMove(e) {
  if (rsDrawing && rsDrawStart) {
    const wrapper = document.getElementById('rs-page-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const x = Math.min(cx, rsDrawStart.x), y = Math.min(cy, rsDrawStart.y);
    const w = Math.abs(cx - rsDrawStart.x), h = Math.abs(cy - rsDrawStart.y);
    const rb = document.getElementById('rs-rubber-band');
    if (rb) { rb.style.left = x + 'px'; rb.style.top = y + 'px'; rb.style.width = w + 'px'; rb.style.height = h + 'px'; }
  }
}

function rsGlobalMouseUp(e) {
  if (!rsDrawing || !rsDrawStart) return;
  rsDrawing = false;
  const rb = document.getElementById('rs-rubber-band');
  if (rb) rb.style.display = 'none';
  const wrapper = document.getElementById('rs-page-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const x = Math.min(cx, rsDrawStart.x), y = Math.min(cy, rsDrawStart.y);
  const w = Math.abs(cx - rsDrawStart.x), h = Math.abs(cy - rsDrawStart.y);
  if (w < 10 || h < 5) { rsDrawStart = null; return; }
  const pw = wrapper.offsetWidth, ph = wrapper.offsetHeight;
  const bounds = { x: (x / pw) * 100, y: (y / ph) * 100, w: (w / pw) * 100, h: (h / ph) * 100 };
  rsPendingNote = { page: rsCurrentPage, half: rsSplitMode ? rsCurrentHalf : '', bounds, lineText: '' };
  openFabPopover();
  const _pageLabel = document.getElementById('rnp-page-label');
  if (_pageLabel) _pageLabel.textContent = 'Page ' + rsScriptLabel(rsCurrentPage, rsCurrentHalf);
  const _linePreview = document.getElementById('rnp-line-preview');
  if (_linePreview) _linePreview.style.display = 'none';
  const _textInput = document.getElementById('rnp-text');
  if (_textInput) _textInput.value = '';
  rsDrawStart = null;
}

/* ═══════════════════════════════════════════════════════════
   PAGE NAVIGATION
   ═══════════════════════════════════════════════════════════ */
async function rsChangePage(delta) {
  if (!rsPdfDoc) return;
  if (rsSplitMode) {
    if (delta > 0) {
      if (rsCurrentHalf === 'L') { rsCurrentHalf = 'R'; } else { if (rsCurrentPage >= rsTotalPages) return; rsCurrentPage++; rsCurrentHalf = 'L'; }
    } else {
      if (rsCurrentHalf === 'R') { rsCurrentHalf = 'L'; } else { if (rsCurrentPage <= 1) return; rsCurrentPage--; rsCurrentHalf = 'R'; }
    }
  } else {
    const next = rsCurrentPage + delta;
    if (next < 1 || next > rsTotalPages) return;
    rsCurrentPage = next;
  }
  const pageInput = document.getElementById('rs-page-input');
  if (pageInput) pageInput.value = rsScriptLabel(rsCurrentPage, rsCurrentHalf);
  await rsRenderPage(rsCurrentPage);
}

function rsToggleSplitMode() {
  rsSplitMode = !rsSplitMode;
  rsCurrentHalf = 'L';
  rsLineZones = {};
  const btn = document.getElementById('rs-split-btn');
  if (btn) btn.classList.toggle('ln-header-btn--active', rsSplitMode);
  toast(rsSplitMode ? '2-up split ON' : '2-up split OFF');
  if (rsPdfDoc) rsRenderPage(rsCurrentPage);
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════ */
function rsHandleKeydown(e) {
  if (!document.getElementById('tab-runshow')?.classList.contains('tab-panel--active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (rsPopoverOpen) {
    if (e.key === 'Enter') { rsConfirmNote(); return; }
    if (e.key === 'Escape') { rsClosePopover(); return; }
    const num = parseInt(e.key);
    if (num >= 1 && num <= rsFlatChars.length) {
      document.getElementById('rs-pop-chars')?.querySelectorAll('.popover-char').forEach((el, i) => el.classList.toggle('popover-char--active', i === num - 1));
      rsActiveCharIdx = num - 1; return;
    }
    const typeKeys = { 's': 'skp', 'p': 'para', 'l': 'line', 'a': 'add', 'g': 'gen' };
    if (typeKeys[e.key.toLowerCase()]) {
      rsActiveNoteType = typeKeys[e.key.toLowerCase()];
      document.getElementById('rs-pop-types')?.querySelectorAll('.popover-type').forEach(el => el.classList.toggle('popover-type--active', el.dataset.type === rsActiveNoteType));
      return;
    }
  }

  if (e.key === 'ArrowRight' || e.key === ']') rsChangePage(1);
  if (e.key === 'ArrowLeft' || e.key === '[') rsChangePage(-1);
  if (e.key === 'Escape') { rsClosePopover(); rsNotesHoveredZoneIdx = null; }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const nav = rsGetNavigableZoneIndices();
    if (!nav.length) return;
    const curPos = rsNotesHoveredZoneIdx !== null ? nav.indexOf(rsNotesHoveredZoneIdx) : -1;
    let nextPos;
    if (curPos === -1) nextPos = dir === 1 ? 0 : nav.length - 1;
    else nextPos = Math.max(0, Math.min(nav.length - 1, curPos + dir));
    rsSetHoveredZone(nav[nextPos]);
    return;
  }

  if (e.key === 'Enter') { rsActivateFocusedZone(); return; }
}

function rsGetNavigableZoneIndices() {
  const zones = rsLineZones[rsPk()] || [];
  const result = [];
  zones.forEach((z, i) => { if (!z.isCharName && !z.isStageDirection) result.push(i); });
  return result;
}

function rsSetHoveredZone(rawIdx) {
  const hitOverlay = document.getElementById('rs-hit-overlay');
  if (!hitOverlay) return;
  hitOverlay.querySelectorAll('.line-zone').forEach(el => el.classList.remove('ln-zone-focused'));
  rsNotesHoveredZoneIdx = rawIdx;
  if (rawIdx === null) return;
  const el = hitOverlay.querySelector(`.line-zone[data-zone="${rawIdx}"]`);
  if (el) { el.classList.add('ln-zone-focused'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function rsActivateFocusedZone() {
  if (rsNotesHoveredZoneIdx === null) return;
  const zones = rsLineZones[rsPk()] || [];
  const zone = zones[rsNotesHoveredZoneIdx];
  if (!zone) return;
  const el = document.getElementById('rs-hit-overlay')?.querySelector(`.line-zone[data-zone="${rsNotesHoveredZoneIdx}"]`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const syntheticE = { clientX: cx, clientY: cy, stopPropagation: () => {} };
  const existing = rsNotes.find(n => n.page === rsCurrentPage && (rsSplitMode ? n.half === rsCurrentHalf : true) && n.zoneIdx === rsNotesHoveredZoneIdx);
  if (existing) rsOpenEditPopover(syntheticE, existing);
  else rsOpenPopover(syntheticE, rsCurrentPage, rsCurrentHalf, rsNotesHoveredZoneIdx, zone);
}

/* ═══════════════════════════════════════════════════════════
   QUICK-ENTRY FAB POPOVER
   ═══════════════════════════════════════════════════════════ */
let fabSelectedCharIdx = 0;
let fabSelectedType = 'skp';

function openFabPopover() {
  // Feature 1: Allow opening even without active run session if from zone
  if (!state.runSession && !rsPendingNote) return;
  fabSelectedCharIdx = rsActiveCharIdx;
  fabSelectedType = rsActiveNoteType;

  const pop = document.getElementById('run-note-popover');
  if (!pop) return;

  const pageLabel = document.getElementById('rnp-page-label');
  if (pageLabel) {
    if (rsPendingNote && rsPendingNote.page) {
      pageLabel.textContent = 'Page ' + rsScriptLabel(rsPendingNote.page, rsPendingNote.half);
    } else {
      pageLabel.textContent = 'Page ' + rsScriptLabel(rsCurrentPage, rsCurrentHalf);
    }
  }

  const charsEl = document.getElementById('rnp-chars');
  if (charsEl) {
    charsEl.innerHTML = rsFlatChars.map((c, i) => `
      <div class="popover-char ${i === fabSelectedCharIdx ? 'popover-char--active' : ''}" data-idx="${i}" style="cursor:pointer;">
        <div class="pop-char-dot" style="background:${c.color};width:9px;height:9px;border-radius:50%;flex-shrink:0;"></div>
        <div style="flex:1"><div class="char-label">${escapeHtml(c.name)}</div></div>
        <span class="shortcut-key">${i + 1}</span>
      </div>`).join('');
    charsEl.querySelectorAll('.popover-char').forEach((el, i) => el.addEventListener('click', () => {
      fabSelectedCharIdx = i;
      charsEl.querySelectorAll('.popover-char').forEach((e2, j) => e2.classList.toggle('popover-char--active', j === i));
    }));
  }

  const typesEl = document.getElementById('rnp-types');
  if (typesEl) {
    const TYPE_KEYS = { skp: 'S', para: 'P', line: 'L', add: 'A', gen: 'G' };
    typesEl.innerHTML = Object.entries(NOTE_TYPES_MAP).map(([key]) => `
      <button class="popover-type ${key === fabSelectedType ? 'popover-type--active' : ''}" data-type="${key}">
        <span>${key}</span><span class="type-key">${TYPE_KEYS[key]}</span>
      </button>`).join('');
    typesEl.querySelectorAll('.popover-type').forEach(btn => btn.addEventListener('click', () => {
      fabSelectedType = btn.dataset.type;
      typesEl.querySelectorAll('.popover-type').forEach(b => b.classList.toggle('popover-type--active', b.dataset.type === fabSelectedType));
    }));
  }

  const linePreview = document.getElementById('rnp-line-preview');
  if (!rsPendingNote) {
    // Opened from FAB button (no zone context) — clear both fields
    const textInput = document.getElementById('rnp-text');
    if (textInput) textInput.value = '';
    if (linePreview) linePreview.style.display = 'none';
  }
  // If rsPendingNote exists, rsOpenPopover already set line preview and cleared note input

  pop.style.display = 'flex';
  pop.style.flexDirection = 'column';
  setTimeout(() => textInput?.focus(), 50);
}

function closeFabPopover() {
  const pop = document.getElementById('run-note-popover');
  if (pop) pop.style.display = 'none';
  const linePreview = document.getElementById('rnp-line-preview');
  if (linePreview) linePreview.style.display = 'none';
  rsPendingNote = null;
}

async function confirmFabNote() {
  if (!state.runSession && !rsPendingNote) { closeFabPopover(); return; }
  const fc = rsFlatChars[fabSelectedCharIdx];
  if (!fc) { toast('Select a cast member', 'error'); return; }
  const textInput = document.getElementById('rnp-text');
  const freeText = textInput ? textInput.value.trim() : '';
  const pid = state.activeProduction.id;
  // Feature 1+2: If from zone tap, use rsPendingNote context; save noteBody separately
  const fromZone = rsPendingNote && rsPendingNote.zoneIdx !== undefined && rsPendingNote.zoneIdx !== null;
  await addDoc(collection(db, 'productions', pid, 'lineNotes'), {
    uid: state.currentUser.uid,
    castId: fc.castId,
    characterName: fc.name,
    charColor: fc.color,
    type: fabSelectedType,
    page: fromZone ? rsPendingNote.page : rsCurrentPage,
    half: fromZone ? (rsPendingNote.half || '') : '',
    zoneIdx: fromZone ? rsPendingNote.zoneIdx : null,
    bounds: fromZone ? rsPendingNote.bounds : null,
    lineText: fromZone ? (rsPendingNote.lineText || '') : '', // Feature 2: zone text
    noteBody: freeText,  // Feature 2: SM's typed note
    productionId: pid,
    sessionId: state.runSession?.sessionId || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  rsActiveCharIdx = fabSelectedCharIdx;
  rsActiveNoteType = fabSelectedType;
  toast('Note added');
  if (fromZone) rsPendingNote = null; // Feature 1
  closeFabPopover();
}



/* ═══════════════════════════════════════════════════════════
   FEATURE 7: PER-ACTOR EMAIL NOTES
   ═══════════════════════════════════════════════════════════ */
function rsOpenEmailNotes() {
  if (rsNotes.length === 0) { toast('No notes to email'); return; }
  const emailModal = document.getElementById('rs-email-notes-modal');
  if (!emailModal) return;
  emailModal.classList.add('open');
  const cast = getCastMembers();
  const byCastId = {};
  rsNotes.forEach(n => {
    const castId = n.castId || n.charId;
    if (!byCastId[castId]) {
      const member = cast.find(m => m.id === castId);
      byCastId[castId] = { actorName: member?.name || n.characterName || n.charName || '?', actorEmail: member?.email || '', color: member?.color || n.charColor || '#888', notes: [] };
    }
    byCastId[castId].notes.push(n);
  });
  const show = state.activeProduction?.title || '';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const subject = 'Line Notes — ' + show + ' — ' + dateStr;
  const totalNotes = rsNotes.length;
  const actorCount = Object.keys(byCastId).length;
  const NOTE_TYPE_LABELS = { skp: 'SKIP', para: 'PARAPHRASE', line: 'LINE', add: 'ADDITION', gen: 'GENERAL' };
  const actorRows = Object.entries(byCastId).filter(([, d]) => d.notes.length > 0).map(([cid, data]) => {
    const sorted = [...data.notes].sort((a, b) => a.page !== b.page ? a.page - b.page : (a.bounds?.y || 0) - (b.bounds?.y || 0));
    const noteCount = sorted.length;
    const hasEmail = !!data.actorEmail;
    let body = 'Hi ' + data.actorName + ',\n\nHere are your line notes from ' + show + ' on ' + dateStr + ':\n';
    sorted.forEach(n => {
      const typeLabel = NOTE_TYPE_LABELS[n.type] || n.type.toUpperCase();
      const lineText = (n.lineText || '').slice(0, 150) + ((n.lineText || '').length > 150 ? '...' : '');
      body += '\n---------\np.' + rsScriptLabel(n.page, n.half) + ' [' + typeLabel + ']';
      if (lineText) body += '\nScript line: "' + lineText + '"';
      if (n.noteBody && n.noteBody.trim()) body += '\nNote: ' + n.noteBody.trim();
    });
    body += '\n---------\n\n' + noteCount + ' note' + (noteCount !== 1 ? 's' : '') + ' total.\n\n\u2014 ' + show + ' Stage Management';
    const mailtoBody = body.length > 1800 ? body.slice(0, 1800) + '\n\n[Note: Some notes may be truncated. Use the Copy button for the full list.]' : body;
    const mailtoUri = 'mailto:' + encodeURIComponent(data.actorEmail) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(mailtoBody);
    const emailDisplay = hasEmail ? '<span class="actor-email">' + escapeHtml(data.actorEmail) + '</span>' : '<span class="actor-email actor-email--warn">No email \u2014 update in Cast &amp; Crew tab</span>';
    return '<div class="email-actor-row" data-castid="' + escapeHtml(cid) + '"><div class="actor-dot" style="background:' + escapeHtml(data.color) + '"></div><div class="actor-info"><span class="actor-name">' + escapeHtml(data.actorName) + '</span>' + emailDisplay + '</div><span class="actor-note-count">' + noteCount + ' note' + (noteCount !== 1 ? 's' : '') + '</span><button class="modal-btn-primary email-open-btn ' + (hasEmail ? '' : 'email-open-btn--disabled') + '" data-mailto="' + escapeHtml(mailtoUri) + '">Open Email</button><button class="modal-btn-cancel email-copy-btn" data-body="' + escapeHtml(body) + '">Copy</button></div>';
  }).join('');
  emailModal.innerHTML = '<div class="send-notes-card"><h3>Email Notes</h3><div class="email-notes-meta">' + escapeHtml(dateStr) + ' \u00b7 ' + totalNotes + ' notes \u00b7 ' + actorCount + ' actors</div>' + actorRows + '<div class="send-notes-actions"><button class="modal-btn-cancel" id="rs-email-notes-close">Close</button></div></div>';
  emailModal.querySelector('#rs-email-notes-close').addEventListener('click', () => emailModal.classList.remove('open'));
  emailModal.addEventListener('click', e => { if (e.target === emailModal) emailModal.classList.remove('open'); });
  emailModal.querySelectorAll('.email-open-btn:not(.email-open-btn--disabled)').forEach(btn => {
    btn.addEventListener('click', () => { window.open(btn.dataset.mailto, '_blank'); });
  });
  emailModal.querySelectorAll('.email-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.body); toast('Copied to clipboard'); }
      catch(e) { const ta = document.createElement('textarea'); ta.value = btn.dataset.body; ta.style.cssText = 'position:fixed;left:-9999px;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('Select and copy manually'); }
    });
  });
}

// Keyboard in FAB popover
document.addEventListener('keydown', e => {
  const pop = document.getElementById('run-note-popover');
  if (!pop || pop.style.display === 'none') return;
  if (e.key === 'Escape') { closeFabPopover(); return; }
  if (e.key === 'Enter' && e.target.id !== 'rnp-text') { confirmFabNote(); return; }
  const num = parseInt(e.key);
  if (num >= 1 && num <= rsFlatChars.length) {
    fabSelectedCharIdx = num - 1;
    document.getElementById('rnp-chars')?.querySelectorAll('.popover-char').forEach((el, i) => el.classList.toggle('popover-char--active', i === num - 1));
    return;
  }
  const typeKeys = { 's': 'skp', 'p': 'para', 'l': 'line', 'a': 'add', 'g': 'gen' };
  if (typeKeys[e.key.toLowerCase()]) {
    fabSelectedType = typeKeys[e.key.toLowerCase()];
    document.getElementById('rnp-types')?.querySelectorAll('.popover-type').forEach(el => el.classList.toggle('popover-type--active', el.dataset.type === fabSelectedType));
  }
});

/* ═══════════════════════════════════════════════════════════
   SESSION LIFECYCLE — PRE-RUN MODAL
   ═══════════════════════════════════════════════════════════ */
function openPreRunModal() {
  const existing = document.querySelector('.pre-run-modal-backdrop');
  if (existing) existing.remove();

  const defaultTitle = `${state.activeProduction?.title || 'Run'} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const lastDuration  = localStorage.getItem('lastRunDuration')  || '120';
  const lastWarnPages = localStorage.getItem('lastRunWarnPages') || '5';
  const lastTotalPages = state.activeProduction?.scriptPageCount || '100';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop pre-run-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card">
      <h2>Start Run Session</h2>
      <label>Session Name</label>
      <input type="text" id="prm-title" maxlength="200" value="${escapeHtml(defaultTitle)}" />
      <label>Total Pages</label>
      <input type="number" id="prm-pages" min="1" value="${escapeHtml(String(lastTotalPages))}" />
      <label>Duration (minutes)</label>
      <input type="number" id="prm-duration" min="1" value="${escapeHtml(lastDuration)}" />
      <label>Warn Pages</label>
      <input type="number" id="prm-warn" min="0" value="${escapeHtml(lastWarnPages)}" />
      <div class="modal-btns">
        <button class="modal-btn-cancel" id="prm-cancel">Cancel</button>
        <button class="modal-btn-primary" id="prm-start">Start Run</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#prm-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#prm-start').addEventListener('click', async () => {
    const title = sanitizeName(backdrop.querySelector('#prm-title').value) || defaultTitle;
    const pages    = parseInt(backdrop.querySelector('#prm-pages').value) || 100;
    const duration = parseInt(backdrop.querySelector('#prm-duration').value) || 120;
    const warnPgs  = parseInt(backdrop.querySelector('#prm-warn').value) || 5;
    localStorage.setItem('lastRunDuration', String(duration));
    localStorage.setItem('lastRunWarnPages', String(warnPgs));
    backdrop.remove();
    try {
      await startRunSession(title, pages, duration, warnPgs);
      // Feature 3: track session ID, clear notes, re-subscribe
      rsLastSessionId = state.runSession.sessionId;
      rsNotes = [];
      renderRunShowSidebar();
      if (rsPdfDoc) rsRedrawOverlay(rsCurrentPage);
      rsSubscribeToNotes();
      // Show FAB
      const fab = document.getElementById('run-show-fab');
      if (fab) fab.classList.remove('hidden');
      renderRunShowControls();
      toast('Run session started!', 'success');
    } catch(e) {
      console.error('Start run error:', e);
      toast('Failed to start session.', 'error');
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   SESSION LIFECYCLE — END RUN MODAL
   ═══════════════════════════════════════════════════════════ */
function openEndRunModal() {
  const existing = document.querySelector('.end-run-modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop end-run-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card">
      <h2>End Run Session?</h2>
      <label>Final Notes (Scratchpad)</label>
      <textarea id="erm-scratch" style="width:100%;min-height:80px;padding:10px;background:#0f0f1e;border:1px solid #2a2a3e;border-radius:6px;color:#e0e0e0;font-size:13px;resize:vertical;outline:none;margin-bottom:16px;">${escapeHtml(state.runSession?.scratchpad || '')}</textarea>
      <div class="modal-btns">
        <button class="modal-btn-cancel" id="erm-cancel">Cancel</button>
        <button class="modal-btn-primary" id="erm-confirm" style="background:#e63946;border-color:#e63946;">End &amp; Generate Report</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#erm-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#erm-confirm').addEventListener('click', async () => {
    const scratchText = backdrop.querySelector('#erm-scratch').value;
    const sid = state.runSession?.sessionId;
    backdrop.remove();
    try {
      // Feature 3: Preserve last session ID
      rsLastSessionId = sid;
      await endRunSession(scratchText);
      // Hide FAB
      const fab = document.getElementById('run-show-fab');
      if (fab) fab.classList.add('hidden');
      renderRunShowControls();
      if (sid) await generateRunReport(sid);
      toast('Run session ended.', 'success');
    } catch(e) {
      console.error('End run error:', e);
      toast('Failed to end session.', 'error');
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   POST-RUN REPORT
   ═══════════════════════════════════════════════════════════ */
async function generateRunReport(sessionId) {
  const pid = state.activeProduction.id;

  // Fetch session doc and all notes for this session
  // Security: sessions readable by all production members
  const [sessionSnap, notesSnap] = await Promise.all([
    getDoc(doc(db, 'productions', pid, 'sessions', sessionId)),
    getDocs(query(collection(db, 'productions', pid, 'lineNotes'), where('sessionId', '==', sessionId))),
  ]);

  if (!sessionSnap.exists()) { toast('Session not found.', 'error'); return; }
  const session = { id: sessionSnap.id, ...sessionSnap.data() };
  const sessionNotes = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const cast = getCastMembers();
  const byCastId = {};
  sessionNotes.forEach(n => {
    const castId = n.castId;
    if (!byCastId[castId]) {
      const member = cast.find(m => m.id === castId);
      byCastId[castId] = {
        actorName: member?.name || n.characterName || '?',
        actorEmail: member?.email || '',
        color: member?.color || n.charColor || '#888',
        notes: [],
      };
    }
    byCastId[castId].notes.push(n);
  });

  const prodTitle = state.activeProduction?.title || '';
  const dateStr = session.date?.toDate
    ? session.date.toDate().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  const durationSec = session.durationSeconds || 0;
  const holdSec     = session.totalHoldSeconds || 0;
  const holdCount   = (session.holdLog || []).length;
  const notesByActor = {};
  Object.entries(byCastId).forEach(([id, d]) => { notesByActor[id] = d.notes.length; });

  // Build HTML report (self-contained, inline styles, Google Fonts only)
  const noteSections = Object.entries(byCastId).filter(([, d]) => d.notes.length > 0).map(([, data]) => {
    const sorted = [...data.notes].sort((a, b) => a.page - b.page || (a.bounds?.y || 0) - (b.bounds?.y || 0));
    const rows = sorted.map(n => {
      const charLabel = n.characterName || n.charName || '';
      return `<div class="nr"><div class="np" style="background:${escapeHtml(data.color)}">${escapeHtml(n.type)}</div><div class="nd"><div><span class="pg">p.${rsScriptLabel(n.page, n.half)}</span>${charLabel ? `<span style="font-size:11px;color:#aaa;margin-right:6px;">[${escapeHtml(charLabel)}]</span>` : ''}<span class="tl">${NOTE_TYPES_MAP[n.type] || n.type}</span></div>${n.lineText ? `<div class="lt">\u201c${escapeHtml(n.lineText)}\u201d</div>` : ''}</div></div>`;
    }).join('');
    return `<section class="s"><div class="sh"><span class="sd" style="background:${escapeHtml(data.color)}"></span><div style="flex:1"><div class="sn">${escapeHtml(data.actorName)}</div>${data.actorEmail ? `<div class="se">${escapeHtml(data.actorEmail)}</div>` : ''}</div></div>${rows}</section>`;
  }).join('');

  const scratchSection = session.scratchpadNotes
    ? `<div class="scratch-section"><h2 class="section-title">SM Notes</h2><div class="scratch-text">${escapeHtml(session.scratchpadNotes)}</div></div>`
    : '';

  const reportHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Run Report — ${escapeHtml(session.title)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#f5f3ee;color:#1a1814;padding:40px 48px}
h1{font-family:'Instrument Serif',serif;font-size:32px;margin-bottom:4px}
.meta{font-family:'DM Mono',monospace;font-size:12px;color:#999;margin-bottom:24px}
.stats-table{width:100%;border-collapse:collapse;margin-bottom:28px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.07)}
.stats-table th,.stats-table td{padding:10px 16px;text-align:left;border-bottom:1px solid #f0ede4;font-size:13px}
.stats-table th{font-family:'DM Mono',monospace;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;background:#faf8f3}
.stats-table tr:last-child td{border-bottom:none}
.section-title{font-family:'Instrument Serif',serif;font-size:20px;margin-bottom:12px}
.scratch-section{background:#fff;border-radius:10px;padding:22px 26px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.07)}
.scratch-text{font-size:13px;color:#555;white-space:pre-wrap;font-family:'DM Mono',monospace}
.s{background:#fff;border-radius:10px;padding:22px 26px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.07)}
.sh{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #f0ede4}
.sd{width:12px;height:12px;border-radius:50%;flex-shrink:0}.sn{font-size:18px;font-weight:500;flex:1}
.se{font-family:'DM Mono',monospace;font-size:11px;color:#999;margin-top:2px}
.nr{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f5f3ee}.nr:last-child{border-bottom:none}
.np{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;color:#fff;padding:3px 8px;border-radius:3px;flex-shrink:0;margin-top:3px}
.nd{display:flex;flex-direction:column;gap:5px}.pg{font-family:'DM Mono',monospace;font-size:11px;color:#aaa;margin-right:6px}
.tl{font-size:13px;font-weight:500;color:#444}.lt{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;color:#333}
@media print{body{padding:20px}}
</style></head><body>
<h1>Run Report</h1>
<div class="meta">${escapeHtml(prodTitle)} &middot; ${escapeHtml(session.title)} &middot; ${dateStr}</div>
<table class="stats-table">
  <thead><tr><th>Metric</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>Total Duration</td><td>${formatTime(durationSec)}</td></tr>
    <tr><td>Hold Time</td><td>${formatTime(holdSec)} (${holdCount} hold${holdCount !== 1 ? 's' : ''})</td></tr>
    <tr><td>Page Count</td><td>${session.totalPages || '—'}</td></tr>
    <tr><td>Note Count</td><td>${sessionNotes.length}</td></tr>
  </tbody>
</table>
${scratchSection}
<h2 class="section-title">Line Notes by Actor</h2>
${noteSections || '<p style="color:#999;font-size:13px;">No notes recorded during this session.</p>'}
</body></html>`;

  // Write report back to Firestore
  // Security: sessions update restricted to creator or owner
  try {
    await updateDoc(doc(db, 'productions', pid, 'sessions', sessionId), {
      reportHtml,
      noteCount: sessionNotes.length,
      notesByActor,
    });
  } catch(e) { console.warn('Could not save report HTML', e); }

  // Open report modal
  openReportModal(session.title, reportHtml);
}

let _currentReportHtml = '';

function openReportModal(title, html) {
  _currentReportHtml = html;
  const modal = document.getElementById('run-report-modal');
  if (!modal) return;
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = title || 'Run Report';
  const body = document.getElementById('run-report-body');
  if (body) body.innerHTML = html;
  modal.style.display = 'flex';
}

function closeReportModal() {
  const modal = document.getElementById('run-report-modal');
  if (modal) modal.style.display = 'none';
}

function printReport() {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow popups to print.', 'error'); return; }
  w.document.write(_currentReportHtml);
  w.document.close();
}

function emailReport() {
  const prod = state.activeProduction?.title || 'Production';
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject = encodeURIComponent(`Run Report — ${prod} — ${date}`);
  window.location.href = `mailto:?subject=${subject}`;
}

/* ═══════════════════════════════════════════════════════════
   REPORTS HISTORY
   ═══════════════════════════════════════════════════════════ */
async function loadReportsHistory() {
  const container = document.getElementById('rs-reports-section');
  if (!container) return;
  const pid = state.activeProduction.id;
  container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Loading reports…</div>';

  try {
    // Use getDocs (one-time fetch) per spec — no real-time updates needed
    const snap = await getDocs(collection(db, 'productions', pid, 'sessions'));
    const sessions = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.status === 'ended')
      .sort((a, b) => {
        const aTime = a.startedAt || 0;
        const bTime = b.startedAt || 0;
        return bTime - aTime;
      });

    if (sessions.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No run reports yet.</div>';
      return;
    }

    const owner = isOwner();
    container.innerHTML = `
      <div style="margin-top:20px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:10px;">Run Reports</div>
        ${sessions.map(s => {
          const dateStr = s.date?.toDate
            ? s.date.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';
          return `<div class="rs-report-row" data-id="${escapeHtml(s.id)}" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg-card);border:1px solid var(--bg-border);border-radius:6px;margin-bottom:6px;cursor:pointer;">
            <div style="flex:1;min-width:0;">
              <div style="color:var(--text-primary);font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.title || 'Untitled')}</div>
              <div style="color:var(--text-muted);font-size:11px;font-family:'DM Mono',monospace;">${dateStr} &middot; ${formatTime(s.durationSeconds || 0)} &middot; ${s.noteCount || 0} note${(s.noteCount || 0) !== 1 ? 's' : ''}</div>
            </div>
            <button class="settings-btn" data-id="${escapeHtml(s.id)}">View</button>
            ${owner ? `<button class="settings-btn settings-btn--danger rs-delete-report" data-id="${escapeHtml(s.id)}">Delete</button>` : ''}
          </div>`;
        }).join('')}
      </div>`;

    container.querySelectorAll('.rs-report-row').forEach(row => {
      row.addEventListener('click', async e => {
        if (e.target.classList.contains('rs-delete-report')) return;
        const sid = row.dataset.id;
        const session = sessions.find(s => s.id === sid);
        if (!session) return;
        if (session.reportHtml) {
          openReportModal(session.title, session.reportHtml);
        } else {
          await generateRunReport(sid);
        }
      });
    });

    if (owner) {
      container.querySelectorAll('.rs-delete-report').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirmDialog('Delete this run report? This cannot be undone.')) return;
          try {
            // Security: sessions delete restricted to creator or owner
            await deleteDoc(doc(db, 'productions', pid, 'sessions', btn.dataset.id));
            toast('Report deleted.', 'success');
            loadReportsHistory();
          } catch(e) { toast('Failed to delete.', 'error'); }
        });
      });
    }
  } catch(e) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Could not load reports.</div>';
  }
}

/* ═══════════════════════════════════════════════════════════
   SEND NOTES (migrated from linenotes.js)
   ═══════════════════════════════════════════════════════════ */
function rsOpenSendNotes() {
  if (rsNotes.length === 0) { toast('No notes to send'); return; }
  const sendModal = document.getElementById('rs-send-notes-modal');
  if (!sendModal) return;
  sendModal.classList.add('open');

  const cast = getCastMembers();
  const byCastId = {};
  rsNotes.forEach(n => {
    const castId = n.castId || n.charId;
    if (!byCastId[castId]) {
      const member = cast.find(m => m.id === castId);
      byCastId[castId] = {
        actorName: member?.name || n.characterName || n.charName || '?',
        actorEmail: member?.email || '',
        color: member?.color || n.charColor || '#888',
        notes: [],
      };
    }
    byCastId[castId].notes.push(n);
  });

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const show = state.activeProduction?.title || '';

  const sections = Object.entries(byCastId).filter(([, d]) => d.notes.length > 0).map(([cid, data]) => {
    const sorted = [...data.notes].sort((a, b) => a.page - b.page || (a.bounds?.y || 0) - (b.bounds?.y || 0));
    const rows = sorted.map(n => {
      const charLabel = n.characterName || n.charName || '';
      return `<div class="send-note-row" style="border-left-color:${escapeHtml(data.color)}"><strong>p.${rsScriptLabel(n.page, n.half)}</strong>${charLabel ? ` [${escapeHtml(charLabel)}]` : ''} [${escapeHtml(n.type)}] <em>${escapeHtml((n.lineText || '').slice(0, 100))}</em>${n.noteBody ? `<div style="color:#c8a96e;font-size:11px;margin-top:2px;"><strong>Note:</strong> ${escapeHtml(n.noteBody)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="send-char-section"><div class="send-char-header"><div style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(data.color)};display:inline-block;"></div><span class="char-name">${escapeHtml(data.actorName)}</span>${data.actorEmail ? `<span style="font-size:11px;color:#5c5850;font-family:'DM Mono',monospace;margin-left:8px;">${escapeHtml(data.actorEmail)}</span>` : ''}</div>${rows}</div>`;
  }).join('');

  sendModal.innerHTML = `<div class="send-notes-card"><h3>Send Line Notes</h3><div style="font-family:'DM Mono',monospace;font-size:11px;color:#5c5850;margin-bottom:16px;">${date} \u00b7 ${rsNotes.length} note${rsNotes.length !== 1 ? 's' : ''}</div>${sections}<div class="send-notes-actions"><button class="modal-btn-primary" id="rs-send-print">Generate Notes Report \u2197</button><button class="modal-btn-cancel" id="rs-send-close">Close</button></div></div>`;

  sendModal.querySelector('#rs-send-close').addEventListener('click', () => sendModal.classList.remove('open'));
  sendModal.addEventListener('click', e => { if (e.target === sendModal) sendModal.classList.remove('open'); });
  sendModal.querySelector('#rs-send-print').addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow popups'); return; }
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Line Notes</title><style>@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#f5f3ee;color:#1a1814;padding:40px 48px}h1{font-family:'Instrument Serif',serif;font-size:32px;margin-bottom:6px}.meta{font-family:'DM Mono',monospace;font-size:12px;color:#999;margin-bottom:36px}.s{background:#fff;border-radius:10px;padding:22px 26px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.07)}.sh{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #f0ede4}.sd{width:12px;height:12px;border-radius:50%}.sn{font-size:18px;font-weight:500;flex:1}.se{font-family:'DM Mono',monospace;font-size:11px;color:#999;margin-top:2px}.nr{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f5f3ee}.nr:last-child{border-bottom:none}.np{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;color:#fff;padding:3px 8px;border-radius:3px;flex-shrink:0;margin-top:3px}.nd{display:flex;flex-direction:column;gap:5px}.pg{font-family:'DM Mono',monospace;font-size:11px;color:#aaa;margin-right:6px}.tl{font-size:13px;font-weight:500;color:#444}.lt{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;color:#333}@media print{body{padding:20px}}</style></head><body><h1>Line Notes</h1><div class="meta">${escapeHtml(show)} \u00b7 ${date} \u00b7 ${rsNotes.length} note${rsNotes.length !== 1 ? 's' : ''}</div>`;
    Object.entries(byCastId).forEach(([, data]) => {
      if (!data.notes.length) return;
      const sorted = [...data.notes].sort((a, b) => a.page - b.page);
      html += `<section class="s"><div class="sh"><span class="sd" style="background:${escapeHtml(data.color)}"></span><div style="flex:1"><div class="sn">${escapeHtml(data.actorName)}</div>${data.actorEmail ? `<div class="se">${escapeHtml(data.actorEmail)}</div>` : ''}</div></div>`;
      sorted.forEach(n => {
        const charLabel = n.characterName || n.charName || '';
        html += `<div class="nr"><div class="np" style="background:${escapeHtml(data.color)}">${escapeHtml(n.type)}</div><div class="nd"><div><span class="pg">p.${rsScriptLabel(n.page, n.half)}</span>${charLabel ? `<span style="font-size:11px;color:#aaa;margin-right:6px;">[${escapeHtml(charLabel)}]</span>` : ''}<span class="tl">${NOTE_TYPES_MAP[n.type] || n.type}</span></div>${n.lineText ? `<div class="lt">\u201c${escapeHtml(n.lineText)}\u201d</div>` : ''}${n.noteBody ? `<div style="font-size:13px;color:#555;margin-top:4px;"><strong>Note:</strong> ${escapeHtml(n.noteBody)}</div>` : ''}</div></div>`;
      });
      html += '</section>';
    });
    html += '</body></html>';
    w.document.write(html); w.document.close();
    sendModal.classList.remove('open'); toast('Notes report opened');
  });
}