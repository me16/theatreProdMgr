#!/usr/bin/env node
/**
 * cue-import-export-patch.mjs
 *
 * Adds Import JSON / Export CSV to Actors, Scenic, and Costumes tracking.
 * Replaces the raw file-picker import on all four types (Props, Actors,
 * Scenic, Costumes) with an instructional modal that:
 *   1. Shows the required JSON schema with a concrete example
 *   2. Provides a copy-pasteable Claude.AI prompt for converting Excel → JSON
 *   3. Has a "Choose File" button to upload the prepared JSON
 *
 * Usage:
 *   node cue-import-export-patch.mjs                  # dry-run (default)
 *   node cue-import-export-patch.mjs --apply           # write changes
 *   node cue-import-export-patch.mjs --project-root /path/to/project --apply
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootIdx = args.indexOf('--project-root');
const PROJECT_ROOT = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd();

const results = [];
let hadError = false;

function read(relPath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf8');
}
function write(relPath, content) {
  if (APPLY) fs.writeFileSync(path.join(PROJECT_ROOT, relPath), content, 'utf8');
}
function exists(relPath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relPath));
}

function applyPatch(file, label, oldStr, newStr) {
  let content = read(file);
  if (content.includes(newStr.slice(0, 80))) {
    results.push({ file, label, status: 'ALREADY_PRESENT' });
    return content;
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    results.push({ file, label, status: 'ANCHOR_NOT_FOUND' });
    hadError = true;
    return content;
  }
  // Ensure unique
  if (content.indexOf(oldStr, idx + 1) !== -1) {
    results.push({ file, label, status: 'ANCHOR_NOT_UNIQUE' });
    hadError = true;
    return content;
  }
  content = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
  write(file, content);
  results.push({ file, label, status: 'APPLIED' });
  return content;
}

function insertAfter(file, label, anchor, insertion) {
  let content = read(file);
  if (content.includes(insertion.slice(0, 80))) {
    results.push({ file, label, status: 'ALREADY_PRESENT' });
    return content;
  }
  const idx = content.indexOf(anchor);
  if (idx === -1) {
    results.push({ file, label, status: 'ANCHOR_NOT_FOUND' });
    hadError = true;
    return content;
  }
  content = content.slice(0, idx + anchor.length) + insertion + content.slice(idx + anchor.length);
  write(file, content);
  results.push({ file, label, status: 'APPLIED' });
  return content;
}

function insertBefore(file, label, anchor, insertion) {
  let content = read(file);
  if (content.includes(insertion.slice(0, 80))) {
    results.push({ file, label, status: 'ALREADY_PRESENT' });
    return content;
  }
  const idx = content.indexOf(anchor);
  if (idx === -1) {
    results.push({ file, label, status: 'ANCHOR_NOT_FOUND' });
    hadError = true;
    return content;
  }
  content = content.slice(0, idx) + insertion + content.slice(idx);
  write(file, content);
  results.push({ file, label, status: 'APPLIED' });
  return content;
}

// ─────────────────────────────────────────────────────────────
// STEP 1: Create shared import-modal.js utility
// ─────────────────────────────────────────────────────────────

const IMPORT_MODAL_PATH = 'src/shared/import-modal.js';

const IMPORT_MODAL_CONTENT = `/**
 * import-modal.js — Shared Import JSON Modal
 *
 * Shows an instructional modal with:
 *   1. The required JSON format (schema + example)
 *   2. A Claude.AI prompt for converting Excel/PDF paperwork to JSON
 *   3. A file upload button
 */
import { toast } from './toast.js';

const MODAL_ID = 'import-json-modal';

/**
 * Show the import JSON modal.
 *
 * @param {Object} opts
 * @param {string} opts.type         — 'props' | 'actors' | 'scenic' | 'costumes'
 * @param {string} opts.schemaHtml   — HTML string showing the JSON schema
 * @param {string} opts.exampleJson  — Pretty-printed JSON example
 * @param {string} opts.claudePrompt — The prompt text users should paste into Claude.AI
 * @param {Function} opts.onFile     — async (parsedData) => void — called with the parsed JSON array
 */
