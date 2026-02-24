export const state = {
  currentUser: null,
  isSuperAdmin: false,
  activeProduction: null,
  activeRole: null,
  unsubscribers: [],
};

export function cleanup() {
  state.unsubscribers.forEach(fn => {
    try { fn(); } catch (e) { /* ignore */ }
  });
  state.unsubscribers = [];
}
