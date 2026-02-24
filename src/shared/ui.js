const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ESC_MAP[c]);
}

export function sanitizeName(str) {
  if (!str) return '';
  return String(str).replace(/[\x00-\x1f]/g, '').trim().slice(0, 200);
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function showOverlay(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

export function hideOverlay(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

export function confirmDialog(msg) {
  return window.confirm(msg);
}
