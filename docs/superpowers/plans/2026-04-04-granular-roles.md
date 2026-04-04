    # Granular Roles & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary owner/member system with 7 named roles, per-member permission overrides, and three custom dashboards (Actor, Director, Costume Designer).

**Architecture:** Foundation-first — rewrite `roles.js` and populate `state.permissions` at production-open time, then migrate all `isOwner()` call sites to `can()`, then add UI: settings member management, tab visibility gating, and the three new dashboard modules.

**Tech Stack:** Vanilla ES modules, Firestore (modular SDK v9), Firebase Auth. No test runner — verification steps are manual browser checks.

**Spec:** `docs/superpowers/specs/2026-04-04-granular-roles-design.md`

---

## File Map

### Modified
- `src/shared/roles.js` — Full rewrite: ROLE_PERMISSIONS constant, `computePermissions()`, `can()`, backwards-compat aliases
- `src/shared/state.js` — Add `permissions: {}` and `castLinkId: null` fields
- `src/shared/tabs.js` — `applyPermissionedTabVisibility()`, dashboard tab injection, route map additions
- `src/dashboard/dashboard.js` — Read `permissionOverrides`/`castLinkId` from member doc; call `computePermissions`; navigate to dashboard on open
- `src/settings/settings.js` — Replace promote/demote buttons with role dropdown + cast link + override panel
- `src/tracking/tracking-tab.js` — Subtab visibility based on permissions
- `src/tracking/actors.js` — `isOwner()` → `can('canManageActorCues')`
- `src/tracking/costumes.js` — `isOwner()` → `can('canManageCostumes')`
- `src/props/props.js` — `isOwner()` → `can('canManageProps')` (10 call sites)
- `src/cast/cast.js` — `isOwner()` → `can('canManageCast')`
- `src/linenotes/linenotes.js` — `isOwner()` → `can('canEditZones')` / `can('canUploadScript')`
- `src/runshow/Runshow.js` — Session controls gated by `can('canRunSession')`; FAB/note-taking by `can('canTakeLineNotes')`
- `firestore.rules` — Role-based write permissions for props, propNotes, actorCues, costumes
- `index.html` — Add three new `tab-panel` divs for dashboards

### New
- `src/actor/actor-dashboard.js` — Actor "My Show" dashboard (3 tabs: Live, My Notes, Stats)
- `src/actor/actor-dashboard.css` — Mobile-first styles
- `src/director/director-dashboard.js` — Director analytics dashboard (4 tabs)
- `src/director/director-dashboard.css` — Director dashboard styles
- `src/costume-designer/costumer-dashboard.js` — Costume Designer quick-change dashboard (3 tabs)
- `src/costume-designer/costumer-dashboard.css` — Costumer dashboard styles

---

## Task 1: Rewrite `src/shared/roles.js`

**Files:**
- Modify: `src/shared/roles.js`

- [ ] **Replace the entire file contents:**

```javascript
// src/shared/roles.js
import { state } from './state.js';

// Missing flags are implicitly false — can() uses !!state.permissions?.[flag]
const ROLE_PERMISSIONS = {
  owner: {
    canRunSession: true, canTakeLineNotes: true, canManageProps: true,
    canManageActorCues: true, canManageCostumes: true, canManageCast: true,
    canEditZones: true, canUploadScript: true, canEditSettings: true,
    hasRunshowAccess: true, hasPropsAccess: true, hasTrackingAccess: true,
    hasLinenotesAccess: true, hasCastAccess: true, hasSettingsAccess: true,
    dashboard: null,
  },
  asm: {
    canRunSession: true, canTakeLineNotes: true, canManageProps: true,
    canManageActorCues: true, canManageCostumes: true,
    hasRunshowAccess: true, hasPropsAccess: true, hasTrackingAccess: true,
    hasLinenotesAccess: true, hasCastAccess: true, hasSettingsAccess: true,
    dashboard: null,
  },
  director:           { hasCastAccess: true, dashboard: 'director' },
  actor:              { dashboard: 'actor' },
  'costume-designer': { canManageCostumes: true, hasTrackingAccess: true, dashboard: 'costumer' },
  'props-master':     { canManageProps: true, hasPropsAccess: true, dashboard: null },
  crew:               { hasTrackingAccess: true, dashboard: null },
  member: {
    canTakeLineNotes: true, hasRunshowAccess: true, hasPropsAccess: true,
    hasTrackingAccess: true, hasLinenotesAccess: true, hasCastAccess: true,
    hasSettingsAccess: true, dashboard: null,
  },
};

export function computePermissions(role, overrides = {}) {
  const base = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['member'];
  return { ...base, ...overrides };
}

export const isOwner    = () => state.activeRole === 'owner' || state.isSuperAdmin;
export const isMember   = () => !!state.activeRole;
export const can        = (flag) => !!state.permissions?.[flag] || state.isSuperAdmin;

// Backwards-compatible aliases — existing call sites continue to work
export const canEditProps    = () => can('canManageProps');
export const canEditZones    = () => can('canEditZones');
export const canUploadScript = () => can('canUploadScript');
```

- [ ] **Verify:** Run `npm run dev`. Open the app, log in, open a production as owner. No console errors. All tabs still visible for owner.

- [ ] **Commit:**
```bash
git add src/shared/roles.js
git commit -m "feat: rewrite roles.js with ROLE_PERMISSIONS, computePermissions, can()"
```

---

## Task 2: Add `permissions` and `castLinkId` to state; populate at production-open

**Files:**
- Modify: `src/shared/state.js` (add 2 fields)
- Modify: `src/dashboard/dashboard.js` (~line 93 and ~line 130-145)

- [ ] **In `src/shared/state.js`, add two fields after `activeRole: null`:**

```javascript
export const state = {
  currentUser: null,
  isSuperAdmin: false,
  activeProduction: null,
  activeRole: null,
  permissions: {},      // ← ADD: computed from role + overrides at production-open time
  castLinkId: null,     // ← ADD: links this user to a cast/{castId} doc (actor/costumer roles)
  unsubscribers: [],
  runSession: null,
  // ... rest unchanged
};
```

Also add cleanup of these two fields in `backToDashboard()` in `src/dashboard/dashboard.js` (~line 157):

```javascript
state.activeProduction = null;
state.activeRole = null;
state.permissions = {};    // ← ADD
state.castLinkId = null;   // ← ADD
state.runSession = null;
```

- [ ] **In `src/dashboard/dashboard.js`, read `permissionOverrides` and `castLinkId` from the member doc.**

Find the section around line 93 where `role` is read from `memberDoc.data()`:

```javascript
const role = memberDoc.data().role || 'member';
```

Change it to:

```javascript
const role = memberDoc.data().role || 'member';
const permissionOverrides = memberDoc.data().permissionOverrides || {};
const castLinkId = memberDoc.data().castLinkId || null;
```

Then find the call to `openProduction` (around line 115-116):

```javascript
card.querySelector('.open-btn').addEventListener('click', () => {
  openProduction(prodSnap.id, prod, role);
});
```

Change to:

```javascript
card.querySelector('.open-btn').addEventListener('click', () => {
  openProduction(prodSnap.id, prod, role, permissionOverrides, castLinkId);
});
```

- [ ] **Update the `openProduction` function signature and body (~line 130):**

```javascript
async function openProduction(id, prod, role, permissionOverrides = {}, castLinkId = null) {
  cleanup();
  state.activeProduction = {
    id,
    title: prod.title,
    scriptPath: prod.scriptPath || null,
    scriptPageCount: prod.scriptPageCount || null,
    joinCode: prod.joinCode || '',
    joinCodeActive: prod.joinCodeActive !== false,
    createdBy: prod.createdBy || '',
    scriptPageStartPage: prod.scriptPageStartPage || 1,
    scriptPageStartHalf: prod.scriptPageStartHalf || '',
  };
  state.activeRole = (state.isSuperAdmin) ? 'owner' : role;
  state.permissions = computePermissions(state.activeRole, state.isSuperAdmin ? {} : permissionOverrides);  // ← ADD
  state.castLinkId = castLinkId;   // ← ADD
  hideDashboard();
  showApp();
}
```

Add the import of `computePermissions` at the top of `dashboard.js` (it already imports from roles.js — add to the existing import):

```javascript
import { isOwner, computePermissions } from '../shared/roles.js';
```

- [ ] **Verify:** Log in, open a production as owner. In browser console: `console.log(window.state?.permissions)` (or add a temporary `window._state = state` import in main.js). Confirm `state.permissions` has `canRunSession: true` etc. for owner role.

- [ ] **Commit:**
```bash
git add src/shared/state.js src/dashboard/dashboard.js
git commit -m "feat: populate state.permissions and castLinkId at production-open"
```

---

## Task 3: Migrate `props.js` — `isOwner()` → `can('canManageProps')`

**Files:**
- Modify: `src/props/props.js`

Add `can` to the import at the top (line 3):

