# Frontend Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all CSS from index.html into organized module files, establish a canonical token/component system, fix typography, unify the button/input/modal patterns, and merge the two-bar navigation into a single 56px bar.

**Architecture:** Vanilla ES modules — Vite handles CSS imported from main.js. All CSS currently lives in a single `<style>` block in index.html (~1348 lines). We extract it into `src/styles/` files imported from main.js, then layer the design system improvements on top. No JS behavior changes.

**Tech Stack:** Vanilla JS, Vite, Firebase, CSS custom properties, Google Fonts (Inter, Instrument Serif, DM Mono already loaded)

---

## Pre-flight facts (do not re-read these files — take these as given)

- `index.html` style block: lines 11–1348
- Existing `:root` tokens (lines 12–25): `--gold`, `--gold-light`, `--gold-muted`, `--gold-glow`, `--bg-deep/base/card/raised/border/hover`, `--text-primary/secondary/muted`, `--red/green/blue`, tracking colors, `--widget-tab-height`
- **Playfair Display** referenced in CSS at these lines: 139, 179, 192, 216, 255, 309, 369, 420, 428, 445, 470 — NOT in any JS file
- **`.app-tabbar`** NOT referenced in any JS file — safe to remove from HTML
- **`rsIsAnyModalOpen()`** in `Runshow.js:1797` uses `getElementById('run-report-modal')` + specific `.open` selectors — does NOT query `.modal-backdrop` directly
- Inline `z-index` in JS: `cue-margin.js:83` (15), `Runshow.js:1354` (4), `Runshow.js:1418` (5), `import-modal.js:32` (9999), `session-sync.js:72` (3000)
- Current nav HTML (lines 1387–1403): `.app-topbar` (logo, title, role badge, spacer, sign-out btn) + separate `.app-tabbar` div (5 `.app-tab` buttons)
- `tabs.js` uses `querySelectorAll('.app-tab')` — works regardless of where buttons live in DOM

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/styles/tokens.css` | Create | `:root` variables only — complete new token system |
| `src/styles/base.css` | Create | Reset, body, scrollbar, focus-visible, `.sr-only` |
| `src/styles/components.css` | Create | Toasts, canonical `.btn`/`.input`/modal classes, existing modal/button/badge variants |
| `src/styles/layout.css` | Create | `#app-view`, topbar, tabbar, tab panels |
| `src/styles/dashboard.css` | Create | Login overlay + dashboard view |
| `src/styles/tracking.css` | Create | Props/tracking/stage/check/timer/panel styles |
| `src/styles/runshow.css` | Create | All `.rs-*` styles, report, cue banner, diagrams |
| `src/styles/cast.css` | Create | Cast table, cast modal, color picker |
| `src/styles/settings.css` | Create | Settings fields, production panel, member list |
| `src/styles/linenotes.css` | Create | Line notes overlay, zone editor, note popover |
| `src/main.js` | Modify | Add 10 CSS imports at top |
| `index.html` | Modify | Remove `<style>` block; restructure nav HTML (Task 16) |
| `src/runshow/cue-margin.js` | Modify | z-index:15 → var(--z-popover) |
| `src/shared/import-modal.js` | Modify | z-index:9999 → var(--z-modal) |
| `src/shared/session-sync.js` | Modify | z-index:3000 → var(--z-modal) |

---

## Task 1: Create tokens.css

**Files:**
- Create: `src/styles/tokens.css`

- [ ] **Step 1: Create the file**

```css
/* src/styles/tokens.css */
:root {
  /* GOLD */
  --gold-dim:    #9A7A3C;
  --gold:        #C8A050;
  --gold-light:  #DCBE6A;
  --gold-subtle: rgba(200,160,80,0.12);
  --gold-glow:   rgba(200,160,80,0.18);

  /* BACKGROUNDS */
  --bg-deep:   #0B0B14;
  --bg-base:   #111120;
  --bg-card:   #171728;
  --bg-raised: #1E1E32;
  --bg-border: #2A2A42;
  --bg-hover:  #222236;

  /* TEXT */
  --text-primary:   #E8E8F0;
  --text-secondary: #9898B0;
  --text-muted:     #5C5C72;

  /* SEMANTIC */
  --red:   #E04050;
  --green: #38A060;
  --blue:  #5B9BD4;

  /* TRACKING TYPE */
  --track-prop:    #C8A96E;
  --track-actor:   #5B9BD4;
  --track-scenic:  #6B8F4E;
  --track-costume: #9B7BC8;

  /* TRACKING STATE */
  --state-hold: #D4AF37;
  --state-on:   #4CAF50;
  --state-off:  #555555;
  --qc-alert:   #E89B3E;

  /* SPACING */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* BORDER RADIUS */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* SHADOWS */
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.4);
  --shadow-lg: 0 24px 80px rgba(0,0,0,0.5);

  /* Z-INDEX SCALE */
  --z-base:    1;
  --z-sticky:  10;
  --z-overlay: 50;
  --z-header:  60;
  --z-popover: 100;
  --z-modal:   300;
  --z-toast:   9999;
  --z-login:   10000;

  /* WIDGET LAYOUT */
  --widget-tab-height: 30px;
}
```

- [ ] **Step 2: Verify no stale `--gold-muted` references remain after later tasks**

Note: existing code uses `--gold-muted` in a handful of places. The new name is `--gold-subtle`. When applying the token grep-replace in Task 13, replace `var(--gold-muted)` → `var(--gold-subtle)` across all CSS files.

---

## Task 2: Create base.css

**Files:**
- Create: `src/styles/base.css`

- [ ] **Step 1: Create the file**

Extract from index.html lines 87–121 (reset through scrollbar + toast keyframes), then add new focus-visible rule:

```css
/* src/styles/base.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: 'Inter', sans-serif;
  background: linear-gradient(135deg, var(--bg-deep) 0%, #1a1a2e 100%);
  color: var(--text-primary);
  line-height: 1.5;
}
button { cursor: pointer; font-family: inherit; }
input, select, textarea { font-family: inherit; }
a { color: inherit; text-decoration: none; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bg-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* Keyboard focus */
:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.input:focus-visible { outline: none; }

/* Accessibility */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

/* Toast keyframes */
@keyframes toastIn  { to { opacity: 1; transform: translateY(0); } }
@keyframes toastOut { to { opacity: 0; transform: translateY(-8px); } }

/* Modal animation */
@keyframes modalIn {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

---

## Task 3: Create components.css

**Files:**
- Create: `src/styles/components.css`

- [ ] **Step 1: Create the file**

This file contains: toasts, canonical btn/input/modal systems, existing button variants (modal-btn-*, settings-btn, etc.), badges, upload-progress, heartbeat.

```css
/* src/styles/components.css */

