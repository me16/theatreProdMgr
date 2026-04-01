/**
 * cue-margin.js — Margin-Pinned Cue Rendering
 *
 * Renders script cues as positioned pill markers in the PDF overlay margins,
 * replacing the old banner-bar approach. Each marker is placed at the cue's
 * Y position (or distributed evenly if no yPosition is set).
 *
 * Also renders the Cue Detail panel and Cue Summary panel for the diagram
 * panel's Cue Details tab.
 */

import { escapeHtml } from '../shared/ui.js';
import { state } from '../shared/state.js';

// Department → color mapping (matches cue type badge colors)
const TYPE_COLORS = {
  LX:    { bg: '#1A2E50', fg: '#5B9BD4' },
  SQ:    { bg: '#2D1A14', fg: '#E63946' },
  PX:    { bg: '#1A2A1A', fg: '#2D8A4E' },
  FLY:   { bg: '#2E2C29', fg: '#9A9488' },
  CARP:  { bg: '#2E2C29', fg: '#9A9488' },
  BLOCK: { bg: '#3a2800', fg: '#f5a623' },
  OTHER: { bg: '#2E2C29', fg: '#9A9488' },
};

function _typeColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.OTHER;
}

/**
 * Distribute default Y positions for cues without explicit yPosition.
 * Spaces them evenly in the top 80% of the page.
 */
function _assignDefaultPositions(cues) {
  const needsY = cues.filter(c => c.yPosition == null && c.bounds?.y == null);
  if (needsY.length === 0) return;
  const step = 80 / (needsY.length + 1);
  needsY.forEach((c, i) => {
    c._computedY = step * (i + 1);
  });
}

/**
 * Render margin cue markers as positioned elements inside the hit overlay.
 *
 * @param {Array}  cues         — scriptCues for the current page
 * @param {number} page         — current script page number
 * @param {string} half         — 'L'|'R'|'' for split mode
 * @param {HTMLElement} overlayEl — the rs-hit-overlay element
 * @param {number} canvasWidth  — rendered canvas width in px (for margin offset)
 * @param {Function} onCueClick — callback(cue) when a marker is clicked
 */
export function renderMarginCues(cues, page, half, overlayEl, canvasWidth, onCueClick) {
  if (!overlayEl || !cues.length) return;

  // Remove any existing margin cues before rendering
  overlayEl.querySelectorAll('.rs-cue-marker').forEach(el => el.remove());

  _assignDefaultPositions(cues);

  cues.forEach(cue => {
    const y = cue.yPosition != null ? cue.yPosition : (cue.bounds?.y ?? cue._computedY ?? 10);
    const side = cue.xSide || 'left';
    const { bg, fg } = _typeColor(cue.type);

    const marker = document.createElement('div');
    marker.className = 'rs-cue-marker';
    marker.dataset.cueId = cue.id;
    marker.style.cssText = [
      'position:absolute',
      'top:' + y + '%',
      side === 'right' ? 'right:-52px' : 'left:-52px',
      'width:46px',
      'height:18px',
      'border-radius:9px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-family:"DM Mono",monospace',
      'font-size:10px',
      'font-weight:500',
      'cursor:pointer',
      'z-index:15',
      'pointer-events:all',
      'transition:transform 0.15s,box-shadow 0.15s',
      'background:' + bg,
      'color:' + fg,
    ].join(';');

    marker.textContent = cue.label || cue.type;
    marker.title = (cue.label || cue.type) + (cue.description ? ' — ' + cue.description : '');

    // Called indicator
    if (cue.goTimestamp) {
      marker.classList.add('rs-cue-marker--called');
      marker.style.background = 'var(--green)';
      marker.style.color = '#fff';
    }

    // Connector line from marker to page edge
    const connector = document.createElement('div');
    connector.className = 'rs-cue-connector';
    connector.style.cssText = [
      'position:absolute',
      'top:50%',
      side === 'right' ? 'left:-6px' : 'right:-6px',
      'width:6px',
      'height:0',
      'border-top:1px dashed ' + fg,
      'opacity:0.4',
    ].join(';');
    marker.appendChild(connector);

    marker.addEventListener('click', e => {
      e.stopPropagation();
      // Highlight selected
      overlayEl.querySelectorAll('.rs-cue-marker').forEach(el => el.classList.remove('rs-cue-marker--selected'));
      marker.classList.add('rs-cue-marker--selected');
      if (onCueClick) onCueClick(cue);
    });

    overlayEl.appendChild(marker);
  });
}

