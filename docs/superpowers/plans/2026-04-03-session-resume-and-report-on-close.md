# Session Resume & Report on Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow ended run sessions to be resumed, and automatically save a report when the page is closed or reloaded mid-run.

**Architecture:** Two independent features share infrastructure. The recovery detection code already exists in `session-sync.js` but is never called — wiring it up handles the close/reload case. Resume of ended sessions adds a "Resume" button to the reports history list and re-activates the session in Firestore + client state. A `pagehide` listener ensures the latest live state is flushed to Firestore before the page unloads, so the recovery dialog always has fresh data to work with.

**Tech Stack:** Vanilla ES modules, Firestore (Firebase JS SDK v9+), no framework.

---

## File Map

| File | Changes |
|------|---------|
| `src/shared/session-sync.js` | Add "Generate Report" button to recovery dialog; export `registerUnloadSync()` |
| `src/runshow/Runshow.js` | Wire up recovery detection in `onRunShowTabActivated`; add `rsCheckForActiveSession()`; add resume button + `rsResumeEndedSession()` in reports history; call `registerUnloadSync()` in `initRunShow()` |

---

## Task 1: Add "Generate Report" option to recovery dialog

**Files:**
- Modify: `src/shared/session-sync.js`

Currently `showRecoveryDialog` only offers Resume and Discard. We need a third option so that when a session was interrupted (page closed/reloaded mid-run), the user can generate the report from the last synced state without resuming.

- [ ] **Step 1: Replace the dialog HTML and resolve logic in `showRecoveryDialog`**

Find the current function (lines 69–90 in `session-sync.js`). Replace it entirely:

```js
export function showRecoveryDialog(sessionData) {
  return new Promise(resolve => {
    const title = sessionData.title || 'Untitled Session';
    const bd = document.createElement('div');
    bd.style.cssText = 'position:fixed;inset:0;z-index:var(--z-modal);background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
    bd.innerHTML = `<div style="background:var(--bg-card);border:1px solid var(--bg-border);border-radius:12px;padding:24px;width:460px;max-width:90vw;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.5);">
      <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
      <h2 style="font-size:18px;color:var(--text-primary);margin-bottom:8px;">Session Interrupted</h2>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">
        You have an active session <strong>"${title}"</strong> that was interrupted.<br/>What would you like to do?
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button id="_rec_discard" style="padding:8px 20px;background:none;border:1px solid var(--bg-border);color:var(--text-secondary);border-radius:6px;font-size:13px;cursor:pointer;">Discard</button>
        <button id="_rec_generate" style="padding:8px 20px;background:none;border:1px solid var(--gold);color:var(--gold);border-radius:6px;font-size:13px;cursor:pointer;">Generate Report</button>
        <button id="_rec_resume" style="padding:8px 20px;background:var(--gold);border:none;color:var(--bg-deep);border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Resume Session</button>
      </div>
    </div>`;
    document.body.appendChild(bd);
    bd.querySelector('#_rec_resume').onclick   = () => { bd.remove(); resolve('resume'); };
    bd.querySelector('#_rec_generate').onclick = () => { bd.remove(); resolve('generate'); };
    bd.querySelector('#_rec_discard').onclick  = () => { bd.remove(); resolve('discard'); };
    bd.addEventListener('click', e => { if (e.target === bd) { bd.remove(); resolve('discard'); } });
  });
}
```

- [ ] **Step 2: Verify manually** — No automated tests. Open the app with an active session in Firestore (you can set `status: 'active'` on a session doc manually in the Firebase console), reload the page, and confirm three buttons appear.

---

## Task 2: Export `registerUnloadSync` from `session-sync.js`

**Files:**
- Modify: `src/shared/session-sync.js`

On `pagehide` (fires reliably for tab close, navigation, and reload — more reliable than `beforeunload`), flush live session state to Firestore. This is best-effort; Firestore SDK writes may or may not complete before the process exits, but it dramatically improves the odds that the recovery dialog has fresh data.