/* ===== TOASTS ===== */
#toast-container {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: var(--z-toast); display: flex; flex-direction: column;
  align-items: center; gap: 8px; pointer-events: none;
}
.toast {
  padding: 10px 24px; border-radius: var(--radius-md); font-size: 14px; font-weight: 500;
  color: #fff; opacity: 0; transform: translateY(12px);
  animation: toastIn 0.3s forwards, toastOut 0.3s 2.2s forwards;
  pointer-events: auto; white-space: nowrap;
}
.toast--info    { background: var(--bg-raised); border: 1px solid var(--bg-border); }
.toast--error   { background: #6b1520; border: 1px solid var(--red); }
.toast--success { background: #1a4a2a; border: 1px solid var(--green); }
.toast--warn    { background: #3a2a00; border: 1px solid var(--qc-alert); }

/* ===== CANONICAL BUTTON SYSTEM ===== */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  padding: 7px 16px; border-radius: var(--radius-md); border: 1px solid transparent;
  font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s; white-space: nowrap; text-decoration: none;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--primary { background: var(--gold); color: var(--bg-deep); border-color: var(--gold); font-weight: 600; }
.btn--primary:hover:not(:disabled) { background: var(--gold-light); border-color: var(--gold-light); }
.btn--secondary { background: transparent; color: var(--text-secondary); border-color: var(--bg-border); }
.btn--secondary:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); }
.btn--danger { background: transparent; color: var(--text-secondary); border-color: var(--bg-border); }
.btn--danger:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
.btn--sm { padding: 4px 10px; font-size: 11px; border-radius: var(--radius-sm); }
.btn--icon { padding: 6px; border-radius: var(--radius-md); aspect-ratio: 1; }

/* ===== CANONICAL INPUT SYSTEM ===== */
.input {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-deep);
  border: 1px solid var(--bg-border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 3px var(--gold-subtle);
}
.input::placeholder { color: var(--text-muted); }
.input:disabled { opacity: 0.5; cursor: not-allowed; }

/* ===== CANONICAL MODAL SYSTEM ===== */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.65);
  z-index: var(--z-modal);
  display: none; align-items: center; justify-content: center;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: var(--bg-card);
  border: 1px solid var(--bg-border);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  width: 480px; max-width: 90vw; max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: modalIn 0.15s ease-out;
}
.modal-title {
  font-family: 'Instrument Serif', serif;
  font-size: 20px; color: var(--gold);
  margin-bottom: var(--space-5);
}
.modal-footer {
  display: flex; gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--bg-border);
}

/* Existing modal card (used by create/join/linenotes modals) */
.modal-card {
  background: var(--bg-card); border: 1px solid var(--bg-border);
  border-radius: var(--radius-lg); padding: var(--space-8);
  width: 420px; max-width: 90vw;
}
.modal-card h2 {
  font-family: 'Instrument Serif', serif; font-size: 20px;
  color: var(--gold); margin-bottom: var(--space-5);
}
.modal-card label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
.modal-card input[type="text"], .modal-card input[type="file"] {
  width: 100%; padding: 10px 14px; margin-bottom: var(--space-4);
  background: var(--bg-deep); border: 1px solid var(--bg-border);
  border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; outline: none;
}
.modal-card input:focus { border-color: var(--gold); }
.modal-btns { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
.modal-btn-primary {
  padding: 8px 20px; background: var(--gold); color: var(--bg-deep);
  border: none; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600;
}
.modal-btn-primary:hover { background: var(--gold-light); }
.modal-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn-cancel {
  padding: 8px 20px; background: transparent;
  border: 1px solid var(--bg-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); font-size: 13px;
}
.modal-btn-cancel:hover { border-color: var(--text-muted); color: var(--text-primary); }

/* Unified cue modal (used by some modules) */
.cue-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.65);
  z-index: var(--z-modal); display: none;
  align-items: center; justify-content: center;
}
.cue-modal-backdrop.cue-modal--visible { display: flex; }
.cue-modal-backdrop.cue-modal--closing { opacity: 0; transition: opacity 0.15s; }
.cue-modal-card {
  background: var(--bg-card); border: 1px solid var(--bg-border);
  border-radius: var(--radius-lg); padding: var(--space-8);
  width: 480px; max-width: 90vw; max-height: 90vh; overflow-y: auto;
  box-shadow: var(--shadow-lg); animation: modalIn 0.15s ease-out;
}
.cue-modal--visible .cue-modal-card { animation: modalIn 0.15s ease-out; }
.cue-modal-title { font-family: 'Instrument Serif', serif; font-size: 20px; color: var(--gold); margin-bottom: var(--space-5); }
.cue-modal-body { margin-bottom: var(--space-5); }
.cue-modal-buttons { display: flex; gap: var(--space-2); justify-content: flex-end; }

/* Upload progress */
.upload-progress {
  width: 100%; height: 4px; background: var(--bg-border);
  border-radius: 2px; margin-bottom: var(--space-3);
  overflow: hidden; display: none;
}
.upload-progress-bar { height: 100%; background: var(--gold); width: 0%; transition: width 0.3s; }

/* Badges */
.role-badge {
  display: inline-block; padding: 2px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
}
.role-badge--owner  { background: var(--gold); color: var(--bg-deep); }
.role-badge--member { background: var(--bg-raised); color: var(--text-secondary); }

/* Heartbeat */
.heartbeat-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-muted); transition: background 0.5s;
}
.heartbeat--healthy { background: var(--green); }
.heartbeat--stale   { background: var(--red); }

/* Typography utilities */
.text-display { font-family: 'Instrument Serif', serif; }
.text-mono    { font-family: 'DM Mono', monospace; }
.text-label   { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); }

/* Empty state */
.empty-state { text-align: center; padding: 60px 24px; color: var(--text-muted); }
.empty-state-icon  { font-size: 32px; margin-bottom: var(--space-3); opacity: 0.4; }
.empty-state-title { font-size: 16px; color: var(--text-secondary); margin-bottom: var(--space-2); }
.empty-state-sub   { font-size: 13px; margin-bottom: var(--space-5); }
/* Legacy aliases */
.empty-state-headline { font-size: 16px; color: var(--text-secondary); margin-bottom: var(--space-2); }
.empty-state-subtext  { font-size: 13px; }
```

---

## Task 4: Create layout.css

**Files:**
- Create: `src/styles/layout.css`

- [ ] **Step 1: Create the file**

```css
/* src/styles/layout.css */
#app-view {
  background: var(--bg-base); position: fixed; inset: 0;
  display: none; flex-direction: column; z-index: var(--z-overlay);
}

