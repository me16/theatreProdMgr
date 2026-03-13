#!/usr/bin/env node
/**
 * patch-connector-visibility.mjs
 *
 * Fixes:
 *   1. Zone Editor (linenotes.js) — bumps connector line opacity from 0.45→0.85
 *      and anchor dot from 0.6→1.0 so they're actually visible.
 *
 *   2. Run Show (cue-margin.js) — adds SVG connector line rendering for cues
 *      that have anchorX/anchorY. Read-only display, no drawing interaction.
 *
 *   3. index.html — adds Run Show connector CSS (rs-cue-connector-svg etc.)
 *
 * Usage:
 *   node patch-connector-visibility.mjs          # dry-run
 *   node patch-connector-visibility.mjs --apply  # write to disk
 */

import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const ROOT = process.cwd();
let patchCount = 0;
let failCount = 0;

function readFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.error(`  ✗ File not found: ${rel}`); return null; }
  return fs.readFileSync(abs, 'utf-8');
}
function writeFile(rel, content) {
  if (APPLY) {
    fs.writeFileSync(path.join(ROOT, rel), content, 'utf-8');
    console.log(`  ✔ Wrote ${rel}`);
  } else {
    console.log(`  [dry-run] Would write ${rel}`);
  }
}
function replaceOnce(content, oldStr, newStr, label) {
  if (content == null) { failCount++; return content; }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    console.error(`  ✗ Anchor not found: ${label}`);
    console.error(`    Looking for: "${oldStr.slice(0, 120)}…"`);
    failCount++;
    return content;
  }
  if (content.indexOf(oldStr, idx + 1) !== -1) {
    console.error(`  ✗ Anchor matched multiple times: ${label}`);
    failCount++;
    return content;
  }
  patchCount++;
  console.log(`  ✓ Replacing: ${label}`);
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
}
function insertAfter(content, anchor, newStr, label) {
  if (content == null) { failCount++; return content; }
  const sig = newStr.trim().split('\n')[0].trim();
  if (sig.length > 20 && content.includes(sig)) {
    console.log(`  ⊘ Already applied: ${label}`);
    return content;
  }
  const idx = content.indexOf(anchor);
  if (idx === -1) {
    console.error(`  ✗ Anchor not found: ${label}`);
    failCount++;
    return content;
  }
  patchCount++;
  console.log(`  ✓ Inserting: ${label}`);
  return content.slice(0, idx + anchor.length) + newStr + content.slice(idx + anchor.length);
}

// ─────────────────────────────────────────────────────────
// PATCH 1: linenotes.js — fix connector opacity
// ─────────────────────────────────────────────────────────
console.log('\n═══ Patch 1: src/linenotes/linenotes.js — fix opacity ═══');
let ln = readFile('src/linenotes/linenotes.js');

if (ln) {
  // Fix line stroke-opacity
  ln = replaceOnce(ln,
    `line.setAttribute('stroke-opacity', '0.45');`,
    `line.setAttribute('stroke-opacity', '0.85');`,
    'Bump connector line stroke-opacity 0.45→0.85'
  );

  // Fix line stroke-width  
  ln = replaceOnce(ln,
    `line.setAttribute('stroke-width', '0.15');`,
    `line.setAttribute('stroke-width', '0.25');`,
    'Bump connector line stroke-width 0.15→0.25'
  );

  // Fix dot fill-opacity
  ln = replaceOnce(ln,
    `dot.setAttribute('fill-opacity', '0.6');`,
    `dot.setAttribute('fill-opacity', '1');`,
    'Bump anchor dot fill-opacity 0.6→1'
  );

  // Fix dot radius
  ln = replaceOnce(ln,
    `dot.setAttribute('r', '0.5');`,
    `dot.setAttribute('r', '0.8');`,
    'Bump anchor dot radius 0.5→0.8'
  );

  writeFile('src/linenotes/linenotes.js', ln);
}


// ─────────────────────────────────────────────────────────
// PATCH 2: cue-margin.js — add connector rendering to Run Show
// ─────────────────────────────────────────────────────────
console.log('\n═══ Patch 2: src/runshow/cue-margin.js — add connectors ═══');
let cm = readFile('src/runshow/cue-margin.js');

