/**
 * stage-widget.js — Tabbed Tracking Widget for Run Show Right Panel
 *
 * Tabs: Props | Actors | Costumes
 */
import { escapeHtml } from '../shared/ui.js';
import { state } from '../shared/state.js';
import { getItemStatus, computeBadgeCounts, resolveLocation } from './core.js';
import { getPropStatus, getProps } from '../props/props.js';
import { getActorCues } from './actors.js';
import { getCostumes } from './costumes.js';
import { getProductionLocations } from './locations.js';

let _activeWidgetTab = 'props';

/**
 * Render the full tracking widget into a container.
 * Called from renderRunShowControls and on each timer tick for the active tab.
 */
export function renderTrackingWidget(container, page, warnPages) {
  if (!container) return;
  if (_activeWidgetTab === 'scenic') _activeWidgetTab = 'props';

  const tabs   = ['props', 'actors', 'costumes'];
  const labels = { props: 'Props', actors: 'Actors', costumes: 'Costumes' };
  const colors = { props: 'var(--track-prop)', actors: 'var(--track-actor)', costumes: 'var(--track-costume)' };

  const badges = {
    props:    computeBadgeCounts('props',    getProps(),     page, warnPages),
    actors:   computeBadgeCounts('actors',   getActorCues(), page, warnPages),
    costumes: computeBadgeCounts('costumes', getCostumes(),  page, warnPages),
  };

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

  let contentHtml = '<div class="sw-content">';
  switch (_activeWidgetTab) {
    case 'props':    contentHtml += _renderPropsView(page, warnPages); break;
    case 'actors':   contentHtml += _renderActorsView(page, warnPages); break;
    case 'costumes': contentHtml += _renderCostumesView(page, warnPages); break;
  }
  contentHtml += '</div>';

  container.innerHTML = tabBarHtml + contentHtml;

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
    props:    computeBadgeCounts('props',    getProps(),     page, warnPages),
    actors:   computeBadgeCounts('actors',   getActorCues(), page, warnPages),
    costumes: computeBadgeCounts('costumes', getCostumes(),  page, warnPages),
  };
  container.querySelectorAll('.sw-tab').forEach(btn => {
    const t = btn.dataset.swTab;
    const b = badges[t];
    if (!b) return;
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
    case 'props':    contentEl.innerHTML = _renderPropsView(page, warnPages); break;
    case 'actors':   contentEl.innerHTML = _renderActorsView(page, warnPages); break;
    case 'costumes': contentEl.innerHTML = _renderCostumesView(page, warnPages); break;
  }
}

// ── Props view ──
function _renderPropsView(page, warnPages) {
  const props = getProps();
  if (!props.length) {
    return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">Loading\u2026</div>';
  }

  const locs = getProductionLocations();
  const sl = [], on = [], sr = [], other = [];

  props.forEach(p => {
    const r = getPropStatus(p, page);
    const warn = r.upcomingEnter && (r.upcomingEnter - page) <= warnPages && (r.upcomingEnter - page) > 0;
    const resolved = resolveLocation(r.location, locs);
    const item = { name: p.name || '?', resolved, warn, activeCue: r.activeCue, crossover: r.crossover, upcomingEnter: r.upcomingEnter, status: r.status };
    if (r.status === 'ON') on.push(item);
    else if (resolved.side === 'right') sr.push(item);
    else if (resolved.side === 'left') sl.push(item);
    else if (resolved.side === 'other') other.push(item);
    else sl.push(item);
  });

  const slLabel = locs.find(l => l.side === 'left')?.shortName   || 'BSL';
  const onLabel = locs.find(l => l.side === 'center')?.shortName || 'ON';
  const srLabel = locs.find(l => l.side === 'right')?.shortName  || 'BSR';

  const pill = (it) => {
    let suffix = '';
    if (it.warn) suffix += '<span style="font-size:9px;color:var(--gold,#c8a96e);margin-left:3px;">p' + it.upcomingEnter + '</span>';
    if (it.crossover) suffix += '<span style="font-size:9px;color:var(--qc-alert,#e63946);margin-left:3px;">\u26a0</span>';
    if (it.activeCue?.carrierOn) suffix += '<span style="font-size:9px;color:var(--text-muted,#666);margin-left:3px;">\u2191' + escapeHtml(it.activeCue.carrierOn) + '</span>';
    return '<span style="display:inline-flex;align-items:center;background:var(--bg-card,#2a2823);border:1px solid var(--bg-border,#3d3a36);border-radius:4px;padding:2px 6px;font-size:11px;margin:2px;">' + escapeHtml(it.name) + suffix + '</span>';
  };

  const col = (items, label) => {
    const inner = items.length
      ? items.map(pill).join('')
      : '<span style="color:rgba(255,255,255,0.18);font-size:11px;">\u2014</span>';
    return '<div style="flex:1;min-width:0;padding:0 4px;"><div style="font-size:10px;font-weight:600;color:var(--text-muted,#666);margin-bottom:4px;text-align:center;">' + label + '</div><div style="display:flex;flex-wrap:wrap;justify-content:center;">' + inner + '</div></div>';
  };

  let html = '<div style="display:flex;gap:4px;padding:4px 0;">';
  html += col(sl, slLabel);
  html += col(on, onLabel);
  html += col(sr, srLabel);
  if (other.length) html += col(other, 'OTH');
  html += '</div>';
  return html;
}

