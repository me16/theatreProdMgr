#!/usr/bin/env node
/**
 * patch-report-inline-email.mjs
 *
 * Replaces the "Send Email" button in the Run Report modal so it swaps the
 * report body with a per-actor email UI (Email / Copy / Email All) inline,
 * instead of opening a separate modal. A "← Back to Report" button swaps
 * back to the original report view.
 *
 * Works against EITHER the original codebase OR the codebase with the
 * previous patch-email-report.mjs already applied.
 *
 * Patches applied to: src/runshow/Runshow.js
 *
 * Usage:
 *   node patch-report-inline-email.mjs          # dry-run (default)
 *   node patch-report-inline-email.mjs --apply  # apply changes
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = !process.argv.includes('--apply');
const TARGET  = 'src/runshow/Runshow.js';

/* ───────────────────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────────────────── */
function bail(msg) { console.error(`\n❌ FATAL: ${msg}`); process.exit(1); }

function applyPatch(source, label, find, replace) {
  if (!source.includes(find)) {
    bail(`Patch "${label}" — search string not found.\n\n  Expected:\n${find.slice(0, 200)}…`);
  }
  const count = source.split(find).length - 1;
  if (count > 1) {
    bail(`Patch "${label}" — matched ${count} times (expected 1).`);
  }
  console.log(`  ✅ ${label}`);
  return source.replace(find, replace);
}

/** Try findA first; if not found, try findB. Replace whichever matches. */
function applyPatchEither(source, label, findA, findB, replace) {
  if (source.includes(findA)) {
    return applyPatch(source, label + ' (from patched state)', findA, replace);
  }
  if (source.includes(findB)) {
    return applyPatch(source, label + ' (from original state)', findB, replace);
  }
  bail(`Patch "${label}" — neither variant found in file.`);
}

/* ───────────────────────────────────────────────────────────
   Resolve file
   ─────────────────────────────────────────────────────────── */
const filePath = path.resolve(TARGET);
if (!fs.existsSync(filePath)) {
  bail(`File not found: ${filePath}\nRun this script from the project root.`);
}

console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '🔧 APPLYING'} — patching ${TARGET}\n`);

let src = fs.readFileSync(filePath, 'utf-8');

/* ═══════════════════════════════════════════════════════════
   P1: Ensure _currentReportSessionId + add _reportEmailMode
   ═══════════════════════════════════════════════════════════ */
// If previous patch was applied, _currentReportSessionId exists
const VARS_PATCHED = `let _currentReportHtml = '';
let _currentReportSessionId = '';`;

const VARS_ORIGINAL = `let _currentReportHtml = '';`;

const VARS_NEW = `let _currentReportHtml = '';
let _currentReportSessionId = '';
let _reportEmailMode = false;`;

src = applyPatchEither(src, 'P1 — State variables', VARS_PATCHED, VARS_ORIGINAL, VARS_NEW);

/* ═══════════════════════════════════════════════════════════
   P2: Update openReportModal — accept sessionId, reset state
   ═══════════════════════════════════════════════════════════ */
const OPEN_MODAL_PATCHED = `function openReportModal(title, html, sessionId) {
  _currentReportHtml = html;
  _currentReportSessionId = sessionId || '';
  const modal = document.getElementById('run-report-modal');
  if (!modal) return;
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = title || 'Run Report';
  const body = document.getElementById('run-report-body');
  if (body) body.innerHTML = html;
  modal.style.display = 'flex';
}`;

const OPEN_MODAL_ORIGINAL = `function openReportModal(title, html) {
  _currentReportHtml = html;
  const modal = document.getElementById('run-report-modal');
  if (!modal) return;
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = title || 'Run Report';
  const body = document.getElementById('run-report-body');
  if (body) body.innerHTML = html;
  modal.style.display = 'flex';
}`;

const OPEN_MODAL_NEW = `function openReportModal(title, html, sessionId) {
  _currentReportHtml = html;
  _currentReportSessionId = sessionId || '';
  _reportEmailMode = false;
  const modal = document.getElementById('run-report-modal');
  if (!modal) return;
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = title || 'Run Report';
  const body = document.getElementById('run-report-body');
  if (body) body.innerHTML = html;
  // Ensure header buttons are in report mode
  const printBtn = document.getElementById('run-report-print');
  const emailBtn = document.getElementById('run-report-email');
  if (printBtn) printBtn.style.display = '';
  if (emailBtn) emailBtn.textContent = 'Send Email';
  modal.style.display = 'flex';
}`;

src = applyPatchEither(src, 'P2 — openReportModal', OPEN_MODAL_PATCHED, OPEN_MODAL_ORIGINAL, OPEN_MODAL_NEW);

/* ═══════════════════════════════════════════════════════════
   P3: Update closeReportModal — reset email mode flag
   ═══════════════════════════════════════════════════════════ */
src = applyPatch(src, 'P3 — closeReportModal resets email mode',

`function closeReportModal() {
  const modal = document.getElementById('run-report-modal');
  if (modal) modal.style.display = 'none';
}`,

`function closeReportModal() {
  const modal = document.getElementById('run-report-modal');
  if (modal) modal.style.display = 'none';
  _reportEmailMode = false;
}`
);

/* ═══════════════════════════════════════════════════════════
   P4: Pass sessionId from generateRunReport (if not already)
   ═══════════════════════════════════════════════════════════ */
// Check if already patched
if (src.includes('openReportModal(session.title, reportHtml, sessionId);')) {
  console.log(`  ⏭️  P4 — generateRunReport sessionId (already applied)`);
} else {
  src = applyPatch(src, 'P4 — generateRunReport passes sessionId',
    `  // Open report modal\n  openReportModal(session.title, reportHtml);`,
    `  // Open report modal\n  openReportModal(session.title, reportHtml, sessionId);`
  );
}