```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Make the following replacements (use exact line context to find each):**

**Line 163** — tab click guard:
```javascript
// BEFORE:
if (tabName === 'manage' && !isOwner()) {
// AFTER:
if (tabName === 'manage' && !can('canManageProps')) {
```

**Line 178** — hide manage tab:
```javascript
// BEFORE:
if (!isOwner()) {
    manageTab?.classList.add('hidden');
// AFTER:
if (!can('canManageProps')) {
    manageTab?.classList.add('hidden');
```

**Line 209** — default tab:
```javascript
// BEFORE:
setActiveTab(isOwner() ? 'manage' : 'view');
// AFTER:
setActiveTab(can('canManageProps') ? 'manage' : 'view');
```

**Line 262** — render guard:
```javascript
// BEFORE:
if (!isOwner()) { setActiveTab('view'); return; }
// AFTER:
if (!can('canManageProps')) { setActiveTab('view'); return; }
```

**Line 316** — import/export buttons:
```javascript
// BEFORE:
${isOwner() ? '<div style="display:flex;gap:8px;margin-bottom:16px;"><button class="settings-btn" id="props-import-btn">Import JSON</button><button class="settings-btn" id="props-export-btn">Export CSV</button></div>' : ''}
// AFTER:
${can('canManageProps') ? '<div style="display:flex;gap:8px;margin-bottom:16px;"><button class="settings-btn" id="props-import-btn">Import JSON</button><button class="settings-btn" id="props-export-btn">Export CSV</button></div>' : ''}
```

**Line 449** — saveProp guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canManageProps')) return;
```
_(This is inside `async function saveProp()` — find the one in that function context.)_

**Line 539** — deleteProp guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canManageProps')) return;
```
_(This is inside `async function deleteProp(propId)`.)_

**Line 832** — prop notes modal edit flag:
```javascript
// BEFORE:
const canEdit = isOwner();
// AFTER:
const canEdit = can('canManageProps');
```

**Line 866** — save prop notes guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canManageProps')) return;
```

**Line 987** — importPropsJSON guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canManageProps')) return;
```

- [ ] **Verify:** Open app as owner — Props Manage tab still works (add/edit/delete). Open as legacy `member` — Manage tab hidden, View Show accessible.

- [ ] **Commit:**
```bash
git add src/props/props.js
git commit -m "feat: migrate props.js isOwner() to can('canManageProps')"
```

---

## Task 4: Migrate `actors.js`, `costumes.js`, `tracking-tab.js`

**Files:**
- Modify: `src/tracking/actors.js`
- Modify: `src/tracking/costumes.js`
- Modify: `src/tracking/tracking-tab.js`

**`actors.js`** — add `can` to import (line 7):
```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Line 46:**
```javascript
// BEFORE:
const owner = isOwner();
// AFTER:
const owner = can('canManageActorCues');
```

- [ ] **Line 210:**
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canManageActorCues')) return;
```

---

**`costumes.js`** — add `can` to import (line 7):
```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Line 44:**
```javascript
// BEFORE:
const owner = isOwner();
// AFTER:
const owner = can('canManageCostumes');
```

- [ ] **Line 206:**
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canManageCostumes')) return;
```

---

**`tracking-tab.js`** — add `can` to import (line 16):
```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Add a `_applySubtabVisibility()` call inside `onTrackingTabActivated()` (after `_renderOuterTabs()`):**

```javascript
export function onTrackingTabActivated() {
  _applySubtabVisibility();   // ← ADD THIS LINE
  _renderOuterTabs();
  _activateTrackingType(activeTrackingType);
}
```

- [ ] **Add the new `_applySubtabVisibility()` function after `initTrackingTab()`:**

```javascript
function _applySubtabVisibility() {
  const showProps    = can('hasPropsAccess') || can('canManageProps');
  const showActors   = can('hasTrackingAccess');
  const showCostumes = can('hasTrackingAccess') || can('canManageCostumes');

  document.querySelectorAll('.tracking-type-tab').forEach(btn => {
    const type = btn.dataset.trackType;
    if (type === 'props')    btn.style.display = showProps    ? '' : 'none';
    if (type === 'actors')   btn.style.display = showActors   ? '' : 'none';
    if (type === 'costumes') btn.style.display = showCostumes ? '' : 'none';
  });

  // If current active type is now hidden, switch to first visible type
  const firstVisible = showProps ? 'props' : showActors ? 'actors' : showCostumes ? 'costumes' : 'props';
  const activeBtn = document.querySelector(`.tracking-type-tab[data-track-type="${activeTrackingType}"]`);
  if (activeBtn && activeBtn.style.display === 'none') {
    activeTrackingType = firstVisible;
  }
}
```

- [ ] **Verify:** Open as owner — all three tracking subtabs (Props/Actors/Costumes) visible. As member — all still visible (hasTrackingAccess + hasPropsAccess both true).

- [ ] **Commit:**
```bash
git add src/tracking/actors.js src/tracking/costumes.js src/tracking/tracking-tab.js
git commit -m "feat: migrate actors/costumes to can(); add tracking subtab visibility"
```

---

## Task 5: Migrate `cast.js`, `linenotes.js`, `runshow.js`

**Files:**
- Modify: `src/cast/cast.js`
- Modify: `src/linenotes/linenotes.js`
- Modify: `src/runshow/Runshow.js`

**`cast.js`** — add `can` to import:
```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Line 53:**
```javascript
// BEFORE:
const owner = isOwner();
// AFTER:
const owner = can('canManageCast');
```
_(The `owner` variable is used throughout the render function for add/edit/remove controls — all those uses update automatically.)_

---

**`linenotes.js`** — add `can` to import:
```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Line 248** — edit times button:
```javascript
// BEFORE:
if (editTimesBtn) editTimesBtn.style.display = isOwner() ? '' : 'none';
// AFTER:
if (editTimesBtn) editTimesBtn.style.display = can('canEditZones') ? '' : 'none';
```

- [ ] **Line 334** — script upload prompt:
```javascript
// BEFORE:
if (isOwner()) showScriptUploadPrompt();
// AFTER:
if (can('canUploadScript')) showScriptUploadPrompt();
```

- [ ] **Line 351** — save page count:
```javascript
// BEFORE:
if (!state.activeProduction.scriptPageCount && isOwner()) {
// AFTER:
if (!state.activeProduction.scriptPageCount && can('canUploadScript')) {
```

- [ ] **Line 430** — save zones:
```javascript
// BEFORE:
if (isOwner()) firebaseSaveZones(zKey);
// AFTER:
if (can('canEditZones')) firebaseSaveZones(zKey);
```

- [ ] **Line 1336** — firebaseSaveZones guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canEditZones')) return;
```

- [ ] **Line 1447** — place cue guard:
```javascript
// BEFORE:
if (!isOwner()) { toast('Only the owner can add cues.', 'error'); zeCloseCuePopover(); return; }
// AFTER:
if (!can('canEditZones')) { toast('Only editors can add cues.', 'error'); zeCloseCuePopover(); return; }
```

- [ ] **Line 1545** — diagrams panel:
```javascript
// BEFORE:
const owner = isOwner();
// AFTER:
const owner = can('canEditZones');
```

- [ ] **Line 1564** — saveCue guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canEditZones')) return;
```

- [ ] **Line 1620** — deleteCue guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canEditZones')) return;
```

- [ ] **Line 1636** — importCuesJSON guard:
```javascript
// BEFORE:
if (!isOwner()) return;
// AFTER:
if (!can('canEditZones')) return;
```

- [ ] **Line 1681** — diagrams render:
```javascript
// BEFORE:
const owner = isOwner();
// AFTER:
const owner = can('canEditZones');
```

---

**`runshow.js`** — add `can` to import:
```javascript
import { isOwner, can } from '../shared/roles.js';
```

- [ ] **Lines 786 and 1693** — note deletion (keep `isOwner()` — these guard deletion of other users' notes):
```javascript
// No change needed — only owners should delete others' notes
if (note.uid !== state.currentUser.uid && !isOwner()) { ... }
```

- [ ] **Line 1049** — script upload:
```javascript
// BEFORE:
if (isOwner()) rsShowScriptUploadPrompt();
// AFTER:
if (can('canUploadScript')) rsShowScriptUploadPrompt();
```

- [ ] **Line 1083** — save page count:
```javascript
// BEFORE:
if (!state.activeProduction.scriptPageCount && isOwner()) {
// AFTER:
if (!state.activeProduction.scriptPageCount && can('canUploadScript')) {
```

- [ ] **In `renderRunShowControls()` (~line 614), gate the Start Run button and active session controls:**

In the `if (!session)` branch (idle mode), wrap the Start Run button:
```javascript
if (!session) {
  const canRun = can('canRunSession');
  container.innerHTML = `
    <div class="rs-controls-inner">
      ${canRun ? '<button class="rs-start-run-btn" id="rs-start-run-btn">▶ Start Run</button>' : ''}
      <div class="rs-tracking-widget"></div>
      <div class="rs-reports-section" id="rs-reports-section"></div>
    </div>`;
  if (canRun) container.querySelector('#rs-start-run-btn').addEventListener('click', openPreRunModal);
  loadReportsHistory();
```

In the active session branch (`} else {`), gate the FAB and scratchpad access. Find the line `if (fab) fab.classList.remove('hidden');` (~line 656) and change to:
```javascript
if (fab && can('canTakeLineNotes')) fab.classList.remove('hidden');
```

- [ ] **Line 2793** — reports history, split `owner` into two concerns:
```javascript
// BEFORE:
const owner = isOwner();
// AFTER:
const owner = isOwner();
const canRun = can('canRunSession');
```

Then at lines 2808-2810, change the button conditions:
```javascript
// BEFORE:
${owner && s.pageLog?.length > 0 ? `<button ... rs-edit-times ...>Edit Times</button>` : ''}
${(s.createdBy === state.currentUser?.uid || owner) ? `<button ... rs-resume-session ...>Resume</button>` : ''}
${owner ? `<button ... rs-delete-report ...>Delete</button>` : ''}
// AFTER:
${canRun && s.pageLog?.length > 0 ? `<button ... rs-edit-times ...>Edit Times</button>` : ''}
${(s.createdBy === state.currentUser?.uid || canRun) ? `<button ... rs-resume-session ...>Resume</button>` : ''}
${owner ? `<button ... rs-delete-report ...>Delete</button>` : ''}
```

- [ ] **Verify:** As owner — Start Run button visible, session controls work. As legacy member — Start Run button hidden, tracking widget still shows, notes log still visible (canTakeLineNotes=true for member).

- [ ] **Commit:**
```bash
git add src/cast/cast.js src/linenotes/linenotes.js src/runshow/Runshow.js
git commit -m "feat: migrate cast/linenotes/runshow isOwner() calls to can()"
```

---

## Task 6: Update Firestore rules for role-based writes

**Files:**
- Modify: `firestore.rules`

The current rules use `isOwner(productionId)` for writes to props, actorCues, and costumes. ASMs, Props Masters, and Costume Designers also need write access to those collections.

- [ ] **Add a `memberRole()` helper function after the existing `isSuperAdmin()` function:**

```
function memberRole(productionId) {
  return get(/databases/$(database)/documents/productions/$(productionId)/members/$(request.auth.uid)).data.get('role', 'member');
}
```

- [ ] **Update the `/props/{propId}` rule:**
```
match /props/{propId} {
  allow read: if isMember(productionId) || isSuperAdmin();
  allow write: if isOwner(productionId) || isSuperAdmin()
               || memberRole(productionId) in ['asm', 'props-master'];
}
```

- [ ] **Update the `/propNotes/{propId}` rule the same way:**
```
match /propNotes/{propId} {
  allow read: if isMember(productionId) || isSuperAdmin();
  allow write: if isOwner(productionId) || isSuperAdmin()
               || memberRole(productionId) in ['asm', 'props-master'];
}
```

- [ ] **Update the `/actorCues/{docId}` rule:**
```
match /actorCues/{docId} {
  allow read: if isMember(productionId) || isSuperAdmin();
  allow write: if isOwner(productionId) || isSuperAdmin()
               || memberRole(productionId) == 'asm';
}
```

- [ ] **Update the `/costumes/{costumeId}` rule:**
```
match /costumes/{costumeId} {
  allow read: if isMember(productionId) || isSuperAdmin();
  allow write: if isOwner(productionId) || isSuperAdmin()
               || memberRole(productionId) in ['asm', 'costume-designer'];
}
```

- [ ] **Deploy rules:**
```bash
firebase deploy --only firestore:rules
```
Expected output: `✔ Deploy complete!`

- [ ] **Verify:** Manually test via Firebase console or by assigning a test account the `asm` role (next task) and confirming prop edits succeed.

- [ ] **Commit:**
```bash
git add firestore.rules
git commit -m "feat: update Firestore rules for ASM/Props Master/Costume Designer write access"
```

---

## Task 7: Tab visibility gating + dashboard panel shells

**Files:**
- Modify: `src/shared/tabs.js`
- Modify: `src/dashboard/dashboard.js`
- Modify: `index.html`

- [ ] **Add three new `tab-panel` divs to `index.html`, immediately before the closing `</div>` of `.app-tab-content` (after the settings panel):**

```html
      <!-- ACTOR DASHBOARD -->
      <div class="tab-panel" id="tab-my-show"></div>
      <!-- DIRECTOR DASHBOARD -->
      <div class="tab-panel" id="tab-director"></div>
      <!-- COSTUME DESIGNER DASHBOARD -->
      <div class="tab-panel" id="tab-costumes"></div>
    </div>
  </div>
```

- [ ] **In `src/shared/tabs.js`, add `can` to the imports:**
```javascript
import { can } from './roles.js';
```

- [ ] **Extend `TAB_ROUTE_MAP` to include dashboard routes:**
```javascript
const TAB_ROUTE_MAP = {
  runshow: 'runshow', tracking: 'tracking', linenotes: 'script',
  cast: 'cast', settings: 'settings',
  'my-show': 'my-show', director: 'director', costumes: 'costumes',  // ← ADD
};
```

- [ ] **Add `applyPermissionedTabVisibility()` export, called once after production opens:**

```javascript
export function applyPermissionedTabVisibility() {
  const p = state.permissions || {};

  // Show/hide top-level tab buttons
  _setTabVisible('runshow',  !!p.hasRunshowAccess);
  _setTabVisible('tracking', !!(p.hasTrackingAccess || p.hasPropsAccess));
  _setTabVisible('linenotes',!!p.hasLinenotesAccess);
  _setTabVisible('cast',     !!p.hasCastAccess);
  _setTabVisible('settings', !!p.hasSettingsAccess);

  // Inject dashboard tab button if needed (idempotent)
  if (p.dashboard === 'actor')    _injectDashboardTab('my-show',  'My Show');
  if (p.dashboard === 'director') _injectDashboardTab('director', 'Notes');
  if (p.dashboard === 'costumer') _injectDashboardTab('costumes', 'Costumes');
}

function _setTabVisible(tabId, visible) {
  const btn = document.querySelector(`.app-tab[data-tab="${tabId}"]`);
  if (btn) btn.style.display = visible ? '' : 'none';
}

function _injectDashboardTab(tabId, label) {
  if (document.querySelector(`.app-tab[data-tab="${tabId}"]`)) return; // already injected
  const tabsEl = document.querySelector('.app-topbar-tabs');
  if (!tabsEl) return;
  const btn = document.createElement('button');
  btn.className = 'app-tab';
  btn.dataset.tab = tabId;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    const pid = state.activeProduction?.id;
    if (pid) setRoute(pid, tabId);
    switchTab(tabId);
  });
  tabsEl.prepend(btn);  // Dashboard tab goes first
}
```

- [ ] **Add the dashboard cases to `switchTab()`'s switch statement:**

```javascript
case 'my-show':
  import('../actor/actor-dashboard.js').then(m => m.onActorDashboardActivated());
  break;
case 'director':
  import('../director/director-dashboard.js').then(m => m.onDirectorDashboardActivated());
  break;
case 'costumes':
  import('../costume-designer/costumer-dashboard.js').then(m => m.onCostumerDashboardActivated());
  break;
```

- [ ] **In `src/dashboard/dashboard.js`, call `applyPermissionedTabVisibility()` and navigate to the right default tab inside `openProduction()`, after `showApp()`:**

Add import at top:
```javascript
import { applyPermissionedTabVisibility } from '../shared/tabs.js';
```

At the end of `openProduction()`:
```javascript
  hideDashboard();
  showApp();
  applyPermissionedTabVisibility();   // ← ADD

  // Navigate to dashboard or default tab
  const dash = state.permissions.dashboard;
  const defaultTab = dash === 'actor'    ? 'my-show'
                   : dash === 'director' ? 'director'
                   : dash === 'costumer' ? 'costumes'
                   : state.permissions.hasRunshowAccess ? 'runshow'
                   : state.permissions.hasPropsAccess   ? 'tracking'
                   : state.permissions.hasCastAccess    ? 'cast'
                   : 'settings';
  switchTab(defaultTab);
  setRoute(id, TAB_ROUTE_MAP[defaultTab] || defaultTab);
```

You'll need to import `switchTab` and `TAB_ROUTE_MAP` — or re-export `TAB_ROUTE_MAP` from `tabs.js` and import it in `dashboard.js`. Alternatively, export a helper `getRouteForTab(tabId)` from `tabs.js`.

The simplest approach: add to `tabs.js`:
```javascript
export function navigateToDefaultTab(prodId) {
  const p = state.permissions || {};
  const dash = p.dashboard;
  const tab = dash === 'actor'    ? 'my-show'
            : dash === 'director' ? 'director'
            : dash === 'costumer' ? 'costumes'
            : p.hasRunshowAccess  ? 'runshow'
            : p.hasPropsAccess    ? 'tracking'
            : p.hasCastAccess     ? 'cast'
            : 'settings';
  switchTab(tab);
  if (prodId) setRoute(prodId, TAB_ROUTE_MAP[tab] || tab);
}
```

And in `dashboard.js`:
```javascript
import { applyPermissionedTabVisibility, navigateToDefaultTab } from '../shared/tabs.js';
// ...
hideDashboard();
showApp();
applyPermissionedTabVisibility();
navigateToDefaultTab(id);
```

- [ ] **Verify:** Open as owner — all tabs visible, lands on Run Show. Temporarily change a test account's role in Firestore to `crew`, reopen — only Tracking tab visible. Change to `props-master` — only Tracking tab visible (Props subtab only).

- [ ] **Commit:**
```bash
git add src/shared/tabs.js src/dashboard/dashboard.js index.html
git commit -m "feat: tab visibility gating and dashboard routing"
```

---

## Task 8: Settings member management UI

**Files:**
- Modify: `src/settings/settings.js`

Replace `loadSettingsMembers()` (~line 315) entirely. The new version adds role dropdowns, cast-link buttons, and inline override panels.

- [ ] **Add these imports at the top of `settings.js` (alongside existing imports):**
```javascript
import { computePermissions } from '../shared/roles.js';
import { collection, getDocs, getDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
```
_(Some may already be imported — only add what's missing.)_

- [ ] **Replace the entire `loadSettingsMembers()` function with:**

```javascript
const ROLE_OPTIONS = [
  { value: 'member',           label: 'Member (legacy)' },
  { value: 'asm',              label: 'ASM' },
  { value: 'director',         label: 'Director' },
  { value: 'actor',            label: 'Actor' },
  { value: 'costume-designer', label: 'Costume Designer' },
  { value: 'props-master',     label: 'Props Master' },
  { value: 'crew',             label: 'Crew' },
];

const OVERRIDE_FLAGS = [
  'canRunSession','canTakeLineNotes','canManageProps','canManageActorCues',
  'canManageCostumes','canManageCast','canEditZones','canUploadScript','canEditSettings',
  'hasRunshowAccess','hasPropsAccess','hasTrackingAccess','hasLinenotesAccess',
  'hasCastAccess','hasSettingsAccess',
];

async function loadSettingsMembers() {
  const container = document.getElementById('settings-members-list');
  if (!container) return;
  const owner = isOwner();
  const pid = state.activeProduction.id;
  try {
    const [membersSnap, castSnap] = await Promise.all([
      getDocs(collection(db, 'productions', pid, 'members')),
      getDocs(collection(db, 'productions', pid, 'cast')),
    ]);
    const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const castList = castSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (members.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted)">No members.</div>';
      return;
    }

    container.innerHTML = members.map(m => {
      const isMe = m.id === state.currentUser.uid;
      const isThisOwner = m.role === 'owner';
      const needsLink = ['actor','costume-designer'].includes(m.role);
      const linkedCast = m.castLinkId ? castList.find(c => c.id === m.castLinkId) : null;

      return `
        <div class="settings-member-row" data-member-id="${escapeHtml(m.id)}"
             style="display:grid;grid-template-columns:1fr auto auto auto auto;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bg-border);">
          <div>
            <div style="color:var(--text-primary);font-size:14px;">${escapeHtml(m.displayName || m.email)}</div>
            <div style="color:var(--text-muted);font-size:12px;font-family:'DM Mono',monospace;">${escapeHtml(m.email)}</div>
          </div>
          ${(owner && !isMe && !isThisOwner) ? `
            <select class="settings-member-role-select form-select" data-member-id="${escapeHtml(m.id)}"
                style="font-size:12px;padding:4px 8px;background:var(--bg-raised);border:1px solid var(--bg-border);color:var(--text-primary);border-radius:4px;">
              ${ROLE_OPTIONS.map(r => `<option value="${r.value}" ${m.role===r.value?'selected':''}>${r.label}</option>`).join('')}
            </select>
          ` : `<span class="role-badge role-badge--${escapeHtml(m.role)}">${isThisOwner ? '★ Owner' : escapeHtml(m.role)}</span>`}
          ${needsLink ? `
            <button class="settings-btn settings-member-cast-link" data-member-id="${escapeHtml(m.id)}"
                style="${!linkedCast ? 'color:var(--orange);border-color:rgba(232,155,62,0.4);' : ''}">
              ${linkedCast
                ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(linkedCast.color||'#888')};margin-right:5px;vertical-align:middle;"></span>${escapeHtml(linkedCast.name)}`
                : '⚠ Link cast entry'}
            </button>
          ` : '<span></span>'}
          ${(owner && !isMe && !isThisOwner) ? `
            <button class="settings-btn settings-member-gear" data-member-id="${escapeHtml(m.id)}" title="Permission overrides">⚙</button>
            <button class="settings-btn settings-btn--danger settings-member-remove"
                data-member-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.displayName||m.email)}">Remove</button>
          ` : '<span></span><span></span>'}
        </div>
        <div class="settings-member-overrides" data-member-id="${escapeHtml(m.id)}"
             style="display:none;padding:12px 16px;background:var(--bg-card);border-bottom:1px solid var(--bg-border);">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:10px;">
            Permission overrides for ${escapeHtml(m.displayName||m.email)}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            ${_renderOverrideToggles(m, castList)}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:8px;font-style:italic;">
            Only flags that differ from the role default are saved.
          </div>
        </div>`;
    }).join('');

    _wireSettingsMemberEvents(container, members, castList, pid, owner);
  } catch(e) {
    container.innerHTML = '<div style="color:var(--text-muted)">Failed to load members.</div>';
    console.error(e);
  }
}

function _renderOverrideToggles(member, castList) {
  const effective = computePermissions(member.role || 'member', member.permissionOverrides || {});
  return OVERRIDE_FLAGS.map(flag => {
    const val = !!effective[flag];
    return `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--text-sec);">
        <input type="checkbox" class="member-override-toggle"
               data-flag="${flag}" data-member-id="${escapeHtml(member.id)}"
               ${val ? 'checked' : ''}>
        ${flag}
      </label>`;
  }).join('');
}

function _wireSettingsMemberEvents(container, members, castList, pid, owner) {
  if (!owner) return;

  // Role dropdown change
  container.querySelectorAll('.settings-member-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const memberId = sel.dataset.memberId;
      try {
        await updateDoc(doc(db, 'productions', pid, 'members', memberId), { role: sel.value });
        toast('Role updated.', 'success');
        loadSettingsMembers();
      } catch(e) { toast('Failed to update role.', 'error'); }
    });
  });

  // Cast link button
  container.querySelectorAll('.settings-member-cast-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const memberId = btn.dataset.memberId;
      _openCastLinkModal(memberId, castList, pid);
    });
  });

  // Gear toggle override panel
  container.querySelectorAll('.settings-member-gear').forEach(btn => {
    btn.addEventListener('click', () => {
      const memberId = btn.dataset.memberId;
      const panel = container.querySelector(`.settings-member-overrides[data-member-id="${memberId}"]`);
      if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
  });

  // Override toggles (auto-save on change)
  container.querySelectorAll('.member-override-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const memberId = cb.dataset.memberId;
      const flag = cb.dataset.flag;
      const member = members.find(m => m.id === memberId);
      if (!member) return;
      const roleDefault = computePermissions(member.role || 'member');
      const overrides = { ...(member.permissionOverrides || {}) };
      if (!!roleDefault[flag] === cb.checked) {
        delete overrides[flag]; // Back to default — remove override
      } else {
        overrides[flag] = cb.checked;
      }
      try {
        await updateDoc(doc(db, 'productions', pid, 'members', memberId), { permissionOverrides: overrides });
        member.permissionOverrides = overrides; // Update local copy
        toast('Override saved.', 'success');
      } catch(e) { toast('Failed.', 'error'); }
    });
  });

  // Remove member
  container.querySelectorAll('.settings-member-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirmDialog(`Remove ${btn.dataset.name} from this production?`)) return;
      try {
        await deleteDoc(doc(db, 'productions', pid, 'members', btn.dataset.id || btn.dataset.memberId));
        toast('Member removed.', 'success');
        loadSettingsMembers();
      } catch(e) { toast('Failed.', 'error'); }
    });
  });
}

