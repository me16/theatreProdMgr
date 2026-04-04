# Granular Roles & Permissions Design

**Date:** 2026-04-04  
**Status:** Approved for implementation

---

## Context

The app currently has two roles — `owner` and `member`. Members can view everything but configure nothing. This is fine for a small all-SM team, but excludes large parts of a theatre company who could benefit from the app if shown a focused, role-appropriate view.

This design adds a full roles/permissions system with 7 named roles, configurable per-member overrides, and three custom dashboards (Actor, Director, Costume Designer).

---

## Roles

| Role | Who | Gets |
|------|-----|------|
| `owner` | Stage Manager | Full access (unchanged) |
| `asm` | Assistant Stage Manager | Run sessions, take notes, manage props/actors/costumes — not cast/zones/script/settings |
| `director` | Director | Read-only analytics dashboard (notes by actor/run) + Cast tab |
| `actor` | Cast member | "My Show" mobile dashboard (live page, their props, their notes history, stats) |
| `costume-designer` | Costume Designer | Quick-change dashboard + full costume manage access |
| `props-master` | Props Master | Full props tab with manage access |
| `crew` | Crew | Live tracking view only |
| `member` | Legacy | Current member behavior preserved (full view, can take notes) |

---

## Permission Flags

### Capability flags (what you can do)

| Flag | owner | asm | director | actor | costume-designer | props-master | crew | member |
|------|:-----:|:---:|:--------:|:-----:|:----------------:|:------------:|:----:|:------:|
| `canRunSession` | ✓ | ✓ | | | | | | |
| `canTakeLineNotes` | ✓ | ✓ | | | | | | ✓ |
| `canManageProps` | ✓ | ✓ | | | | ✓ | | |
| `canManageActorCues` | ✓ | ✓ | | | | | | |
| `canManageCostumes` | ✓ | ✓ | | | ✓ | | | |
| `canManageCast` | ✓ | | | | | | | |
| `canEditZones` | ✓ | | | | | | | |
| `canUploadScript` | ✓ | | | | | | | |
| `canEditSettings` | ✓ | | | | | | | |

### Access flags (tab visibility)

| Flag | owner | asm | director | actor | costume-designer | props-master | crew | member |
|------|:-----:|:---:|:--------:|:-----:|:----------------:|:------------:|:----:|:------:|
| `hasRunshowAccess` | ✓ | ✓ | | | | | | ✓ |
| `hasPropsAccess` | ✓ | ✓ | | | | ✓ | | ✓ |
| `hasTrackingAccess` | ✓ | ✓ | | | ✓ | | ✓ | ✓ |
| `hasLinenotesAccess` | ✓ | ✓ | | | | | | ✓ |
| `hasCastAccess` | ✓ | ✓ | ✓ | | | | | ✓ |

### Dashboard flag

| Role | `dashboard` value |
|------|-------------------|
| actor | `'actor'` |
| director | `'director'` |
| costume-designer | `'costumer'` |
| all others | `null` |

Tab visibility is derived entirely from flags — there is no separate tab list.

---

## Data Model Changes

### Member documents

`productions/{prodId}/members/{userId}` gains two new fields:

```javascript
{
  // existing fields unchanged
  role: 'owner' | 'asm' | 'director' | 'actor' | 'costume-designer'
       | 'props-master' | 'crew' | 'member',  // NEW (was implicit owner/member)
  permissionOverrides: {          // NEW — optional, only set when diverging from role defaults
    hasPropsAccess: true,         // example: owner grants an actor the props tab
    canTakeLineNotes: true,       // example: specific crew member gets note-taking
    // ...any flag can be overridden
  },
  castLinkId: string | null,      // NEW — links to cast/{castId}; required for actor/costume-designer dashboards
}
```

Only flags that differ from the role's defaults are stored in `permissionOverrides`. The document is omitted entirely when no overrides exist.

### No other Firestore changes required.

---

## `src/shared/roles.js` Rewrite

