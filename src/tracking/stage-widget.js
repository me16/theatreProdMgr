/**
 * stage-widget.js — Tabbed Tracking Widget for Run Show Right Panel
 *
 * Replaces the old 3-column SL/ON/SR stage columns with a tabbed widget
 * showing Props | Actors | Scenic | Costumes with alert badges.
 */
import { escapeHtml } from '../shared/ui.js';
import { state } from '../shared/state.js';
import { getItemStatus, computeBadgeCounts } from './core.js';
import { getPropStatus, getProps } from '../props/props.js';
import { getActorCues } from './actors.js';
import { getScenicPieces, getScenicCueGroups } from './scenic.js';
import { getCostumes } from './costumes.js';
import { getProductionLocations } from './locations.js';

let _activeWidgetTab = 'props';

/**
 * Render the full tracking widget into a container.
 * Called from renderRunShowControls and on each timer tick for the active tab.
 */
export function renderTrackingWidget(container, page, warnPages) {
  if (!container) return;
  const tabs = ['props', 'actors', 'scenic', 'costumes'];
  const labels = { props: 'Props', actors: 'Actors', scenic: 'Scenic', costumes: 'Costumes' };
  const colors = { props: 'var(--track-prop)', actors: 'var(--track-actor)', scenic: 'var(--track-scenic)', costumes: 'var(--track-costume)' };

  // Compute badge counts
  const badges = {};
  badges.props = computeBadgeCounts('props', getProps(), page, warnPages);
  badges.actors = computeBadgeCounts('actors', getActorCues(), page, warnPages);
  badges.scenic = computeBadgeCounts('scenic', getScenicPieces(), page, warnPages);
  badges.costumes = computeBadgeCounts('costumes', getCostumes(), page, warnPages);

  // Tab bar
  let tabBarHtml = '<div class="sw-tab-bar">';
  tabs.forEach(t => {
    const active = t === _activeWidgetTab;
    const b = badges[t];
    const badgeHtml = b.count > 0
      ? '<span class="sw-badge' + (b.alert ? ' sw-badge--alert' : '') + '">' + b.count + '</span>'
      : '';
    tabBarHtml += '<button class="sw-tab' + (active ? ' sw-tab--active' : '') + '" data-sw-tab="' + t + '" style="' + (active ? 'color:' + colors[t] + ';border-bottom-color:' + colors[t] + ';' : '') + '">' + labels[t] + badgeHtml + '</button>';
  });
  tabBarHtml += '</div>';

  // Content
  let contentHtml = '<div class="sw-content">';
  switch (_activeWidgetTab) {
    case 'props': contentHtml += _renderPropsView(page, warnPages); break;
    case 'actors': contentHtml += _renderActorsView(page, warnPages); break;
    case 'scenic': contentHtml += _renderScenicView(page, warnPages); break;
    case 'costumes': contentHtml += _renderCostumesView(page, warnPages); break;
  }
  contentHtml += '</div>';

  container.innerHTML = tabBarHtml + contentHtml;

  // Wire tab clicks
  container.querySelectorAll('.sw-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeWidgetTab = btn.dataset.swTab;
      renderTrackingWidget(container, page, warnPages);
    });
  });
}

/** Refresh only badge counts (called on tick for inactive tabs). */
export function refreshWidgetBadges(container, page, warnPages) {
  if (!container) return;
  const badges = {
    props: computeBadgeCounts('props', getProps(), page, warnPages),
    actors: computeBadgeCounts('actors', getActorCues(), page, warnPages),
    scenic: computeBadgeCounts('scenic', getScenicPieces(), page, warnPages),
    costumes: computeBadgeCounts('costumes', getCostumes(), page, warnPages),
  };
  container.querySelectorAll('.sw-tab').forEach(btn => {
    const t = btn.dataset.swTab;
    const b = badges[t];
    let badge = btn.querySelector('.sw-badge');
    if (b.count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'sw-badge'; btn.appendChild(badge); }
      badge.textContent = b.count;
      badge.classList.toggle('sw-badge--alert', b.alert);
    } else if (badge) {
      badge.remove();
    }
  });
}

