#!/usr/bin/env node
/**
 * CUE Stage Management Platform — Bug Fix Migration Script
 * =========================================================
 * Implements all 13 fixes from the Second-Pass Review Implementation Guide.
 * 
 * Priority 0 (Critical): Fixes 1–5
 * Priority 1 (High):     Fixes 6–10
 * Priority 2 (Medium):   Fixes 11–13
 *
 * Usage:
 *   node cue-bugfix-migration.mjs [--dry-run] [--project-root /path/to/cue]
 *
 * Flags:
 *   --dry-run        Report what would change without writing files
 *   --project-root   Path to the CUE project root (default: current directory)
 */

import fs from 'fs';
import path from 'path';

// ─── CLI args ────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const rootIdx = args.indexOf('--project-root');
const PROJECT_ROOT = rootIdx !== -1 && args[rootIdx + 1]
  ? path.resolve(args[rootIdx + 1])
  : process.cwd();

// ─── Helpers ─────────────────────────────────────────────
let totalApplied = 0;
let totalFailed = 0;
const results = [];

function strReplace(filePath, oldStr, newStr, label) {
  const abs = path.join(PROJECT_ROOT, filePath);
  if (!fs.existsSync(abs)) {
    console.error(`  ✗ FILE NOT FOUND: ${filePath}`);
    results.push({ label, status: 'FILE_NOT_FOUND', file: filePath });
    totalFailed++;
    return false;
  }
  let content = fs.readFileSync(abs, 'utf-8');
  if (!content.includes(oldStr)) {
    // Try trimming trailing whitespace on each line as a fallback
    const oldLines = oldStr.split('\n');
    const trimmedOld = oldLines.map(l => l.trimEnd()).join('\n');
    if (content.includes(trimmedOld)) {
      // Match with trimmed version
      if (DRY_RUN) {
        console.log(`  ✓ [DRY RUN] Would apply: ${label} (matched with trimmed whitespace)`);
        results.push({ label, status: 'WOULD_APPLY', file: filePath });
        totalApplied++;
        return true;
      }
      content = content.replace(trimmedOld, newStr);
      fs.writeFileSync(abs, content, 'utf-8');
      console.log(`  ✓ Applied: ${label} (trimmed match)`);
      results.push({ label, status: 'APPLIED_TRIMMED', file: filePath });
      totalApplied++;
      return true;
    }
    console.error(`  ✗ OLD_STR NOT FOUND: ${label}`);
    console.error(`    File: ${filePath}`);
    console.error(`    First 80 chars of old_str: "${oldStr.slice(0, 80)}…"`);
    results.push({ label, status: 'NOT_FOUND', file: filePath });
    totalFailed++;
    return false;
  }
  if (DRY_RUN) {
    console.log(`  ✓ [DRY RUN] Would apply: ${label}`);
    results.push({ label, status: 'WOULD_APPLY', file: filePath });
    totalApplied++;
    return true;
  }
  content = content.replace(oldStr, newStr);
  fs.writeFileSync(abs, content, 'utf-8');
  console.log(`  ✓ Applied: ${label}`);
  results.push({ label, status: 'APPLIED', file: filePath });
  totalApplied++;
  return true;
}

// ═════════════════════════════════════════════════════════════
// PRIORITY 0: CRITICAL FIXES (Apply First)
// ═════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║  PRIORITY 0: CRITICAL FIXES                  ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── Fix 1: Move startSessionSync() inside startRunSession() [RS-002] ──
// The startSessionSync() call is a stray top-level statement outside the
// startRunSession() function body. It executes at module import time.
console.log('Fix 1: Move startSessionSync() inside startRunSession() [RS-002]');
strReplace(
  'src/props/props.js',
  // old_str
  `  // 3. Start the timer immediately
  startTimer(totalPages, durationMin);
}
  // P0: Start periodic Firestore sync
  startSessionSync();`,
  // new_str
  `  // 3. Start the timer immediately
  startTimer(totalPages, durationMin);

  // P0: Start periodic Firestore sync
  startSessionSync();
}`,
  'Fix 1 [RS-002]: Move startSessionSync() inside startRunSession()'
);