```javascript
// ROLE_PERMISSIONS constant — only truthy flags listed per role; missing flags are
// implicitly false (can() uses !!state.permissions?.[flag], so undefined === false)
const ROLE_PERMISSIONS = {
  owner:              { canRunSession: true, canTakeLineNotes: true, canManageProps: true,
                        canManageActorCues: true, canManageCostumes: true, canManageCast: true,
                        canEditZones: true, canUploadScript: true, canEditSettings: true,
                        hasRunshowAccess: true, hasPropsAccess: true, hasTrackingAccess: true,
                        hasLinenotesAccess: true, hasCastAccess: true, dashboard: null },
  asm:                { canRunSession: true, canTakeLineNotes: true, canManageProps: true,
                        canManageActorCues: true, canManageCostumes: true,
                        hasRunshowAccess: true, hasPropsAccess: true, hasTrackingAccess: true,
                        hasLinenotesAccess: true, hasCastAccess: true, dashboard: null },
  director:           { hasCastAccess: true, dashboard: 'director' },
  actor:              { dashboard: 'actor' },
  'costume-designer': { canManageCostumes: true, hasTrackingAccess: true, dashboard: 'costumer' },
  'props-master':     { canManageProps: true, hasPropsAccess: true, dashboard: null },
  crew:               { hasTrackingAccess: true, dashboard: null },
  member:             { canTakeLineNotes: true, hasRunshowAccess: true, hasPropsAccess: true,
                        hasTrackingAccess: true, hasLinenotesAccess: true, hasCastAccess: true,
                        dashboard: null },
};

// computePermissions — merges role defaults with per-member overrides
// Called once at production-open time; result stored in state.permissions
export function computePermissions(role, overrides = {}) {
  const base = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['member'];
  return { ...base, ...overrides };
}

// Public helpers — rewrite existing helpers to read from state.permissions
export const isOwner = () => state.activeRole === 'owner' || state.isSuperAdmin;
export const can = (flag) => !!state.permissions?.[flag] || state.isSuperAdmin;

// Backwards-compatible aliases for existing call sites
export const canEditProps    = () => can('canManageProps');
export const canEditZones    = () => can('canEditZones');
export const canUploadScript = () => can('canUploadScript');
export const isMember        = () => !!state.activeRole;
```

`state.permissions` is populated in `src/dashboard/dashboard.js` at production-open time, after reading the member doc.

---

## Settings Tab: Member Management UI

The existing Members section of `src/settings/settings.js` is extended with:

- **Role dropdown** per member row — click to reassign role; owner row shows a locked "★ Owner" badge
- **Cast link column** — visible only for `actor` and `costume-designer` roles; shows linked character name (with colour dot) or an ⚠ "Link cast entry" warning button that opens a picker modal
- **Override panel** — ⚙ gear icon per member expands an inline panel of permission toggles; only non-default flags are shown as active; panel auto-saves on toggle

The cast link picker modal lists all `cast/{castId}` documents and lets the owner select one to bind to the member's `castLinkId`.

---

## Actor Dashboard (`dashboard: 'actor'`)

**Route:** `#/{prodId}/my-show` (default landing for actor role)  
**File:** `src/actor/actor-dashboard.js` (new)  
**Mobile-first CSS** — max-width 480px, large tap targets

### Three tabs (top nav bar, gold underline — matches app style)

**Live tab** (default)
- Green live banner showing current page + act, updated via `onSnapshot` on the active session doc
- Upcoming cue highlight: next prop pickup/handoff for their characters, sourced from `props` collection filtered to cues where `mover` matches their linked cast member's characters
- My Props list: all props the actor handles across the whole show (same filter as above)

**My Notes tab**
- List of past sessions (most recent first) where the actor has notes
- Notes filtered via `lineNotes` query: `where('actors', 'array-contains', {castId})` OR legacy `where('castId', '==', castId)`
- Most recent session expanded by default showing individual note pills (type badge + page + line text)
- Older sessions collapsed as single rows with note count badge

**Stats tab**
- Note type breakdown cards: Skips / Paras / Called / Added / Missed — counts across all runs
- Trouble spots bar chart: top pages by note frequency, gold bars
- Progress over runs: mini bar chart of note count per session — "trending down is good"

