#!/usr/bin/env node
/**
 * cue-actor-lines.mjs
 * Implements Actor Line Assignment across Zone Editor, Run Show, and Cast Tab.
 *
 * 3 features, 4 files, ~18 discrete changes.
 *
 * Usage:
 *   node cue-actor-lines.mjs --dry-run          # preview (default)
 *   node cue-actor-lines.mjs --apply             # write changes
 *   node cue-actor-lines.mjs --apply --project-root /path/to/project
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROJECT_ROOT = (() => {
  const idx = args.indexOf('--project-root');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : process.cwd();
})();

const results = [];
let hadError = false;

function log(msg) { console.log(msg); }
function logOk(tag) { results.push({ tag, status: 'OK' }); log(`  ✅ ${tag}`); }
function logSkip(tag) { results.push({ tag, status: 'ALREADY_PRESENT' }); log(`  ⏭️  ${tag} — already applied`); }
function logFail(tag, reason) { results.push({ tag, status: 'FAIL', reason }); log(`  ❌ ${tag} — ${reason}`); hadError = true; }

function readFile(relPath) {
  const full = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(full)) { throw new Error(`File not found: ${full}`); }
  return fs.readFileSync(full, 'utf8');
}

function writeFile(relPath, content) {
  if (!APPLY) return;
  fs.writeFileSync(path.join(PROJECT_ROOT, relPath), content, 'utf8');
}

/**
 * Replace `old` with `replacement` in `src`. Returns new string.
 * Throws if old not found. Skips (returns null) if `skipIf` is already in src.
 */
function applyPatch(src, old, replacement, tag, skipIf) {
  if (skipIf && src.includes(skipIf)) { logSkip(tag); return null; }
  const idx = src.indexOf(old);
  if (idx === -1) { logFail(tag, `Anchor string not found (${old.substring(0, 60).replace(/\n/g, '\\n')}…)`); return null; }
  // Ensure unique
  const second = src.indexOf(old, idx + 1);
  if (second !== -1) { logFail(tag, `Anchor string found multiple times`); return null; }
  const result = src.slice(0, idx) + replacement + src.slice(idx + old.length);
  logOk(tag);
  return result;
}

/**
 * Insert `insertion` after `anchor` in `src`. Returns new string.
 */
function insertAfter(src, anchor, insertion, tag, skipIf) {
  if (skipIf && src.includes(skipIf)) { logSkip(tag); return null; }
  const idx = src.indexOf(anchor);
  if (idx === -1) { logFail(tag, `Anchor string not found (${anchor.substring(0, 60).replace(/\n/g, '\\n')}…)`); return null; }
  const result = src.slice(0, idx + anchor.length) + insertion + src.slice(idx + anchor.length);
  logOk(tag);
  return result;
}

