import { auth } from '../firebase.js';
import { state } from './state.js';
import { onLineNotesTabActivated } from '../linenotes/linenotes.js';
import { renderCastTab } from '../cast/cast.js';
import { renderSettingsTab } from '../settings/settings.js';
import { onRunShowTabActivated } from '../RunShow/Runshow.js';
import { onPropsTabActivated } from '../props/props.js';
import { setRoute } from './router.js';

const TAB_ROUTE_MAP = { runshow:'runshow', props:'props', linenotes:'script', cast:'cast', settings:'settings' };

let activeTab = 'runshow';

export function initTabs() {
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId) {
        // P2: Update hash via router
        const pid = state.activeProduction?.id;
        if (pid) setRoute(pid, TAB_ROUTE_MAP[tabId] || tabId);
        switchTab(tabId);
      }
    });
  });

  document.getElementById('app-back-logo')?.addEventListener('click', () => {
    import('../dashboard/dashboard.js').then(m => m.backToDashboard());
  });
  document.getElementById('app-logout-btn')?.addEventListener('click', () => auth.signOut());
}

export function switchTab(tabId) {
  activeTab = tabId;

  // Toggle tab buttons
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.classList.toggle('app-tab--active', btn.dataset.tab === tabId);
  });

  // Toggle panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('tab-panel--active', panel.id === `tab-${tabId}`);
  });

  // Activation side effects
  switch (tabId) {
    case 'runshow':
      onRunShowTabActivated();
      break;
    case 'linenotes':
      onLineNotesTabActivated();
      break;
    case 'cast':
      renderCastTab();
      break;
    case 'settings':
      renderSettingsTab();
      break;
    // 'props' — handled by its own Firestore subscription
    case 'props':
      onPropsTabActivated();
      break;
  }
}

export function resetToRunShowTab() {
  activeTab = 'runshow';
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.classList.toggle('app-tab--active', btn.dataset.tab === 'runshow');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('tab-panel--active', panel.id === 'tab-runshow');
  });
}

// Kept for backward-compat — now delegates to resetToRunShowTab
export function resetToPropsTab() {
  resetToRunShowTab();
}

export function getActiveTab() {
  return activeTab;
}