### Unlinked actor state
If `castLinkId` is null (owner hasn't linked yet), the dashboard renders a single placeholder card: "Contact your stage manager to link your cast profile." All three tabs are still shown but their content areas display the same message.

### Live session data source
Actor reads current page via a Firestore `onSnapshot` on the active session doc (queries `sessions` for the most recent `status: 'active'` doc). Read-only — no session controls exposed.

### Props filter
Prop cues have a `mover` free-text field containing a character name (e.g. `"Cinderella"`). Filter props to those having at least one cue where `cue.mover` is in the linked cast member's `characters[]` array. This runs client-side after fetching all props — no Firestore index needed.

---

## Director Dashboard (`dashboard: 'director'`)

**Route:** `#/{prodId}/director` (default landing)  
**File:** `src/director/director-dashboard.js` (new)

### Four tabs

**By Actor** (default)
- Summary stat cards: Total notes / Skips / Paras / Called — across filtered run set
- Run filter chips (all runs or a specific session)
- Per-actor table: character name + colour dot, note counts by type, mini trend bar (4 most recent runs)
- Click a row → drill-down view of that actor's full note list for the filtered runs

**By Run**
- Each run as a row; columns: date, total notes, skips, paras, lines called, duration
- Highlights runs where total notes increased vs. previous run

**Page Heatmap**
- Grid of page numbers, colour-coded by note density (gold → red scale)
- Click a page → list of all notes on that page across all actors

**Cast**
- Read-only view of `src/cast/cast.js` content — no edit controls rendered

---

## Costume Designer Dashboard (`dashboard: 'costumer'`)

**Route:** `#/{prodId}/costumes` (default landing)  
**File:** `src/costume-designer/costumer-dashboard.js` (new)

### Three tabs

**Quick Changes** (default)
- Live session banner: current page + summary counts (Active / QC soon / Off)
- Upcoming quick changes: costumes sorted by `enterPage`, filtered to changes where `durationMinutes` < 5 (or flagged `isQuickChange`), with urgency badges (red < 2 min, orange < 4 min, green otherwise)
- Completed changes: greyed-out list of changes already passed in this session

**All Costumes**
- The existing costumes tracking view (live on/off status grid)
- Same as what the regular Tracking > Costumes subtab shows today

**Manage**
- Full costume add/edit/delete — same UI as the owner-only Manage tab today
- Enabled because `canManageCostumes` is true for this role

---

## Firestore Rules

No new collections. Rules changes needed:

1. **Member doc reads**: Members can read their own member doc (to get `castLinkId`, `permissionOverrides`)
2. **Session reads**: All production members can read session docs (needed for Actor live page subscription)
3. **Cast reads**: All production members can read cast docs (needed for actor dashboard linking)
4. No rules changes needed for lineNotes, props, costumes — members already have read access

---

## Call Site Migration

Existing feature modules gate manage functionality via `isOwner()`. For ASMs (and other roles with manage flags) to work, those calls must migrate to `can()`:

| Module | Current call | Migrate to |
|--------|-------------|------------|
| `src/props/props.js` | `isOwner()` (manage tab, saveProp, deleteProp) | `can('canManageProps')` |
| `src/tracking/actors.js` | `isOwner()` (manage tab, import) | `can('canManageActorCues')` |
| `src/tracking/costumes.js` | `isOwner()` (manage tab, import) | `can('canManageCostumes')` |
| `src/cast/cast.js` | `isOwner()` (add/edit/remove) | `can('canManageCast')` |
| `src/linenotes/linenotes.js` | `isOwner()` (save zones, edit times) | `can('canEditZones')` |
| `src/linenotes/linenotes.js` | `isOwner()` (script upload prompt) | `can('canUploadScript')` |
| `src/settings/settings.js` | `isOwner()` (all settings edits) | `can('canEditSettings')` |
| `src/runshow/Runshow.js` | `isOwner()` (start/end session) | `can('canRunSession')` |
| `src/runshow/Runshow.js` | `isOwner()` (take line notes) | `can('canTakeLineNotes')` |

`isOwner()` is retained only for the Settings member-management section (only owners can assign roles/overrides) and the production owner badge display.

---

## Migration / Backwards Compatibility

- Existing member docs without a `role` field default to `'member'` at `computePermissions()` time — no migration needed
- All existing `isOwner()` / `canEditProps()` / `canEditZones()` call sites continue to work unchanged via the backwards-compatible aliases
- The join-code flow (`joinProduction` Cloud Function) continues to create members with `role: 'member'` — owner upgrades roles after the fact

---

## Verification

1. **Role assignment flow**: Join as a new member → owner opens Settings → assigns "Actor" role → links cast entry → member refreshes and lands on actor dashboard
2. **Permission enforcement**: Actor tries to navigate to `#/{prodId}/props` manually → redirected (no `hasPropsAccess`) unless owner granted override
3. **Live page sync**: Start a run session as owner → actor's Live tab updates page number in real time
4. **Director drill-down**: Director filters to a specific run → clicks an actor row → sees only that actor's notes for that run
5. **Costume Designer manage**: Costume Designer opens Manage tab → adds a new costume → appears in All Costumes tab and owner's Tracking tab
6. **Override toggle**: Owner opens ⚙ for a Crew member → enables `hasPropsAccess` → crew member now sees Props tab
7. **Legacy member**: Existing member doc with no `role` field → full view access preserved, can take line notes