export function showImportModal({ type, schemaHtml, exampleJson, claudePrompt, onFile }) {
  // Remove any existing modal
  document.getElementById(MODAL_ID)?.remove();

  const typeName = type.charAt(0).toUpperCase() + type.slice(1);

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);';

  modal.innerHTML = \`
    <div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:12px;max-width:640px;width:90vw;max-height:85vh;overflow-y:auto;padding:28px 32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="font-family:'Instrument Serif',serif;font-size:22px;color:var(--gold);margin:0;">Import \${typeName} JSON</h2>
        <button id="import-modal-close" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;padding:4px 8px;">&times;</button>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">Required JSON Format</h3>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;line-height:1.5;">
          \${schemaHtml}
        </div>
        <div style="position:relative;">
          <pre id="import-modal-example" style="background:var(--bg-deep);border:1px solid var(--bg-border);border-radius:8px;padding:14px 16px;font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);overflow-x:auto;white-space:pre;max-height:220px;overflow-y:auto;margin:0;">\${escapeForPre(exampleJson)}</pre>
          <button id="import-modal-copy-example" style="position:absolute;top:6px;right:6px;background:var(--bg-card);border:1px solid var(--bg-border);border-radius:4px;color:var(--text-muted);font-size:11px;padding:3px 8px;cursor:pointer;">Copy</button>
        </div>
      </div>

      <div style="margin-bottom:24px;padding:16px;background:rgba(91,155,212,0.08);border:1px solid rgba(91,155,212,0.25);border-radius:8px;">
        <h3 style="font-size:14px;color:#5B9BD4;margin-bottom:8px;">Convert Excel / PDF with Claude.AI</h3>
        <p style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;">
          Have a spreadsheet or PDF with your \${typeName.toLowerCase()} data? Upload it to
          <a href="https://claude.ai" target="_blank" style="color:#5B9BD4;text-decoration:underline;">claude.ai</a>
          alongside the prompt below, and Claude will convert it to the exact JSON format needed.
        </p>
        <div style="position:relative;">
          <pre id="import-modal-prompt" style="background:var(--bg-deep);border:1px solid var(--bg-border);border-radius:8px;padding:14px 16px;font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;margin:0;">\${escapeForPre(claudePrompt)}</pre>
          <button id="import-modal-copy-prompt" style="position:absolute;top:6px;right:6px;background:var(--bg-card);border:1px solid var(--bg-border);border-radius:4px;color:var(--text-muted);font-size:11px;padding:3px 8px;cursor:pointer;">Copy</button>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;padding-top:4px;border-top:1px solid var(--bg-border);">
        <button id="import-modal-choose-file" class="modal-btn-primary" style="white-space:nowrap;">Choose JSON File…</button>
        <span id="import-modal-filename" style="font-size:12px;color:var(--text-muted);flex:1;">No file selected</span>
        <button id="import-modal-cancel" class="modal-btn-cancel">Cancel</button>
      </div>
      <input type="file" id="import-modal-file-input" accept=".json" style="display:none;" />
    </div>
  \`;

  document.body.appendChild(modal);

  // ── Wire events ──
  const close = () => modal.remove();

  modal.querySelector('#import-modal-close').addEventListener('click', close);
  modal.querySelector('#import-modal-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Copy buttons
  modal.querySelector('#import-modal-copy-example').addEventListener('click', () => {
    navigator.clipboard.writeText(exampleJson).then(() => toast('Example copied!', 'success')).catch(() => toast('Copy failed.', 'error'));
  });
  modal.querySelector('#import-modal-copy-prompt').addEventListener('click', () => {
    navigator.clipboard.writeText(claudePrompt).then(() => toast('Prompt copied!', 'success')).catch(() => toast('Copy failed.', 'error'));
  });

  // File picker
  const fileInput = modal.querySelector('#import-modal-file-input');
  modal.querySelector('#import-modal-choose-file').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    modal.querySelector('#import-modal-filename').textContent = file.name;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) { toast('JSON must be an array.', 'error'); return; }
      close();
      await onFile(data);
    } catch (e) {
      toast('Invalid JSON: ' + e.message, 'error');
    }
  });
}

function escapeForPre(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
`;

if (exists(IMPORT_MODAL_PATH)) {
  results.push({ file: IMPORT_MODAL_PATH, label: 'Create shared import-modal.js', status: 'ALREADY_PRESENT' });
} else {
  if (APPLY) {
    const dir = path.dirname(path.join(PROJECT_ROOT, IMPORT_MODAL_PATH));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(PROJECT_ROOT, IMPORT_MODAL_PATH), IMPORT_MODAL_CONTENT, 'utf8');
  }
  results.push({ file: IMPORT_MODAL_PATH, label: 'Create shared import-modal.js', status: 'APPLIED' });
}


// ─────────────────────────────────────────────────────────────
// STEP 2: Patch Props — replace raw file-picker import with modal
// ─────────────────────────────────────────────────────────────

const PROPS_FILE = 'src/props/props.js';

// 2a. Add import for showImportModal
insertAfter(PROPS_FILE, 'Props: add showImportModal import',
  `import { escapeHtml, sanitizeName, confirmDialog, downloadCSV } from '../shared/ui.js';`,
  `\nimport { showImportModal } from '../shared/import-modal.js';`
);

