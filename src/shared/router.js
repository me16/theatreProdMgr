/**
 * router.js — Lightweight Hash-Based Router for CUE
 * P2: URL routing with hash-based routes.
 * Format: #/{prodId}/{tab}?sub=X&page=N
 */
import { state } from './state.js';

let _initialized = false;
let _onRouteChange = null;

const ROUTES = [
  { pattern: /^#\/dashboard$/, action: 'dashboard' },
  { pattern: /^#\/([^/]+)\/runshow$/, action: 'tab', tab: 'runshow' },
  { pattern: /^#\/([^/]+)\/props/, action: 'tab', tab: 'props' },
  { pattern: /^#\/([^/]+)\/script/, action: 'tab', tab: 'linenotes' },
  { pattern: /^#\/([^/]+)\/cast$/, action: 'tab', tab: 'cast' },
  { pattern: /^#\/([^/]+)\/settings$/, action: 'tab', tab: 'settings' },
];

function parseHashParams(hash) {
  const qi = hash.indexOf('?');
  if (qi === -1) return {};
  const params = {};
  hash.slice(qi + 1).split('&').forEach(p => {
    const [k, v] = p.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return params;
}

function getHashPath(hash) { const qi = hash.indexOf('?'); return qi === -1 ? hash : hash.slice(0, qi); }

function handleHashChange() {
  const hash = window.location.hash || '';
  if (!hash) return;
  const path = getHashPath(hash);
  const params = parseHashParams(hash);
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (!m) continue;
    if (route.action === 'dashboard') { _onRouteChange?.('dashboard', null, null, params); return; }
    if (route.action === 'tab') { _onRouteChange?.('tab', m[1], route.tab, params); return; }
  }
}

export function initRouter(onRouteChange) {
  if (_initialized) return;
  _initialized = true;
  _onRouteChange = onRouteChange;
  window.addEventListener('hashchange', handleHashChange);
  if (window.location.hash) setTimeout(handleHashChange, 0);
}

export function navigate(hash) {
  if (window.location.hash === hash) handleHashChange();
  else window.location.hash = hash;
}

export function setRoute(prodId, tab, params = {}) {
  let h = '#/' + prodId + '/' + tab;
  const q = [];
  if (params.sub) q.push('sub=' + encodeURIComponent(params.sub));
  if (params.page) q.push('page=' + encodeURIComponent(params.page));
  if (q.length) h += '?' + q.join('&');
  navigate(h);
}

export function updateRouteParams(params) {
  const hash = window.location.hash || '';
  const path = getHashPath(hash);
  const cur = parseHashParams(hash);
  const merged = { ...cur, ...params };
  const q = [];
  Object.entries(merged).forEach(([k, v]) => {
    if (v != null && v !== '') q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  });
  const newHash = q.length ? path + '?' + q.join('&') : path;
  if (window.location.hash !== newHash) history.replaceState(null, '', newHash);
}

export function navigateToDashboard() { navigate('#/dashboard'); }
export function getRouteParams() { return parseHashParams(window.location.hash || ''); }
