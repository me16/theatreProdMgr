#!/usr/bin/env node
// cue-p1-props-revision.mjs — Phase 1: Props Revision
// Renames Props tab → Tracking tab with two-level subtab navigation.
// Props module continues to own all CRUD/rendering/timer logic.
// Creates tracking-tab.js as the outer controller.
//
// Usage: node cue-p1-props-revision.mjs          (dry run)
//        node cue-p1-props-revision.mjs --apply   (apply changes)

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

function applyPatchAll(file, oldStr, newStr, label) {
  // Replace ALL occurrences (non-unique OK)
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(newStr) && !content.includes(oldStr) && !FORCE) {
    console.log(`  [SKIP] ${label} — already applied`);
    return content;
  }
  if (!content.includes(oldStr)) {
    console.error(`  [FAIL] ${label}`);
    console.error(`    Expected (first 200 chars): ${oldStr.slice(0, 200)}`);
    process.exit(1);
  }
  const updated = content.split(oldStr).join(newStr);
  if (!DRY) fs.writeFileSync(file, updated, 'utf8');
  const count = (content.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log(`  [✓] ${label} (${count} occurrence${count !== 1 ? 's' : ''})`);
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

console.log(`\nCUE P1: Props Revision ${DRY ? '(DRY RUN)' : '(APPLYING)'}\n`);

const INDEX_PATH = 'index.html';
const TABS_PATH = 'src/shared/tabs.js';
const PROPS_PATH = 'src/props/props.js';
const MAIN_PATH = 'src/main.js';
const ROUTER_PATH = 'src/shared/router.js';


// ─────────────────────────────────────────────────────────────
// 1. Create src/tracking/tracking-tab.js
// ─────────────────────────────────────────────────────────────
createFile('src/tracking/tracking-tab.js', `/**
 * tracking-tab.js — Tracking Tab Controller
 *
 * Manages the outer tracking-type subtabs (Props | Actors | Scenic | Costumes)
 * and delegates rendering to the active tracking type's module.
 *
 * The inner subtabs (Manage | View Show | Pre/Post Check) are owned by each
 * tracking type module individually. For Props, they live in src/props/props.js.
 */

import { onPropsTabActivated } from '../props/props.js';

let activeTrackingType = 'props';

// Per-type scroll positions, preserved across tab switches
const _scrollPositions = { props: 0, actors: 0, scenic: 0, costumes: 0 };

/**
 * Called by tabs.js when the Tracking tab is activated.
 */
export function onTrackingTabActivated() {
  _renderOuterTabs();
  _activateTrackingType(activeTrackingType);
}

/**
 * Initialize the tracking tab — wire outer subtab clicks.
 */
export function initTrackingTab() {
  document.getElementById('tracking-type-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.tracking-type-tab');
    if (!btn) return;
    const type = btn.dataset.trackType;
    if (type && type !== activeTrackingType) {
      // Save scroll position for current type
      const content = document.getElementById('props-content');
      if (content) _scrollPositions[activeTrackingType] = content.scrollTop;
      activeTrackingType = type;
      _renderOuterTabs();
      _activateTrackingType(type);
    }
  });
}

function _renderOuterTabs() {
  const tabs = document.querySelectorAll('.tracking-type-tab');
  tabs.forEach(btn => {
    btn.classList.toggle('tracking-type-tab--active', btn.dataset.trackType === activeTrackingType);
  });
}

function _activateTrackingType(type) {
  // Show/hide the inner subtabs and content areas appropriate for this type
  const propsSubtabs = document.getElementById('props-subtabs');
  const propsContent = document.getElementById('props-content');

  switch (type) {
    case 'props':
      // Props: show existing subtabs + content
      if (propsSubtabs) propsSubtabs.style.display = '';
      if (propsContent) propsContent.style.display = '';
      onPropsTabActivated();
      // Restore scroll
      if (propsContent) propsContent.scrollTop = _scrollPositions.props || 0;
      break;

    case 'actors':
    case 'scenic':
    case 'costumes':
      // Future tracking types — show placeholder
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) {
        propsContent.style.display = '';
        propsContent.innerHTML =
          '<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:14px;">' +
          '<div style="font-size:32px;margin-bottom:12px;">' +
          (type === 'actors' ? '🎭' : type === 'scenic' ? '🏗️' : '👗') +
          '</div>' +
          '<div>' + type.charAt(0).toUpperCase() + type.slice(1) + ' tracking coming soon.</div>' +
          '</div>';
      }
      break;
  }
}

export function getActiveTrackingType() {
  return activeTrackingType;
}
`, 'Create src/tracking/tracking-tab.js');


// ─────────────────────────────────────────────────────────────
// 2. index.html: Change tab bar button from Props → Tracking
// ─────────────────────────────────────────────────────────────
applyPatch(INDEX_PATH,
  `<button class="app-tab" data-tab="props">Props</button>`,
  `<button class="app-tab" data-tab="tracking">Tracking</button>`,
  'index.html: Tab bar button Props → Tracking');


// ─────────────────────────────────────────────────────────────
// 3. index.html: Replace tab-props panel with tab-tracking
//    containing outer tracking type subtabs + preserved inner structure
// ─────────────────────────────────────────────────────────────
applyPatch(INDEX_PATH,
  `      <!-- PROPS TAB -->
      <div class="tab-panel" id="tab-props">
        <div class="props-subtabs" id="props-subtabs">
          <button class="props-subtab props-subtab--active" data-subtab="manage">Manage Props</button>
          <button class="props-subtab" data-subtab="view">View Show</button>
          <button class="props-subtab" data-subtab="check">Pre/Post Check</button>
        </div>
        <div class="props-content" id="props-content"></div>
      </div>`,
  `      <!-- TRACKING TAB (was Props) -->
      <div class="tab-panel" id="tab-tracking">
        <!-- Outer subtabs: tracking type -->
        <div class="tracking-type-tabs" id="tracking-type-tabs">
          <button class="tracking-type-tab tracking-type-tab--active" data-track-type="props">Props</button>
          <button class="tracking-type-tab" data-track-type="actors">Actors</button>
          <button class="tracking-type-tab" data-track-type="scenic">Scenic</button>
          <button class="tracking-type-tab" data-track-type="costumes">Costumes</button>
        </div>
        <!-- Inner subtabs: mode (per-type, initially props) -->
        <div class="props-subtabs" id="props-subtabs">
          <button class="props-subtab props-subtab--active" data-subtab="manage">Manage Props</button>
          <button class="props-subtab" data-subtab="view">View Show</button>
          <button class="props-subtab" data-subtab="check">Pre/Post Check</button>
        </div>
        <div class="props-content" id="props-content"></div>
      </div>`,
  'index.html: Replace tab-props panel with tab-tracking + outer subtabs');


// ─────────────────────────────────────────────────────────────
// 4. index.html: Add CSS for tracking type tabs
//    Insert after the existing .props-content rule
// ─────────────────────────────────────────────────────────────
applyPatch(INDEX_PATH,
  `.props-content { flex: 1; overflow-y: auto; padding: 24px; }`,
  `.props-content { flex: 1; overflow-y: auto; padding: 24px; }

    /* ===== TRACKING TYPE TABS (outer subtabs) ===== */
    .tracking-type-tabs {
      display: flex; gap: 2px; padding: 6px 12px; background: var(--bg-deep);
      border-bottom: 1px solid var(--bg-border); flex-shrink: 0;
    }
    .tracking-type-tab {
      padding: 6px 16px; background: transparent; border: 1px solid transparent;
      border-radius: 6px; color: var(--text-muted); font-size: 12px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; transition: all 0.2s;
      position: relative;
    }
    .tracking-type-tab:hover { color: var(--text-secondary); background: var(--bg-raised); }
    .tracking-type-tab--active { color: var(--gold); background: var(--bg-raised); border-color: var(--bg-border); }
    .tracking-type-tab--active[data-track-type="props"] { color: var(--track-prop); }
    .tracking-type-tab--active[data-track-type="actors"] { color: var(--track-actor); }
    .tracking-type-tab--active[data-track-type="scenic"] { color: var(--track-scenic); }
    .tracking-type-tab--active[data-track-type="costumes"] { color: var(--track-costume); }
    .tracking-type-tab .tracking-badge {
      position: absolute; top: 2px; right: 2px; width: 14px; height: 14px;
      border-radius: 50%; font-size: 9px; line-height: 14px; text-align: center;
      background: var(--text-muted); color: var(--bg-deep);
    }
    .tracking-type-tab .tracking-badge--alert {
      background: var(--gold); animation: badge-pulse 1.5s ease-in-out infinite;
    }
    @keyframes badge-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }`,
  'index.html: Add tracking type tab CSS');


// ─────────────────────────────────────────────────────────────
// 5. props.js: Change tab-props visibility check to tab-tracking
// ─────────────────────────────────────────────────────────────
applyPatch(PROPS_PATH,
  `if (!document.getElementById('tab-props')?.classList.contains('tab-panel--active')) return;`,
  `if (!document.getElementById('tab-tracking')?.classList.contains('tab-panel--active')) return;`,
  'props.js: renderContent() tab-props → tab-tracking');


// ─────────────────────────────────────────────────────────────
// 6. tabs.js: Update imports — add onTrackingTabActivated, keep onPropsTabActivated
//    (onPropsTabActivated is still used by tracking-tab.js indirectly,
//     but tabs.js no longer calls it directly)
// ─────────────────────────────────────────────────────────────
applyPatch(TABS_PATH,
  `import { onRunShowTabActivated } from '../RunShow/Runshow.js';
import { onPropsTabActivated } from '../props/props.js';
import { setRoute } from './router.js';`,
  `import { onRunShowTabActivated } from '../RunShow/Runshow.js';
import { onPropsTabActivated } from '../props/props.js';
import { onTrackingTabActivated } from '../tracking/tracking-tab.js';
import { setRoute } from './router.js';`,
  'tabs.js: Add onTrackingTabActivated import');


// ─────────────────────────────────────────────────────────────
// 7. tabs.js: Update TAB_ROUTE_MAP — props → tracking
// ─────────────────────────────────────────────────────────────
applyPatch(TABS_PATH,
  `const TAB_ROUTE_MAP = { runshow:'runshow', props:'props', linenotes:'script', cast:'cast', settings:'settings' };`,
  `const TAB_ROUTE_MAP = { runshow:'runshow', tracking:'tracking', linenotes:'script', cast:'cast', settings:'settings' };`,
  'tabs.js: TAB_ROUTE_MAP props → tracking');


// ─────────────────────────────────────────────────────────────
// 8. tabs.js: Update switch case — props → tracking
// ─────────────────────────────────────────────────────────────
applyPatch(TABS_PATH,
  `    // 'props' — handled by its own Firestore subscription
    case 'props':
      onPropsTabActivated();
      break;`,
  `    case 'tracking':
      onTrackingTabActivated();
      break;`,
  'tabs.js: Switch case props → tracking');


// ─────────────────────────────────────────────────────────────
// 9. router.js: Add tracking route + keep props as backward compat alias
// ─────────────────────────────────────────────────────────────
applyPatch(ROUTER_PATH,
  `  { pattern: /^#\\/([^/]+)\\/props/, action: 'tab', tab: 'props' },`,
  `  { pattern: /^#\\/([^/]+)\\/tracking/, action: 'tab', tab: 'tracking' },
  { pattern: /^#\\/([^/]+)\\/props/, action: 'tab', tab: 'tracking' },`,
  'router.js: Add tracking route + props backward compat alias');


// ─────────────────────────────────────────────────────────────
// 10. main.js: Add import for tracking-tab init
// ─────────────────────────────────────────────────────────────
applyPatch(MAIN_PATH,
  `import { initSettings } from './settings/settings.js';
import { initTabs } from './shared/tabs.js';`,
  `import { initSettings } from './settings/settings.js';
import { initTabs } from './shared/tabs.js';
import { initTrackingTab } from './tracking/tracking-tab.js';`,
  'main.js: Add initTrackingTab import');

applyPatch(MAIN_PATH,
  `initSettings();
initTabs();`,
  `initSettings();
initTabs();
initTrackingTab();`,
  'main.js: Call initTrackingTab()');


// ─────────────────────────────────────────────────────────────
// 11. props.js: Fix showApp() — it resets tab toggles to 'runshow'.
//     The forEach on tab-panel uses panel.id === 'tab-runshow' which is fine.
//     But the app-tab forEach uses btn.dataset.tab === 'runshow' which is also fine.
//     However, we need to make sure the 'tracking' tab button CSS is correctly
//     reset when a new production opens. No change needed — verified.
// ─────────────────────────────────────────────────────────────
// (No patch needed — showApp() resets all panels to 'tab-runshow' active,
//  which correctly deactivates tab-tracking. Verified.)


// ─────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────
console.log(`\n✔ ${patchCount} operations ${DRY ? 'would be applied' : 'applied'}.`);

if (!DRY) {
  console.log('\nVerification checklist:');
  console.log('  1. App loads without console errors');
  console.log('  2. Tab bar shows: Run Show | Tracking | Edit Script | Cast & Crew | Settings');
  console.log('  3. Clicking Tracking tab shows outer subtabs: Props | Actors | Scenic | Costumes');
  console.log('  4. Props outer subtab is active by default, showing Manage/View/Check inner subtabs');
  console.log('  5. Props CRUD (add/edit/delete prop) works exactly as before');
  console.log('  6. View Show tab shows stage columns with correct page tracking during active run');
  console.log('  7. Pre/Post Check tab works with checkmarks persisting');
  console.log('  8. Clicking Actors/Scenic/Costumes outer subtabs shows "coming soon" placeholder');
  console.log('  9. Switching back to Props restores scroll position and inner tab selection');
  console.log(' 10. URL routing works: #/{prodId}/tracking and #/{prodId}/props both open Tracking tab');
  console.log(' 11. Run Show timer + page navigation unaffected');
  console.log(' 12. Import/Export props feature still works');
}
