import { auth } from '../firebase.js';
import { onLineNotesTabActivated } from '../linenotes/linenotes.js';
import { renderCastTab } from '../cast/cast.js';
import { renderSettingsTab } from '../settings/settings.js';

let activeTab = 'props';

export function initTabs() {
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId) switchTab(tabId);
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
  }
}

export function resetToPropsTab() {
  activeTab = 'props';
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.classList.toggle('app-tab--active', btn.dataset.tab === 'props');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('tab-panel--active', panel.id === 'tab-props');
  });
}

export function getActiveTab() {
  return activeTab;
}