// 2b. Replace importPropsJSON function body to use the modal
//     We anchor on the function declaration + the first line of the body
applyPatch(PROPS_FILE, 'Props: replace importPropsJSON with modal version',
  `function importPropsJSON() {
  if (!isOwner()) return;
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) { toast('JSON must be an array of props.', 'error'); return; }
      for (let i = 0; i < data.length; i++) {
        const p = data[i];
        if (!p.name || typeof p.name !== 'string') { toast('Item ' + (i+1) + ': name is required.', 'error'); return; }
        if (!['SL', 'SR'].includes(p.start)) { toast('Item ' + (i+1) + ': start must be SL or SR.', 'error'); return; }
        if (p.cues && !Array.isArray(p.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        for (let j = 0; j < p.cues.length; j++) {
          if (!Number.isInteger(p.cues[j].enterPage) || p.cues[j].enterPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': enterPage must be a positive integer.', 'error'); return; }
          if (!Number.isInteger(p.cues[j].exitPage) || p.cues[j].exitPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': exitPage must be a positive integer.', 'error'); return; }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' props. Import will ADD to existing props — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const p of data) {
        const cues = (p.cues || []).map(c => ({ enterPage: c.enterPage, exitPage: c.exitPage, enterLocation: c.enterLocation || '', exitLocation: c.exitLocation || 'SL', carrierOn: c.carrierOn || '', carrierOnCastId: '', carrierOff: c.carrierOff || '', carrierOffCastId: '', mover: c.mover || '', moverCastId: '' }));
        await addDoc(collection(db, 'productions', pid, 'props'), { name: sanitizeName(p.name), start: p.start, cues, enters: cues.map(c => c.enterPage), exits: cues.map(c => c.exitPage), endLocation: cues.length > 0 ? cues[cues.length - 1].exitLocation : p.start, createdAt: serverTimestamp() });
      }
      toast('Imported ' + data.length + ' props.', 'success');
    } catch(e) { toast('Invalid JSON: ' + e.message, 'error'); }
  });
  input.click();
}`,
  `function importPropsJSON() {
  if (!isOwner()) return;
  showImportModal({
    type: 'props',
    schemaHtml: 'Your JSON must be an <strong>array of objects</strong>. Each object needs a <code>name</code> (string) and <code>start</code> (<code>"SL"</code> or <code>"SR"</code>). Optionally include a <code>cues</code> array with enter/exit page numbers, locations, and carrier/mover names.',
    exampleJson: JSON.stringify([
      {
        name: "Yorick's Skull",
        start: "SL",
        cues: [
          { enterPage: 12, exitPage: 18, enterLocation: "backstage-left", exitLocation: "backstage-right", carrierOn: "Hamlet", carrierOff: "Gravedigger", mover: "" }
        ]
      },
      {
        name: "Letter",
        start: "SR",
        cues: [
          { enterPage: 5, exitPage: 9, enterLocation: "backstage-right", exitLocation: "on-stage" },
          { enterPage: 22, exitPage: 30, enterLocation: "on-stage", exitLocation: "backstage-left" }
        ]
      }
    ], null, 2),
    claudePrompt: \`I have a props tracking spreadsheet/document for a theater production. Please convert it to a JSON array with this exact format:

[
  {
    "name": "Prop Name",
    "start": "SL",
    "cues": [
      {
        "enterPage": 5,
        "exitPage": 10,
        "enterLocation": "backstage-left",
        "exitLocation": "backstage-right",
        "carrierOn": "Actor Name",
        "carrierOff": "Actor Name",
        "mover": "Crew Name"
      }
    ]
  }
]

Rules:
- "start" must be "SL" (stage left) or "SR" (stage right)
- Location values: "backstage-left", "backstage-right", "on-stage"
- "enterPage" and "exitPage" must be positive integers
- "carrierOn", "carrierOff", "mover" are optional strings
- Output ONLY the raw JSON array, no markdown or explanation\`,
    onFile: async (data) => {
      for (let i = 0; i < data.length; i++) {
        const p = data[i];
        if (!p.name || typeof p.name !== 'string') { toast('Item ' + (i+1) + ': name is required.', 'error'); return; }
        if (!['SL', 'SR'].includes(p.start)) { toast('Item ' + (i+1) + ': start must be SL or SR.', 'error'); return; }
        if (p.cues && !Array.isArray(p.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        if (p.cues) {
          for (let j = 0; j < p.cues.length; j++) {
            if (!Number.isInteger(p.cues[j].enterPage) || p.cues[j].enterPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': enterPage must be a positive integer.', 'error'); return; }
            if (!Number.isInteger(p.cues[j].exitPage) || p.cues[j].exitPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': exitPage must be a positive integer.', 'error'); return; }
          }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' props. Import will ADD to existing props — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const p of data) {
        const cues = (p.cues || []).map(c => ({ enterPage: c.enterPage, exitPage: c.exitPage, enterLocation: c.enterLocation || '', exitLocation: c.exitLocation || 'SL', carrierOn: c.carrierOn || '', carrierOnCastId: '', carrierOff: c.carrierOff || '', carrierOffCastId: '', mover: c.mover || '', moverCastId: '' }));
        await addDoc(collection(db, 'productions', pid, 'props'), { name: sanitizeName(p.name), start: p.start, cues, enters: cues.map(c => c.enterPage), exits: cues.map(c => c.exitPage), endLocation: cues.length > 0 ? cues[cues.length - 1].exitLocation : p.start, createdAt: serverTimestamp() });
      }
      toast('Imported ' + data.length + ' props.', 'success');
    }
  });
}`
);