function _openCastLinkModal(memberId, castList, pid) {
  const existing = document.querySelector('.cast-link-modal');
  if (existing) existing.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop cast-link-modal';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:400px">
      <h2>Link Cast Entry</h2>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">Select which cast member this person plays.</p>
      <div id="cast-link-list" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${castList.map(c => `
          <button class="cast-link-option settings-btn" data-cast-id="${escapeHtml(c.id)}"
              style="display:flex;align-items:center;gap:8px;text-align:left;padding:8px 12px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(c.color||'#888')};flex-shrink:0;display:inline-block;"></span>
            <span>${escapeHtml(c.name)}</span>
            ${c.characters?.length ? `<span style="color:var(--text-muted);font-size:11px;margin-left:auto;">${escapeHtml(c.characters.join(', '))}</span>` : ''}
          </button>`).join('')}
      </div>
      <div class="modal-btns" style="margin-top:12px;">
        <button class="modal-btn-cancel" id="cast-link-cancel">Cancel</button>
        <button class="modal-btn-cancel" id="cast-link-unlink" style="color:var(--red)">Unlink</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cast-link-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('#cast-link-unlink').addEventListener('click', async () => {
    try {
      await updateDoc(doc(db, 'productions', pid, 'members', memberId), { castLinkId: null });
      toast('Cast link removed.', 'success');
      backdrop.remove();
      loadSettingsMembers();
    } catch(e) { toast('Failed.', 'error'); }
  });
  backdrop.querySelectorAll('.cast-link-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'productions', pid, 'members', memberId), { castLinkId: btn.dataset.castId });
        toast('Cast entry linked!', 'success');
        backdrop.remove();
        loadSettingsMembers();
      } catch(e) { toast('Failed.', 'error'); }
    });
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}
```

- [ ] **Verify:** Open Settings as owner. Members list shows role dropdowns, gear icons, and cast-link buttons for Actor-role members. Change a member's role via dropdown — Firestore updates. Open override panel — toggles show. Link a cast entry to an actor member.

- [ ] **Commit:**
```bash
git add src/settings/settings.js
git commit -m "feat: settings member management — role dropdown, cast link, override panel"
```

---

## Task 9: Actor dashboard

**Files:**
- Create: `src/actor/actor-dashboard.js`
- Create: `src/actor/actor-dashboard.css`

- [ ] **Create `src/actor/actor-dashboard.css`:**

```css
/* src/actor/actor-dashboard.css */
.actor-dash {
  max-width: 480px;
  margin: 0 auto;
  padding: 0;
  font-family: system-ui, -apple-system, sans-serif;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.actor-dash-header {
  background: var(--bg-deep);
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--bg-border);
  flex-shrink: 0;
}
.actor-dash-prod { font-size: 10px; color: var(--gold-dim); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 3px; }
.actor-dash-name { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.actor-dash-dot  { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.actor-dash-tabs { display: flex; background: var(--bg-deep); border-bottom: 1px solid var(--bg-border); flex-shrink: 0; }
.actor-dash-tab  { flex: 1; padding: 9px 4px; font-size: 12px; text-align: center; color: var(--text-muted); border-bottom: 2px solid transparent; cursor: pointer; background: none; border-top: none; border-left: none; border-right: none; }
.actor-dash-tab.active { color: var(--gold); border-bottom-color: var(--gold); font-weight: 600; }
.actor-dash-body { flex: 1; overflow-y: auto; background: var(--bg-base); }
.actor-dash-section { padding: 10px 16px; border-bottom: 1px solid var(--bg-border); }
.actor-dash-label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); font-weight: 600; margin-bottom: 8px; }
.actor-live-banner { margin: 10px 16px 0; background: var(--bg-card); border: 1px solid var(--green); border-radius: 12px; padding: 10px 12px; }
.actor-live-label { font-size: 9px; color: var(--green); text-transform: uppercase; letter-spacing: .07em; margin-bottom: 4px; }
.actor-page-num { font-size: 28px; font-weight: 700; line-height: 1; }
.actor-page-sub { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }
.actor-upcoming-cue { margin-top: 8px; background: var(--bg-raised); border-left: 3px solid var(--orange); padding: 6px 8px; border-radius: 0 8px 8px 0; font-size: 11px; color: var(--text-primary); }
.actor-upcoming-head { font-size: 9px; color: var(--orange); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
.actor-prop-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--bg-raised); }
.actor-prop-row:last-child { border-bottom: none; }
.actor-prop-thumb { width: 34px; height: 34px; border-radius: 8px; background: var(--bg-raised); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; border: 1px solid var(--bg-border); }
.actor-prop-name { font-weight: 600; font-size: 12px; }
.actor-prop-cue { font-size: 11px; color: var(--text-secondary); margin-top: 1px; }
.actor-run-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--bg-raised); }
.actor-run-row:last-child { border-bottom: none; }
.actor-run-title { font-weight: 600; font-size: 12px; }
.actor-run-date { font-size: 11px; color: var(--text-secondary); }
.actor-note-pill { font-size: 11px; padding: 6px 8px; background: var(--bg-card); border-radius: 6px; margin-bottom: 4px; }
.actor-note-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600; }
.actor-stat-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.actor-stat-bar-pg { font-size: 10px; width: 40px; text-align: right; color: var(--text-secondary); }
.actor-stat-bar-track { flex: 1; height: 7px; background: var(--bg-raised); border-radius: 4px; overflow: hidden; }
.actor-stat-bar-fill { height: 100%; background: var(--gold); border-radius: 4px; }
.actor-stat-bar-n { font-size: 10px; color: var(--text-secondary); width: 16px; }
.actor-type-pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.actor-type-card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: 8px; padding: 8px 12px; text-align: center; }
.actor-type-val { font-size: 20px; font-weight: 700; line-height: 1; }
.actor-type-lbl { font-size: 9px; color: var(--text-muted); margin-top: 2px; }
.actor-unlinked { display: flex; align-items: center; justify-content: center; height: 200px; }
.actor-unlinked p { color: var(--text-muted); font-size: 14px; text-align: center; }
```

- [ ] **Create `src/actor/actor-dashboard.js`:**

```javascript
// src/actor/actor-dashboard.js
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { collection, query, where, getDocs, getDoc, doc, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { escapeHtml } from '../shared/ui.js';

const NOTE_TYPES = {
  skp:  { label: 'Skip',    color: '#E04050' },
  para: { label: 'Para',    color: '#E89B3E' },
  line: { label: 'Called',  color: '#5B9BD4' },
  add:  { label: 'Added',   color: '#38A060' },
  gen:  { label: 'General', color: '#9898B0' },
  jmp:  { label: 'Jumped',  color: '#C8A050' },
  mw:   { label: 'Missed',  color: '#9B7BC8' },
};

let _unsubSession = null;
let _activeTab = 'live';
let _castMember = null;
let _myProps = [];
let _myNotes = [];
let _prodId = null;

export async function onActorDashboardActivated() {
  const panel = document.getElementById('tab-my-show');
  if (!panel) return;

  _prodId = state.activeProduction?.id;
  if (!_prodId) return;

  const castLinkId = state.castLinkId;
  if (!castLinkId) {
    panel.innerHTML = '<div class="actor-dash"><div class="actor-unlinked"><p>Contact your stage manager to link your cast profile.</p></div></div>';
    return;
  }

  const castDoc = await getDoc(doc(db, 'productions', _prodId, 'cast', castLinkId));
  if (!castDoc.exists()) {
    panel.innerHTML = '<div class="actor-dash"><div class="actor-unlinked"><p>Cast profile not found. Ask your stage manager to re-link your profile.</p></div></div>';
    return;
  }
  _castMember = { id: castDoc.id, ...castDoc.data() };

  // Fetch props and notes in parallel
  const [propsSnap, notesSnap] = await Promise.all([
    getDocs(collection(db, 'productions', _prodId, 'props')),
    getDocs(collection(db, 'productions', _prodId, 'lineNotes')),
  ]);

  const chars = _castMember.characters || [];
  _myProps = propsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => (p.cues || []).some(c => chars.includes(c.mover) || chars.includes(c.carrierOn) || chars.includes(c.carrierOff)));

  _myNotes = notesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(n => {
      if (n.castId === castLinkId) return true;
      if (Array.isArray(n.actors)) return n.actors.some(a => a.castId === castLinkId);
      return false;
    });

  _render(panel);
  _subscribeSession(panel);
}

