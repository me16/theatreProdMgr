/**
 * tracking-tab.js — Tracking Tab Controller
 *
 * Manages the outer tracking-type subtabs (Props | Actors | Costumes)
 * and delegates rendering to the active tracking type's module.
 *
 * The inner subtabs (Manage | View Show | Pre/Post Check) are owned by each
 * tracking type module individually. For Props, they live in src/props/props.js.
 */

import { onPropsTabActivated } from '../props/props.js';
import { subscribeToActorCues, renderActorsContent } from './actors.js';
import { subscribeToCostumes, renderCostumesContent } from './costumes.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';

let activeTrackingType = 'props';

// Per-type scroll positions, preserved across tab switches
const _scrollPositions = { props: 0, actors: 0, costumes: 0 };

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
      _ensureTrackingSubs();
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) { propsContent.style.display = ''; renderActorsContent(propsContent); }
      break;
    case 'costumes':
      _ensureTrackingSubs();
      if (propsSubtabs) propsSubtabs.style.display = 'none';
      if (propsContent) { propsContent.style.display = ''; renderCostumesContent(propsContent); }
      break;
  }
}

export function getActiveTrackingType() {
  return activeTrackingType;
}

// Ensure Firestore subscriptions are active for all tracking types
let _trackingSubbed = false;
function _ensureTrackingSubs() {
  if (_trackingSubbed) return;
  const pid = state.activeProduction?.id;
  if (!pid) return;
  _trackingSubbed = true;
  subscribeToActorCues(pid);
  subscribeToCostumes(pid);
}

// Reset subscription flag on production change (called from cleanup)
export function resetTrackingSubs() { _trackingSubbed = false; }