// ═══════════════════════════════════════════════════════════
// PATCH index.html
// ═══════════════════════════════════════════════════════════
function patchIndexHtml() {
  log('\n📄 index.html');
  const FILE = 'index.html';
  let src;
  try { src = readFile(FILE); } catch (e) { logFail('index.html:read', e.message); return; }

  // ── 1A: Add actor dropdown to zone detail panel ──
  const old1A = `            <label style="display:flex;align-items:center;gap:7px;margin-bottom:10px;cursor:pointer;">
              <input type="checkbox" id="zd-musicline" style="accent-color:#4ecdc4;">
              <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);">Music line <kbd>M</kbd></span>
            </label>
            <div style="display:flex;gap:6px;justify-content:flex-end;">`;

  const new1A = `            <label style="display:flex;align-items:center;gap:7px;margin-bottom:10px;cursor:pointer;">
              <input type="checkbox" id="zd-musicline" style="accent-color:#4ecdc4;">
              <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);">Music line <kbd>M</kbd></span>
            </label>
            <div style="margin-bottom:10px;" id="zd-actor-section">
              <div class="ze-label">Assign Actor</div>
              <select class="ze-input" id="zd-actor" style="font-size:11px;padding:4px 6px;">
                <option value="">— none —</option>
              </select>
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end;">`;

  r = applyPatch(src, old1A, new1A, '1A: actor dropdown in ze-detail', 'zd-actor-section');
  if (r !== null) src = r;

  // ── 1B: Add CSS for actor badge + run show pill ──
  const anchor1B = `    .ze-select-all-drag-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    #ze-saved-badge.visible { opacity: 1; }`;

  const new1B = `    .ze-select-all-drag-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    #ze-saved-badge.visible { opacity: 1; }

    /* Actor assignment badge on zones */
    .ze-zone-actor-badge {
      position: absolute; top: -1px; right: 2px;
      font-family: 'DM Mono', monospace; font-size: 8px;
      background: rgba(91,155,212,0.25); color: #5b9bd4;
      padding: 0 4px; border-radius: 2px; line-height: 14px;
      pointer-events: none; white-space: nowrap; max-width: 80px;
      overflow: hidden; text-overflow: ellipsis;
    }

    /* Run Show actor pill on line zones */
    .rs-actor-pill {
      position: absolute; left: -2px; top: 50%; transform: translate(-100%, -50%);
      font-family: 'DM Mono', monospace; font-size: 9px;
      padding: 1px 5px; border-radius: 3px; line-height: 14px;
      white-space: nowrap; pointer-events: none; z-index: 4;
      max-width: 90px; overflow: hidden; text-overflow: ellipsis;
      opacity: 0.85;
    }`;

  r = applyPatch(src, anchor1B, new1B, '1B: CSS for actor badge + pill', 'ze-zone-actor-badge');
  if (r !== null) src = r;

  // ── 2A: Add "Actors" toggle to Run Show sidebar header ──
  const old2A = `              <div style="margin-left:auto;display:flex;gap:6px;">
                <button class="ln-header-btn" id="rs-email-notes-btn">Email Notes</button>
                <button class="ln-header-btn" id="rs-send-btn">Send Notes</button>
              </div>`;

  const new2A = `              <div style="margin-left:auto;display:flex;gap:6px;">
                <button class="ln-header-btn" id="rs-toggle-actor-pills" title="Show/hide actor labels on script lines">Actors</button>
                <button class="ln-header-btn" id="rs-email-notes-btn">Email Notes</button>
                <button class="ln-header-btn" id="rs-send-btn">Send Notes</button>
              </div>`;

  r = applyPatch(src, old2A, new2A, '2A: Actors toggle btn in RS sidebar', 'rs-toggle-actor-pills');
  if (r !== null) src = r;

  writeFile(FILE, src);
}

