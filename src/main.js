import { auth, db } from './firebase.js';
import { onAuthStateChanged, getIdTokenResult } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { state, cleanup } from './shared/state.js';
import { initLogin, showLogin, hideLogin } from './auth/login.js';
import { initDashboard, showDashboard, hideDashboard } from './dashboard/dashboard.js';
import { initProps, hideApp } from './props/props.js';
import { initLineNotes, resetLineNotes } from './linenotes/linenotes.js';
import { initCast } from './cast/cast.js';
import { initSettings } from './settings/settings.js';
import { initTabs } from './shared/tabs.js';

// Initialize all modules
initLogin();
initDashboard();
initProps();
initLineNotes();
initCast();
initSettings();
initTabs();

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Logged out
    cleanup();
    state.currentUser = null;
    state.isSuperAdmin = false;
    state.activeProduction = null;
    state.activeRole = null;
    hideDashboard();
    hideApp();
    resetLineNotes();
    document.getElementById('app-view').style.display = 'none';
    showLogin();
    return;
  }

  // Logged in
  state.currentUser = user;
  hideLogin();

  // Force token refresh to get custom claims
  try {
    const tokenResult = await getIdTokenResult(user, true);
    state.isSuperAdmin = tokenResult.claims.superadmin === true;
  } catch (e) {
    console.warn('Token refresh error:', e);
    state.isSuperAdmin = false;
  }

  // Ensure user doc exists
  try {
    await setDoc(doc(db, 'users', user.uid), {
      displayName: user.displayName || user.email,
      email: user.email,
      createdAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('Could not write user doc:', e);
  }

  showDashboard();
});