// ── Fix 2: Fix endRunSession() ordering to prevent stale UI [RS-001] ──
// Reorder: capture data first, null session before UI re-render
console.log('\nFix 2: Fix endRunSession() ordering [RS-001]');
strReplace(
  'src/props/props.js',
  // old_str
  `export async function endRunSession(scratchpadText) {
  if (!state.runSession) return;

  stopTimer();

  // P0: Stop sync and write final state
  stopSessionSync();
  await syncSessionToFirestore();
  hideHeartbeat();

  const sid = state.runSession.sessionId;
  const pid = state.activeProduction.id;
  const elapsed = state.runSession.timerElapsed;
  const holdLog = state.runSession.holdLog || [];
  const totalHold = holdLog.reduce((s, h) => s + (h.durationSeconds || 0), 0);

  // Security rule note: sessions update restricted to creator (createdBy == uid) or owner role
  await updateDoc(doc(db, 'productions', pid, 'sessions', sid), {
    endedAt: serverTimestamp(),
    durationSeconds: elapsed,
    holdLog: holdLog,
    totalHoldSeconds: totalHold,
    scratchpadNotes: scratchpadText || '',
    status: 'ended',
  });

  state.runSession = null;
}`,
  // new_str
  `export async function endRunSession(scratchpadText) {
  if (!state.runSession) return;

  // Capture session data BEFORE clearing state
  const sid = state.runSession.sessionId;
  const pid = state.activeProduction.id;
  const elapsed = state.runSession.timerElapsed;
  const holdLog = state.runSession.holdLog || [];
  const totalHold = holdLog.reduce((s, h) => s + (h.durationSeconds || 0), 0);

  // P0: Stop sync FIRST (before clearing session)
  stopSessionSync();
  await syncSessionToFirestore();

  // Clear the timer interval without triggering re-renders via _notifyRunShow
  const iv = getTimerState().timerInterval;
  if (iv) { clearInterval(iv); setTimerField('timerInterval', null); }

  // Null out session BEFORE any UI can re-render
  state.runSession = null;

  hideHeartbeat();

  // Now write the final state to Firestore
  // Security rule note: sessions update restricted to creator (createdBy == uid) or owner role
  await updateDoc(doc(db, 'productions', pid, 'sessions', sid), {
    endedAt: serverTimestamp(),
    durationSeconds: elapsed,
    holdLog: holdLog,
    totalHoldSeconds: totalHold,
    scratchpadNotes: scratchpadText || '',
    status: 'ended',
  });
}`,
  'Fix 2 [RS-001]: Reorder endRunSession — capture data, null session before UI'
);

// ── Fix 3: Call stopTimer() in backToDashboard() [RS-003] ──
// Timer interval is never cleared when navigating back to dashboard
console.log('\nFix 3: Call stopTimer() in backToDashboard() [RS-003]');
strReplace(
  'src/dashboard/dashboard.js',
  // old_str
  `export function backToDashboard() {
  cleanup();
  resetLineNotes();
  resetRunShow();
  state.activeProduction = null;
  state.activeRole = null;
  state.runSession = null;
  hideApp();
  showDashboard();
}`,
  // new_str
  `export function backToDashboard() {
  // Stop any active timer before cleanup to prevent orphaned intervals
  import('../props/props.js').then(m => m.stopTimer());
  import('../shared/session-sync.js').then(m => m.stopSessionSync());

  cleanup();
  resetLineNotes();
  resetRunShow();
  state.activeProduction = null;
  state.activeRole = null;
  state.runSession = null;
  hideApp();
  showDashboard();
}`,
  'Fix 3 [RS-003]: Stop timer and session sync in backToDashboard()'
);

