# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server on :3000
npm run build      # Production build → dist/
npm run preview    # Preview production build locally
npm run deploy     # vite build + firebase deploy (hosting + functions + rules)
```

No linter or test runner is configured. There are no tests.

**Admin CLI tools** (require `GOOGLE_APPLICATION_CREDENTIALS` set):
```bash
node admin/manage-productions.js list
node admin/manage-productions.js members <prodId>
node admin/manage-productions.js promote <prodId> <email>
node admin/manage-admins.js grant <email>
```

**Firebase functions deploy:**
```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
```

**Environment:** copy `.env.example` → `.env` and fill in the six `VITE_*` Firebase config vars.

## Architecture

Vanilla ES modules (no framework). State is a shared singleton; real-time reactivity comes from Firestore `onSnapshot` subscriptions.

### Entry point & app shell

`index.html` contains all CSS (CSS variables-based design system) and the minimal DOM shell. The JS entry is `src/main.js`, which initializes feature modules and manages the auth/session lifecycle.

`src/firebase.js` exports `auth`, `db`, `storage`, and `functions` — all modules import from here.

### Routing & state

- `src/shared/router.js` — hash router; URL pattern is `#/{prodId}/{tab}?params`
- `src/shared/state.js` — global singleton: `currentUser`, `activeProduction`, `activeRole`, `runSession`, etc.
- `src/shared/tabs.js` — maps tab names to module init functions

### Major feature modules

| Module | Key file(s) | Purpose |
|--------|-------------|---------|
| **Runshow** | `src/runshow/Runshow.js` (~2000 lines) | Core run session: PDF rendering, timer, stage columns widget, cue margin panel, session recovery |
| **Props** | `src/props/props.js` | Props tracking with cues, photos, pre/post-run checklists, timer |
| **Tracking** | `src/tracking/` | Multi-type tracking (props/actors/scenic/costumes) + locations config |
| **Linenotes** | `src/linenotes/linenotes.js` | PDF zone editor for tagging character names/stage directions; script cues |
| **Cast** | `src/cast/cast.js` | Cast & crew management; character assignments used by other modules |
| **Settings** | `src/settings/settings.js` | Production title, join code, locations CRUD |
| **Dashboard** | `src/dashboard/dashboard.js` | Production picker; create/join production flows |

### Tracking system

`src/tracking/core.js` provides `getItemStatus(item, page)` — the central function that computes an item's current location and state from cue data. It handles:
- **3-state items** (props, actors): Off → Hold → On
- **2-state items** (scenic, costumes): Off → On
- Legacy location alias resolution

`src/tracking/stage-widget.js` renders live status badges inside the runshow cue margin, refreshed on every cue transition.

### Session lifecycle & sync

`src/shared/session-sync.js` syncs run session state to Firestore every 10 seconds. On app load it detects any interrupted active sessions and offers resume/discard. Session state lives in `productions/{prodId}/sessions/{sessionId}`.

### PDF rendering

PDF.js (CDN, v3.11.174) is loaded in `index.html`. `src/shared/pdf-service.js` wraps it. Both Runshow and Linenotes load the same PDF; zones drawn in Linenotes map to page coordinates used in Runshow.

### Firestore data model (top level)

```
productions/{prodId}
  members/{userId}          role: owner | member
  props/{propId}            name, cues[], location, photos[]
  actorCues/{actorId}       name, cues[], defaultHoldLocation
  scenic/{scenicId}         2-state tracking items
  costumes/{costumeId}      2-state tracking items
  cast/{castId}             name, type, characters[], color
  sessions/{sessionId}      run session state + timer + hold log
  lineNotes/{noteId}        per-page script notes
  scriptCues/{cueId}        page-triggered cues (type, text, diagram)
  diagrams/{diagramId}      image uploads
  zones/{zoneId}            PDF coordinate zones (characters/stage directions)
  locations/{locId}         custom location names/sides/sort order
```

### Backend

`functions/index.js` — single callable Cloud Function `joinProduction(code)` that validates a join code and creates a member document.

`admin/` — Node.js CLI scripts using Firebase Admin SDK for production and superadmin management. These run outside Vite and import directly from `firebase-admin`.