// ─────────────────────────────────────────────────────────────
// STEP 3: Patch Actors — add import/export with modal
// ─────────────────────────────────────────────────────────────

const ACTORS_FILE = 'src/tracking/actors.js';

// 3a. Add imports for downloadCSV and showImportModal
insertAfter(ACTORS_FILE, 'Actors: add downloadCSV import',
  `import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';`,
  `\nimport { downloadCSV } from '../shared/ui.js';\nimport { showImportModal } from '../shared/import-modal.js';`
);

// 3b. Add toolbar buttons to _renderManage
//     Anchor on the heading inside _renderManage
applyPatch(ACTORS_FILE, 'Actors: add import/export toolbar',
  `'<h3 style="font-size:16px;color:var(--track-actor);margin-bottom:16px;">Manage Actors</h3>' +`,
  `'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="font-size:16px;color:var(--track-actor);margin:0;">Manage Actors</h3><div style="display:flex;gap:8px;"><button class="settings-btn" id="actors-import-btn">Import JSON</button><button class="settings-btn" id="actors-export-btn">Export CSV</button></div></div>' +`
);

// 3c. Add event wiring for import/export buttons — insert after the actor-cancel-edit-btn wiring
insertAfter(ACTORS_FILE, 'Actors: wire import/export buttons',
  `el.querySelector('#actor-cancel-edit-btn')?.addEventListener('click', () => {
    _editingActorId = null; _actorCueRows = [];
    renderActorsContent(document.getElementById('props-content'));
  });`,
  `

  // Import / Export
  el.querySelector('#actors-export-btn')?.addEventListener('click', () => _exportActorsCSV());
  el.querySelector('#actors-import-btn')?.addEventListener('click', () => _importActorsJSON());`
);