// ── Fix 4: Add missing Firestore security rules [FRS-001] ──
// Add rules for sessions, checkState, scriptCues, and diagrams subcollections
console.log('\nFix 4: Add missing Firestore security rules [FRS-001]');
strReplace(
  'firestore.rules',
  // old_str — anchor on the cast rule
  `    // Cast & Crew subcollection --- added for CUE UI overhaul
    match /cast/{castId} {
      allow read: if isMember(productionId) || isSuperAdmin();
      allow create, update, delete: if isOwner(productionId) || isSuperAdmin();`,
  // new_str — keep cast rule, add new subcollection rules after
  `    // Cast & Crew subcollection
    match /cast/{castId} {
      allow read: if isMember(productionId) || isSuperAdmin();
      allow create, update, delete: if isOwner(productionId) || isSuperAdmin();
    }

    // Sessions subcollection --- run show lifecycle
    match /sessions/{sessionId} {
      allow read: if isMember(productionId) || isSuperAdmin();
      allow create: if isMember(productionId);
      allow update, delete: if resource.data.createdBy == request.auth.uid || isOwner(productionId) || isSuperAdmin();
    }

    // Check state subcollection --- pre/post show checklists (per-user)
    match /checkState/{uid} {
      allow read: if request.auth.uid == uid || isOwner(productionId) || isSuperAdmin();
      allow write: if request.auth.uid == uid;
    }

    // Script cues subcollection
    match /scriptCues/{cueId} {
      allow read: if isMember(productionId) || isSuperAdmin();
      allow write: if isOwner(productionId) || isSuperAdmin();
    }

    // Diagrams subcollection
    match /diagrams/{diagramId} {
      allow read: if isMember(productionId) || isSuperAdmin();
      allow write: if isOwner(productionId) || isSuperAdmin();`,
  'Fix 4 [FRS-001]: Add Firestore rules for sessions, checkState, scriptCues, diagrams'
);

// ── Fix 5: Add missing Storage security rules [STG-001] ──
// Add storage rules for prop photos and diagram uploads
console.log('\nFix 5: Add missing Storage security rules [STG-001]');
strReplace(
  'storage.rules',
  // old_str
  `    match /productions/{productionId}/script.pdf {
      allow read: if request.auth != null
        && firestore.exists(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid));
      allow write: if request.auth != null
        && firestore.get(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid)).data.role == 'owner'
        && request.resource.contentType == 'application/pdf'
        && request.resource.size < 100 * 1024 * 1024;
    }`,
  // new_str
  `    match /productions/{productionId}/script.pdf {
      allow read: if request.auth != null
        && firestore.exists(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid));
      allow write: if request.auth != null
        && firestore.get(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid)).data.role == 'owner'
        && request.resource.contentType == 'application/pdf'
        && request.resource.size < 100 * 1024 * 1024;
    }

    // Prop photos --- owners can upload images up to 10MB
    match /productions/{productionId}/props/{allPaths=**} {
      allow read: if request.auth != null
        && firestore.exists(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid));
      allow write: if request.auth != null
        && firestore.get(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid)).data.role == 'owner'
        && request.resource.contentType.matches('image/.*')
        && request.resource.size < 10 * 1024 * 1024;
    }

    // Diagrams --- owners can upload images up to 20MB
    match /diagrams/{productionId}/{allPaths=**} {
      allow read: if request.auth != null
        && firestore.exists(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid));
      allow write: if request.auth != null
        && firestore.get(/databases/(default)/documents/productions/$(productionId)/members/$(request.auth.uid)).data.role == 'owner'
        && request.resource.contentType.matches('image/.*')
        && request.resource.size < 20 * 1024 * 1024;
    }`,
  'Fix 5 [STG-001]: Add storage rules for prop photos and diagrams'
);