function _render(panel) {
  const chars = (_castMember.characters || []).join(', ') || _castMember.name;
  panel.innerHTML = `
    <div class="actor-dash">
      <div class="actor-dash-header">
        <div class="actor-dash-prod">${escapeHtml(state.activeProduction?.title || '')}</div>
        <div class="actor-dash-name">
          <span class="actor-dash-dot" style="background:${escapeHtml(_castMember.color||'#888')}"></span>
          ${escapeHtml(chars)}
        </div>
      </div>
      <div class="actor-dash-tabs">
        <button class="actor-dash-tab ${_activeTab==='live'?'active':''}" data-tab="live">Live</button>
        <button class="actor-dash-tab ${_activeTab==='notes'?'active':''}" data-tab="notes">My Notes</button>
        <button class="actor-dash-tab ${_activeTab==='stats'?'active':''}" data-tab="stats">Stats</button>
      </div>
      <div class="actor-dash-body" id="actor-dash-body"></div>
    </div>`;

  panel.querySelectorAll('.actor-dash-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      panel.querySelectorAll('.actor-dash-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
      _renderTabBody();
    });
  });
  _renderTabBody();
}

function _renderTabBody() {
  const body = document.getElementById('actor-dash-body');
  if (!body) return;
  if (_activeTab === 'live')  _renderLive(body);
  if (_activeTab === 'notes') _renderNotes(body);
  if (_activeTab === 'stats') _renderStats(body);
}