/* ═══════════════════════════════════════════════════════════
   P5: Pass sessionId from Reports History (if not already)
   ═══════════════════════════════════════════════════════════ */
if (src.includes('openReportModal(session.title, session.reportHtml, sid);')) {
  console.log(`  ⏭️  P5 — Reports History sessionId (already applied)`);
} else {
  src = applyPatch(src, 'P5 — Reports History passes sessionId',
    `        if (session.reportHtml) {\n          openReportModal(session.title, session.reportHtml);\n        } else {`,
    `        if (session.reportHtml) {\n          openReportModal(session.title, session.reportHtml, sid);\n        } else {`
  );
}

/* ═══════════════════════════════════════════════════════════
   P6: Replace emailReport() — regex-based to handle any version
   ═══════════════════════════════════════════════════════════ */

// Strategy: find the function start via regex, find the REPORTS HISTORY section
// marker, and replace everything between them.
const emailFnRegex = /(?:async\s+)?function emailReport\(\)\s*\{/;
const fnMatch = src.match(emailFnRegex);
if (!fnMatch) bail('P6 — Could not find emailReport() function declaration.');

const fnStartIdx = fnMatch.index;

// The section that follows emailReport is REPORTS HISTORY
const HISTORY_MARKER = '\n/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n   REPORTS HISTORY';
const historyIdx = src.indexOf(HISTORY_MARKER, fnStartIdx);
if (historyIdx === -1) bail('P6 — Could not find REPORTS HISTORY section marker after emailReport().');

// The new emailReport + _restoreReportView functions
const NEW_FUNCTIONS = `async function emailReport() {
  // If already in email mode, swap back to report
  if (_reportEmailMode) {
    _restoreReportView();
    return;
  }

  const pid = state.activeProduction?.id;
  const sessionId = _currentReportSessionId;

  // Fallback: if no session ID tracked, open basic mailto
  if (!pid || !sessionId) {
    const prod = state.activeProduction?.title || 'Production';
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const subject = encodeURIComponent(\`Run Report \u2014 \${prod} \u2014 \${date}\`);
    window.location.href = \`mailto:?subject=\${subject}\`;
    return;
  }

  // Fetch session doc + notes from Firestore
  let session, sessionNotes;
  try {
    const [sessionSnap, notesSnap] = await Promise.all([
      getDoc(doc(db, 'productions', pid, 'sessions', sessionId)),
      getDocs(query(collection(db, 'productions', pid, 'lineNotes'), where('sessionId', '==', sessionId))),
    ]);
    if (!sessionSnap.exists()) { toast('Session not found.', 'error'); return; }
    session = { id: sessionSnap.id, ...sessionSnap.data() };
    sessionNotes = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Failed to load session notes for email:', e);
    toast('Could not load notes.', 'error');
    return;
  }

  if (sessionNotes.length === 0) { toast('No notes to email for this session.'); return; }

  // Group notes by cast member
  const cast = getCastMembers();
  const byCastId = {};
  sessionNotes.forEach(n => {
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

  const show = state.activeProduction?.title || '';
  const dateStr = session.date?.toDate
    ? session.date.toDate().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const subject = 'Line Notes \\u2014 ' + show + ' \\u2014 ' + dateStr;
  const totalNotes = sessionNotes.length;
  const actorEntries = Object.entries(byCastId).filter(([, d]) => d.notes.length > 0);
  const actorCount = actorEntries.length;
  const actorsWithEmail = actorEntries.filter(([, d]) => !!d.actorEmail);
  const actorsWithoutEmail = actorEntries.filter(([, d]) => !d.actorEmail);

  // Per-actor rows
  const actorRows = actorEntries.map(([cid, data]) => {
    const noteCount = data.notes.length;
    const hasEmail = !!data.actorEmail;
    const body = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
    const mailtoUri = hasEmail ? _buildMailtoUri(data.actorEmail, subject, body) : '';
    const emailDisplay = hasEmail
      ? '<span class="actor-email">' + escapeHtml(data.actorEmail) + '</span>'
      : '<span class="actor-email actor-email--warn">No email \\u2014 update in Cast &amp; Crew tab</span>';

    return '<div class="email-actor-row" data-castid="' + escapeHtml(cid) + '">'
      + '<div class="actor-dot" style="background:' + escapeHtml(data.color) + '"></div>'
      + '<div class="actor-info"><span class="actor-name">' + escapeHtml(data.actorName) + '</span>' + emailDisplay + '</div>'
      + '<span class="actor-note-count">' + noteCount + ' note' + (noteCount !== 1 ? 's' : '') + '</span>'
      + '<button class="modal-btn-primary email-single-btn' + (hasEmail ? '' : ' email-open-btn--disabled') + '"'
      +   ' data-mailto="' + escapeHtml(mailtoUri) + '"'
      +   ' title="Email ' + escapeHtml(data.actorName) + '">Email</button>'
      + '<button class="modal-btn-cancel email-copy-btn"'
      +   ' data-body="' + escapeHtml(body) + '"'
      +   ' title="Copy notes for ' + escapeHtml(data.actorName) + '">Copy</button>'
      + '</div>';
  }).join('');

  // Warning + Email All
  const emailAllDisabled = actorsWithEmail.length === 0;
  const emailAllLabel = emailAllDisabled
    ? 'No actors have email addresses'
    : 'Email All ' + actorsWithEmail.length + ' Actor' + (actorsWithEmail.length !== 1 ? 's' : '');
  const warningBanner = actorsWithoutEmail.length > 0
    ? '<div class="email-notes-warning">'
      + actorsWithoutEmail.length + ' actor' + (actorsWithoutEmail.length !== 1 ? 's' : '')
      + ' missing email \\u2014 update in Cast &amp; Crew tab</div>'
    : '';

  // Build inline email UI
  const emailHtml = '<div style="max-width:620px;margin:0 auto;">'
    + '<div class="email-notes-meta">' + escapeHtml(dateStr)
    +   ' \\u00b7 ' + totalNotes + ' notes \\u00b7 ' + actorCount + ' actors</div>'
    + warningBanner
    + '<div class="email-all-section">'
    +   '<button class="email-all-btn' + (emailAllDisabled ? ' email-open-btn--disabled' : '')
    +     '" id="rs-rpt-email-all">' + emailAllLabel + '</button>'
    + '</div>'
    + actorRows
    + '</div>';

  // Swap report body content
  const reportBody = document.getElementById('run-report-body');
  if (reportBody) {
    reportBody.innerHTML = emailHtml;
    reportBody.style.background = 'var(--bg-card)';
  }

  // Toggle header: hide Print + change Send Email → ← Back to Report
  const printBtn = document.getElementById('run-report-print');
  const emailBtn = document.getElementById('run-report-email');
  if (printBtn) printBtn.style.display = 'none';
  if (emailBtn) emailBtn.textContent = '\\u2190 Back to Report';

  // Update title
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = 'Email Notes';

  _reportEmailMode = true;

  // Wire up event listeners on the inline email UI

  // "Email All" — stagger mailto opens
  if (!emailAllDisabled) {
    document.getElementById('rs-rpt-email-all')?.addEventListener('click', () => {
      let delay = 0;
      actorsWithEmail.forEach(([cid, data]) => {
        const mbody = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
        const uri = _buildMailtoUri(data.actorEmail, subject, mbody);
        setTimeout(() => { window.open(uri, '_blank'); }, delay);
        delay += 300;
      });
      toast('Opening ' + actorsWithEmail.length + ' email' + (actorsWithEmail.length !== 1 ? 's' : '') + '\\u2026');
    });
  }

  // Per-actor Email buttons
  if (reportBody) {
    reportBody.querySelectorAll('.email-single-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uri = btn.dataset.mailto;
        if (uri) window.open(uri, '_blank');
      });
    });

    // Per-actor Copy buttons
    reportBody.querySelectorAll('.email-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _copyToClipboard(btn.dataset.body);
      });
    });
  }
}

/** Restore the report body from the cached HTML and reset header buttons. */
function _restoreReportView() {
  _reportEmailMode = false;

  const reportBody = document.getElementById('run-report-body');
  if (reportBody) {
    reportBody.innerHTML = _currentReportHtml;
    reportBody.style.background = '#fff';
  }

  // Restore header buttons
  const printBtn = document.getElementById('run-report-print');
  const emailBtn = document.getElementById('run-report-email');
  if (printBtn) printBtn.style.display = '';
  if (emailBtn) emailBtn.textContent = 'Send Email';

  // Restore title
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = _currentReportHtml ? 'Run Report' : 'Run Report';
}`;

// Perform the replacement
const before = src.substring(0, fnStartIdx);
const after  = src.substring(historyIdx);  // includes the \n and marker
src = before + NEW_FUNCTIONS + after;
console.log(`  ✅ P6 — emailReport() replaced with inline email UI + _restoreReportView()`);


/* ───────────────────────────────────────────────────────────
   Write or report
   ─────────────────────────────────────────────────────────── */
if (DRY_RUN) {
  console.log(`\n✅ Dry run passed — all patches matched successfully.`);
  console.log(`   Re-run with --apply to write changes:\n`);
  console.log(`   node patch-report-inline-email.mjs --apply\n`);
} else {
  fs.writeFileSync(filePath, src, 'utf-8');
  console.log(`\n✅ All patches applied to ${TARGET}`);
  console.log(`\n📋 What changed:`);
  console.log(`   P1  Added _reportEmailMode flag`);
  console.log(`   P2  openReportModal resets email mode + restores header buttons on open`);
  console.log(`   P3  closeReportModal resets email mode flag`);
  console.log(`   P4  generateRunReport passes sessionId (if not already)`);
  console.log(`   P5  Reports History passes sessionId for cached reports (if not already)`);
  console.log(`   P6  emailReport() swaps report body inline with email UI`);
  console.log(`        ← Back to Report restores original report view`);
  console.log(`        Print + Send Email buttons hide in email mode`);
  console.log(`\n🧪 Verify:`);
  console.log(`   1. End a run with notes → report appears → click "Send Email"`);
  console.log(`      → body swaps to per-actor email UI, Print hides, button says "← Back to Report"`);
  console.log(`   2. Click "← Back to Report" → original report restores`);
  console.log(`   3. Open a past report from history → same behavior`);
  console.log(`   4. "Email All" staggers mailto: windows`);
  console.log(`   5. "Copy" copies notes for actors without email`);
  console.log(`   6. Close modal → reopen → shows report (not email view)`);
  console.log(`   7. Run  npx vite build  to confirm no build errors\n`);
}
