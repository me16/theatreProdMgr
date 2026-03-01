/**
 * session-sync.js — Firestore Session Sync for Crash Recovery
 * P0: Periodic sync of live session state to Firestore,
 *     recovery detection on app init, heartbeat indicator.
 */
import { db } from '../firebase.js';
import { state } from './state.js';
import {
  doc, updateDoc, getDocs, query, where, collection, serverTimestamp
} from 'firebase/firestore';

let _syncInterval = null;
const SYNC_INTERVAL_MS = 10_000;

/* ── PERIODIC SYNC ────────────────────────────── */
export async function syncSessionToFirestore() {
  if (!state.runSession) return;
  const pid = state.activeProduction?.id;
  const sid = state.runSession.sessionId;
  if (!pid || !sid) return;
  try {
    await updateDoc(doc(db, 'productions', pid, 'sessions', sid), {
      liveElapsedSeconds: state.runSession.timerElapsed || 0,
      liveCurrentPage: state.runSession.currentPage || 1,
      liveHoldLog: state.runSession.holdLog || [],
      liveScratchpad: state.runSession.scratchpad || '',
      liveTimerRunning: state.runSession.timerRunning || false,
      liveTimerHeld: state.runSession.timerHeld || false,
      lastSyncTimestamp: serverTimestamp(),
    });
    _updateHeartbeat(true);
  } catch (e) {
    console.warn('Session sync failed:', e);
    _updateHeartbeat(false);
  }
}

export function startSessionSync() {
  stopSessionSync();
  syncSessionToFirestore();
  _syncInterval = setInterval(syncSessionToFirestore, SYNC_INTERVAL_MS);
}

export function stopSessionSync() {
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
}

/* ── RECOVERY DETECTION ──────────────────────── */
export async function detectActiveSession(productionId) {
  try {
    const q = query(
      collection(db, 'productions', productionId, 'sessions'),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      return docs[0];
    }
  } catch (e) { console.warn('detectActiveSession error:', e); }
  return null;
}

export function showRecoveryDialog(sessionData) {
  return new Promise(resolve => {
    const title = sessionData.title || 'Untitled Session';
    const bd = document.createElement('div');
    bd.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
    bd.innerHTML = `<div style="background:var(--bg-card);border:1px solid var(--bg-border);border-radius:12px;padding:24px;width:420px;max-width:90vw;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.5);">
      <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
      <h2 style="font-size:18px;color:var(--text-primary);margin-bottom:8px;">Session Interrupted</h2>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">
        You have an active session <strong>"${title}"</strong> that was interrupted.<br/>Resume or discard?
      </p>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="_rec_discard" style="padding:8px 20px;background:none;border:1px solid var(--bg-border);color:var(--text-secondary);border-radius:6px;font-size:13px;cursor:pointer;">Discard</button>
        <button id="_rec_resume" style="padding:8px 20px;background:var(--gold);border:none;color:var(--bg-deep);border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Resume Session</button>
      </div>
    </div>`;
    document.body.appendChild(bd);
    bd.querySelector('#_rec_resume').onclick = () => { bd.remove(); resolve('resume'); };
    bd.querySelector('#_rec_discard').onclick = () => { bd.remove(); resolve('discard'); };
    bd.addEventListener('click', e => { if (e.target === bd) { bd.remove(); resolve('discard'); } });
  });
}

export function hydrateSessionFromFirestore(sessionData) {
  const now = Date.now();
  const lastSync = sessionData.lastSyncTimestamp?.toMillis?.() || now;
  const drift = (now - lastSync) / 1000;
  let elapsed = sessionData.liveElapsedSeconds || 0;
  if (sessionData.liveTimerRunning) elapsed += drift;
  state.runSession = {
    sessionId: sessionData.id,
    title: sessionData.title || 'Recovered Session',
    timerRunning: false,
    timerHeld: sessionData.liveTimerHeld || false,
    timerElapsed: elapsed,
    timerTotalPages: sessionData.totalPages || 100,
    timerDuration: sessionData.targetDurationMinutes || 120,
    timerWarnPages: sessionData.warnPages || 5,
    currentPage: sessionData.liveCurrentPage || 1,
    timerInterval: null,
    holdStartTime: null,
    holdLog: sessionData.liveHoldLog || [],
    scratchpad: sessionData.liveScratchpad || '',
  };
  return state.runSession;
}

export async function abandonSession(productionId, sessionId) {
  try {
    await updateDoc(doc(db, 'productions', productionId, 'sessions', sessionId), {
      status: 'abandoned', endedAt: serverTimestamp(),
    });
  } catch (e) { console.warn('abandonSession error:', e); }
}

/* ── HEARTBEAT ───────────────────────────────── */
function _updateHeartbeat(healthy) {
  const dot = document.getElementById('rs-heartbeat-dot');
  if (!dot) return;
  if (state.runSession) {
    dot.style.display = 'inline-block';
    dot.className = 'heartbeat-dot ' + (healthy ? 'heartbeat--healthy' : 'heartbeat--stale');
  } else { dot.style.display = 'none'; }
}
export function hideHeartbeat() {
  const dot = document.getElementById('rs-heartbeat-dot');
  if (dot) dot.style.display = 'none';
}