function _renderLive(body) {
  // Session content injected by _subscribeSession; show placeholder until session arrives
  body.innerHTML = `
    <div id="actor-live-session">
      <div style="padding:32px 16px;text-align:center;color:var(--text-muted);font-size:13px;">No active session.</div>
    </div>
    <div class="actor-dash-section" style="margin-top:8px">
      <div class="actor-dash-label">My Props</div>
      ${_myProps.length === 0
        ? '<div style="color:var(--text-muted);font-size:12px;">No props assigned to your character(s).</div>'
        : _myProps.map(p => `
          <div class="actor-prop-row">
            <div class="actor-prop-thumb">🎭</div>
            <div>
              <div class="actor-prop-name">${escapeHtml(p.name)}</div>
              <div class="actor-prop-cue">${_propCueSummary(p)}</div>
            </div>
          </div>`).join('')}
    </div>`;
}

function _propCueSummary(prop) {
  const chars = _castMember.characters || [];
  const myCues = (prop.cues || []).filter(c => chars.includes(c.mover) || chars.includes(c.carrierOn) || chars.includes(c.carrierOff));
  if (!myCues.length) return '';
  const first = myCues[0];
  return `p.${first.enterPage || '?'} → p.${first.exitPage || '?'}`;
}

function _renderLiveSession(session) {
  const el = document.getElementById('actor-live-session');
  if (!el) return;
  const chars = _castMember.characters || [];
  const page = session.currentPage || session.liveCurrentPage || 0;

  // Find next prop cue for this actor
  const upcoming = _myProps.flatMap(p =>
    (p.cues || [])
      .filter(c => (chars.includes(c.mover)||chars.includes(c.carrierOn)) && (c.enterPage||0) > page)
      .map(c => ({ prop: p, cue: c }))
  ).sort((a,b) => (a.cue.enterPage||0) - (b.cue.enterPage||0))[0];

  el.innerHTML = `
    <div class="actor-live-banner">
      <div class="actor-live-label"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:4px;vertical-align:middle;"></span>Session in progress</div>
      <div class="actor-page-num">${page}</div>
      <div class="actor-page-sub">Current page</div>
      ${upcoming ? `
        <div class="actor-upcoming-cue">
          <div class="actor-upcoming-head">↑ Coming up · p.${upcoming.cue.enterPage}</div>
          ${escapeHtml(upcoming.prop.name)}${upcoming.cue.enterLocation ? ` — ${escapeHtml(upcoming.cue.enterLocation)}` : ''}
        </div>` : ''}
    </div>`;
}

function _subscribeSession(panel) {
  if (_unsubSession) { _unsubSession(); _unsubSession = null; }
  const q = query(
    collection(db, 'productions', _prodId, 'sessions'),
    where('status', '==', 'active'),
    limit(1)
  );
  _unsubSession = onSnapshot(q, snap => {
    if (_activeTab !== 'live') return;
    const el = document.getElementById('actor-live-session');
    if (!snap.empty) {
      const session = { id: snap.docs[0].id, ...snap.docs[0].data() };
      _renderLiveSession(session);
    } else if (el) {
      el.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text-muted);font-size:13px;">No active session.</div>';
    }
  });
  state.unsubscribers.push(() => { if (_unsubSession) { _unsubSession(); _unsubSession = null; } });
}

function _renderNotes(body) {
  // Group notes by sessionId
  const bySession = {};
  _myNotes.forEach(n => {
    const sid = n.sessionId || '__no_session__';
    if (!bySession[sid]) bySession[sid] = [];
    bySession[sid].push(n);
  });

  if (Object.keys(bySession).length === 0) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">No notes yet.</div>';
    return;
  }

  body.innerHTML = Object.entries(bySession).map(([sid, notes], idx) => {
    const sorted = [...notes].sort((a,b) => (a.page||0)-(b.page||0));
    const date = notes[0]?.createdAt?.toDate?.()?.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) || '';
    return `
      <div class="actor-dash-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${idx===0?8:0}px;">
          <div>
            <div class="actor-run-title">Run · ${escapeHtml(sid === '__no_session__' ? 'Untagged' : sid.slice(-6))}</div>
            <div class="actor-run-date">${date} · ${notes.length} note${notes.length!==1?'s':''}</div>
          </div>
          <span style="background:rgba(224,64,80,0.12);color:var(--red);border-radius:10px;padding:2px 8px;font-size:10px;font-weight:600;">${notes.length}</span>
        </div>
        ${idx === 0 ? sorted.map(n => {
          const nt = NOTE_TYPES[n.type] || { label: n.type, color: '#888' };
          return `<div class="actor-note-pill" style="border-left:3px solid ${nt.color}">
            <span style="color:${nt.color};font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.05em;">${nt.label}</span>
            <span style="color:var(--text-muted);font-size:9px;margin-left:4px;">p.${n.page||'?'}</span>
            ${n.lineText ? `<div style="margin-top:2px;font-size:11px;">"${escapeHtml(n.lineText.slice(0,80))}${n.lineText.length>80?'…':''}"</div>` : ''}
          </div>`;
        }).join('') : ''}
      </div>`;
  }).join('');
}