/* Single unified navigation bar (56px) — Phase 9 target */
.app-topbar {
  display: flex; align-items: center;
  height: 56px; padding: 0 var(--space-4); gap: var(--space-3);
  background: var(--bg-base); border-bottom: 1px solid var(--bg-border);
  flex-shrink: 0; z-index: var(--z-header);
}
.app-topbar-logo {
  font-family: 'Instrument Serif', serif; font-size: 20px;
  color: var(--gold); letter-spacing: 3px; cursor: pointer;
  padding-right: var(--space-4); border-right: 1px solid var(--bg-border);
  flex-shrink: 0;
}
.app-topbar-logo:hover { opacity: 0.75; }
.app-topbar-title {
  font-size: 13px; color: var(--text-secondary);
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.app-topbar-tabs {
  display: flex; align-items: center; gap: 2px;
  margin-left: auto;
}
.app-tab {
  height: 36px; padding: 0 var(--space-4);
  background: none; border: none; border-radius: var(--radius-sm);
  color: var(--text-muted); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.app-tab:hover     { color: var(--text-secondary); background: var(--bg-raised); }
.app-tab--active   { color: var(--gold); background: var(--gold-subtle); }

/* Kept during extraction; removed from HTML in Task 16 */
.app-tabbar {
  display: flex; background: var(--bg-base); border-bottom: 1px solid var(--bg-border);
  padding: 0 8px; flex-shrink: 0;
}

.app-tab-content { flex: 1; overflow: hidden; position: relative; display: flex; flex-direction: column; }
.tab-panel { display: none; flex: 1; overflow: hidden; flex-direction: column; }
.tab-panel--active { display: flex; }

.topbar-btn {
  background: none; border: 1px solid var(--bg-border);
  color: var(--text-muted); font-size: 12px; padding: 5px 12px;
  border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s;
}
.topbar-btn:hover { border-color: var(--gold); color: var(--gold); }
```

---

## Task 5: Create dashboard.css

**Files:**
- Create: `src/styles/dashboard.css`

Extract login overlay + dashboard styles from index.html lines 123–205. Replace all hardcoded hex with tokens, replace Playfair with Instrument Serif.

- [ ] **Step 1: Create the file**

```css
/* src/styles/dashboard.css */

/* ===== LOGIN OVERLAY ===== */
#login-overlay {
  position: fixed; inset: 0; z-index: var(--z-login);
  background: radial-gradient(ellipse at center, var(--bg-deep) 0%, #000 100%);
  display: flex; align-items: center; justify-content: center;
}
.login-card {
  background: var(--bg-card); border: 1px solid var(--bg-border);
  border-radius: var(--radius-xl); padding: 48px 40px;
  width: 380px; max-width: 90vw; text-align: center;
  box-shadow: var(--shadow-lg);
}
.login-card h1 {
  font-family: 'Instrument Serif', serif; font-size: 56px;
  color: var(--gold); margin-bottom: 4px; letter-spacing: 4px;
}
.login-card .subtitle {
  font-family: 'Instrument Serif', serif; font-size: 14px;
  color: var(--text-secondary); margin-bottom: 32px; letter-spacing: 1px;
}
.login-card input {
  width: 100%; padding: 12px 16px; margin-bottom: 12px;
  background: var(--bg-deep); border: 1px solid var(--bg-border);
  border-radius: var(--radius-md); color: var(--text-primary);
  font-size: 14px; outline: none; transition: border-color 0.2s;
}
.login-card input:focus { border-color: var(--gold); }
.login-card input::placeholder { color: var(--text-muted); }
.login-btn {
  width: 100%; padding: 12px; margin-top: 8px;
  background: var(--gold); color: var(--bg-deep); border: none;
  border-radius: var(--radius-md); font-size: 15px; font-weight: 600;
  letter-spacing: 0.5px; transition: background 0.2s;
}
.login-btn:hover    { background: var(--gold-light); }
.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.login-error { color: var(--red); font-size: 13px; margin-top: 12px; min-height: 20px; }
.login-forgot-link { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.login-forgot-link:hover { color: var(--text-secondary); }

/* ===== DASHBOARD ===== */
#dashboard-view {
  position: fixed; inset: 0; z-index: var(--z-popover);
  background: linear-gradient(135deg, var(--bg-deep) 0%, #1a1a2e 100%);
  overflow-y: auto; display: none;
}
.dash-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--bg-border);
  background: var(--bg-base); position: sticky; top: 0; z-index: var(--z-sticky);
}
.dash-header .logo {
  font-family: 'Instrument Serif', serif; font-size: 28px;
  color: var(--gold); letter-spacing: 3px;
}
.dash-header-right { display: flex; align-items: center; gap: 12px; }
.dash-header .user-email { font-size: 13px; color: var(--text-secondary); }
.dash-logout-btn {
  padding: 6px 16px; background: transparent; border: 1px solid var(--bg-border);
  color: var(--text-secondary); border-radius: var(--radius-sm); font-size: 13px; transition: all 0.2s;
}
.dash-logout-btn:hover { border-color: var(--red); color: var(--red); }
.dash-body { max-width: 960px; margin: 0 auto; padding: var(--space-8) var(--space-6); }
.dash-section-title {
  font-family: 'Instrument Serif', serif; font-size: 22px;
  color: var(--gold); margin-bottom: var(--space-5);
}
.dash-actions { display: flex; gap: 12px; margin-bottom: var(--space-8); flex-wrap: wrap; }
.dash-action-btn {
  padding: 10px 20px; background: var(--bg-card); border: 1px dashed var(--gold);
  color: var(--gold); border-radius: var(--radius-md); font-size: 14px; transition: all 0.2s;
}
.dash-action-btn:hover { background: var(--bg-raised); }
.productions-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4);
}
.production-card {
  background: var(--bg-card); border: 1px solid var(--bg-border);
  border-radius: var(--radius-lg); padding: var(--space-5); transition: border-color 0.2s;
}
.production-card--owner { border-left: 3px solid var(--gold); }
.production-card:hover { border-color: var(--gold); }
.production-card h3 {
  font-family: 'Instrument Serif', serif; font-size: 18px;
  color: var(--text-primary); margin-bottom: 8px;
}
.production-card .meta  { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
.production-card .open-btn {
  margin-top: 12px; padding: 8px 20px; background: var(--gold);
  color: var(--bg-deep); border: none; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600; transition: background 0.2s;
}
.production-card .open-btn:hover { background: var(--gold-light); }
```

---

## Task 6: Create tracking.css

**Files:**
- Create: `src/styles/tracking.css`

Extract from index.html: props subtabs, tracking type tabs, prop form, cue rows, props table, stage nav/columns/props, prop photos, prop notes modal, pre/post check, timer panel, production panel.

- [ ] **Step 1: Create the file**

```css
/* src/styles/tracking.css */

/* Subtabs */
.props-subtabs { display: flex; border-bottom: 1px solid var(--bg-border); padding: 0 var(--space-6); background: var(--bg-base); flex-shrink: 0; }
.props-subtab { height: 40px; padding: 0 var(--space-4); background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.props-subtab:hover     { color: var(--text-secondary); }
.props-subtab--active   { color: var(--gold); border-bottom-color: var(--gold); }
.props-content { flex: 1; overflow-y: auto; padding: var(--space-6); }

/* Tracking type tabs */
.tracking-type-tabs { display: flex; gap: 8px; flex-wrap: wrap; padding: var(--space-4) var(--space-6) 0; background: var(--bg-base); }
.tracking-type-tab {
  padding: 6px 16px; background: var(--bg-raised); border: 1px solid var(--bg-border);
  color: var(--text-secondary); border-radius: 20px; font-size: 12px; cursor: pointer; transition: all 0.2s;
  display: flex; align-items: center; gap: 6px;
}
.tracking-type-tab:hover { border-color: var(--gold); color: var(--gold); }
.tracking-type-tab--active { border-color: var(--gold); color: var(--gold); background: var(--gold-subtle); }
.tracking-type-tab--active[data-track-type="props"]    { border-color: var(--track-prop);    color: var(--track-prop);    background: rgba(200,169,110,0.10); }
.tracking-type-tab--active[data-track-type="actors"]   { border-color: var(--track-actor);   color: var(--track-actor);   background: rgba(91,155,212,0.10); }
.tracking-type-tab--active[data-track-type="scenic"]   { border-color: var(--track-scenic);  color: var(--track-scenic);  background: rgba(107,143,78,0.10); }
.tracking-type-tab--active[data-track-type="costumes"] { border-color: var(--track-costume); color: var(--track-costume); background: rgba(155,123,200,0.10); }
.tracking-type-tab .tracking-badge { display: inline-block; min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px; background: var(--bg-border); color: var(--text-secondary); font-size: 10px; font-weight: 600; text-align: center; line-height: 16px; }
.tracking-type-tab .tracking-badge--alert { background: var(--qc-alert); color: var(--bg-deep); }

/* Prop form */
.prop-form { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-md); padding: 20px; margin-bottom: var(--space-4); }
.prop-form h3 { font-family: 'Instrument Serif', serif; font-size: 18px; color: var(--gold); margin-bottom: var(--space-4); }
.form-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.form-row label { font-size: 12px; color: var(--text-muted); min-width: 80px; }
.form-input { flex: 1; min-width: 120px; padding: 8px 12px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; outline: none; }
.form-input:focus { border-color: var(--gold); }
.form-select { padding: 8px 12px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; outline: none; }

/* Cue rows */
.cue-rows { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.cue-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cue-row .cue-num { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--text-muted); min-width: 28px; }
.cue-row .arrow { color: var(--text-muted); }
.cue-row input { width: 60px; padding: 5px 8px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 12px; outline: none; }
.cue-row select { padding: 5px 8px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 12px; outline: none; }
.cue-row .carrier-input { width: 100px; }
.cue-row .remove-cue-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 0 4px; }
.cue-row .remove-cue-btn:hover { color: var(--red); }
.add-cue-btn { background: none; border: 1px dashed var(--bg-border); color: var(--text-muted); padding: 5px 12px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.add-cue-btn:hover { border-color: var(--gold); color: var(--gold); }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: var(--space-4); }