// ═════════════════════════════════════════════════════════════
// PRIORITY 1: HIGH SEVERITY FIXES
// ═════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║  PRIORITY 1: HIGH SEVERITY FIXES             ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── Fix 6: Ensure PDF navigation works after run ends [PDF-001] ──
// After ending run, clear render task and re-render page for clean navigation
console.log('Fix 6: PDF navigation after run ends [PDF-001]');
strReplace(
  'src/runshow/Runshow.js',
  // old_str
  `      await endRunSession(scratchText);
      // Hide FAB
      const fab = document.getElementById('run-show-fab');
      if (fab) fab.classList.add('hidden');
      renderRunShowControls();
      if (sid) await generateRunReport(sid);
      toast('Run session ended.', 'success');`,
  // new_str
  `      await endRunSession(scratchText);
      // Hide FAB
      const fab = document.getElementById('run-show-fab');
      if (fab) fab.classList.add('hidden');
      renderRunShowControls();
      // Re-render current page to clear stale overlay and ensure navigation works
      if (rsPdfDoc) {
        rsCurrentRenderTask = null; // Clear any stale render reference
        await rsRenderPage(rsCurrentPage);
      }
      if (sid) await generateRunReport(sid);
      toast('Run session ended.', 'success');`,
  'Fix 6 [PDF-001]: Re-render page after ending run for clean navigation'
);

// ── Fix 7: Update all title DOM elements when title changes [ST-001] ──
// settings.js updates #app-prod-title and #ln-show-name but NOT #rs-show-name
console.log('\nFix 7: Update all title DOM elements [ST-001]');
strReplace(
  'src/settings/settings.js',
  // old_str
  `        state.activeProduction.title = val;
        document.getElementById('app-prod-title').textContent = val;
        const ln = document.getElementById('ln-show-name');
        if (ln) ln.textContent = val;
        toast('Title updated.', 'success');`,
  // new_str
  `        state.activeProduction.title = val;
        document.getElementById('app-prod-title').textContent = val;
        const ln = document.getElementById('ln-show-name');
        if (ln) ln.textContent = val;
        const rs = document.getElementById('rs-show-name');
        if (rs) rs.textContent = val;
        toast('Title updated.', 'success');`,
  'Fix 7 [ST-001]: Also update #rs-show-name when title changes in Settings'
);

// ── Fix 8: Copy scriptPageStart fields in openProduction() [ST-002] ──
// openProduction() only copies a subset of production fields
console.log('\nFix 8: Copy scriptPageStart fields in openProduction() [ST-002]');
strReplace(
  'src/dashboard/dashboard.js',
  // old_str
  `  state.activeProduction = {
    id,
    title: prod.title,
    scriptPath: prod.scriptPath || null,
    scriptPageCount: prod.scriptPageCount || null,
    joinCode: prod.joinCode || '',
    joinCodeActive: prod.joinCodeActive !== false,
    createdBy: prod.createdBy || '',
  };`,
  // new_str
  `  state.activeProduction = {
    id,
    title: prod.title,
    scriptPath: prod.scriptPath || null,
    scriptPageCount: prod.scriptPageCount || null,
    joinCode: prod.joinCode || '',
    joinCodeActive: prod.joinCodeActive !== false,
    createdBy: prod.createdBy || '',
    scriptPageStartPage: prod.scriptPageStartPage || 1,
    scriptPageStartHalf: prod.scriptPageStartHalf || '',
  };`,
  'Fix 8 [ST-002]: Include scriptPageStart fields when opening a production'
);

// ── Fix 9: Notify Run Show when props change [PR-001] ──
// Props changes should trigger a stage columns update in Run Show
console.log('\nFix 9: Notify Run Show when props change [PR-001]');
strReplace(
  'src/props/props.js',
  // old_str
  `  const unsubProps = onSnapshot(collection(db, 'productions', pid, 'props'), snap => {
    props = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderContent();
  });`,
  // new_str
  `  const unsubProps = onSnapshot(collection(db, 'productions', pid, 'props'), snap => {
    props = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderContent();
    _notifyRunShow(); // Ensure Run Show stage columns update when props change
  });`,
  'Fix 9 [PR-001]: Notify Run Show when props change to update stage columns'
);