function _renderStats(body) {
  const counts = {};
  Object.keys(NOTE_TYPES).forEach(k => counts[k] = 0);
  _myNotes.forEach(n => { if (counts[n.type] !== undefined) counts[n.type]++; });

  // Page frequency
  const pageCounts = {};
  _myNotes.forEach(n => { if (n.page) pageCounts[n.page] = (pageCounts[n.page]||0)+1; });
  const topPages = Object.entries(pageCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxCount = topPages[0]?.[1] || 1;

  body.innerHTML = `
    <div class="actor-dash-section">
      <div class="actor-dash-label">Note breakdown · all runs</div>
      <div class="actor-type-pills">
        ${Object.entries(NOTE_TYPES).filter(([k]) => counts[k] > 0).map(([k,nt]) => `
          <div class="actor-type-card" style="border-color:${nt.color}22">
            <div class="actor-type-val" style="color:${nt.color}">${counts[k]}</div>
            <div class="actor-type-lbl">${nt.label}s</div>
          </div>`).join('')}
        ${Object.values(counts).every(v=>v===0) ? '<div style="color:var(--text-muted);font-size:12px;">No notes recorded yet.</div>' : ''}
      </div>
    </div>
    ${topPages.length > 0 ? `
    <div class="actor-dash-section">
      <div class="actor-dash-label">Trouble spots by page</div>
      ${topPages.map(([pg, cnt]) => `
        <div class="actor-stat-bar-row">
          <div class="actor-stat-bar-pg">p.${pg}</div>
          <div class="actor-stat-bar-track"><div class="actor-stat-bar-fill" style="width:${Math.round(cnt/maxCount*100)}%"></div></div>
          <div class="actor-stat-bar-n">${cnt}</div>
        </div>`).join('')}
    </div>` : ''}`;
}
```

- [ ] **Verify:** Set a test account to `actor` role in Firestore, link a cast entry via Settings, open the app. App lands on My Show tab. Live tab shows "No active session." Start a session as owner in another browser → actor's Live tab updates with current page. My Notes tab shows grouped notes. Stats tab shows type counts.

- [ ] **Commit:**
```bash
git add src/actor/actor-dashboard.js src/actor/actor-dashboard.css
git commit -m "feat: add Actor dashboard (Live, My Notes, Stats tabs)"
```

---

## Task 10: Director dashboard

**Files:**
- Create: `src/director/director-dashboard.js`
- Create: `src/director/director-dashboard.css`

- [ ] **Create `src/director/director-dashboard.css`:**

```css
/* src/director/director-dashboard.css */
.director-dash { height: 100%; display: flex; flex-direction: column; background: var(--bg-base); }
.director-topbar { background: var(--bg-deep); padding: 10px 24px; border-bottom: 1px solid var(--bg-border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.director-topbar h2 { font-size: 16px; font-weight: 600; }
.director-role-chip { font-size: 10px; background: rgba(155,123,200,0.15); color: #9B7BC8; border: 1px solid rgba(155,123,200,0.3); border-radius: 6px; padding: 3px 8px; font-weight: 600; }
.director-tabs { display: flex; background: var(--bg-deep); border-bottom: 1px solid var(--bg-border); flex-shrink: 0; }
.director-tab { padding: 9px 18px; font-size: 12px; color: var(--text-muted); border-bottom: 2px solid transparent; cursor: pointer; background: none; border-top: none; border-left: none; border-right: none; }
.director-tab.active { color: var(--gold); border-bottom-color: var(--gold); font-weight: 600; }
.director-body { flex: 1; overflow-y: auto; padding: 0; }
.director-stat-row { display: grid; grid-template-columns: repeat(4,1fr); background: var(--bg-border); gap: 1px; border-bottom: 1px solid var(--bg-border); flex-shrink: 0; }
.director-stat-card { background: var(--bg-card); padding: 14px 18px; }
.director-stat-val { font-size: 26px; font-weight: 700; line-height: 1; }
.director-stat-lbl { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; margin-top: 3px; }
.director-run-chips { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 20px; background: var(--bg-card); border-bottom: 1px solid var(--bg-border); }
.director-run-chip { font-size: 11px; padding: 4px 12px; border-radius: 12px; border: 1px solid var(--bg-border); background: var(--bg-raised); color: var(--text-secondary); cursor: pointer; }
.director-run-chip.active { background: rgba(200,160,80,0.12); border-color: rgba(200,160,80,0.3); color: var(--gold); font-weight: 600; }
.director-table { width: 100%; border-collapse: collapse; }
.director-table th, .director-table td { border-bottom: 1px solid var(--bg-raised); padding: 9px 20px; font-size: 12px; }
.director-table th { background: var(--bg-card); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); text-align: center; }
.director-table th:first-child { text-align: left; }
.director-table td:first-child { text-align: left; }
.director-table td { text-align: center; }
.director-table tr:hover td { background: var(--bg-hover); cursor: pointer; }
.director-actor-name { font-weight: 600; }
.director-actor-char { font-size: 11px; color: var(--text-muted); }
.director-trend { display: flex; align-items: flex-end; gap: 3px; height: 20px; }
.director-trend-bar { flex: 1; border-radius: 2px 2px 0 0; min-height: 2px; background: var(--gold); opacity: .7; }
```

- [ ] **Create `src/director/director-dashboard.js`:**

```javascript
// src/director/director-dashboard.js
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { escapeHtml } from '../shared/ui.js';

let _sessions = [];
let _notes = [];
let _cast = [];
let _prodId = null;
let _activeTab = 'by-actor';
let _filterSessionId = 'all';

export async function onDirectorDashboardActivated() {
  const panel = document.getElementById('tab-director');
  if (!panel) return;
  _prodId = state.activeProduction?.id;
  if (!_prodId) return;

  panel.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>';

  const [sessSnap, notesSnap, castSnap] = await Promise.all([
    getDocs(query(collection(db, 'productions', _prodId, 'sessions'), where('status','==','ended'), orderBy('date','desc'))),
    getDocs(collection(db, 'productions', _prodId, 'lineNotes')),
    getDocs(collection(db, 'productions', _prodId, 'cast')),
  ]);

  _sessions = sessSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  _notes    = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  _cast     = castSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  _render(panel);
}

function _render(panel) {
  panel.innerHTML = `
    <div class="director-dash">
      <div class="director-topbar">
        <h2>${escapeHtml(state.activeProduction?.title||'')} — Notes Overview</h2>
        <span class="director-role-chip">Director</span>
      </div>
      <div class="director-tabs">
        <button class="director-tab ${_activeTab==='by-actor'?'active':''}" data-tab="by-actor">By Actor</button>
        <button class="director-tab ${_activeTab==='by-run'?'active':''}" data-tab="by-run">By Run</button>
        <button class="director-tab ${_activeTab==='heatmap'?'active':''}" data-tab="heatmap">Page Heatmap</button>
        <button class="director-tab ${_activeTab==='cast'?'active':''}" data-tab="cast">Cast</button>
      </div>
      <div class="director-body" id="director-body"></div>
    </div>`;

  panel.querySelectorAll('.director-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      panel.querySelectorAll('.director-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
      _renderBody();
    });
  });
  _renderBody();
}

function _filteredNotes() {
  if (_filterSessionId === 'all') return _notes;
  return _notes.filter(n => n.sessionId === _filterSessionId);
}

function _renderBody() {
  const body = document.getElementById('director-body');
  if (!body) return;
  if (_activeTab === 'by-actor') _renderByActor(body);
  if (_activeTab === 'by-run')   _renderByRun(body);
  if (_activeTab === 'heatmap')  _renderHeatmap(body);
  if (_activeTab === 'cast')     _renderCast(body);
}

