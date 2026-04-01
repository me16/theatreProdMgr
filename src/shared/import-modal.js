/**
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

  modal.innerHTML = `
    <div style="background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:12px;max-width:640px;width:90vw;max-height:85vh;overflow-y:auto;padding:28px 32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="font-family:'Instrument Serif',serif;font-size:22px;color:var(--gold);margin:0;">Import ${typeName} JSON</h2>
        <button id="import-modal-close" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;padding:4px 8px;">&times;</button>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">Required JSON Format</h3>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;line-height:1.5;">
          ${schemaHtml}
        </div>
        <div style="position:relative;">
          <pre id="import-modal-example" style="background:var(--bg-deep);border:1px solid var(--bg-border);border-radius:8px;padding:14px 16px;font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);overflow-x:auto;white-space:pre;max-height:220px;overflow-y:auto;margin:0;">${escapeForPre(exampleJson)}</pre>
          <button id="import-modal-copy-example" style="position:absolute;top:6px;right:6px;background:var(--bg-card);border:1px solid var(--bg-border);border-radius:4px;color:var(--text-muted);font-size:11px;padding:3px 8px;cursor:pointer;">Copy</button>
        </div>
      </div>

      <div style="margin-bottom:24px;padding:16px;background:rgba(91,155,212,0.08);border:1px solid rgba(91,155,212,0.25);border-radius:8px;">
        <h3 style="font-size:14px;color:#5B9BD4;margin-bottom:8px;">Convert Excel / PDF with Claude.AI</h3>
        <p style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;">
          Have a spreadsheet or PDF with your ${typeName.toLowerCase()} data? Upload it to
          <a href="https://claude.ai" target="_blank" style="color:#5B9BD4;text-decoration:underline;">claude.ai</a>
          alongside the prompt below, and Claude will convert it to the exact JSON format needed. Just hit DOWNLOAD when the artifact is generated, and import the downloaded file.
        </p>
        <div style="position:relative;">
          <pre id="import-modal-prompt" style="background:var(--bg-deep);border:1px solid var(--bg-border);border-radius:8px;padding:14px 16px;font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;margin:0;">${escapeForPre(claudePrompt)}</pre>
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
  `;

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