// ── Fix 10: Preserve scratchpad on renderRunShowControls() [UX-002] ──
// Save the current scratchpad value to state before rebuilding the controls panel HTML
console.log('\nFix 10: Preserve scratchpad on controls rebuild [UX-002]');
strReplace(
  'src/runshow/Runshow.js',
  // old_str
  `function renderRunShowControls() {
  const container = document.getElementById('rs-controls');
  if (!container) return;

  const session = state.runSession;`,
  // new_str
  `function renderRunShowControls() {
  const container = document.getElementById('rs-controls');
  if (!container) return;

  // Preserve scratchpad text before rebuilding DOM
  const existingScratchpad = document.getElementById('rs-scratchpad');
  if (existingScratchpad && state.runSession) {
    state.runSession.scratchpad = existingScratchpad.value;
  }

  const session = state.runSession;`,
  'Fix 10 [UX-002]: Save scratchpad text to state before rebuilding controls panel'
);


// ═════════════════════════════════════════════════════════════
// PRIORITY 2: MEDIUM SEVERITY FIXES
// ═════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║  PRIORITY 2: MEDIUM SEVERITY FIXES            ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── Fix 11: Block keyboard nav when modals are open [UX-004] ──
// Add modal-open check to the local renderStageColumnsHtml keyboard handler in Runshow.js
// This fix targets the keyboard handler; we inject the modal check into
// the rsSubscribeToNotes area's keyboard event listener (the FAB popover keydown).
// The guide says to add the check AFTER tab-active / input checks, BEFORE nav logic.
// We'll apply it to the Runshow.js keyboard handler for arrow key navigation.
console.log('Fix 11: Block keyboard nav when modals are open [UX-004]');

// The keyboard handler in Runshow.js is in the initRunShow function.
// We need to find the keydown handler and add the modal check.
// Based on the project knowledge, the FAB popover keydown is already handled.
// The main page navigation keyboard handler needs the modal guard.
// Let's search for it more specifically.
{
  const runshowPath = path.join(PROJECT_ROOT, 'src/runshow/Runshow.js');
  if (fs.existsSync(runshowPath)) {
    let content = fs.readFileSync(runshowPath, 'utf-8');

    // Find the main keydown handler for page navigation (ArrowLeft/ArrowRight)
    // The pattern we're looking for is a keydown listener that handles arrow keys
    // for page navigation. We'll add the modal guard right after the input/textarea check.
    const modalGuard = `    // Fix 11 [UX-004]: Block keyboard nav when modals are open
    if (document.querySelector('.modal-backdrop, .cast-modal.open, [class*="modal"].open, .prop-notes-modal, .prop-photo-lightbox')) return;`;

    // Look for the pattern where arrow key handling starts after input check
    // Typical pattern: if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Then arrow key handling follows.
    const inputCheckPattern = `if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;`;
    const inputCheckAlt = `if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;`;

    let applied = false;
    for (const pattern of [inputCheckPattern, inputCheckAlt]) {
      if (content.includes(pattern) && !content.includes('Fix 11 [UX-004]')) {
        // Find ALL occurrences and add the modal guard after each one
        content = content.replace(
          new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          pattern + '\n' + modalGuard
        );
        applied = true;
        break;
      }
    }

    if (applied) {
      if (DRY_RUN) {
        console.log('  ✓ [DRY RUN] Would apply: Fix 11 [UX-004]: Modal guard on keyboard nav');
      } else {
        fs.writeFileSync(runshowPath, content, 'utf-8');
        console.log('  ✓ Applied: Fix 11 [UX-004]: Modal guard on keyboard nav');
      }
      results.push({ label: 'Fix 11 [UX-004]', status: DRY_RUN ? 'WOULD_APPLY' : 'APPLIED', file: 'src/runshow/Runshow.js' });
      totalApplied++;
    } else if (content.includes('Fix 11 [UX-004]')) {
      console.log('  ⊘ Already applied: Fix 11 [UX-004]');
      results.push({ label: 'Fix 11 [UX-004]', status: 'ALREADY_APPLIED', file: 'src/runshow/Runshow.js' });
      totalApplied++;
    } else {
      console.error('  ✗ Could not locate keyboard handler input check in Runshow.js for Fix 11');
      console.error('    Please manually add modal guard to keyboard event handlers');
      results.push({ label: 'Fix 11 [UX-004]', status: 'MANUAL_REQUIRED', file: 'src/runshow/Runshow.js' });
      totalFailed++;
    }
  } else {
    console.error('  ✗ FILE NOT FOUND: src/runshow/Runshow.js');
    results.push({ label: 'Fix 11 [UX-004]', status: 'FILE_NOT_FOUND', file: 'src/runshow/Runshow.js' });
    totalFailed++;
  }
}