function _renderByActor(body) {
  const notes = _filteredNotes();
  const totals = { total: notes.length, skp: 0, para: 0, line: 0 };
  notes.forEach(n => { if (n.type==='skp') totals.skp++; if (n.type==='para') totals.para++; if (n.type==='line') totals.line++; });

  // Aggregate by castId
  const byCast = {};
  notes.forEach(n => {
    const ids = n.castId ? [n.castId] : (n.actors||[]).map(a=>a.castId);
    ids.forEach(cid => {
      if (!byCast[cid]) byCast[cid] = { total:0, skp:0, para:0, line:0 };
      byCast[cid].total++;
      if (n.type==='skp')  byCast[cid].skp++;
      if (n.type==='para') byCast[cid].para++;
      if (n.type==='line') byCast[cid].line++;
    });
  });

  const rows = Object.entries(byCast)
    .sort((a,b) => b[1].total - a[1].total)
    .map(([cid, counts]) => {
      const member = _cast.find(c => c.id === cid);
      if (!member) return null;
      // Trend: last 4 sessions' note count for this actor
      const trendData = _sessions.slice(0,4).reverse().map(s =>
        _notes.filter(n => n.sessionId === s.id && (n.castId===cid || (n.actors||[]).some(a=>a.castId===cid))).length
      );
      const maxTrend = Math.max(...trendData, 1);
      return { member, counts, trendData, maxTrend };
    }).filter(Boolean);

  body.innerHTML = `
    <div class="director-stat-row">
      <div class="director-stat-card"><div class="director-stat-val">${totals.total}</div><div class="director-stat-lbl">Total notes</div></div>
      <div class="director-stat-card"><div class="director-stat-val" style="color:var(--red)">${totals.skp}</div><div class="director-stat-lbl">Skips</div></div>
      <div class="director-stat-card"><div class="director-stat-val" style="color:var(--orange)">${totals.para}</div><div class="director-stat-lbl">Paraphrases</div></div>
      <div class="director-stat-card"><div class="director-stat-val" style="color:var(--blue)">${totals.line}</div><div class="director-stat-lbl">Lines called</div></div>
    </div>
    <div class="director-run-chips">
      <span style="font-size:11px;color:var(--text-muted);align-self:center;margin-right:4px;">Run:</span>
      <div class="director-run-chip ${_filterSessionId==='all'?'active':''}" data-sid="all">All runs</div>
      ${_sessions.slice(0,6).map(s => `
        <div class="director-run-chip ${_filterSessionId===s.id?'active':''}" data-sid="${escapeHtml(s.id)}">
          ${escapeHtml(s.title||'Untitled')}
        </div>`).join('')}
    </div>
    <table class="director-table">
      <thead><tr>
        <th>Actor / Character</th>
        <th>Skip</th><th>Para</th><th>Called</th><th>Total</th><th>Trend</th>
      </tr></thead>
      <tbody>
        ${rows.length === 0
          ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">No notes for this selection.</td></tr>'
          : rows.map(r => `
          <tr data-cast-id="${escapeHtml(r.member.id)}">
            <td>
              <div class="director-actor-name" style="display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${escapeHtml(r.member.color||'#888')};flex-shrink:0;display:inline-block;"></span>
                ${escapeHtml(r.member.name)}
              </div>
              <div class="director-actor-char">${escapeHtml((r.member.characters||[]).join(', '))}</div>
            </td>
            <td style="color:var(--red);font-weight:600;">${r.counts.skp}</td>
            <td style="color:var(--orange);font-weight:600;">${r.counts.para}</td>
            <td style="color:var(--blue);font-weight:600;">${r.counts.line}</td>
            <td style="font-weight:600;">${r.counts.total}</td>
            <td>
              <div class="director-trend">
                ${r.trendData.map(v=>`<div class="director-trend-bar" style="height:${Math.round(v/r.maxTrend*18)+2}px"></div>`).join('')}
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  // Run filter chips
  body.querySelectorAll('.director-run-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _filterSessionId = chip.dataset.sid;
      _renderByActor(body);
    });
  });
}

function _renderByRun(body) {
  if (_sessions.length === 0) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">No completed runs yet.</div>';
    return;
  }
  body.innerHTML = `
    <table class="director-table">
      <thead><tr><th>Run</th><th>Date</th><th>Notes</th><th>Skips</th><th>Paras</th><th>Called</th><th>Duration</th></tr></thead>
      <tbody>
        ${_sessions.map((s,i) => {
          const runNotes = _notes.filter(n => n.sessionId === s.id);
          const skp  = runNotes.filter(n=>n.type==='skp').length;
          const para = runNotes.filter(n=>n.type==='para').length;
          const line = runNotes.filter(n=>n.type==='line').length;
          const prevNotes = i < _sessions.length-1 ? _notes.filter(n=>n.sessionId===_sessions[i+1].id).length : null;
          const trend = prevNotes !== null ? (runNotes.length > prevNotes ? '↑' : runNotes.length < prevNotes ? '↓' : '→') : '';
          const trendColor = trend==='↑' ? 'var(--red)' : trend==='↓' ? 'var(--green)' : 'var(--text-muted)';
          const dateStr = s.date?.toDate?.()?.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})||'—';
          const dur = s.durationSeconds ? `${Math.floor(s.durationSeconds/60)}m` : '—';
          return `<tr>
            <td>${escapeHtml(s.title||'Untitled')}</td>
            <td style="color:var(--text-muted)">${dateStr}</td>
            <td style="font-weight:600">${runNotes.length} <span style="color:${trendColor};font-size:11px;">${trend}</span></td>
            <td style="color:var(--red)">${skp}</td>
            <td style="color:var(--orange)">${para}</td>
            <td style="color:var(--blue)">${line}</td>
            <td style="color:var(--text-muted)">${dur}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function _renderHeatmap(body) {
  const pageCounts = {};
  _notes.forEach(n => { if (n.page) pageCounts[n.page] = (pageCounts[n.page]||0)+1; });
  const maxPage = state.activeProduction?.scriptPageCount || Math.max(...Object.keys(pageCounts).map(Number), 0);
  const maxCount = Math.max(...Object.values(pageCounts), 1);

  if (maxPage === 0) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">No script loaded.</div>';
    return;
  }

  const cells = Array.from({length: maxPage}, (_,i) => i+1).map(pg => {
    const cnt = pageCounts[pg] || 0;
    const intensity = cnt / maxCount;
    const bg = cnt === 0 ? 'var(--bg-raised)'
             : intensity > .66 ? 'rgba(224,64,80,0.8)'
             : intensity > .33 ? 'rgba(232,155,62,0.7)'
             : 'rgba(200,160,80,0.5)';
    return `<div title="p.${pg}: ${cnt} note${cnt!==1?'s':''}" data-page="${pg}"
         style="width:32px;height:32px;border-radius:4px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-primary);cursor:${cnt>0?'pointer':'default'};border:1px solid var(--bg-border);">
       ${pg}
     </div>`;
  }).join('');

  body.innerHTML = `
    <div style="padding:16px 20px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">Note density by page — click a page to see notes.</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${cells}</div>
    </div>`;
}

function _renderCast(body) {
  if (_cast.length === 0) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">No cast members added yet.</div>';
    return;
  }
  body.innerHTML = `
    <div style="padding:16px 20px">
      ${_cast.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bg-raised);">
          <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(c.color||'#888')};flex-shrink:0;display:inline-block;"></span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px;">${escapeHtml(c.name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${escapeHtml((c.characters||[]).join(', ')||c.type||'')}</div>
          </div>
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(c.type||'')}</div>
        </div>`).join('')}
    </div>`;
}
```

- [ ] **Verify:** Set a test account to `director` role. Open app → lands on Notes tab (no normal app tabs visible except Cast). By Actor tab shows note counts per actor with trend bars. By Run shows per-session counts. Run filter chips filter the By Actor table.

- [ ] **Commit:**
```bash
git add src/director/director-dashboard.js src/director/director-dashboard.css
git commit -m "feat: add Director dashboard (By Actor, By Run, Page Heatmap, Cast tabs)"
```

---

## Task 11: Costume Designer dashboard

**Files:**
- Create: `src/costume-designer/costumer-dashboard.js`
- Create: `src/costume-designer/costumer-dashboard.css`

- [ ] **Create `src/costume-designer/costumer-dashboard.css`:**

```css
/* src/costume-designer/costumer-dashboard.css */
.costumer-dash { height: 100%; display: flex; flex-direction: column; background: var(--bg-base); }
.costumer-topbar { background: var(--bg-deep); padding: 10px 20px; border-bottom: 1px solid var(--bg-border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.costumer-topbar h2 { font-size: 16px; font-weight: 600; }
.costumer-role-chip { font-size: 10px; background: rgba(232,155,62,0.15); color: var(--orange); border: 1px solid rgba(232,155,62,0.3); border-radius: 6px; padding: 3px 8px; font-weight: 600; }
.costumer-tabs { display: flex; background: var(--bg-deep); border-bottom: 1px solid var(--bg-border); flex-shrink: 0; }
.costumer-tab { padding: 9px 16px; font-size: 12px; color: var(--text-muted); border-bottom: 2px solid transparent; cursor: pointer; background: none; border-top: none; border-left: none; border-right: none; }
.costumer-tab.active { color: var(--gold); border-bottom-color: var(--gold); font-weight: 600; }
.costumer-body { flex: 1; overflow-y: auto; }
.costumer-live-banner { margin: 10px 20px 0; background: var(--bg-card); border: 1px solid var(--green); border-radius: 12px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
.costumer-page-num { font-size: 24px; font-weight: 700; line-height: 1; }
.costumer-page-sub { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }
.costumer-status-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; background: var(--bg-border); border-radius: 8px; overflow: hidden; border: 1px solid var(--bg-border); }
.costumer-stat-cell { background: var(--bg-card); padding: 8px 12px; text-align: center; }
.costumer-stat-val { font-size: 18px; font-weight: 700; line-height: 1; }
.costumer-stat-lbl { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
.costumer-section-head { padding: 10px 20px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--bg-border); }
.costumer-qc-row { display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--bg-raised); }
.costumer-qc-page { background: var(--bg-raised); border-radius: 6px; text-align: center; padding: 5px 4px; font-size: 10px; color: var(--text-secondary); }
.costumer-qc-pg { font-size: 16px; font-weight: 700; color: var(--text-primary); line-height: 1; }
.costumer-qc-badge { font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; white-space: nowrap; }
.qc-urgent { background: rgba(224,64,80,0.15); color: var(--red); border: 1px solid rgba(224,64,80,0.3); }
.qc-warn   { background: rgba(232,155,62,0.15); color: var(--orange); border: 1px solid rgba(232,155,62,0.3); }
.qc-ok     { background: rgba(56,160,96,0.15); color: var(--green); border: 1px solid rgba(56,160,96,0.3); }
.qc-done   { color: var(--text-muted); font-size: 11px; }
```

- [ ] **Create `src/costume-designer/costumer-dashboard.js`:**

