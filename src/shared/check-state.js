/**
 * check-state.js — Pre/Post Check State Persistence
 * P0: Persist checkbox state to Firestore subcollection.
 * Path: productions/{id}/checkState/{uid}
 */
import { db } from '../firebase.js';
import { state } from './state.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

let _saveTimeout = null;

export async function loadCheckState() {
  const pid = state.activeProduction?.id;
  const uid = state.currentUser?.uid;
  if (!pid || !uid) return { preChecked: {}, postChecked: {} };
  try {
    const snap = await getDoc(doc(db, 'productions', pid, 'checkState', uid));
    if (snap.exists()) {
      const d = snap.data();
      return { preChecked: d.preChecked || {}, postChecked: d.postChecked || {} };
    }
  } catch (e) { console.warn('loadCheckState error:', e); }
  return { preChecked: {}, postChecked: {} };
}

export function saveCheckState(preChecked, postChecked) {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    const pid = state.activeProduction?.id;
    const uid = state.currentUser?.uid;
    if (!pid || !uid) return;
    setDoc(doc(db, 'productions', pid, 'checkState', uid), {
      preChecked: preChecked || {}, postChecked: postChecked || {}, updatedAt: serverTimestamp(),
    }).catch(e => console.warn('saveCheckState error:', e));
  }, 500);
}

export function checkProgress(checked, total) {
  const count = Object.keys(checked).filter(k => checked[k]).length;
  return { count, total, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
}

export function renderProgressBar(label, progress) {
  return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
    '<span style="font-size:12px;color:var(--text-secondary);min-width:110px;">' + label + ': ' + progress.count + '/' + progress.total + '</span>' +
    '<div style="flex:1;height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;">' +
    '<div style="width:' + progress.pct + '%;height:100%;background:var(--gold);border-radius:3px;transition:width 0.3s;"></div>' +
    '</div>' +
    '<span style="font-size:11px;color:var(--text-muted);min-width:32px;text-align:right;">' + progress.pct + '%</span>' +
    '</div>';
}