// ── Fix 12: Normalize location strings in stage columns [PR-003] ──
// Replace the column assignment logic in Runshow.js's local renderStageColumnsHtml
console.log('\nFix 12: Normalize location strings in stage columns [PR-003]');
strReplace(
  'src/runshow/Runshow.js',
  // old_str — the local renderStageColumnsHtml's column assignment
  `    const item = { prop: p, ...r, warn };
    if (r.status === 'ON') onProps.push(item);
    else if (r.location === 'SL') slProps.push(item);
    else srProps.push(item);`,
  // new_str — normalize location before assigning to columns
  `    const item = { prop: p, ...r, warn };
    const loc = (r.location || '').toUpperCase().replace('STAGE LEFT','SL').replace('STAGE RIGHT','SR').replace('ON STAGE','ON').replace('ONSTAGE','ON');
    if (r.status === 'ON') onProps.push(item);
    else if (loc === 'SL') slProps.push(item);
    else if (loc === 'SR') srProps.push(item);
    else slProps.push(item); // Default unknown locations to SL`,
  'Fix 12 [PR-003]: Normalize SL/SR/ON location aliases in stage columns'
);

// ── Fix 13: Skip re-render when editing a prop [DB-003] ──
// Guard against re-rendering the manage tab when a prop is actively being edited
console.log('\nFix 13: Skip re-render when editing a prop [DB-003]');
strReplace(
  'src/props/props.js',
  // old_str
  `function renderContent() {
  if (!document.getElementById('tab-props')?.classList.contains('tab-panel--active')) return;
  switch (activeTab) {
    case 'manage': renderManageTab(); break;
    case 'view': renderViewTab(); break;
    case 'check': renderCheckTab(); break;
  }
}`,
  // new_str
  `function renderContent() {
  if (!document.getElementById('tab-props')?.classList.contains('tab-panel--active')) return;
  // Skip manage tab re-render if user is actively editing a prop (prevents input loss)
  if (activeTab === 'manage' && editingPropId) return;
  switch (activeTab) {
    case 'manage': renderManageTab(); break;
    case 'view': renderViewTab(); break;
    case 'check': renderCheckTab(); break;
  }
}`,
  'Fix 13 [DB-003]: Skip manage tab re-render when actively editing a prop'
);


// ═════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║  MIGRATION SUMMARY                           ║');
console.log('╚══════════════════════════════════════════════╝\n');

if (DRY_RUN) {
  console.log('  🔍 DRY RUN — no files were modified\n');
}

console.log(`  Applied:  ${totalApplied} / ${totalApplied + totalFailed}`);
console.log(`  Failed:   ${totalFailed} / ${totalApplied + totalFailed}`);
console.log('');

if (totalFailed > 0) {
  console.log('  ⚠ Failed fixes:\n');
  results.filter(r => ['NOT_FOUND', 'FILE_NOT_FOUND', 'MANUAL_REQUIRED'].includes(r.status)).forEach(r => {
    console.log(`    • ${r.label}`);
    console.log(`      Status: ${r.status} | File: ${r.file}`);
  });
  console.log('');
}

console.log('  Detailed results:\n');
results.forEach((r, i) => {
  const icon = ['APPLIED', 'APPLIED_TRIMMED', 'WOULD_APPLY', 'ALREADY_APPLIED'].includes(r.status) ? '✓' : '✗';
  console.log(`    ${icon} ${r.label} → ${r.status}`);
});

console.log('\n─────────────────────────────────────────────────');
console.log('  Next steps:');
console.log('  1. Run: npm run build');
console.log('  2. Verify no import/syntax errors');
console.log('  3. Deploy updated firestore.rules and storage.rules');
console.log('  4. Run the test verification checklists from the guide');
console.log('─────────────────────────────────────────────────\n');

process.exit(totalFailed > 0 ? 1 : 0);