```javascript
// src/costume-designer/costumer-dashboard.js
import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { collection, getDocs, query, where, limit, onSnapshot } from 'firebase/firestore';
import { escapeHtml } from '../shared/ui.js';

let _costumes = [];
let _prodId = null;
let _activeTab = 'qc';
let _unsubSession = null;
let _currentPage = null;

export async function onCostumerDashboardActivated() {
  const panel = document.getElementById('tab-costumes');
  if (!panel) return;
  _prodId = state.activeProduction?.id;
  if (!_prodId) return;

  const snap = await getDocs(collection(db, 'productions', _prodId, 'costumes'));
  _costumes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  _render(panel);
  _subscribeSession(panel);
}

function _render(panel) {
  panel.innerHTML = `
    <div class="costumer-dash">
      <div class="costumer-topbar">
        <h2>${escapeHtml(state.activeProduction?.title||'')} — Costumes</h2>
        <span class="costumer-role-chip">Costume Designer</span>
      </div>
      <div class="costumer-tabs">
        <button class="costumer-tab ${_activeTab==='qc'?'active':''}" data-tab="qc">Quick Changes</button>
        <button class="costumer-tab ${_activeTab==='all'?'active':''}" data-tab="all">All Costumes</button>
        <button class="costumer-tab ${_activeTab==='manage'?'active':''}" data-tab="manage">Manage</button>
      </div>
      <div class="costumer-body" id="costumer-body"></div>
    </div>`;

  panel.querySelectorAll('.costumer-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      panel.querySelectorAll('.costumer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
      _renderBody();
    });
  });
  _renderBody();
}

function _renderBody() {
  const body = document.getElementById('costumer-body');
  if (!body) return;
  if (_activeTab === 'qc')     _renderQC(body);
  if (_activeTab === 'all')    _renderAll(body);
  if (_activeTab === 'manage') _renderManage(body);
}

function _renderQC(body) {
  const page = _currentPage || 0;
  const qcCostumes = _costumes.filter(c => c.isQuickChange || (c.durationMinutes && c.durationMinutes < 5));
  const upcoming = qcCostumes
    .filter(c => (c.cues||[]).some(cue => (cue.exitPage||0) > page))
    .sort((a,b) => {
      const aPage = Math.min(...(a.cues||[]).map(c=>c.exitPage||999));
      const bPage = Math.min(...(b.cues||[]).map(c=>c.exitPage||999));
      return aPage - bPage;
    });
  const done = qcCostumes.filter(c => (c.cues||[]).every(cue => (cue.exitPage||0) <= page && page > 0));

  // Status counts
  const active = _costumes.filter(c => (c.cues||[]).some(cue => (cue.enterPage||0) <= page && (cue.exitPage||0) >= page && page > 0)).length;
  const qcSoon = upcoming.filter(c => {
    const nextPage = Math.min(...(c.cues||[]).map(cu=>cu.exitPage||999));
    return (nextPage - page) <= 5;
  }).length;

  const _badge = (c) => {
    const nextPage = Math.min(...(c.cues||[]).map(cu=>cu.exitPage||999));
    const pagesAway = nextPage - page;
    const mins = c.durationMinutes || 0;
    if (mins < 2 || pagesAway <= 2) return '<span class="costumer-qc-badge qc-urgent">urgent</span>';
    if (mins < 4 || pagesAway <= 4) return '<span class="costumer-qc-badge qc-warn">soon</span>';
    return '<span class="costumer-qc-badge qc-ok">ok</span>';
  };

  body.innerHTML = `
    <div id="costumer-live-section">
      ${_currentPage !== null ? `
        <div class="costumer-live-banner">
          <div>
            <div style="font-size:9px;color:var(--green);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:4px;vertical-align:middle;"></span>Session in progress
            </div>
            <div class="costumer-page-num">${_currentPage}</div>
            <div class="costumer-page-sub">Current page</div>
          </div>
          <div class="costumer-status-grid">
            <div class="costumer-stat-cell"><div class="costumer-stat-val" style="color:var(--green)">${active}</div><div class="costumer-stat-lbl">Active</div></div>
            <div class="costumer-stat-cell"><div class="costumer-stat-val" style="color:var(--red)">${qcSoon}</div><div class="costumer-stat-lbl">QC soon</div></div>
            <div class="costumer-stat-cell"><div class="costumer-stat-val" style="color:var(--text-muted)">${_costumes.length - active}</div><div class="costumer-stat-lbl">Off</div></div>
          </div>
        </div>` : '<div style="padding:16px 20px 0;color:var(--text-muted);font-size:12px;">No active session.</div>'}
    </div>
    ${upcoming.length > 0 ? `
      <div class="costumer-section-head">Upcoming quick changes</div>
      ${upcoming.map(c => {
        const nextPage = Math.min(...(c.cues||[]).map(cu=>cu.exitPage||999));
        const actor = _costumes.find(x=>x.id===c.id); // same ref
        return `<div class="costumer-qc-row">
          <div class="costumer-qc-page"><div class="costumer-qc-pg">${nextPage}</div>p.</div>
          <div>
            <div style="font-weight:600;font-size:12px;">${escapeHtml(c.name)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(c.character||'')}${c.durationMinutes?` · ${c.durationMinutes} min`:''}</div>
          </div>
          ${_badge(c)}
        </div>`;
      }).join('')}` : ''}
    ${done.length > 0 ? `
      <div class="costumer-section-head">Completed this run</div>
      ${done.map(c => `
        <div class="costumer-qc-row" style="opacity:0.5">
          <div class="costumer-qc-page"><div class="costumer-qc-pg">✓</div></div>
          <div>
            <div style="font-weight:600;font-size:12px;">${escapeHtml(c.name)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(c.character||'')}</div>
          </div>
          <span class="qc-done">done</span>
        </div>`).join('')}` : ''}`;
}

function _renderAll(body) {
  // Re-use the existing costumes tracking view by importing it
  import('../tracking/costumes.js').then(m => {
    body.innerHTML = '<div id="costumer-all-inner" style="height:100%"></div>';
    const inner = body.querySelector('#costumer-all-inner');
    if (inner) m.renderCostumesContent(inner);
  });
}

function _renderManage(body) {
  import('../tracking/costumes.js').then(m => {
    body.innerHTML = '<div id="costumer-manage-inner" style="height:100%"></div>';
    const inner = body.querySelector('#costumer-manage-inner');
    if (inner) {
      // Force manage tab to be active for this render
      m.setCostumeInnerTab('manage');
      m.renderCostumesContent(inner);
    }
  });
}

function _subscribeSession(panel) {
  if (_unsubSession) { _unsubSession(); _unsubSession = null; }
  const q = query(
    collection(db, 'productions', _prodId, 'sessions'),
    where('status', '==', 'active'),
    limit(1)
  );
  _unsubSession = onSnapshot(q, snap => {
    if (snap.empty) {
      _currentPage = null;
    } else {
      const s = snap.docs[0].data();
      _currentPage = s.currentPage || s.liveCurrentPage || null;
    }
    if (_activeTab === 'qc') {
      const body = document.getElementById('costumer-body');
      if (body) _renderQC(body);
    }
  });
  state.unsubscribers.push(() => { if (_unsubSession) { _unsubSession(); _unsubSession = null; } });
}
```

- [ ] **Export `setCostumeInnerTab` from `src/tracking/costumes.js`** (needed by the Manage tab above). Add after line 41 in costumes.js (alongside the existing `setActorInnerTab` pattern if it exists — otherwise add it):

```javascript
export function setCostumeInnerTab(tab) { activeInnerTab = tab; }
```

- [ ] **Verify:** Set a test account to `costume-designer` role. Open app → lands on Costumes tab. Quick Changes shows upcoming quick-change costumes. All Costumes tab shows the standard tracking grid. Manage tab shows add/edit UI (because `canManageCostumes` = true for this role).

- [ ] **Commit:**
```bash
git add src/costume-designer/costumer-dashboard.js src/costume-designer/costumer-dashboard.css src/tracking/costumes.js
git commit -m "feat: add Costume Designer dashboard (Quick Changes, All Costumes, Manage tabs)"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Role enum + overrides architecture (Tasks 1–2)
- ✅ Member doc `role`, `permissionOverrides`, `castLinkId` fields (Task 2)
- ✅ All isOwner() call sites migrated (Tasks 3–5)
- ✅ Firestore rules for ASM/Props Master/Costume Designer writes (Task 6)
- ✅ Permission-gated tab visibility (Task 7)
- ✅ Settings member management: role dropdown, cast link, override panel (Task 8)
- ✅ Actor dashboard: Live (page + props), My Notes (by run), Stats (Task 9)
- ✅ Director dashboard: By Actor, By Run, Page Heatmap, Cast (Task 10)
- ✅ Costume Designer dashboard: Quick Changes, All Costumes, Manage (Task 11)
- ✅ Unlinked actor state handled in Task 9
- ✅ Props filter via characters[] explained in Task 9

**Placeholder check:** No TBDs, TODOs, or "similar to Task N" references. Each task has complete code.

**Type consistency check:**
- `computePermissions` defined in Task 1, imported in Tasks 2 and 8 — ✅
- `can` exported in Task 1, imported with `{ isOwner, can }` in Tasks 3–7 — ✅
- `applyPermissionedTabVisibility` defined and exported in Task 7, imported in Task 7 (dashboard.js section) — ✅
- `navigateToDefaultTab` defined and exported in Task 7, imported in Task 7 (dashboard.js section) — ✅
- `onActorDashboardActivated` defined in Task 9, imported in Task 7 (tabs.js switch) — ✅
- `onDirectorDashboardActivated` defined in Task 10, imported in Task 7 — ✅
- `onCostumerDashboardActivated` defined in Task 11, imported in Task 7 — ✅
- `setCostumeInnerTab` added to costumes.js in Task 11, called in Task 11 — ✅
- `renderCostumesContent` already exported from costumes.js — ✅