// 3d. Add the export and import functions before _syncActorCueRows
insertBefore(ACTORS_FILE, 'Actors: add export/import functions',
  `function _syncActorCueRows(el) {`,
  `function _exportActorsCSV() {
  if (actorCues.length === 0) { toast('No actors to export.', 'warn'); return; }
  const maxCues = Math.max(1, ...actorCues.map(a => (a.cues || []).length));
  const header = ['characterName', 'actorName', 'color', 'defaultHoldLocation'];
  for (let i = 1; i <= maxCues; i++) { header.push('cue_' + i + '_holdPage', 'cue_' + i + '_enterPage', 'cue_' + i + '_exitPage', 'cue_' + i + '_enterLocation', 'cue_' + i + '_exitLocation'); }
  const rows = [header];
  actorCues.forEach(a => {
    const cues = a.cues || [];
    const row = [a.characterName || '', a.actorName || '', a.color || '', a.defaultHoldLocation || ''];
    for (let i = 0; i < maxCues; i++) { const c = cues[i]; if (c) { row.push(c.holdPage || '', c.enterPage || '', c.exitPage || '', c.enterLocation || '', c.exitLocation || ''); } else { row.push('', '', '', '', ''); } }
    rows.push(row);
  });
  const title = (state.activeProduction?.title || 'production').replace(/[^a-zA-Z0-9]/g, '_');
  downloadCSV(rows, 'actors_' + title + '_' + new Date().toISOString().split('T')[0] + '.csv');
  toast('Actors exported.', 'success');
}

function _importActorsJSON() {
  if (!isOwner()) return;
  showImportModal({
    type: 'actors',
    schemaHtml: 'Your JSON must be an <strong>array of objects</strong>. Each object needs a <code>characterName</code> (string). Optionally include <code>actorName</code>, <code>color</code> (hex), and a <code>cues</code> array with hold/enter/exit pages and locations.',
    exampleJson: JSON.stringify([
      {
        characterName: "Hamlet",
        actorName: "John Smith",
        color: "#5B9BD4",
        defaultHoldLocation: "backstage-left",
        cues: [
          { holdPage: 3, enterPage: 5, exitPage: 18, enterLocation: "backstage-left", exitLocation: "backstage-right" },
          { holdPage: 20, enterPage: 22, exitPage: 35, enterLocation: "backstage-right", exitLocation: "backstage-left" }
        ]
      },
      {
        characterName: "Ophelia",
        actorName: "Jane Doe",
        color: "#E63946",
        cues: [
          { holdPage: 10, enterPage: 12, exitPage: 20, enterLocation: "backstage-right", exitLocation: "backstage-left" }
        ]
      }
    ], null, 2),
    claudePrompt: \`I have a cast/actor tracking spreadsheet for a theater production. Please convert it to a JSON array with this exact format:

[
  {
    "characterName": "Character Name",
    "actorName": "Actor Real Name",
    "color": "#5B9BD4",
    "defaultHoldLocation": "backstage-left",
    "cues": [
      {
        "holdPage": 3,
        "enterPage": 5,
        "exitPage": 18,
        "enterLocation": "backstage-left",
        "exitLocation": "backstage-right"
      }
    ]
  }
]

Rules:
- "characterName" is required for each entry
- "holdPage" is the page where the actor goes to their hold position (optional, set to 0 if unknown)
- "enterPage" and "exitPage" must be positive integers
- Location values: "backstage-left", "backstage-right", "on-stage"
- "color" should be a hex color code (optional)
- Output ONLY the raw JSON array, no markdown or explanation\`,
    onFile: async (data) => {
      for (let i = 0; i < data.length; i++) {
        const a = data[i];
        if (!a.characterName || typeof a.characterName !== 'string') { toast('Item ' + (i+1) + ': characterName is required.', 'error'); return; }
        if (a.cues && !Array.isArray(a.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        if (a.cues) {
          for (let j = 0; j < a.cues.length; j++) {
            if (!Number.isInteger(a.cues[j].enterPage) || a.cues[j].enterPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': enterPage must be a positive integer.', 'error'); return; }
            if (!Number.isInteger(a.cues[j].exitPage) || a.cues[j].exitPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': exitPage must be a positive integer.', 'error'); return; }
          }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' actors. Import will ADD to existing actors — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const a of data) {
        const cues = (a.cues || []).map(c => ({
          holdPage: parseInt(c.holdPage) || 0, enterPage: c.enterPage, exitPage: c.exitPage,
          enterLocation: c.enterLocation || 'backstage-left', exitLocation: c.exitLocation || 'backstage-right',
          holdLocation: c.holdLocation || c.enterLocation || '', notes: '', linkedPropIds: [], linkedCostumeId: '',
        }));
        await addDoc(collection(db, 'productions', pid, 'actorCues'), {
          characterName: sanitizeName(a.characterName), castId: '', actorName: a.actorName || '', color: a.color || '#5B9BD4',
          trackingType: 'actor', cues, defaultHoldLocation: a.defaultHoldLocation || 'backstage-left', notes: '', createdAt: serverTimestamp(),
        });
      }
      toast('Imported ' + data.length + ' actors.', 'success');
    }
  });
}

`
);


// ─────────────────────────────────────────────────────────────
// STEP 4: Patch Scenic — add import/export with modal
// ─────────────────────────────────────────────────────────────

const SCENIC_FILE = 'src/tracking/scenic.js';

// 4a. Add imports
insertAfter(SCENIC_FILE, 'Scenic: add downloadCSV import',
  `import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';`,
  `\nimport { downloadCSV } from '../shared/ui.js';\nimport { showImportModal } from '../shared/import-modal.js';`
);

// 4b. Add toolbar to _renderManage — anchor on the heading
//     The scenic _renderManage starts with piece list rows, then has an innerHTML block
//     We need to find where the manage heading / add-piece form begins
//     Looking at the code: el.innerHTML starts with '<div style="padding:24px;">' then piece list and groups
//     Let me anchor on the scenic-add-btn add form area
applyPatch(SCENIC_FILE, 'Scenic: add import/export toolbar',
  `el.innerHTML = '<div style="padding:24px;">' +\n    '<h3 style="font-size:16px;color:var(--track-scenic);margin-bottom:16px;">Scenic Pieces</h3>' +`,
  `el.innerHTML = '<div style="padding:24px;">' +\n    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="font-size:16px;color:var(--track-scenic);margin:0;">Scenic Pieces</h3><div style="display:flex;gap:8px;"><button class="settings-btn" id="scenic-import-btn">Import JSON</button><button class="settings-btn" id="scenic-export-btn">Export CSV</button></div></div>' +`
);

