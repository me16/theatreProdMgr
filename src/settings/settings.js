import { db, storage } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import {
  collection, doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

export function initSettings() {
  // no-op
}

export async function renderSettingsTab() {
  const container = document.getElementById('settings-content');
  if (!container) return;

  const owner = isOwner();
  const prod = state.activeProduction;

  container.innerHTML = `
    <div class="settings-section">
      <h3>Production Title</h3>
      ${owner
        ? `<div class="settings-field">
            <input type="text" id="settings-title-input" class="form-input" value="${escapeHtml(prod.title)}" maxlength="200" />
            <button class="settings-btn settings-btn--primary" id="settings-title-save">Save</button>
          </div>`
        : `<div style="color:var(--text-primary);font-size:15px;">${escapeHtml(prod.title)}</div>`
      }
    </div>

    <div class="settings-section">
      <h3>Join Code</h3>
      <div class="settings-field">
        <div class="join-code-box${prod.joinCodeActive !== false ? '' : ' join-code-box--inactive'}" id="settings-join-code">
          ${escapeHtml(prod.joinCode || '—')}
        </div>
        ${owner ? `
          <button class="settings-btn" id="settings-regen-code">Regenerate</button>
          <button class="settings-btn" id="settings-toggle-code">${prod.joinCodeActive !== false ? 'Deactivate' : 'Activate'}</button>
        ` : ''}
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:6px;">
        ${prod.joinCodeActive !== false ? 'Active — share with cast &amp; crew.' : 'Inactive — join requests will be rejected.'}
      </div>
    </div>

    <div class="settings-section">
      <h3>Script PDF</h3>
      ${prod.scriptPath
        ? `<div style="color:var(--text-secondary);font-size:13px;margin-bottom:10px;">Script uploaded ✓</div>`
        : `<div style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">No script uploaded.</div>`
      }
      ${owner ? `
        <button class="settings-btn settings-btn--primary" id="settings-upload-script-btn">${prod.scriptPath ? 'Replace Script' : 'Upload Script'}</button>
        <input type="file" id="settings-script-file" accept="application/pdf" style="display:none;" />
        <div class="upload-progress" id="settings-upload-progress" style="display:none;margin-top:8px;">
          <div class="upload-progress-bar" id="settings-upload-bar"></div>
        </div>
      ` : ''}
    </div>

    <div class="settings-section">
      <h3>Members</h3>
      <div id="settings-members-list"><div style="color:var(--text-muted);font-size:13px;">Loading…</div></div>
    </div>
  `;

  if (owner) {
    // Title save
    container.querySelector('#settings-title-save')?.addEventListener('click', async () => {
      const val = sanitizeName(container.querySelector('#settings-title-input').value);
      if (!val) { toast('Title required.', 'error'); return; }
      try {
        await updateDoc(doc(db, 'productions', prod.id), { title: val });
        state.activeProduction.title = val;
        document.getElementById('app-prod-title').textContent = val;
        const ln = document.getElementById('ln-show-name');
        if (ln) ln.textContent = val;
        toast('Title updated.', 'success');
      } catch(e) { toast('Failed to save.', 'error'); }
    });

    // Regen join code
    container.querySelector('#settings-regen-code')?.addEventListener('click', async () => {
      if (!confirmDialog('Regenerate join code? The old code will stop working.')) return;
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
      try {
        await updateDoc(doc(db, 'productions', prod.id), { joinCode: code });
        state.activeProduction.joinCode = code;
        container.querySelector('#settings-join-code').textContent = code;
        toast('Join code regenerated.', 'success');
      } catch(e) { toast('Failed.', 'error'); }
    });

    // Toggle join code active
    container.querySelector('#settings-toggle-code')?.addEventListener('click', async () => {
      const current = prod.joinCodeActive !== false;
      try {
        await updateDoc(doc(db, 'productions', prod.id), { joinCodeActive: !current });
        state.activeProduction.joinCodeActive = !current;
        renderSettingsTab();
      } catch(e) { toast('Failed.', 'error'); }
    });

    // Script upload
    const uploadBtn = container.querySelector('#settings-upload-script-btn');
    const fileInput = container.querySelector('#settings-script-file');
    uploadBtn?.addEventListener('click', () => fileInput.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file || file.type !== 'application/pdf') { toast('Select a PDF.', 'error'); return; }
      const progressDiv = container.querySelector('#settings-upload-progress');
      const bar = container.querySelector('#settings-upload-bar');
      progressDiv.style.display = 'block';
      uploadBtn.disabled = true;
      const storageRef = ref(storage, `productions/${prod.id}/script.pdf`);
      const task = uploadBytesResumable(storageRef, file);
      task.on('state_changed',
        snap => { bar.style.width = `${(snap.bytesTransferred / snap.totalBytes) * 100}%`; },
        err => { toast('Upload failed.', 'error'); uploadBtn.disabled = false; },
        async () => {
          await updateDoc(doc(db, 'productions', prod.id), { scriptPath: `productions/${prod.id}/script.pdf` });
          state.activeProduction.scriptPath = `productions/${prod.id}/script.pdf`;
          toast('Script uploaded!', 'success');
          renderSettingsTab();
        }
      );
    });
  }

  // Load members
  await loadSettingsMembers();
}

async function loadSettingsMembers() {
  const container = document.getElementById('settings-members-list');
  if (!container) return;
  const owner = isOwner();
  const pid = state.activeProduction.id;
  try {
    const snap = await getDocs(collection(db, 'productions', pid, 'members'));
    const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (members.length === 0) { container.innerHTML = '<div style="color:var(--text-muted)">No members.</div>'; return; }
    container.innerHTML = members.map(m => `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--bg-border);">
        <div style="flex:1">
          <div style="color:var(--text-primary);font-size:14px;">${escapeHtml(m.displayName || m.email)}</div>
          <div style="color:var(--text-muted);font-size:12px;font-family:'DM Mono',monospace;">${escapeHtml(m.email)}</div>
        </div>
        <span class="role-badge role-badge--${escapeHtml(m.role)}">${escapeHtml(m.role)}</span>
        ${owner && m.id !== state.currentUser.uid ? `
          <button class="settings-btn" data-action="${m.role === 'owner' ? 'demote' : 'promote'}" data-id="${m.id}" data-name="${escapeHtml(m.displayName || m.email)}">${m.role === 'owner' ? 'Demote' : 'Promote'}</button>
          <button class="settings-btn settings-btn--danger" data-action="remove" data-id="${m.id}" data-name="${escapeHtml(m.displayName || m.email)}">Remove</button>
        ` : ''}
      </div>`).join('');

    container.querySelectorAll('[data-action="promote"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDialog(`Promote ${btn.dataset.name} to owner?`)) return;
        try {
          await updateDoc(doc(db, 'productions', pid, 'members', btn.dataset.id), { role: 'owner' });
          toast('Member promoted.', 'success'); loadSettingsMembers();
        } catch(e) { toast('Failed.', 'error'); }
      })
    );
    container.querySelectorAll('[data-action="demote"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDialog(`Demote ${btn.dataset.name} to member?`)) return;
        try {
          await updateDoc(doc(db, 'productions', pid, 'members', btn.dataset.id), { role: 'member' });
          toast('Member demoted.', 'success'); loadSettingsMembers();
        } catch(e) { toast('Failed.', 'error'); }
      })
    );
    container.querySelectorAll('[data-action="remove"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDialog(`Remove ${btn.dataset.name} from this production?`)) return;
        try {
          await deleteDoc(doc(db, 'productions', pid, 'members', btn.dataset.id));
          toast('Member removed.', 'success'); loadSettingsMembers();
        } catch(e) { toast('Failed.', 'error'); }
      })
    );
  } catch(e) { container.innerHTML = '<div style="color:var(--text-muted)">Failed to load members.</div>'; }
}