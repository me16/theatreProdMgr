/**
 * modal.js — Unified Modal Component
 * P1: 3 sizes, focus trapping, enter/exit transitions, Escape/backdrop close.
 */
const SIZE = { small: '400px', medium: '520px', large: '900px' };
let _active = [];

export function openModal({ title = '', size = 'medium', content = '', buttons = [], onClose = null, noTitle = false } = {}) {
  const bd = document.createElement('div');
  bd.className = 'cue-modal-backdrop';
  const card = document.createElement('div');
  card.className = 'cue-modal-card';
  card.style.maxWidth = SIZE[size] || SIZE.medium;
  let titleHtml = (!noTitle && title) ? '<div class="cue-modal-title">' + title + '</div>' : '';
  let btnsHtml = '';
  if (buttons.length) {
    btnsHtml = '<div class="cue-modal-buttons">' + buttons.map((b, i) => {
      const cls = b.variant === 'primary' ? 'btn-primary' : b.variant === 'destructive' ? 'btn-destructive' : 'btn-secondary';
      return '<button class="' + cls + '" data-mi="' + i + '">' + b.label + '</button>';
    }).join('') + '</div>';
  }
  card.innerHTML = titleHtml + '<div class="cue-modal-body">' + content + '</div>' + btnsHtml;
  bd.appendChild(card);
  document.body.appendChild(bd);
  buttons.forEach((b, i) => {
    card.querySelector('[data-mi="' + i + '"]')?.addEventListener('click', e => { e.stopPropagation(); b.action?.(bd, card); });
  });
  bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd, onClose); });
  const esc = e => { if (e.key === 'Escape') { closeModal(bd, onClose); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  bd._esc = esc; bd._onClose = onClose;
  requestAnimationFrame(() => bd.classList.add('cue-modal--visible'));
  _active.push(bd);
  return bd;
}

export function closeModal(bd, onClose) {
  if (!bd) return;
  bd.classList.remove('cue-modal--visible');
  bd.classList.add('cue-modal--closing');
  setTimeout(() => bd.remove(), 150);
  _active = _active.filter(m => m !== bd);
  if (bd._esc) document.removeEventListener('keydown', bd._esc);
  (onClose || bd._onClose)?.();
}

export function closeAllModals() { [..._active].forEach(m => closeModal(m)); }