// ── Actors view ──
function _renderActorsView(page, warnPages) {
  const actors = getActorCues();
  if (!actors.length) {
    return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">Loading\u2026</div>';
  }

  const locs = getProductionLocations();
  const off = [], hold = [], on = [];

  actors.forEach(a => {
    const r = getItemStatus(a, page, { stateModel: 'three-state' });
    const warn = r.upcomingHold && (r.upcomingHold - page) <= warnPages && (r.upcomingHold - page) > 0;
    const holdResolved = r.holdLocation ? resolveLocation(r.holdLocation, locs) : null;
    const item = { name: a.characterName || '?', color: a.color || '#5B9BD4', holdShortName: holdResolved?.shortName || null, warn, ...r };
    if (r.status === 'ON') on.push(item);
    else if (r.status === 'HOLD') hold.push(item);
    else off.push(item);
  });

  const pill = (it, borderColor) => {
    let extra = '';
    if (it.holdShortName && it.status === 'HOLD') extra += ' <span style="font-size:9px;color:var(--text-muted,#666);">@ ' + escapeHtml(it.holdShortName) + '</span>';
    if (it.warn) extra += ' <span style="font-size:9px;color:var(--state-hold,#c8a96e);">hold p' + (it.upcomingHold || '?') + '</span>';
    return '<div style="padding:3px 7px;background:var(--bg-card,#2a2823);border-radius:4px;margin-bottom:3px;font-size:11px;border-left:3px solid ' + borderColor + ';">' + escapeHtml(it.name) + extra + '</div>';
  };

  const col = (items, label, labelColor, borderColor) => {
    const inner = items.length
      ? items.map(i => pill(i, borderColor)).join('')
      : '<div style="color:rgba(255,255,255,0.18);font-size:11px;text-align:center;">\u2014</div>';
    return '<div style="flex:1;min-width:0;padding:0 4px;"><div style="font-size:10px;font-weight:600;color:' + labelColor + ';margin-bottom:4px;text-align:center;">' + label + ' (' + items.length + ')</div>' + inner + '</div>';
  };

  return '<div style="display:flex;gap:4px;padding:4px 0;">' +
    col(off,  'Off',  'var(--text-muted,#666)',    'var(--state-off,#555)') +
    col(hold, 'Hold', 'var(--state-hold,#c8a96e)', 'var(--state-hold,#c8a96e)') +
    col(on,   'On',   'var(--state-on,#6fcf97)',   'var(--state-on,#6fcf97)') +
    '</div>';
}

// ── Costumes view ──
function _renderCostumesView(page, warnPages) {
  const all = getCostumes();
  if (!all.length) {
    return '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">Loading\u2026</div>';
  }
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
  html += wearing.map(c =>
    '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:3px;font-size:11px;border-left:3px solid var(--track-costume);">' + escapeHtml(c.characterName || '') + ' — ' + escapeHtml(c.name) + '</div>'
  ).join('') || '<div style="color:var(--text-muted);font-size:11px;">No active costumes.</div>';
  return html;
}