- [ ] **Step 1: Add `registerUnloadSync` export at the bottom of `session-sync.js`** (after `hideHeartbeat`)

```js
let _unloadRegistered = false;
export function registerUnloadSync() {
  if (_unloadRegistered) return;
  _unloadRegistered = true;
  window.addEventListener('pagehide', () => {
    if (state.runSession) syncSessionToFirestore();
  });
}
```

- [ ] **Step 2: Verify** — Add a `console.log('pagehide fired')` inside the listener temporarily, start a run, close and reopen the tab, confirm it fired (check the Firebase console to see `lastSyncTimestamp` updated). Remove the log before committing.

- [ ] **Step 3: Commit**

```bash
git add src/shared/session-sync.js
git commit -m "feat: add Generate Report option to recovery dialog; add registerUnloadSync"
```

---

## Task 3: Wire up crash recovery in `onRunShowTabActivated`

**Files:**
- Modify: `src/runshow/Runshow.js`

The recovery functions (`detectActiveSession`, `showRecoveryDialog`, `hydrateSessionFromFirestore`, `abandonSession`) are imported but never called. Wire them up.

- [ ] **Step 1: Add `registerUnloadSync` to the import from `session-sync.js`**

Find line 31 in `Runshow.js`:

```js
import { detectActiveSession, showRecoveryDialog, hydrateSessionFromFirestore, abandonSession, startSessionSync, syncSessionToFirestore } from '../shared/session-sync.js';
```

Replace with:

```js
import { detectActiveSession, showRecoveryDialog, hydrateSessionFromFirestore, abandonSession, startSessionSync, syncSessionToFirestore, registerUnloadSync } from '../shared/session-sync.js';
```

- [ ] **Step 2: Call `registerUnloadSync()` in `initRunShow()`**

Find the end of `initRunShow()` (around line 470, just before the closing `}`). Add:

```js
  registerUnloadSync();
```

- [ ] **Step 3: Add `rsCheckForActiveSession()` function**

Add this new function anywhere before `onRunShowTabActivated` (e.g., just before it):

```js
async function rsCheckForActiveSession() {
  const pid = state.activeProduction?.id;
  if (!pid) return;
  const activeSession = await detectActiveSession(pid);
  if (!activeSession) return;

  const choice = await showRecoveryDialog(activeSession);

  if (choice === 'resume') {
    hydrateSessionFromFirestore(activeSession);
    startSessionSync();
    rsLastSessionId = activeSession.id;
    rsNotes = [];
    rsSubscribeToNotes();
    const fab = document.getElementById('run-show-fab');
    if (fab) fab.classList.remove('hidden');
    renderRunShowControls();
    rsStartClock();
    toast('Session resumed.', 'success');

  } else if (choice === 'generate') {
    const sid = activeSession.id;
    hydrateSessionFromFirestore(activeSession);
    rsLastSessionId = sid;
    try {
      await endRunSession(activeSession.liveScratchpad || '');
      renderRunShowControls();
      await generateRunReport(sid);
      loadReportsHistory();
      toast('Run report generated.', 'success');
    } catch (e) {
      console.error('Generate report error:', e);
      toast('Failed to generate report.', 'error');
    }

  } else { // 'discard'
    await abandonSession(pid, activeSession.id);
    toast('Session discarded.', 'info');
  }
}
```

- [ ] **Step 4: Call `rsCheckForActiveSession()` in `onRunShowTabActivated`**

Find the section after `renderRunShowTab()` is called (around line 495–499):

```js
  renderRunShowTab();
  rsLoadBookmarks();
  rsUpdateBookmarksBtn();
  if (state.runSession) rsStartClock();
  document.getElementById('rs-canvas-area')?.focus({ preventScroll: true });
```

Replace with:

```js
  renderRunShowTab();
  rsLoadBookmarks();
  rsUpdateBookmarksBtn();
  if (state.runSession) {
    rsStartClock();
  } else {
    await rsCheckForActiveSession();
    if (state.runSession) rsStartClock();
  }
  document.getElementById('rs-canvas-area')?.focus({ preventScroll: true });
```