/**
 * Render a detail view for a single selected cue.
 *
 * @param {Object} cue       — the scriptCue document
 * @param {HTMLElement} panelEl — the container element
 * @param {Object|null} session — current run session (for GO button)
 * @param {Function} onGo     — callback when GO is pressed
 */
export function renderCueDetailPanel(cue, panelEl, session, onGo) {
  if (!panelEl) return;
  const { bg, fg } = _typeColor(cue.type);
  const isActiveRun = !!session;
  const alreadyCalled = !!cue.goTimestamp;

  panelEl.innerHTML = `
    <div style="padding:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="background:${bg};color:${fg};padding:2px 10px;border-radius:9px;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;">${escapeHtml(cue.type)}</span>
        <span style="color:var(--text-primary);font-size:14px;font-weight:500;">${escapeHtml(cue.label || '')}</span>
      </div>
      ${cue.description ? `<div style="color:var(--text-secondary);font-size:13px;line-height:1.5;margin-bottom:12px;">${escapeHtml(cue.description)}</div>` : ''}
      <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);margin-bottom:12px;">
        Page ${cue.page}${cue.xSide ? ' · ' + cue.xSide : ''}${cue.yPosition != null ? ' · y:' + Math.round(cue.yPosition) + '%' : ''}
      </div>
      ${alreadyCalled
        ? `<div style="padding:8px 12px;background:#1a3a2a;border-radius:6px;color:#4caf50;font-size:12px;font-weight:500;">✓ Called</div>`
        : isActiveRun
          ? `<button class="rs-cue-go-btn" data-cue-id="${escapeHtml(cue.id)}">▶ GO</button>`
          : '<div style="color:var(--text-muted);font-size:12px;">Start a run to enable GO</div>'
      }
    </div>
  `;

  if (isActiveRun && !alreadyCalled) {
    panelEl.querySelector('.rs-cue-go-btn')?.addEventListener('click', () => {
      if (onGo) onGo(cue);
    });
  }
}

/**
 * Render a summary of all cues on the current page.
 *
 * @param {Array} cues        — scriptCues for the current page
 * @param {number} page       — current script page
 * @param {HTMLElement} panelEl — container element
 * @param {Function} onCueClick — callback(cue) when a row is clicked
 */
export function renderCueSummaryPanel(cues, page, panelEl, onCueClick) {
  if (!panelEl) return;
  if (cues.length === 0) {
    panelEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No cues on this page.</div>';
    return;
  }
  panelEl.innerHTML = `
    <div style="padding:8px 12px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--bg-border);">
      Page ${page} · ${cues.length} cue${cues.length !== 1 ? 's' : ''}
    </div>
    <div class="rs-cue-summary-list">
      ${cues.map(c => {
        const { bg, fg } = _typeColor(c.type);
        const calledClass = c.goTimestamp ? 'rs-cue-summary-row--called' : '';
        return `<div class="rs-cue-summary-row ${calledClass}" data-cue-id="${escapeHtml(c.id)}" style="cursor:pointer;">
          <span style="background:${bg};color:${fg};padding:1px 8px;border-radius:9px;font-family:'DM Mono',monospace;font-size:10px;">${escapeHtml(c.type)}</span>
          <span style="flex:1;color:var(--text-primary);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.label || '')}</span>
          ${c.goTimestamp ? '<span style="color:#4caf50;font-size:11px;">✓</span>' : ''}
        </div>`;
      }).join('')}
    </div>
  `;
  panelEl.querySelectorAll('.rs-cue-summary-row').forEach(row => {
    row.addEventListener('click', () => {
      const cue = cues.find(c => c.id === row.dataset.cueId);
      if (cue && onCueClick) onCueClick(cue);
    });
  });
}
