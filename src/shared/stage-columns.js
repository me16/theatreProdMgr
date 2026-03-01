/**
 * stage-columns.js — Shared Stage Columns Widget
 * P2: Extracted from Runshow.js + props.js.
 */
import { escapeHtml } from './ui.js';

export function renderStageColumnsHtml({ props, page, getPropStatus, showWarnings = false, warnPages = 5 }) {
  const sl = [], on = [], sr = [];
  props.forEach(p => {
    const s = getPropStatus(p, page);
    if (!s.location) return;
    const item = { name: p.name, location: s.location, carrier: s.carrier || null, crossover: s.crossover || null,
      warn: showWarnings && s.upcomingEnter && (s.upcomingEnter - page) > 0 && (s.upcomingEnter - page) <= warnPages,
      upcomingEnter: s.upcomingEnter || null };
    const loc = (item.location || '').toUpperCase();
    if (loc === 'SL' || loc === 'STAGE LEFT') sl.push(item);
    else if (loc === 'ON' || loc === 'ONSTAGE' || loc === 'ON STAGE') on.push(item);
    else if (loc === 'SR' || loc === 'STAGE RIGHT') sr.push(item);
    else sl.push(item);
  });
  const col = items => items.length === 0 ? '<div class="stage-col-empty">No props</div>'
    : items.map(it => {
      const carrier = it.carrier ? '<div class="prop-carrier">' + escapeHtml(it.carrier) + '</div>' : '';
      let xo = '';
      if (it.crossover) xo = '<div class="prop-crossover-alert">⚠ Move ' + escapeHtml(it.crossover.from) + '→' + escapeHtml(it.crossover.to) + ' · ' + (it.crossover.mover ? escapeHtml(it.crossover.mover) : '<em>unassigned</em>') + '</div>';
      const wt = it.warn ? ' <span style="color:var(--gold);font-size:11px;">(pg ' + it.upcomingEnter + ')</span>' : '';
      return '<div class="stage-prop ' + (it.warn ? 'stage-prop--warn' : '') + (it.crossover ? ' stage-prop--crossover' : '') + '" data-propname="' + escapeHtml(it.name) + '"><div class="prop-name">' + escapeHtml(it.name) + wt + '</div>' + carrier + xo + '</div>';
    }).join('');
  return '<div class="stage-columns">'
    + '<div class="stage-col stage-col--sl"><h4>Stage Left</h4>' + col(sl) + '</div>'
    + '<div class="stage-col stage-col--on"><h4>ON Stage</h4>' + col(on) + '</div>'
    + '<div class="stage-col stage-col--sr"><h4>Stage Right</h4>' + col(sr) + '</div>'
    + '</div>';
}