// ═══════════════════════════════════════════════════════════
// PATCH src/linenotes/linenotes.js
// ═══════════════════════════════════════════════════════════
function patchLineNotes() {
  log('\n📄 src/linenotes/linenotes.js');
  const FILE = 'src/linenotes/linenotes.js';
  let src;
  try { src = readFile(FILE); } catch (e) { logFail('linenotes.js:read', e.message); return; }

  // ── 1C: Populate actor dropdown in zePopulateDetail ──
  // Actual codebase: ml.checked = !!z.isMusicLine;\n  if (focusText && t) requestAnimationFrame
  const old1C = `  const ml = getValue('zd-musicline'); if (ml) ml.checked = !!z.isMusicLine;
  if (focusText && t) requestAnimationFrame(() => { t.focus(); t.select(); });`;

  const new1C = `  const ml = getValue('zd-musicline'); if (ml) ml.checked = !!z.isMusicLine;
  // Actor assignment dropdown
  const actorSelect = document.getElementById('zd-actor');
  const actorSection = document.getElementById('zd-actor-section');
  if (actorSelect && actorSection) {
    // Hide for charName/stageDir zones, show for dialogue/music
    actorSection.style.display = (z.isCharName || z.isStageDirection) ? 'none' : '';
    const cast = getCastMembers();
    let opts = '<option value="">— none —</option>';
    cast.forEach(m => {
      const chars = m.characters?.length > 0 ? m.characters : [m.name];
      chars.forEach(ch => {
        const val = m.id + '::' + ch;
        const sel = (m.id === z.assignedCastId && ch === z.assignedCharName) ? ' selected' : '';
        opts += '<option value="' + escapeHtml(val) + '"' + sel + '>' + escapeHtml(ch) + ' (' + escapeHtml(m.name) + ')</option>';
      });
    });
    actorSelect.innerHTML = opts;
    // Explicitly set value — innerHTML + selected attribute is unreliable in some browsers
    if (z.assignedCastId && z.assignedCharName) {
      actorSelect.value = z.assignedCastId + '::' + z.assignedCharName;
    }
  }
  if (focusText && t) requestAnimationFrame(() => { t.focus(); t.select(); });`;

  r = applyPatch(src, old1C, new1C, '1C: populate actor dropdown in zePopulateDetail', 'zd-actor-section');
  if (r !== null) src = r;

  // ── 1D: Save actor assignment in zeApplyDetail ──
  const old1D = `  if (z.isCharName) { z.isStageDirection = false; z.isMusicLine = false; }
  if (z.isStageDirection) { z.isCharName = false; z.isMusicLine = false; }
  if (z.isMusicLine) { z.isCharName = false; z.isStageDirection = false; }
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones();`;

  const new1D = `  if (z.isCharName) { z.isStageDirection = false; z.isMusicLine = false; }
  if (z.isStageDirection) { z.isCharName = false; z.isMusicLine = false; }
  if (z.isMusicLine) { z.isCharName = false; z.isStageDirection = false; }
  // Actor assignment
  const actorVal = document.getElementById('zd-actor')?.value || '';
  if (actorVal) {
    const [cid, cname] = actorVal.split('::');
    z.assignedCastId = cid;
    z.assignedCharName = cname;
  } else {
    z.assignedCastId = null;
    z.assignedCharName = null;
  }
  // Clear actor if zone is charName or stageDir
  if (z.isCharName || z.isStageDirection) { z.assignedCastId = null; z.assignedCharName = null; }
  zeRenderZones(); zeUpdateListPanel(); zeSelectZone(zeSelectedIdx); debounceSaveZones();`;

  r = applyPatch(src, old1D, new1D, '1D: save actor assignment in zeApplyDetail', 'assignedCastId');
  if (r !== null) src = r;

  // ── 1E: Show actor badge on zone overlay in zeRenderZones ──
  // Actual codebase uses substring(0, 50) and `[zone ${idx}]`
  const anchor1E = `    const label = document.createElement('span');
    label.className = 'ze-zone-label';
    label.textContent = zone.text ? zone.text.substring(0, 50) : \`[zone \${idx}]\`;
    div.appendChild(label);`;

  const insertion1E = `

    if (zone.assignedCharName) {
      const ab = document.createElement('span');
      ab.className = 'ze-zone-actor-badge';
      ab.textContent = zone.assignedCharName;
      div.appendChild(ab);
    }`;

  r = insertAfter(src, anchor1E, insertion1E, '1E: actor badge in zeRenderZones', 'ze-zone-actor-badge');
  if (r !== null) src = r;

  writeFile(FILE, src);
}

// ═══════════════════════════════════════════════════════════
// PATCH src/runshow/Runshow.js
// ═══════════════════════════════════════════════════════════
function patchRunshow() {
  log('\n📄 src/runshow/Runshow.js');
  const FILE = 'src/runshow/Runshow.js';
  let src;
  try { src = readFile(FILE); } catch (e) { logFail('Runshow.js:read', e.message); return; }

  // ── 2B: Add module state variable ──
  const old2B = `let rsDiagramPanelMode = 'diagrams'; // 'diagrams' | 'cues'`;

  const new2B = `let rsDiagramPanelMode = 'diagrams'; // 'diagrams' | 'cues'
let rsShowActorPills = false;         // toggle actor name pills on assigned zones`;

  r = applyPatch(src, old2B, new2B, '2B: rsShowActorPills state var', 'rsShowActorPills');
  if (r !== null) src = r;

  // ── 2C: Wire the toggle button ──
  const anchor2C = `  document.getElementById('rs-email-notes-btn')?.addEventListener('click', rsOpenEmailNotes);`;

  const insertion2C = `
  document.getElementById('rs-toggle-actor-pills')?.addEventListener('click', () => {
    rsShowActorPills = !rsShowActorPills;
    const btn = document.getElementById('rs-toggle-actor-pills');
    if (btn) btn.classList.toggle('ln-header-btn--active', rsShowActorPills);
    if (rsPdfDoc) rsRedrawOverlay(rsCurrentPage);
  });

`;

  r = insertAfter(src, anchor2C, insertion2C, '2C: wire Actors toggle in initRunShow',
    'rsShowActorPills = !rsShowActorPills');
  if (r !== null) src = r;

  // ── 2D: Render actor pills in rsRenderLineZones ──
  const old2D = `    const label = document.createElement('span');
    label.className = 'zone-label';
    label.textContent = zone.text ? zone.text.substring(0, 40) : \`zone \${idx}\`;
    div.appendChild(label);
    hitOverlay.appendChild(div);`;

  const new2D = `    const label = document.createElement('span');
    label.className = 'zone-label';
    label.textContent = zone.text ? zone.text.substring(0, 40) : \`zone \${idx}\`;
    div.appendChild(label);
    // Actor pill (when toggled on and zone has assignment)
    if (rsShowActorPills && zone.assignedCharName) {
      const cast = getCastMembers();
      const member = cast.find(m => m.id === zone.assignedCastId);
      const pillColor = member?.color || '#5b9bd4';
      const pill = document.createElement('span');
      pill.className = 'rs-actor-pill';
      pill.style.background = pillColor;
      pill.style.color = '#fff';
      pill.textContent = zone.assignedCharName;
      div.appendChild(pill);
    }
    hitOverlay.appendChild(div);`;

  r = applyPatch(src, old2D, new2D, '2D: render actor pills in rsRenderLineZones', 'rs-actor-pill');
  if (r !== null) src = r;

  writeFile(FILE, src);
}

