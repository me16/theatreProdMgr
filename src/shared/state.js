export const state = {
  currentUser: null,
  isSuperAdmin: false,
  activeProduction: null,
  activeRole: null,
  unsubscribers: [],
  runSession: null, // null when no session active
  // runSession shape when active (in-memory only — not synced to Firestore in real time):
  // {
  //   sessionId: string,
  //   title: string,
  //   timerRunning: boolean,
  //   timerHeld: boolean,
  //   timerElapsed: number,       // seconds
  //   timerTotalPages: number,
  //   timerDuration: number,      // minutes
  //   timerWarnPages: number,
  //   currentPage: number,
  //   timerInterval: number | null,
  //   holdStartTime: number | null,
  //   holdLog: [],
  //   scratchpad: string,
  // }
};

export function cleanup() {
  state.unsubscribers.forEach(fn => {
    try { fn(); } catch (e) { /* ignore */ }
  });
  state.unsubscribers = [];
}