/* Props table */
.props-table-wrap { overflow-x: auto; }
.props-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.props-table th { text-align: left; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 10px; border-bottom: 1px solid var(--bg-border); position: sticky; top: 0; background: var(--bg-base); z-index: var(--z-sticky); }
.props-table td { padding: 10px; border-bottom: 1px solid var(--bg-border); vertical-align: middle; }
.props-table tr:hover td { background: var(--bg-hover); }
.cue-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; margin: 1px; font-family: 'DM Mono', monospace; }
.cue-tag--enter { background: rgba(56,160,96,0.2); color: var(--green); }
.cue-tag--exit  { background: rgba(224,64,80,0.2);  color: var(--red); }

/* Stage navigation */
.stage-nav { display: flex; align-items: center; gap: 8px; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--bg-border); background: var(--bg-base); flex-shrink: 0; }
.stage-nav .page-display { font-family: 'DM Mono', monospace; font-size: 13px; color: var(--text-secondary); }
.stage-nav button { background: none; border: 1px solid var(--bg-border); color: var(--text-secondary); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.stage-nav button:hover { border-color: var(--gold); color: var(--gold); }
.stage-columns { display: flex; flex: 1; gap: 1px; overflow: hidden; }
.stage-col { flex: 1; display: flex; flex-direction: column; background: var(--bg-card); border-right: 1px solid var(--bg-border); overflow-y: auto; padding: var(--space-3); }
.stage-col--sl { }
.stage-col--on { background: rgba(200,160,80,0.04); }
.stage-col--sr { border-right: none; }
.stage-col h4 { font-family: 'Instrument Serif', serif; font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 12px; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
.stage-prop { background: var(--bg-raised); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); padding: 6px 10px; margin-bottom: 6px; cursor: pointer; transition: border-color 0.15s; }
.stage-prop:hover { border-color: var(--gold); }
.stage-prop--warn { border-color: var(--qc-alert); }
.stage-prop--crossover { border-color: var(--red); }
.stage-prop--crossover.stage-prop--warn { border-color: var(--red); }
.prop-crossover-alert { font-size: 10px; color: var(--red); margin-top: 3px; }
.prop-crossover-alert em { font-style: normal; }
.cue-crossover-alert { font-size: 10px; color: var(--qc-alert); }
.cue-enter-loc { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.cue-mover { font-size: 10px; color: var(--track-actor); margin-top: 2px; }
.stage-prop .prop-name    { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.stage-prop .prop-carrier { font-size: 11px; color: var(--text-muted); }

/* Prop photos */
.prop-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: var(--radius-sm); cursor: pointer; border: 1px solid var(--bg-border); }
.prop-thumb:hover { border-color: var(--gold); }
.prop-thumb-check { display: none; }
.prop-photo-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: var(--z-modal); display: flex; align-items: center; justify-content: center; cursor: zoom-out; }
.prop-photo-lightbox img { max-width: 90vw; max-height: 90vh; border-radius: var(--radius-md); }
.prop-photo-preview { width: 100%; max-height: 200px; object-fit: contain; border-radius: var(--radius-sm); margin-bottom: 8px; }
.prop-photo-upload-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.prop-photo-clear-btn { background: none; border: 1px solid var(--bg-border); color: var(--text-muted); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 11px; cursor: pointer; }
.prop-photo-clear-btn:hover { border-color: var(--red); color: var(--red); }
.prop-notes-photo { width: 100%; max-height: 180px; object-fit: contain; border-radius: var(--radius-sm); margin-bottom: 8px; }

/* Prop notes modal */
.prop-notes-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: var(--z-modal); display: flex; align-items: center; justify-content: center; }
.prop-notes-card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-lg); padding: var(--space-6); width: 480px; max-width: 92vw; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); }
.prop-notes-card h3 { font-family: 'Instrument Serif', serif; font-size: 18px; color: var(--gold); margin-bottom: 12px; }
.prop-notes-card .cue-summary { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }
.prop-notes-card textarea { width: 100%; min-height: 100px; padding: 10px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; outline: none; resize: vertical; }
.prop-notes-card textarea:focus { border-color: var(--gold); }
.prop-notes-card textarea:disabled { opacity: 0.5; }

/* Pre/post check */
.check-section { margin-bottom: var(--space-6); }
.check-section h3 { font-family: 'Instrument Serif', serif; font-size: 18px; color: var(--gold); margin-bottom: 4px; }
.check-progress { display: flex; align-items: center; gap: 8px; margin-bottom: var(--space-4); }
.check-progress .badge { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.check-progress .badge--done    { background: rgba(56,160,96,0.2); color: var(--green); }
.check-progress .badge--pending { background: var(--bg-raised); color: var(--text-secondary); }
.check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.check-card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-md); padding: 12px; cursor: pointer; transition: all 0.15s; }
.check-card:hover { border-color: var(--gold); }
.check-card--checked { background: rgba(56,160,96,0.08); border-color: var(--green); }
.check-card .check-name   { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.check-card .check-detail { font-size: 11px; color: var(--text-muted); margin-top: 3px; }
.check-card .check-mark   { font-size: 18px; float: right; }
.reset-checks-btn { background: none; border: 1px solid var(--bg-border); color: var(--text-muted); padding: 5px 12px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.reset-checks-btn:hover { border-color: var(--red); color: var(--red); }

/* Timer */
.timer-panel { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-md); padding: 16px; margin-bottom: var(--space-4); }
.timer-panel h3 { font-family: 'Instrument Serif', serif; font-size: 16px; color: var(--gold); margin-bottom: 12px; }
.timer-inputs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.timer-inputs label { font-size: 11px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px; }
.timer-inputs input { padding: 6px 10px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; outline: none; width: 80px; }
.timer-inputs input:focus { border-color: var(--gold); }
.timer-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.timer-btn { padding: 7px 14px; border: 1px solid var(--bg-border); border-radius: var(--radius-sm); background: none; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s; }
.timer-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.timer-btn--start { border-color: var(--green); color: var(--green); }
.timer-btn--hold  { border-color: var(--state-hold); color: var(--state-hold); }
.timer-btn--stop  { border-color: var(--red); color: var(--red); }
.timer-progress { height: 4px; background: var(--bg-border); border-radius: 2px; overflow: hidden; }
.timer-progress-bar { height: 100%; background: var(--gold); width: 0%; transition: width 1s linear; }
.timer-display { font-family: 'DM Mono', monospace; font-size: 24px; color: var(--text-primary); margin-bottom: 8px; }

/* Production panel */
#production-panel {
  position: fixed; top: 0; right: -380px; width: 380px; height: 100%;
  background: var(--bg-card); border-left: 1px solid var(--bg-border);
  z-index: var(--z-modal); transition: right 0.3s ease; overflow-y: auto;
  display: flex; flex-direction: column;
}
#production-panel.open { right: 0; }
#production-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: calc(var(--z-modal) - 1); display: none;
}
#production-backdrop.open { display: block; }
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid var(--bg-border); }
.panel-header h2 { font-family: 'Instrument Serif', serif; font-size: 20px; color: var(--gold); }
.panel-close { background: none; border: none; color: var(--text-muted); font-size: 24px; cursor: pointer; }
.panel-close:hover { color: var(--text-primary); }
.panel-section { padding: 16px 20px; border-bottom: 1px solid var(--bg-border); }
.panel-section h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 12px; }
.panel-section input[type="text"] { width: 100%; padding: 8px 12px; background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; outline: none; margin-bottom: 8px; }
.panel-section input:focus { border-color: var(--gold); }
.join-code-display { font-family: 'DM Mono', monospace; font-size: 22px; letter-spacing: 4px; color: var(--text-primary); margin-bottom: 8px; }
.join-code-inactive { opacity: 0.4; }
.panel-btn { padding: 7px 14px; background: none; border: 1px solid var(--bg-border); color: var(--text-secondary); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; margin-right: 6px; margin-bottom: 6px; }
.panel-btn:hover { border-color: var(--gold); color: var(--gold); }
.panel-btn--danger:hover { border-color: var(--red); color: var(--red); }
.member-list { display: flex; flex-direction: column; gap: 8px; }
.member-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; background: var(--bg-raised); border-radius: var(--radius-sm); }
.member-item .member-email { font-size: 13px; color: var(--text-secondary); }
.member-item .member-actions { display: flex; gap: 6px; }
.member-item .member-actions button { background: none; border: 1px solid var(--bg-border); color: var(--text-muted); padding: 3px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; }
.member-item .member-actions button:hover { border-color: var(--gold); color: var(--gold); }
.member-item .member-actions .remove-btn:hover { border-color: var(--red); color: var(--red); }