// 4c. Wire import/export buttons — insert after the scenic-cancel-edit-btn wiring
insertAfter(SCENIC_FILE, 'Scenic: wire import/export buttons',
  `el.querySelector('#scenic-cancel-edit-btn')?.addEventListener('click', () => {
    _editingPieceId = null; _pieceCueRows = [];
    renderScenicContent(document.getElementById('props-content'));
  });`,
  `

  // Import / Export
  el.querySelector('#scenic-export-btn')?.addEventListener('click', () => _exportScenicCSV());
  el.querySelector('#scenic-import-btn')?.addEventListener('click', () => _importScenicJSON());`
);

// 4d. Add the export and import functions before _syncPieceCueRows
insertBefore(SCENIC_FILE, 'Scenic: add export/import functions',
  `function _syncPieceCueRows(el) {`,
  `function _exportScenicCSV() {
  if (scenicPieces.length === 0) { toast('No scenic pieces to export.', 'warn'); return; }
  const maxCues = Math.max(1, ...scenicPieces.map(p => (p.cues || []).length));
  const header = ['name', 'weight', 'start', 'moveMethod', 'notes'];
  for (let i = 1; i <= maxCues; i++) { header.push('cue_' + i + '_enterPage', 'cue_' + i + '_exitPage', 'cue_' + i + '_enterLocation', 'cue_' + i + '_exitLocation'); }
  const rows = [header];
  scenicPieces.forEach(p => {
    const cues = p.cues || [];
    const row = [p.name || '', p.weight || '', p.start || '', p.moveMethod || '', p.notes || ''];
    for (let i = 0; i < maxCues; i++) { const c = cues[i]; if (c) { row.push(c.enterPage || '', c.exitPage || '', c.enterLocation || '', c.exitLocation || ''); } else { row.push('', '', '', ''); } }
    rows.push(row);
  });
  const title = (state.activeProduction?.title || 'production').replace(/[^a-zA-Z0-9]/g, '_');
  downloadCSV(rows, 'scenic_' + title + '_' + new Date().toISOString().split('T')[0] + '.csv');
  toast('Scenic pieces exported.', 'success');
}

function _importScenicJSON() {
  if (!isOwner()) return;
  showImportModal({
    type: 'scenic',
    schemaHtml: 'Your JSON must be an <strong>array of objects</strong>. Each object needs a <code>name</code> (string). Optionally include <code>weight</code> (number, lbs), <code>moveMethod</code>, <code>notes</code>, and a <code>cues</code> array with enter/exit pages and locations.',
    exampleJson: JSON.stringify([
      {
        name: "Castle Wall Flat",
        weight: 120,
        start: "backstage-left",
        cues: [
          { enterPage: 8, exitPage: 25, enterLocation: "backstage-left", exitLocation: "backstage-right" }
        ]
      },
      {
        name: "Forest Drop",
        weight: 45,
        start: "backstage-right",
        cues: [
          { enterPage: 3, exitPage: 15, enterLocation: "backstage-right", exitLocation: "backstage-left" },
          { enterPage: 30, exitPage: 42, enterLocation: "backstage-left", exitLocation: "backstage-right" }
        ]
      }
    ], null, 2),
    claudePrompt: \`I have a scenic/set piece tracking spreadsheet for a theater production. Please convert it to a JSON array with this exact format:

[
  {
    "name": "Piece Name",
    "weight": 120,
    "start": "backstage-left",
    "moveMethod": "fly",
    "notes": "Optional notes",
    "cues": [
      {
        "enterPage": 8,
        "exitPage": 25,
        "enterLocation": "backstage-left",
        "exitLocation": "backstage-right"
      }
    ]
  }
]

Rules:
- "name" is required for each entry
- "weight" is optional (number, in lbs)
- "start" defaults to "backstage-left" — values: "backstage-left", "backstage-right", "on-stage"
- "enterPage" and "exitPage" must be positive integers
- "moveMethod" is optional (e.g. "fly", "push", "track", "manual")
- Output ONLY the raw JSON array, no markdown or explanation\`,
    onFile: async (data) => {
      for (let i = 0; i < data.length; i++) {
        const p = data[i];
        if (!p.name || typeof p.name !== 'string') { toast('Item ' + (i+1) + ': name is required.', 'error'); return; }
        if (p.cues && !Array.isArray(p.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        if (p.cues) {
          for (let j = 0; j < p.cues.length; j++) {
            if (!Number.isInteger(p.cues[j].enterPage) || p.cues[j].enterPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': enterPage must be a positive integer.', 'error'); return; }
            if (!Number.isInteger(p.cues[j].exitPage) || p.cues[j].exitPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': exitPage must be a positive integer.', 'error'); return; }
          }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' scenic pieces. Import will ADD to existing — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const p of data) {
        const cues = (p.cues || []).map(c => ({
          enterPage: c.enterPage, exitPage: c.exitPage,
          enterLocation: c.enterLocation || 'backstage-left', exitLocation: c.exitLocation || 'backstage-right',
        }));
        await addDoc(collection(db, 'productions', pid, 'scenicPieces'), {
          name: sanitizeName(p.name), weight: p.weight || null, trackingType: 'scenic',
          start: p.start || 'backstage-left', cues, moveMethod: p.moveMethod || '', notes: p.notes || '', createdAt: serverTimestamp(),
        });
      }
      toast('Imported ' + data.length + ' scenic pieces.', 'success');
    }
  });
}

`
);