// ═══════════════════════════════════════════════════════════
// PATCH src/cast/cast.js
// ═══════════════════════════════════════════════════════════
function patchCast() {
  log('\n📄 src/cast/cast.js');
  const FILE = 'src/cast/cast.js';
  let src;
  try { src = readFile(FILE); } catch (e) { logFail('cast.js:read', e.message); return; }

  // ── 3A: Add getDocs to Firestore imports ──
  const old3A = `import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';`;

  const new3A = `import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, getDocs,
  serverTimestamp
} from 'firebase/firestore';`;

  r = applyPatch(src, old3A, new3A, '3A: add getDocs import', 'getDocs');
  if (r !== null) src = r;

  // ── 3C: Add data-member-id and Lines button to member cards ──
  // The member cards are table rows. Find the <tr> rendering in the .map():
  //   return `<tr>
  //     <td class="cast-member-name">
  // Need to add data-member-id to the <tr>.
  const old3C_tr = 'return `<tr>';
  // Check if there's only one occurrence relevant to cast members. The template
  // literal with cast-member-name is unique enough:
  const trAnchor = `return \`<tr>
                <td class="cast-member-name">\${escapeHtml(m.name)}</td>`;

  const trNew = `return \`<tr data-member-id="\${escapeHtml(m.id)}">
                <td class="cast-member-name">\${escapeHtml(m.name)}</td>`;

  r = applyPatch(src, trAnchor, trNew, '3C-a: add data-member-id to <tr>', 'data-member-id');
  if (r !== null) src = r;

  // Add "Lines" button next to Edit/Remove in the actions td.
  // The owner actions cell has Edit and Remove buttons.
  const oldActions = `\${owner ? \`<td class="cast-actions">
                  <button class="cast-action-btn" data-action="edit" data-id="\${escapeHtml(m.id)}">Edit</button>
                  <button class="cast-action-btn cast-action-btn--danger" data-action="remove" data-id="\${escapeHtml(m.id)}">Remove</button>
                </td>\` : ''}`;

  const newActions = `\${owner ? \`<td class="cast-actions">
                  <button class="cast-action-btn" data-action="edit" data-id="\${escapeHtml(m.id)}">Edit</button>
                  <button class="cast-action-btn cast-action-btn--danger" data-action="remove" data-id="\${escapeHtml(m.id)}">Remove</button>
                  <button class="cast-lines-btn" data-lines-id="\${escapeHtml(m.id)}" style="font-size:10px;padding:3px 8px;background:var(--bg-raised);border:1px solid var(--bg-border);color:var(--text-secondary);border-radius:4px;cursor:pointer;font-family:'DM Mono',monospace;" title="View assigned script lines">Lines</button>
                </td>\` : \`<td><button class="cast-lines-btn" data-lines-id="\${escapeHtml(m.id)}" style="font-size:10px;padding:3px 8px;background:var(--bg-raised);border:1px solid var(--bg-border);color:var(--text-secondary);border-radius:4px;cursor:pointer;font-family:'DM Mono',monospace;" title="View assigned script lines">Lines</button></td>\`}`;

  r = applyPatch(src, oldActions, newActions, '3C-b: add Lines button to actions', 'cast-lines-btn');
  if (r !== null) src = r;

  // Also need to add a <th></th> for the Lines column when not owner, or expand the owner <th>
  // The table header has: <thead><tr><th>Name</th><th>Email</th><th>Characters</th>${owner ? '<th></th>' : ''}</tr></thead>
  const oldTh = `<thead><tr><th>Name</th><th>Email</th><th>Characters</th>\${owner ? '<th></th>' : ''}</tr></thead>`;
  const newTh = `<thead><tr><th>Name</th><th>Email</th><th>Characters</th><th></th></tr></thead>`;

  r = applyPatch(src, oldTh, newTh, '3C-c: always show actions th', 'Characters</th><th></th></tr>');
  if (r !== null) src = r;

  // ── 3C-d: Wire the Lines button click handler ──
  // Find the event wiring section in renderCastTab — after the remove button wiring.
  // We need to add the click handler for .cast-lines-btn.
  const wireAnchor = `    container.querySelectorAll('[data-action="remove"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDialog('Remove this cast member?')) return;
        try {
          await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'cast', btn.dataset.id));
          toast('Member removed.', 'success');
        } catch(e) { toast('Failed to remove.', 'error'); }
      })
    );
  }`;

  const wireInsertion = `

  // Lines button handler — all users, not just owners
  container.querySelectorAll('.cast-lines-btn').forEach(btn => {
    btn.addEventListener('click', () => showActorLineReport(btn.dataset.linesId));
  });`;

  r = insertAfter(src, wireAnchor, wireInsertion, '3C-d: wire Lines btn click', 'showActorLineReport');
  if (r !== null) src = r;

  // ── 3B: Add buildActorLineReport + showActorLineReport functions ──
  // Insert right before the `function openCastModal(member)` function
  const funcAnchor = `function openCastModal(member) {`;

  const newFunctions = `/**
 * Build a line report for a single cast member.
 * Reads all zone documents, filters for zones assigned to the given castId,
 * groups by page, and returns { pageKey: string, lines: string[] }[].
 */
async function buildActorLineReport(castId, charNames) {
  const pid = state.activeProduction?.id;
  if (!pid) return [];
  try {
    const zonesSnap = await getDocs(collection(db, 'productions', pid, 'zones'));
    const pages = [];
    zonesSnap.docs.forEach(docSnap => {
      const pageKey = docSnap.id;
      const zones = docSnap.data().zones || [];
      const matching = zones.filter(z =>
        z.assignedCastId === castId && charNames.includes(z.assignedCharName)
        && !z.isCharName && !z.isStageDirection
      );
      if (matching.length > 0) {
        pages.push({
          pageKey,
          lines: matching.map(z => z.text || '[no text]')
        });
      }
    });
    // Sort by page number (numeric part)
    pages.sort((a, b) => {
      const numA = parseInt(a.pageKey) || 0;
      const numB = parseInt(b.pageKey) || 0;
      if (numA !== numB) return numA - numB;
      return a.pageKey.localeCompare(b.pageKey);
    });
    return pages;
  } catch (e) {
    console.error('Failed to build actor line report:', e);
    return [];
  }
}

/**
 * Render the line report modal/section for a cast member.
 */
async function showActorLineReport(memberId) {
  const member = castMembers.find(m => m.id === memberId);
  if (!member) return;
  const charNames = member.characters?.length > 0 ? member.characters : [member.name];

  // Show loading state
  const container = document.getElementById('cast-content');
  if (!container) return;
  const reportId = 'cast-line-report-' + memberId;
  let reportEl = document.getElementById(reportId);
  if (reportEl) { reportEl.remove(); return; } // toggle off

  // Create report container
  reportEl = document.createElement('div');
  reportEl.id = reportId;
  reportEl.className = 'cast-line-report';
  reportEl.style.cssText = 'background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;padding:16px;margin:8px 0 16px;';
  reportEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;font-family:\\'DM Mono\\',monospace;">Loading line report\\u2026</div>';

  // Insert after the member's row (find the <tr> with data-member-id, then after its parent table group)
  const memberRow = container.querySelector('[data-member-id="' + memberId + '"]');
  const groupDiv = memberRow?.closest('div[style]');
  if (groupDiv) groupDiv.after(reportEl);
  else container.appendChild(reportEl);

  const pages = await buildActorLineReport(memberId, charNames);

  if (pages.length === 0) {
    reportEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0;">No lines assigned to ' + escapeHtml(member.name) + ' yet. Assign lines in the Edit Script tab.</div>';
    return;
  }

  const totalLines = pages.reduce((sum, p) => sum + p.lines.length, 0);
  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
    + '<span style="font-family:\\'DM Mono\\',monospace;font-size:11px;color:var(--gold);">'
    + totalLines + ' line' + (totalLines !== 1 ? 's' : '') + ' across ' + pages.length + ' page' + (pages.length !== 1 ? 's' : '')
    + '</span>'
    + '<button class="ln-header-btn" data-close-report="' + escapeHtml(memberId) + '" style="font-size:10px;">Close</button></div>';

  pages.forEach(p => {
    html += '<details class="cast-line-page-group" style="margin-bottom:6px;">'
      + '<summary style="cursor:pointer;font-family:\\'DM Mono\\',monospace;font-size:12px;color:var(--text-primary);padding:4px 0;user-select:none;">'
      + '<span style="color:var(--gold);">p.' + escapeHtml(p.pageKey) + '</span>'
      + ' \\u00b7 ' + p.lines.length + ' line' + (p.lines.length !== 1 ? 's' : '')
      + '</summary>'
      + '<div style="padding:4px 0 8px 16px;">';
    p.lines.forEach(line => {
      html += '<div style="font-size:12px;color:var(--text-secondary);padding:2px 0;border-left:2px solid ' + escapeHtml(member.color || '#5b9bd4') + ';padding-left:8px;margin-bottom:3px;">'
        + escapeHtml(line.length > 120 ? line.slice(0, 120) + '\\u2026' : line)
        + '</div>';
    });
    html += '</div></details>';
  });

  reportEl.innerHTML = html;

  // Wire close button
  reportEl.querySelector('[data-close-report]')?.addEventListener('click', () => reportEl.remove());
}

`;

  // Insert before openCastModal:
  {
    const tag = '3B: add line report functions';
    if (src.includes('buildActorLineReport')) {
      logSkip(tag);
    } else {
      const idx = src.indexOf(funcAnchor);
      if (idx === -1) {
        logFail(tag, 'Could not find openCastModal function');
      } else {
        src = src.slice(0, idx) + newFunctions + src.slice(idx);
        logOk(tag);
      }
    }
  }

  writeFile(FILE, src);
}