/* Danger zone */
.danger-zone { border: 1px solid var(--bg-border); border-radius: var(--radius-md); overflow: hidden; }
.danger-zone-header { padding: 12px 16px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
.danger-zone-header:hover { color: var(--red); }
.danger-zone-content { display: none; padding: 16px; border-top: 1px solid var(--bg-border); }
.danger-zone.open .danger-zone-content { display: block; }
```

---

## Task 7: Create runshow.css

**Files:**
- Create: `src/styles/runshow.css`

Extract all `.rs-*` styles plus report, cue banner, diagram, email/send-notes styles from index.html.

- [ ] **Step 1: Create the file**

Copy all CSS rules in index.html whose selectors begin with `.rs-`, `.run-`, `#run-`, `.sw-`, `#rs-`, `.diagram-`, `.email-`, `.send-notes-`, `.note-item`, `.note-type-btn`, `.note-color-bar`, `.note-popover`, `.popover-*`, `.processing-`, `.heartbeat-` (runshow context), plus `.cue-type-badge*`, `.cue-banner`, `.cue-pill`, `.cue-marker`.

The complete content of this file from the existing CSS is the collection of those rules. During extraction replace all hardcoded hex values with tokens per the mapping in Task 13. Key z-index replacements:

- `.cast-modal`: `z-index: 500` → `z-index: var(--z-modal)`
- `#linenotes-overlay`: `z-index: 600` → `z-index: var(--z-modal)` (note: overlay, not modal in this context — keep as var(--z-modal) since it covers the app)
- `.run-report-modal`: `z-index: 3000` → `z-index: var(--z-modal)`
- `.rs-note-popover`, `.run-note-popover`: `z-index: 900` → `z-index: var(--z-popover)`
- `.rs-bookmarks-menu`: raw z-index → `var(--z-popover)`
- `.run-show-fab`: `z-index: 500` → `z-index: var(--z-overlay)`

The full CSS block for this file is all `.rs-*`, `.sw-*`, `#rs-*`, `.run-*`, `.diagram-*`, `.email-*`, `.send-notes-*`, `.rs-actor-pill`, `.rs-report-*`, `.cue-type-badge*`, `.rs-cue-*` rules from index.html with tokens substituted. **(Read index.html lines 480–900 to extract these — they appear in that range.)**

---

## Task 8: Create cast.css

**Files:**
- Create: `src/styles/cast.css`

- [ ] **Step 1: Create the file**

The cast styles were already extracted to `src/styles/components.css` partially (the `.cast-*` rules appear at lines 39–85 of index.html). Extract all `.cast-*`, `.char-chip*`, `.color-swatch`, `.cast-picker*`, `.char-modal*`, `.char-color-*`, `.opt-char` rules:

```css
/* src/styles/cast.css */
.cast-tab-content { flex: 1; overflow-y: auto; padding: var(--space-6); }
.cast-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-5); }

/* cast-add-btn composes .btn.btn--primary — kept for backward compat */
.cast-add-btn { background: var(--gold); color: var(--bg-deep); border: none; padding: 7px 16px; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }
.cast-add-btn:hover { background: var(--gold-light); }

.cast-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cast-table th { text-align: left; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 10px; border-bottom: 1px solid var(--bg-border); }
.cast-table td { padding: 10px; border-bottom: 1px solid var(--bg-border); vertical-align: middle; }
.cast-member-name { font-weight: 600; color: var(--text-primary); }
.cast-member-email { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--text-muted); }
.cast-characters { display: flex; flex-wrap: wrap; gap: 4px; }
.char-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--bg-raised); border: 1px solid var(--bg-border); border-radius: 20px; padding: 2px 8px; font-size: 11px; color: var(--text-secondary); }
.char-chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.cast-actions { white-space: nowrap; }
.cast-action-btn { background: none; border: 1px solid var(--bg-border); color: var(--text-secondary); font-size: 11px; padding: 3px 10px; border-radius: var(--radius-sm); cursor: pointer; margin-right: 4px; }
.cast-action-btn:hover { border-color: var(--gold); color: var(--gold); }
.cast-action-btn--danger:hover { border-color: var(--red); color: var(--red); }

.cast-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: var(--z-modal); display: none; align-items: center; justify-content: center; }
.cast-modal.open { display: flex; }
.cast-modal-card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-lg); padding: var(--space-6); width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); }
.cast-modal-field { margin-bottom: 14px; }
.cast-modal-field label { display: block; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
.char-chips-editor { display: flex; flex-wrap: wrap; gap: 6px; min-height: 28px; padding: 4px 0; margin-bottom: 6px; }
.char-chip-editable { display: inline-flex; align-items: center; gap: 4px; background: var(--bg-raised); border: 1px solid var(--bg-border); border-radius: 20px; padding: 3px 8px; font-size: 12px; color: var(--text-secondary); }
.chip-remove { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.char-chip-add-row { display: flex; align-items: center; gap: 6px; }
.color-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.color-swatch { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
.color-swatch--selected { border-color: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,0.15); }
.cast-picker { position: relative; }
.cast-picker-input { width: 100%; }
.cast-picker-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); box-shadow: var(--shadow-md); max-height: 200px; overflow-y: auto; display: none; z-index: var(--z-popover); margin-top: 2px; }
.cast-picker-dropdown.open { display: block; }
.cast-picker-option { padding: 8px 12px; cursor: pointer; font-size: 13px; color: var(--text-secondary); }
.cast-picker-option:hover { background: var(--bg-hover); color: var(--text-primary); }
.opt-char { font-size: 10px; color: var(--text-muted); font-family: 'DM Mono', monospace; margin-top: 2px; }

.char-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: var(--z-modal); display: none; align-items: center; justify-content: center; }
.char-modal.open { display: flex; }
.char-modal-card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-lg); padding: var(--space-6); width: 400px; max-width: 92vw; box-shadow: var(--shadow-lg); }
.char-modal-card h3 { font-family: 'Instrument Serif', serif; font-size: 18px; color: var(--gold); margin-bottom: var(--space-4); }
.char-modal-card input[type="text"] { width: 100%; padding: 10px 14px; margin-bottom: var(--space-4); background: var(--bg-deep); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; outline: none; }
.char-modal-card input:focus { border-color: var(--gold); }
.char-color-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--space-4); }
.char-color-swatch { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
.char-color-swatch:hover { transform: scale(1.1); }
.char-color-swatch--selected { border-color: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,0.15); }
```

---

## Task 9: Create settings.css

**Files:**
- Create: `src/styles/settings.css`

- [ ] **Step 1: Create the file**

```css
/* src/styles/settings.css */
.settings-content { flex: 1; overflow-y: auto; padding: 28px; max-width: 680px; }
.settings-section { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: var(--radius-md); padding: var(--space-5); margin-bottom: var(--space-4); }
.settings-section h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-muted); margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--bg-border); }
.settings-field { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.settings-field input, .settings-field select { flex: 1; min-width: 180px; }
.settings-btn { background: none; border: 1px solid var(--bg-border); color: var(--text-secondary); padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.settings-btn:hover { border-color: var(--gold); color: var(--gold); }
.settings-btn--primary { background: var(--gold); border-color: var(--gold); color: var(--bg-deep); font-weight: 600; }
.settings-btn--primary:hover { background: var(--gold-light); }
.settings-btn--danger:hover { border-color: var(--red); color: var(--red); }
.join-code-box { font-family: 'DM Mono', monospace; font-size: 20px; letter-spacing: 4px; background: var(--bg-raised); border: 1px solid var(--bg-border); border-radius: var(--radius-sm); padding: 8px 16px; color: var(--text-primary); }
.join-code-box--inactive { opacity: 0.4; }
```

---

## Task 10: Create linenotes.css

**Files:**
- Create: `src/styles/linenotes.css`

Extract all `#linenotes-overlay`, `.ln-*`, `.ze-*`, `.zd-*`, `.zone-*`, `.note-popover`, `.popover-*`, `.char-item`, `.char-dot`, `.note-types`, `.notes-list`, `.note-item`, `.note-type-*`, `.multi-select-bar`, `.processing-overlay`, `.send-notes-modal`, `.send-notes-card`, `.send-char-*`, `.send-note-*`, `.ln-subtab*`, `.cue-type-badge*`, `.zone-editor-*`, `.zone-list-item`, `.zone-detail`, `.zone-toolbar`, `.zone-saved-badge`, `.line-zone*`, `.note-tag`, `.note-underline`, `.zd-*`, `#ze-detail`, `#ze-multi-bar`, `#ze-saved-badge` rules from index.html.

These rules span approximately lines 490–1347 in index.html. The z-index values to replace in this section:

- `#linenotes-overlay`: `z-index: 600` → `z-index: var(--z-modal)`
- `.note-popover`, `.zone-editor-panel`: any `z-index: 250+` → `var(--z-popover)`
- `.processing-overlay`: any `z-index: 650` → `var(--z-modal)`
- `.send-notes-modal`, `.send-notes-card`: any `z-index: 620` → `var(--z-modal)`
- `.char-modal`: `z-index: 700` → `var(--z-modal)` (already handled in cast.css above)

**(Read index.html lines 490–1347 and copy all matching rules into this file, substituting hardcoded hex with tokens as listed in Task 13.)**

---

## Task 11: Wire CSS imports into main.js and remove style block

**Files:**
- Modify: `src/main.js` (top of file)
- Modify: `index.html` (remove lines 11–1348)

- [ ] **Step 1: Add imports at top of src/main.js**

```js
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/dashboard.css'
import './styles/tracking.css'
import './styles/runshow.css'
import './styles/cast.css'
import './styles/settings.css'
import './styles/linenotes.css'
```

These lines go BEFORE the existing firebase import on line 1.

- [ ] **Step 2: Remove the `<style>` block from index.html**

Delete lines 11–1348 (the entire `<style>` block). The file should jump from the `<link>` tag directly to `</head>`.

- [ ] **Step 3: Run build to verify no errors**

```bash
cd /Users/nrg/cue-stage-manager && npm run build
```

Expected: successful build with no errors. If any CSS rules are missing, the visual gap will be obvious in `npm run preview`.

---

## Task 12: Replace Playfair Display with Instrument Serif

**Files:**
- Modify: all `src/styles/*.css` files

- [ ] **Step 1: Find all Playfair references**

```bash
grep -rn "Playfair" /Users/nrg/cue-stage-manager/src/styles/
```

- [ ] **Step 2: Replace each occurrence**

In every CSS file, replace:
```
'Playfair Display', serif
```
with:
```
'Instrument Serif', serif
```

Also replace the variant with double-quotes:
```
"Playfair Display", serif
```
with:
```
'Instrument Serif', serif
```

- [ ] **Step 3: Verify no Playfair references remain**

```bash
grep -rn "Playfair" /Users/nrg/cue-stage-manager/src/
```

Expected: zero matches.

---

## Task 13: Replace hardcoded hex colors with tokens in CSS files

**Files:**
- Modify: all `src/styles/*.css` files

- [ ] **Step 1: Apply these find-and-replace operations across all CSS files**

Perform these in order (most specific first to avoid partial matches):

| Find | Replace with |
|------|-------------|
| `#d4af37` | `var(--gold)` |
| `#D4AF37` | `var(--gold)` |
| `#e0c04a` | `var(--gold-light)` |
| `#C8A050` | `var(--gold)` |
| `#DCBE6A` | `var(--gold-light)` |
| `#C8A05033` | `var(--gold-subtle)` |
| `rgba(200,160,80,0.12)` | `var(--gold-subtle)` |
| `rgba(200,160,80,0.15)` | `var(--gold-glow)` |
| `rgba(200,160,80,0.18)` | `var(--gold-glow)` |
| `#0B0B14` | `var(--bg-deep)` |
| `#0f0f1e` | `var(--bg-deep)` |
| `#0a0a14` | `var(--bg-deep)` |
| `#0f0e0c` | `var(--bg-deep)` |
| `#111120` | `var(--bg-base)` |
| `#171728` | `var(--bg-card)` |
| `#1a1a2e` | `var(--bg-card)` |
| `#12122a` | `var(--bg-card)` |
| `#1E1E32` | `var(--bg-raised)` |
| `#1e1e34` | `var(--bg-raised)` |
| `#2A2A42` | `var(--bg-border)` |
| `#2a2a3e` | `var(--bg-border)` |
| `#3a3a4e` | `var(--bg-raised)` |
| `#222236` | `var(--bg-hover)` |
| `#1e1e34` | `var(--bg-raised)` |
| `#E8E8F0` | `var(--text-primary)` |
| `#e0e0e0` | `var(--text-primary)` |
| `#e0e0f0` | `var(--text-primary)` |
| `#ccc` | `var(--text-primary)` |
| `#9898B0` | `var(--text-secondary)` |
| `#888` | `var(--text-secondary)` |
| `#aaa` | `var(--text-secondary)` |
| `#5C5C72` | `var(--text-muted)` |
| `#555` | `var(--text-muted)` |
| `#666` | `var(--text-muted)` |
| `#444` | `var(--text-muted)` |
| `#E04050` | `var(--red)` |
| `#e63946` | `var(--red)` |
| `#38A060` | `var(--green)` |
| `#2d8a4e` | `var(--green)` |
| `#5b9bd4` | `var(--blue)` |
| `#5B9BD4` | `var(--blue)` |
| `var(--gold-muted)` | `var(--gold-subtle)` |

**EXCEPTIONS — do NOT replace these:**
- `#fff` and `rgba(255,255,255,*)` — keep as-is (used for swatch borders, pill text)
- `#6b1520` (toast error bg), `#1a4a2a` (toast success bg), `#3a2a00` (toast warn bg) — these are one-off semantic backgrounds, keep or use approximate token
- Tracking type colors (`#C8A96E`, `#9B7BC8`, `#6B8F4E`) — already in tokens, replace with `var(--track-prop)` etc.
- State colors (`#D4AF37` = `var(--state-hold)`, `#4CAF50` = `var(--state-on)`, `#555555` = `var(--state-off)`) — replace with respective state variables
- Cue color objects in linenotes.js and cue-margin.js — **leave JS files alone** in this task (handled in Task 15)

- [ ] **Step 2: Verify no stale hex remains in CSS**

```bash
grep -En '#[0-9a-fA-F]{3,6}' /Users/nrg/cue-stage-manager/src/styles/*.css | grep -v '\/\*'
```

Only tracking state/type colors, `#fff`, semi-transparent overlays, and color-swatch values should remain.

---

## Task 14: Z-index audit in CSS files

**Files:**
- Modify: all `src/styles/*.css` files

- [ ] **Step 1: Find all raw z-index numbers in CSS files**

```bash
grep -En 'z-index:\s*[0-9]' /Users/nrg/cue-stage-manager/src/styles/*.css
```

- [ ] **Step 2: Replace each occurrence using this mapping**

| Context | Raw value | Replace with |
|---------|-----------|-------------|
| `#login-overlay` | 2000 | `var(--z-login)` |
| `#dashboard-view` | 100 | `var(--z-popover)` |
| `.dash-header` sticky | 10 | `var(--z-sticky)` |
| `#app-view` | 50 | `var(--z-overlay)` |
| `.app-topbar` | 60 | `var(--z-header)` |
| `.cast-modal` | 500 | `var(--z-modal)` |
| `.char-modal` | 700 | `var(--z-modal)` |
| `#linenotes-overlay` | 600 | `var(--z-modal)` |
| `.prop-photo-lightbox` | 900 | `var(--z-modal)` |
| `.prop-notes-modal` | any raw | `var(--z-modal)` |
| `.run-report-modal` | 3000 | `var(--z-modal)` |
| `.send-notes-modal` | 620 | `var(--z-modal)` |
| `.processing-overlay` | 650 | `var(--z-modal)` |
| `#production-panel` | 500 | `var(--z-modal)` |
| `#production-backdrop` | ~499 | `calc(var(--z-modal) - 1)` |
| `#toast-container` | 9999 | `var(--z-toast)` |
| `.cast-picker-dropdown` | 100 | `var(--z-popover)` |
| `.note-popover` | 250+ | `var(--z-popover)` |
| `.rs-bookmarks-menu` | any | `var(--z-popover)` |
| `.run-note-popover` | 900 | `var(--z-popover)` |
| `.rs-note-popover` | 900 | `var(--z-popover)` |
| sticky table headers | 5–15 | `var(--z-sticky)` |
| `.run-show-fab` | 500 | `var(--z-overlay)` |
| `.cue-modal-backdrop` | 300 | `var(--z-modal)` |
| `.zone-editor-panel` | 240 | `var(--z-overlay)` |
| `.rs-scratchpad-*` local z | 20–30 | leave as-is (canvas-internal) |

- [ ] **Step 3: Verify**

```bash
grep -En 'z-index:\s*[0-9]' /Users/nrg/cue-stage-manager/src/styles/*.css
```

Expected: zero matches (or only justified internal canvas z-indexes).

---

## Task 15: Z-index audit in JS files

**Files:**
- Modify: `src/runshow/cue-margin.js:83`
- Modify: `src/shared/import-modal.js:32`
- Modify: `src/shared/session-sync.js:72`

Note: `Runshow.js:1354` (z-index:4) and `Runshow.js:1418` (z-index:5) are canvas-internal layer positions — leave them as raw numbers.

- [ ] **Step 1: Update cue-margin.js line 83**

Change `'z-index:15'` → `'z-index:var(--z-popover)'`

- [ ] **Step 2: Update import-modal.js line 32**

Change `z-index:9999` → `z-index:var(--z-modal)` in the cssText string.

- [ ] **Step 3: Update session-sync.js line 72**

Change `z-index:3000` → `z-index:var(--z-modal)` in the cssText string.

- [ ] **Step 4: Verify**

```bash
grep -n 'z-index' /Users/nrg/cue-stage-manager/src/runshow/cue-margin.js /Users/nrg/cue-stage-manager/src/shared/import-modal.js /Users/nrg/cue-stage-manager/src/shared/session-sync.js
```

Expected: all three show `var(--z-modal)` or `var(--z-popover)`.

---

## Task 16: Navigation restructure — merge topbar + tabbar

**Files:**
- Modify: `index.html` (HTML structure)
- Modify: `src/styles/layout.css` (remove `.app-tabbar` rule)

- [ ] **Step 1: Locate the current nav HTML in index.html**

Current structure (after style block removal in Task 11):
```html
<div id="app-view">
  <!-- Top Bar -->
  <div class="app-topbar">
    <span class="app-topbar-logo" id="app-back-logo">CUE</span>
    <span class="app-topbar-title" id="app-prod-title"></span>
    <span class="role-badge app-topbar-badge" id="app-role-badge"></span>
    <div class="app-topbar-spacer" style="flex:1"></div>
    <button class="topbar-btn" id="app-logout-btn">Sign Out</button>
  </div>
  <!-- Tab Bar -->
  <div class="app-tabbar">
    <button class="app-tab app-tab--active" data-tab="runshow">Run Show</button>
    <button class="app-tab" data-tab="tracking">Tracking</button>
    <button class="app-tab" data-tab="linenotes">Script Editor</button>
    <button class="app-tab" data-tab="cast">Cast &amp; Crew</button>
    <button class="app-tab" data-tab="settings">Settings</button>
  </div>
```

- [ ] **Step 2: Replace with merged single bar**

```html
<div id="app-view">
  <!-- Single Navigation Bar -->
  <div class="app-topbar">
    <span class="app-topbar-logo" id="app-back-logo">CUE</span>
    <span class="app-topbar-title" id="app-prod-title"></span>
    <span class="role-badge app-topbar-badge" id="app-role-badge"></span>
    <div class="app-topbar-tabs">
      <button class="app-tab app-tab--active" data-tab="runshow">Run Show</button>
      <button class="app-tab" data-tab="tracking">Tracking</button>
      <button class="app-tab" data-tab="linenotes">Script Editor</button>
      <button class="app-tab" data-tab="cast">Cast &amp; Crew</button>
      <button class="app-tab" data-tab="settings">Settings</button>
    </div>
    <button class="topbar-btn" id="app-logout-btn">Sign Out</button>
  </div>
```

Note: `tabs.js` uses `querySelectorAll('.app-tab')` — this still works because the buttons still have that class, just inside `.app-topbar-tabs` instead of `.app-tabbar`.

- [ ] **Step 3: Remove `.app-tabbar` rule from layout.css**

Delete the `.app-tabbar { ... }` block that was kept as a placeholder.

- [ ] **Step 4: Run build**

```bash
cd /Users/nrg/cue-stage-manager && npm run build
```

---

## Task 17: Dashboard polish

**Files:**
- Modify: `src/styles/dashboard.css`
- Modify: `src/dashboard/dashboard.js`

- [ ] **Step 1: Update `.dash-action-btn` in dashboard.css to use btn system**

Replace the `.dash-action-btn` rule with:
```css
.dash-action-btn {
  padding: 10px 20px;
  background: transparent; border: 1px solid var(--bg-border);
  color: var(--text-secondary); border-radius: var(--radius-md); font-size: 14px;
  transition: all 0.2s;
}
.dash-action-btn:hover { border-color: var(--gold); color: var(--gold); }
.dash-action-btn--primary {
  background: var(--gold); color: var(--bg-deep); border-color: var(--gold); font-weight: 600;
}
.dash-action-btn--primary:hover { background: var(--gold-light); }
```

- [ ] **Step 2: Update dashboard.js to add `--primary` class to "New Production" button**

In `src/dashboard/dashboard.js`, find where `create-production-btn` or the "New Production" button is referenced or rendered. Add `dash-action-btn--primary` class to it:

Find:
```js
id="create-production-btn"
```
or the equivalent innerHTML that renders the button. Add the class `dash-action-btn--primary` to that button element.

- [ ] **Step 3: Add production-card--owner class in dashboard.js**

In `src/dashboard/dashboard.js`, find where production cards are rendered. In the card element creation, add `production-card--owner` class when `role === 'owner'`:

```js
// Find the production card creation. It will look something like:
card.className = 'production-card' + (role === 'owner' ? ' production-card--owner' : '');
```

Read `src/dashboard/dashboard.js` to find the exact production card rendering code and apply this change.

---

## Task 18: Final build verification

**Files:**
- Read: `src/runshow/Runshow.js` (confirm rsIsAnyModalOpen still works)

- [ ] **Step 1: Run production build**

```bash
cd /Users/nrg/cue-stage-manager && npm run build
```

Expected: exits 0, no CSS or JS errors.

- [ ] **Step 2: Verify rsIsAnyModalOpen selector still works**

The function at `Runshow.js:1797` queries:
```js
'.cast-modal.open, .send-notes-modal.open, .char-modal.open, .prop-notes-modal, .prop-photo-lightbox, .page-times-modal-backdrop'
```

All these class names are preserved in our new CSS files:
- `.cast-modal.open` → in cast.css ✓
- `.send-notes-modal.open` → in runshow.css/linenotes.css ✓
- `.char-modal.open` → in cast.css ✓
- `.prop-notes-modal` → in tracking.css ✓
- `.prop-photo-lightbox` → in tracking.css ✓
- `.page-times-modal-backdrop` → in runshow.css ✓

The dynamically-created modals (`.pre-run-modal-backdrop`, `.end-run-modal-backdrop`, `.page-times-modal-backdrop`) are created with `modal-backdrop` class plus a specific class — they use inline `display` style for show/hide. This pattern is unchanged.

- [ ] **Step 3: Check for remaining hardcoded hex in CSS**

```bash
grep -En '#[0-9a-fA-F]{3,6}' /Users/nrg/cue-stage-manager/src/styles/*.css | grep -v 'color-swatch\|#fff\|#000\|6b1520\|1a4a2a\|3a2a00'
```

Expected: minimal remaining values, all justified.

- [ ] **Step 4: Confirm Google Fonts loads all three families**

Check `index.html` — the `<link>` tag should be:
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

All three families (DM Mono, Instrument Serif, Inter) are already loaded. No change needed.

- [ ] **Step 5: Commit**

```bash
cd /Users/nrg/cue-stage-manager
git add src/styles/ src/main.js index.html src/runshow/cue-margin.js src/shared/import-modal.js src/shared/session-sync.js src/dashboard/dashboard.js
git commit -m "$(cat <<'EOF'
feat: frontend design overhaul — CSS extraction, token system, nav unification

- Extract ~1350 lines of inline CSS into 10 module files under src/styles/
- Establish complete token system (colors, spacing, radii, shadows, z-index scale)
- Replace Playfair Display with Instrument Serif throughout
- Add canonical .btn, .input, .modal-backdrop component classes
- Merge two-bar nav (52px topbar + 42px tabbar) into single 56px bar
- Replace all hardcoded hex values with CSS custom properties
- Replace all raw z-index numbers with scale variables in CSS and JS

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Phase | Status |
|-------|--------|
| Phase 2: CSS extraction to src/styles/ | Tasks 1–11 ✓ |
| Phase 3: Token system :root replacement | Task 1 ✓ |
| Phase 4: Replace Playfair → Instrument Serif (Option B) | Task 12 ✓ |
| Phase 5: Canonical .btn system | Task 3 ✓ |
| Phase 6: Canonical .input system | Task 3 ✓ |
| Phase 7: Canonical .modal-backdrop + .modal pattern | Task 3 ✓ |
| Phase 8: Z-index audit CSS | Task 14 ✓ |
| Phase 8: Z-index audit JS inline styles | Task 15 ✓ |
| Phase 9: Single 56px nav bar | Task 16 ✓ |
| Phase 10: Dashboard polish (empty-state, owner border, btn variants) | Tasks 3, 17 ✓ |
| Phase 11: Focus states keyboard accessibility | Task 2 ✓ |
| Phase 12: Build verify + rsIsAnyModalOpen + hex/z-index confirmation | Task 18 ✓ |

**Gap: `.app-topbar-tabs` CSS** — The `margin-left: auto` that pushes tabs right is defined in layout.css Task 4 ✓. The `.app-topbar-badge` (role badge in topbar) has no explicit style other than the `.role-badge` class — it will inherit correctly.

**Gap: `btn-primary`, `btn-secondary`, `btn-destructive`, `btn-inline`, `btn-loading` classes** — These appear in the existing CSS (unified component classes). They should be included in `components.css` Task 3. Add these rules to the end of components.css:

```css
/* Legacy unified button classes */
.btn-primary    { background: var(--gold); color: var(--bg-deep); border: none; padding: 8px 20px; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-primary:hover    { background: var(--gold-light); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary  { background: transparent; border: 1px solid var(--bg-border); color: var(--text-secondary); padding: 8px 20px; border-radius: var(--radius-md); font-size: 13px; cursor: pointer; }
.btn-secondary:hover { border-color: var(--gold); color: var(--gold); }
.btn-destructive { background: transparent; border: 1px solid var(--bg-border); color: var(--text-secondary); padding: 8px 20px; border-radius: var(--radius-md); font-size: 13px; cursor: pointer; }
.btn-destructive:hover { border-color: var(--red); color: var(--red); }
.btn-inline { background: none; border: none; color: var(--gold); font-size: 13px; cursor: pointer; padding: 2px 6px; }
.btn-inline:hover { opacity: 0.8; }
.btn-loading { position: relative; color: transparent !important; pointer-events: none; }
.btn-loading::after { content: ''; position: absolute; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

**Placeholder scan:** No TBDs found. Tasks 7 and 10 reference extracting from index.html by line range — this is intentional (the CSS is 400–500 lines each and writing it twice would be redundant; the executor reads the file and copies). This is not a placeholder — it's a pointer to source material.

**Type consistency:** All class names used in later tasks match the definitions in earlier tasks. `rsIsAnyModalOpen()` selectors verified against new file locations.