// ─────────────────────────────────────────────────────────────
// STEP 5: Patch Costumes — add import/export with modal
// ─────────────────────────────────────────────────────────────

const COSTUMES_FILE = 'src/tracking/costumes.js';

// 5a. Add imports
insertAfter(COSTUMES_FILE, 'Costumes: add downloadCSV import',
  `import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';`,
  `\nimport { downloadCSV } from '../shared/ui.js';\nimport { showImportModal } from '../shared/import-modal.js';`
);

// 5b. Add toolbar to _renderManage — anchor on the heading
applyPatch(COSTUMES_FILE, 'Costumes: add import/export toolbar',
  `'<h3 style="font-size:16px;color:var(--track-costume);margin-bottom:16px;">Manage Costumes</h3>' +`,
  `'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="font-size:16px;color:var(--track-costume);margin:0;">Manage Costumes</h3><div style="display:flex;gap:8px;"><button class="settings-btn" id="costumes-import-btn">Import JSON</button><button class="settings-btn" id="costumes-export-btn">Export CSV</button></div></div>' +`
);

// 5c. Wire import/export buttons — insert after the costume-cancel-edit-btn wiring
insertAfter(COSTUMES_FILE, 'Costumes: wire import/export buttons',
  `el.querySelector('#costume-cancel-edit-btn')?.addEventListener('click', () => {
    _editingCostumeId = null; _costumeCueRows = [];
    renderCostumesContent(document.getElementById('props-content'));
  });`,
  `

  // Import / Export
  el.querySelector('#costumes-export-btn')?.addEventListener('click', () => _exportCostumesCSV());
  el.querySelector('#costumes-import-btn')?.addEventListener('click', () => _importCostumesJSON());`
);