- [ ] **Step 5: Test the three paths manually**

Set up a session doc in Firestore with `status: 'active'` and valid `liveCurrentPage`, `liveHoldLog`, `liveScratchpad` fields. Reload the page and verify:
- "Resume Session" → runshow switches to active mode, clock ticks, notes load
- "Generate Report" → report modal opens, session marked `ended` in Firestore
- "Discard" → session marked `abandoned` in Firestore, idle mode shown

- [ ] **Step 6: Commit**

```bash
git add src/runshow/Runshow.js
git commit -m "feat: wire up crash recovery — detect interrupted sessions on tab activation"
```

---

## Task 4: Add "Resume" button to ended sessions in reports history

**Files:**
- Modify: `src/runshow/Runshow.js`

Currently `loadReportsHistory()` renders rows with View, Edit Times, and Delete buttons. Add a Resume button visible only to the session creator or an owner.

- [ ] **Step 1: Update the row HTML in `loadReportsHistory()`**

Find the template literal inside `sessions.map(s => { ... })` (around line 2860). The current last line of the inner HTML is:

```js
            ${owner ? `<button class="settings-btn settings-btn--danger rs-delete-report" data-id="${escapeHtml(s.id)}">Delete</button>` : ''}
```

Add the Resume button just before the Delete button:

```js
            ${(s.createdBy === state.currentUser?.uid || owner) ? `<button class="settings-btn rs-resume-session" data-id="${escapeHtml(s.id)}">Resume</button>` : ''}
            ${owner ? `<button class="settings-btn settings-btn--danger rs-delete-report" data-id="${escapeHtml(s.id)}">Delete</button>` : ''}
```

- [ ] **Step 2: Wire up click listeners for `.rs-resume-session` buttons**

Find the block in `loadReportsHistory()` that wires up `.rs-edit-times` and `.rs-delete-report` listeners (around line 2887). After the `if (owner)` block that handles those, add:

```js
    container.querySelectorAll('.rs-resume-session').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const sid = btn.dataset.id;
        const session = sessions.find(s => s.id === sid);
        if (!session) return;
        await rsResumeEndedSession(session);
      });
    });
```

- [ ] **Step 3: Verify** — Load the reports history with at least one ended session. Confirm the Resume button appears on sessions you created (or all sessions if you are the owner).

---

## Task 5: Implement `rsResumeEndedSession`

**Files:**
- Modify: `src/runshow/Runshow.js`

- [ ] **Step 1: Add the function**

Add this function immediately after `openEndRunModal()` closes (around line 2404, before the `generateRunReport` function):

```js
/* ═══════════════════════════════════════════════════════════
   SESSION LIFECYCLE — RESUME ENDED SESSION
   ═══════════════════════════════════════════════════════════ */
async function rsResumeEndedSession(session) {
  if (state.runSession) {
    toast('A run session is already active.', 'error');
    return;
  }
  if (!confirmDialog(`Resume "${session.title || 'this session'}"? New notes will be added to the existing session and the report will be regenerated when you end it.`)) return;

  const pid = state.activeProduction.id;
  const sid = session.id;

  try {
    // Re-activate in Firestore
    await updateDoc(doc(db, 'productions', pid, 'sessions', sid), {
      status: 'active',
      endedAt: null,
    });

    // Hydrate client state
    hydrateSessionFromFirestore(session);

    // Adjust startedAt so the clock resumes from the previous elapsed time.
    // durationSeconds is net of holds, so: startedAt = now - durationSeconds*1000 - totalHoldMs
    const previousHoldMs = (session.holdLog || []).reduce((s, h) => s + (h.durationSeconds || 0) * 1000, 0);
    state.runSession.startedAt = Date.now() - (session.durationSeconds || 0) * 1000 - previousHoldMs;

    startSessionSync();
    rsLastSessionId = sid;
    rsNotes = [];
    rsSubscribeToNotes();
    const fab = document.getElementById('run-show-fab');
    if (fab) fab.classList.remove('hidden');
    renderRunShowControls();
    rsStartClock();
    toast('Session resumed.', 'success');
  } catch (e) {
    console.error('Resume session error:', e);
    toast('Failed to resume session.', 'error');
  }
}
```