// ═══════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════
log(`\n🎭 CUE Actor Line Assignment — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
log(`   Project root: ${PROJECT_ROOT}`);

// Reset r to module scope
let r;

patchIndexHtml();
patchLineNotes();
patchRunshow();
patchCast();

// ── Summary ──
log('\n' + '═'.repeat(56));
log('SUMMARY');
log('═'.repeat(56));
const ok = results.filter(r => r.status === 'OK').length;
const skip = results.filter(r => r.status === 'ALREADY_PRESENT').length;
const fail = results.filter(r => r.status === 'FAIL').length;
log(`  ✅ Applied:  ${ok}`);
log(`  ⏭️  Skipped:  ${skip}`);
log(`  ❌ Failed:   ${fail}`);

if (fail > 0) {
  log('\nFailed patches:');
  results.filter(r => r.status === 'FAIL').forEach(r => log(`  • ${r.tag}: ${r.reason}`));
}

if (!APPLY && ok > 0) {
  log('\n⚠️  DRY RUN — no files were modified. Re-run with --apply to write changes.');
}

if (APPLY && ok > 0 && fail === 0) {
  log('\n✅ All patches applied successfully!\n');
  log('VERIFICATION CHECKLIST:');
  log('  Zone Editor (Edit Script tab)');
  log('  [ ] Select a dialogue zone → "Assign Actor" dropdown visible');
  log('  [ ] Select a charname/stagedir zone → dropdown hidden');
  log('  [ ] Assign actor → Apply → zone shows actor badge');
  log('  [ ] Change page, return → assignment persists');
  log('');
  log('  Run Show');
  log('  [ ] "Actors" toggle button in sidebar header');
  log('  [ ] Toggle ON → assigned zones show colored pills');
  log('  [ ] Toggle OFF → pills hidden');
  log('');
  log('  Cast Tab');
  log('  [ ] Each member card has a "Lines" button');
  log('  [ ] Click Lines → report appears with page/line counts');
  log('  [ ] Click Lines again → report toggles off');
  log('  [ ] Member with no assigned lines → "No lines assigned" message');
}

process.exit(hadError ? 1 : 0);