if (cm) {
  // Replace the entire renderMarginCues function.
  // The old function has a connector stub div inside the marker — we replace it
  // with SVG-based connector lines from anchorX/anchorY to the marker.

  const oldFn = `export function renderMarginCues(cues, page, half, overlayEl, canvasWidth, onCueClick) {
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
}`;

  const newFn = `export function renderMarginCues(cues, page, half, overlayEl, canvasWidth, onCueClick) {
  if (!overlayEl || !cues.length) return;

  // Remove any existing margin cues and connector SVG
  overlayEl.querySelectorAll('.rs-cue-marker').forEach(el => el.remove());
  overlayEl.querySelectorAll('.rs-cue-connector-svg').forEach(el => el.remove());

  _assignDefaultPositions(cues);

  // SVG overlay for connector lines (percentage-based viewBox)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('rs-cue-connector-svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:14;overflow:visible;';
  overlayEl.appendChild(svg);

  cues.forEach(cue => {
    const y = cue.yPosition != null ? cue.yPosition : (cue.bounds?.y ?? cue._computedY ?? 10);
    const side = cue.xSide || 'left';
    const { bg, fg } = _typeColor(cue.type);

    // --- SVG connector line (if anchor exists) ---
    if (cue.anchorX != null && cue.anchorY != null) {
      const edgeX = side === 'left' ? 0 : 100;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.classList.add('rs-connector-line');
      line.dataset.cueId = cue.id;
      line.setAttribute('x1', cue.anchorX);
      line.setAttribute('y1', cue.anchorY);
      line.setAttribute('x2', edgeX);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', fg);
      line.setAttribute('stroke-width', '0.25');
      line.setAttribute('stroke-dasharray', '0.8,0.5');
      line.setAttribute('stroke-opacity', '0.8');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(line);

      // Anchor dot
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.classList.add('rs-connector-dot');
      dot.dataset.cueId = cue.id;
      dot.setAttribute('cx', cue.anchorX);
      dot.setAttribute('cy', cue.anchorY);
      dot.setAttribute('r', '0.8');
      dot.setAttribute('fill', fg);
      dot.setAttribute('fill-opacity', '1');
      svg.appendChild(dot);
    }

    // --- Marker pill ---
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

    marker.addEventListener('click', e => {
      e.stopPropagation();
      overlayEl.querySelectorAll('.rs-cue-marker').forEach(el => el.classList.remove('rs-cue-marker--selected'));
      marker.classList.add('rs-cue-marker--selected');
      // Highlight this cue's connector
      svg.querySelectorAll('.rs-connector-line').forEach(l => l.classList.remove('rs-connector-line--active'));
      svg.querySelectorAll('.rs-connector-dot').forEach(d => d.classList.remove('rs-connector-dot--active'));
      const myLine = svg.querySelector('.rs-connector-line[data-cue-id="' + cue.id + '"]');
      const myDot = svg.querySelector('.rs-connector-dot[data-cue-id="' + cue.id + '"]');
      if (myLine) myLine.classList.add('rs-connector-line--active');
      if (myDot) myDot.classList.add('rs-connector-dot--active');
      if (onCueClick) onCueClick(cue);
    });

    overlayEl.appendChild(marker);
  });
}`;

  cm = replaceOnce(cm, oldFn, newFn, 'renderMarginCues → SVG connectors');
  writeFile('src/runshow/cue-margin.js', cm);
}


// ─────────────────────────────────────────────────────────
// PATCH 3: index.html — Run Show connector CSS
// ─────────────────────────────────────────────────────────
console.log('\n═══ Patch 3: index.html — Run Show connector CSS ═══');
let html = readFile('index.html');

if (html) {
  // Insert after the existing rs-cue-marker--called rule
  const anchor = `.rs-cue-marker--called { opacity:0.7; }`;
  const css = `
    /* ===== Run Show connector lines (SVG) ===== */
    .rs-cue-connector-svg {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 14; overflow: visible;
    }
    .rs-connector-line { transition: stroke-opacity 0.2s; }
    .rs-connector-line--active { stroke-opacity: 1 !important; stroke-dasharray: none !important; }
    .rs-connector-dot { transition: fill-opacity 0.2s; }
    .rs-connector-dot--active { fill-opacity: 1 !important; }`;

  html = insertAfter(html, anchor, css, 'Add Run Show connector CSS');

  // Also fix Zone Editor connector CSS opacity if the previous patch set it too low
  // Bump the --active states to be fully opaque
  if (html.includes('.ze-connector-line--active { stroke-opacity: 0.85')) {
    html = replaceOnce(html,
      '.ze-connector-line--active { stroke-opacity: 0.85',
      '.ze-connector-line--active { stroke-opacity: 1',
      'Fix ZE connector --active opacity'
    );
  }

  writeFile('index.html', html);
}


// ─────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`Patches applied: ${patchCount}  |  Failures: ${failCount}`);
if (!APPLY) {
  console.log('Dry-run complete. Re-run with --apply to write changes.');
} else {
  console.log('All changes written to disk.');
}

if (failCount === 0) {
  console.log(`
┌────────────────────────────────────────────────────┐
│  VERIFICATION CHECKLIST                            │
├────────────────────────────────────────────────────┤
│  1. Zone Editor: connector lines should now be     │
│     clearly visible — dashed line at ~85% opacity  │
│     with a solid dot at the anchor point.          │
│                                                    │
│  2. Run Show: navigate to a page with cues that    │
│     have connectors (anchorX/anchorY set).         │
│     Same dashed-line + dot should appear from      │
│     the anchor point to the margin pill.           │
│                                                    │
│  3. Click a cue marker in Run Show → its           │
│     connector line goes solid (selected state).    │
│                                                    │
│  4. Cues without anchorX/anchorY still render      │
│     as pill-only, no connector line.               │
└────────────────────────────────────────────────────┘
`);
}