- [ ] **Step 2: Verify clock continuity**

Resume a session that had e.g. 10 minutes of run time. Confirm the clock shows 10:xx and ticks forward (not 0:00). Confirm it does not show an inflated value that double-counts previous holds.

- [ ] **Step 3: End the resumed session and verify report**

After resuming, click "End Run". Confirm:
- Report generates correctly
- `durationSeconds` in Firestore = original net run time + new run time
- Notes from both the original and resumed session appear in the report

- [ ] **Step 4: Commit**

```bash
git add src/runshow/Runshow.js
git commit -m "feat: resume ended sessions from reports history; restore clock from prior elapsed time"
```

---

## Task 6: Smoke test end-to-end flows

No automated tests exist. Manually verify each scenario:

- [ ] **Scenario A — Reload mid-run → Generate Report**
  1. Start a run, add a note
  2. Reload the page
  3. Recovery dialog appears with three buttons
  4. Click "Generate Report"
  5. Report modal opens with notes; session marked `ended` in Firestore

- [ ] **Scenario B — Reload mid-run → Resume**
  1. Start a run, advance to page 5, add a note
  2. Reload the page
  3. Click "Resume Session"
  4. Runshow is in active mode, clock ticking, page shows last synced page, notes visible
  5. End the run — report generates correctly

- [ ] **Scenario C — Reload mid-run → Discard**
  1. Start a run
  2. Reload the page
  3. Click "Discard"
  4. Idle mode shown; session doc has `status: 'abandoned'` in Firestore

- [ ] **Scenario D — Resume from reports history**
  1. End a run normally (report generates)
  2. From idle mode, click "Resume" on the report row
  3. Confirm dialog appears; click OK
  4. Runshow enters active mode; clock shows prior elapsed time
  5. Add a new note; end run
  6. New report includes original notes + new note

- [ ] **Final commit if all passes**

```bash
git add src/shared/session-sync.js src/runshow/Runshow.js
git commit -m "chore: smoke-test verified session resume and report-on-close features"
```

---

## Self-Review

**Spec coverage:**
- ✅ Resume an ended session → Task 4 + 5
- ✅ Generate report on reload → Task 1 + 3
- ✅ Best-effort flush on page close → Task 2
- ✅ Clock resumes from correct elapsed time → Task 5, Step 1 (startedAt math)
- ✅ Notes from resumed session appear in new report → existing `generateRunReport` reads all `lineNotes` with matching `sessionId`

**Placeholder scan:** No TBDs, no vague instructions — all code shown explicitly.

**Type/name consistency:**
- `rsResumeEndedSession` — used in Task 4 (listener) and defined in Task 5 ✅
- `rsCheckForActiveSession` — defined in Task 3 Step 3 and called in Step 4 ✅
- `registerUnloadSync` — exported in Task 2, imported + called in Task 3 Step 1–2 ✅
- `showRecoveryDialog` returns `'resume' | 'generate' | 'discard'` — all three handled in `rsCheckForActiveSession` ✅
- `hydrateSessionFromFirestore(session)` — `session` in both recovery and resume contexts is a Firestore doc shaped `{ id, title, liveCurrentPage, liveHoldLog, liveScratchpad, startedAt, holdLog, pageLog, createdBy }` ✅

**Edge cases addressed:**
- Resume blocked if a session is already active (Task 5 Step 1 guard)
- Firestore security: `updateDoc` on `status: 'active'` will throw if user is not creator or owner; caught and surfaced via toast
- `endRunSession` called during 'generate' path: it calls `_notifyRunShow()` which is currently a no-op (never wired up), so `renderRunShowControls()` is called explicitly after it returns ✅