// 5d. Add the export and import functions before _syncCostumeCueRows
insertBefore(COSTUMES_FILE, 'Costumes: add export/import functions',
  `function _syncCostumeCueRows(el) {`,
  `function _exportCostumesCSV() {
  if (costumes.length === 0) { toast('No costumes to export.', 'warn'); return; }
  const maxCues = Math.max(1, ...costumes.map(c => (c.cues || []).length));
  const header = ['name', 'characterName', 'presetLocation'];
  for (let i = 1; i <= maxCues; i++) { header.push('cue_' + i + '_startPage', 'cue_' + i + '_endPage', 'cue_' + i + '_changeLocation', 'cue_' + i + '_isQuickChange'); }
  const rows = [header];
  costumes.forEach(c => {
    const cues = c.cues || [];
    const row = [c.name || '', c.characterName || '', c.presetLocation || ''];
    for (let i = 0; i < maxCues; i++) { const q = cues[i]; if (q) { row.push(q.startPage || '', q.endPage || '', q.changeLocation || '', q.isQuickChange ? 'YES' : ''); } else { row.push('', '', '', ''); } }
    rows.push(row);
  });
  const title = (state.activeProduction?.title || 'production').replace(/[^a-zA-Z0-9]/g, '_');
  downloadCSV(rows, 'costumes_' + title + '_' + new Date().toISOString().split('T')[0] + '.csv');
  toast('Costumes exported.', 'success');
}

function _importCostumesJSON() {
  if (!isOwner()) return;
  showImportModal({
    type: 'costumes',
    schemaHtml: 'Your JSON must be an <strong>array of objects</strong>. Each object needs a <code>name</code> (string). Optionally include <code>characterName</code>, <code>presetLocation</code>, and a <code>cues</code> array with start/end pages, change location, and quick-change flag.',
    exampleJson: JSON.stringify([
      {
        name: "Ophelia's Gown",
        characterName: "Ophelia",
        presetLocation: "backstage-left",
        cues: [
          { startPage: 12, endPage: 20, changeLocation: "backstage-left", isQuickChange: false },
          { startPage: 28, endPage: 35, changeLocation: "backstage-right", isQuickChange: true }
        ]
      },
      {
        name: "Hamlet's Mourning Cloak",
        characterName: "Hamlet",
        cues: [
          { startPage: 1, endPage: 18, changeLocation: "backstage-left", isQuickChange: false }
        ]
      }
    ], null, 2),
    claudePrompt: \`I have a costume tracking spreadsheet for a theater production. Please convert it to a JSON array with this exact format:

[
  {
    "name": "Costume Name",
    "characterName": "Character Name",
    "presetLocation": "backstage-left",
    "cues": [
      {
        "startPage": 12,
        "endPage": 20,
        "changeLocation": "backstage-left",
        "isQuickChange": false
      }
    ]
  }
]

Rules:
- "name" is required for each entry
- "characterName" is optional but recommended
- "presetLocation" defaults to "backstage-left" — values: "backstage-left", "backstage-right", "on-stage"
- "startPage" and "endPage" must be positive integers
- "isQuickChange" is a boolean (true/false) — set true for fast costume changes
- Output ONLY the raw JSON array, no markdown or explanation\`,
    onFile: async (data) => {
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (!c.name || typeof c.name !== 'string') { toast('Item ' + (i+1) + ': name is required.', 'error'); return; }
        if (c.cues && !Array.isArray(c.cues)) { toast('Item ' + (i+1) + ': cues must be an array.', 'error'); return; }
        if (c.cues) {
          for (let j = 0; j < c.cues.length; j++) {
            if (!Number.isInteger(c.cues[j].startPage) || c.cues[j].startPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': startPage must be a positive integer.', 'error'); return; }
            if (!Number.isInteger(c.cues[j].endPage) || c.cues[j].endPage < 1) { toast('Item ' + (i+1) + ', Cue ' + (j+1) + ': endPage must be a positive integer.', 'error'); return; }
          }
        }
      }
      if (!confirmDialog('Found ' + data.length + ' costumes. Import will ADD to existing — duplicates not checked. Continue?')) return;
      const pid = state.activeProduction.id;
      for (const c of data) {
        const cues = (c.cues || []).map(q => ({
          startPage: q.startPage, endPage: q.endPage,
          changeLocation: q.changeLocation || 'backstage-left', isQuickChange: !!q.isQuickChange,
          quickChangeDetails: q.isQuickChange ? { dresserCastId: '', dresserName: '', estimatedSeconds: 0, notes: '' } : null,
        }));
        await addDoc(collection(db, 'productions', pid, 'costumes'), {
          name: sanitizeName(c.name), characterName: c.characterName || '', castId: '', trackingType: 'costume',
          description: '', photoUrl: '', presetLocation: c.presetLocation || 'backstage-left', cues, createdAt: serverTimestamp(),
        });
      }
      toast('Imported ' + data.length + ' costumes.', 'success');
    }
  });
}

`
);


// ─────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║   CUE Import/Export Patch — ' + (APPLY ? 'APPLY' : 'DRY-RUN') + '          ║');
console.log('╚══════════════════════════════════════════════════╝\n');

const maxLabel = Math.max(...results.map(r => r.label.length));
results.forEach(r => {
  const icon = r.status === 'APPLIED' ? '✅' : r.status === 'ALREADY_PRESENT' ? '⏭️ ' : '❌';
  console.log(`  ${icon} ${r.label.padEnd(maxLabel + 2)} ${r.status}  (${r.file})`);
});

console.log('\n' + '─'.repeat(56));
const applied = results.filter(r => r.status === 'APPLIED').length;
const skipped = results.filter(r => r.status === 'ALREADY_PRESENT').length;
const failed = results.filter(r => !['APPLIED', 'ALREADY_PRESENT'].includes(r.status)).length;
console.log(`  Applied: ${applied}   Skipped: ${skipped}   Failed: ${failed}`);

if (hadError) {
  console.log('\n⚠️  Some patches failed. Review the errors above.');
  process.exit(1);
}

if (!APPLY) {
  console.log('\n  ℹ️  Dry-run complete. Re-run with --apply to write changes.');
} else {
  console.log('\n  ✅ All patches applied successfully!');
  console.log('\n  ── Verification Checklist ──');
  console.log('  □ New file: src/shared/import-modal.js exists');
  console.log('  □ Props "Import JSON" button opens the instructional modal');
  console.log('  □ Actors manage tab shows "Import JSON" + "Export CSV" buttons');
  console.log('  □ Scenic manage tab shows "Import JSON" + "Export CSV" buttons');
  console.log('  □ Costumes manage tab shows "Import JSON" + "Export CSV" buttons');
  console.log('  □ Each modal shows JSON format, example, Claude prompt, and file picker');
  console.log('  □ Export CSV produces correct columns for each tracking type');
  console.log('  □ Import validates JSON structure and writes to Firestore');
  console.log('  □ "Copy" buttons work for both the example and the Claude prompt');
}

console.log('');