/** Refresh only the active tab content (called on tick). */
export function refreshWidgetContent(container, page, warnPages) {
  if (!container) return;
  const contentEl = container.querySelector('.sw-content');
  if (!contentEl) return;
  switch (_activeWidgetTab) {
    case 'props': contentEl.innerHTML = _renderPropsView(page, warnPages); break;
    case 'actors': contentEl.innerHTML = _renderActorsView(page, warnPages); break;
    case 'scenic': contentEl.innerHTML = _renderScenicView(page, warnPages); break;
    case 'costumes': contentEl.innerHTML = _renderCostumesView(page, warnPages); break;
  }
}

// ── Props view (replaces old renderStageColumnsHtml) ──
function _renderPropsView(page, warnPages) {
  const props = getProps();
  if (!props.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No props yet.</div>';
  const sl = [], on = [], sr = [];
  props.forEach(p => {
    const r = getPropStatus(p, page);
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPages && (r.upcomingEnter - page) > 0;
    const item = { name: p.name || '?', ...r, warn };
    const loc = (r.location || '').toUpperCase().replace('STAGE LEFT','SL').replace('STAGE RIGHT','SR').replace('ON STAGE','ON').replace('ONSTAGE','ON');
    if (r.status === 'ON') on.push(item);
    else if (loc === 'SR' || loc === 'BACKSTAGE-RIGHT') sr.push(item);
    else sl.push(item);
  });
  const col = (items) => items.length === 0 ? '<div style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;">—</div>'
    : items.map(it => {
      let extra = '';
      if (it.activeCue?.carrierOn) extra += '<div style="font-size:10px;color:var(--text-muted);">↑ ' + escapeHtml(it.activeCue.carrierOn) + '</div>';
      if (it.crossover) extra += '<div style="font-size:10px;color:var(--qc-alert);">⚠ ' + escapeHtml(it.crossover.from) + '→' + escapeHtml(it.crossover.to) + '</div>';
      return '<div class="stage-prop' + (it.warn ? ' stage-prop--warn' : '') + (it.crossover ? ' stage-prop--crossover' : '') + '"><div class="prop-name">' + escapeHtml(it.name) + (it.warn ? ' <span style="color:var(--gold);font-size:10px;">(pg ' + it.upcomingEnter + ')</span>' : '') + '</div>' + extra + '</div>';
    }).join('');
  return '<div class="rs-stage-columns"><div class="stage-col stage-col--sl"><h4>SL</h4>' + col(sl) + '</div><div class="stage-col stage-col--on"><h4>ON</h4>' + col(on) + '</div><div class="stage-col stage-col--sr"><h4>SR</h4>' + col(sr) + '</div></div>';
}

// ── Actors view ──
function _renderActorsView(page, warnPages) {
  const actors = getActorCues();
  if (!actors.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No actors tracked.</div>';
  const off = [], hold = [], on = [];
  actors.forEach(a => {
    const r = getItemStatus(a, page, { stateModel: 'three-state' });
    const warn = r.upcomingHold && (r.upcomingHold - page) <= warnPages && (r.upcomingHold - page) > 0;
    const item = { name: a.characterName || '?', color: a.color || '#5B9BD4', ...r, warn };
    if (r.status === 'ON') on.push(item);
    else if (r.status === 'HOLD') hold.push(item);
    else off.push(item);
  });
  const pill = (it, border) => '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;color:var(--text-primary);border-left:3px solid ' + border + ';">' + escapeHtml(it.name) + (it.warn ? ' <span style="color:var(--state-hold);font-size:9px;">hold pg ' + (it.upcomingHold || '?') + '</span>' : '') + '</div>';
  return '<div class="rs-stage-columns">' +
    '<div class="stage-col stage-col--sl"><h4>Off (' + off.length + ')</h4>' + (off.map(i => pill(i, 'var(--state-off)')).join('') || '—') + '</div>' +
    '<div class="stage-col stage-col--on" style="background:rgba(212,175,55,0.04);"><h4 style="color:var(--state-hold);">Hold (' + hold.length + ')</h4>' + (hold.map(i => pill(i, 'var(--state-hold)')).join('') || '—') + '</div>' +
    '<div class="stage-col stage-col--sr"><h4 style="color:var(--state-on);">On (' + on.length + ')</h4>' + (on.map(i => pill(i, 'var(--state-on)')).join('') || '—') + '</div></div>';
}

// ── Scenic view ──
function _renderScenicView(page, warnPages) {
  const pieces = getScenicPieces();
  const groups = getScenicCueGroups();
  if (!pieces.length && !groups.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No scenic elements.</div>';
  const sl = [], on = [], sr = [];
  pieces.forEach(p => {
    const r = getItemStatus(p, page, { stateModel: 'two-state' });
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPages && (r.upcomingEnter - page) > 0;
    const item = { name: p.name || '?', ...r, warn };
    if (r.status === 'ON') on.push(item);
    else if ((r.location || '').includes('right')) sr.push(item);
    else sl.push(item);
  });
  const pill = it => '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;color:var(--text-primary);' + (it.warn ? 'border-left:3px solid var(--state-hold);' : '') + '">' + escapeHtml(it.name) + '</div>';

  let groupHtml = '';
  const upcoming = groups.filter(g => g.startPage && g.startPage >= page && g.startPage <= page + warnPages * 2);
  if (upcoming.length > 0) {
    groupHtml = '<div style="border-top:1px solid var(--bg-border);margin-top:6px;padding-top:6px;">' +
      upcoming.map(g => '<div style="font-size:10px;color:' + (page >= g.startPage && page <= g.endPage ? 'var(--gold)' : 'var(--text-muted)') + ';">▸ ' + escapeHtml(g.name) + ' pg ' + g.startPage + '</div>').join('') + '</div>';
  }

  return '<div class="rs-stage-columns"><div class="stage-col stage-col--sl"><h4>BSL</h4>' + (sl.map(pill).join('') || '—') + '</div><div class="stage-col stage-col--on"><h4>ON</h4>' + (on.map(pill).join('') || '—') + '</div><div class="stage-col stage-col--sr"><h4>BSR</h4>' + (sr.map(pill).join('') || '—') + '</div></div>' + groupHtml;
}

// ── Costumes view ──
function _renderCostumesView(page, warnPages) {
  const all = getCostumes();
  if (!all.length) return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">No costumes tracked.</div>';
  const quickChanges = [];
  const wearing = [];
  all.forEach(c => {
    const cues = c.cues || [];
    for (const cue of cues) {
      if (page >= (cue.startPage || 0) && page <= (cue.endPage || 9999)) { wearing.push(c); break; }
    }
    for (const cue of cues) {
      if ((cue.startPage || 0) > page && (cue.startPage - page) <= warnPages && cue.isQuickChange) {
        quickChanges.push({ costume: c, cue, pagesUntil: cue.startPage - page }); break;
      }
    }
  });
  let html = '';
  if (quickChanges.length > 0) {
    html += quickChanges.map(({ costume: c, pagesUntil }) =>
      '<div style="padding:4px 8px;background:rgba(232,155,62,0.12);border-left:3px solid var(--qc-alert);border-radius:4px;margin-bottom:4px;font-size:11px;' + (pagesUntil <= 2 ? 'animation:badge-pulse 1.5s ease-in-out infinite;' : '') + '">⚡ ' + escapeHtml(c.characterName || c.name) + ' <span style="color:var(--text-muted);">(' + pagesUntil + ' pg)</span></div>'
    ).join('');
    html += '<div style="border-top:1px solid var(--bg-border);margin:6px 0;"></div>';
  }
  html += wearing.map(c => '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;border-left:3px solid var(--track-costume);">' + escapeHtml(c.characterName || '') + ' — ' + escapeHtml(c.name) + '</div>').join('') || '<div style="color:var(--text-muted);font-size:11px;">No active costumes.</div>';
  return html;
}
