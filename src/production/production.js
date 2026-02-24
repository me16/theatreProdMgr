import { db, storage, auth } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import {
  doc, updateDoc, getDocs, deleteDoc, setDoc, collection, serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable } from 'firebase/storage';

const panel = document.getElementById('production-panel');
const backdrop = document.getElementById('production-backdrop');

export function initProductionPanel() {
  backdrop.addEventListener('click', closePanel);
}

export function openPanel() {
  if (!state.activeProduction) return;
  renderPanel();
  panel.classList.add('open');
  backdrop.classList.add('open');
}

export function closePanel() {
  panel.classList.remove('open');
  backdrop.classList.remove('open');
}

function renderPanel() {
  const prod = state.activeProduction;
  const owner = isOwner();

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Production Settings</h2>
      <button class="panel-close" id="panel-close-btn">✕</button>
    </div>

    <div class="panel-section">
      <h4>Title</h4>
      ${owner
        ? `<input type="text" id="panel-title" value="${escapeHtml(prod.title)}" maxlength="200" />
           <button class="panel-btn" id="panel-save-title" style="margin-top:8px;">Save Title</button>`
        : `<p style="color:#ccc;">${escapeHtml(prod.title)}</p>`
      }
    </div>

    <div class="panel-section">
      <h4>Join Code</h4>
      <div class="join-code-display ${prod.joinCodeActive ? '' : 'join-code-inactive'}" id="panel-join-code">${escapeHtml(prod.joinCode)}</div>
      ${owner ? `
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="panel-btn" id="panel-regen-code">Regenerate</button>
          <button class="panel-btn" id="panel-toggle-code">${prod.joinCodeActive ? 'Deactivate' : 'Activate'}</button>
        </div>
      ` : ''}
    </div>

    <div class="panel-section">
      <h4>Script</h4>
      <p style="font-size:13px;color:#888;margin-bottom:8px;">
        ${prod.scriptPath ? '✓ Script uploaded' : 'No script uploaded'}
        ${prod.scriptPageCount ? ` (${prod.scriptPageCount} pages)` : ''}
      </p>
      ${owner ? `
        <input type="file" id="panel-script-file" accept="application/pdf" style="display:none;" />
        <button class="panel-btn" id="panel-upload-script">${prod.scriptPath ? 'Replace Script' : 'Upload Script'}</button>
        <div class="upload-progress" id="panel-upload-progress" style="margin-top:8px;">
          <div class="upload-progress-bar" id="panel-upload-bar"></div>
        </div>
      ` : ''}
    </div>

    <div class="panel-section">
      <h4>Members</h4>
      <ul class="member-list" id="panel-member-list">
        <li style="color:#555;font-size:13px;">Loading…</li>
      </ul>
    </div>
  `;

  // Wire up events
  panel.querySelector('#panel-close-btn').addEventListener('click', closePanel);

  if (owner) {
    panel.querySelector('#panel-save-title')?.addEventListener('click', saveTitle);
    panel.querySelector('#panel-regen-code')?.addEventListener('click', regenCode);
    panel.querySelector('#panel-toggle-code')?.addEventListener('click', toggleCode);
    panel.querySelector('#panel-upload-script')?.addEventListener('click', () => {
      panel.querySelector('#panel-script-file').click();
    });
    panel.querySelector('#panel-script-file')?.addEventListener('change', uploadScript);
  }

  loadMembers();
}

async function saveTitle() {
  if (!isOwner()) return;
  const input = panel.querySelector('#panel-title');
  const title = sanitizeName(input.value);
  if (!title) { toast('Title cannot be empty.', 'error'); return; }
  try {
    await updateDoc(doc(db, 'productions', state.activeProduction.id), { title });
    state.activeProduction.title = title;
    document.getElementById('app-prod-title').textContent = title;
    document.getElementById('ln-show-name').textContent = title;
    toast('Title updated.', 'success');
  } catch (e) {
    toast('Failed to update title.', 'error');
  }
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function regenCode() {
  if (!isOwner()) return;
  const newCode = generateJoinCode();
  try {
    await updateDoc(doc(db, 'productions', state.activeProduction.id), { joinCode: newCode, joinCodeActive: true });
    state.activeProduction.joinCode = newCode;
    state.activeProduction.joinCodeActive = true;
    renderPanel();
    toast('Join code regenerated.', 'success');
  } catch (e) {
    toast('Failed to regenerate code.', 'error');
  }
}

async function toggleCode() {
  if (!isOwner()) return;
  const newActive = !state.activeProduction.joinCodeActive;
  try {
    await updateDoc(doc(db, 'productions', state.activeProduction.id), { joinCodeActive: newActive });
    state.activeProduction.joinCodeActive = newActive;
    renderPanel();
    toast(newActive ? 'Join code activated.' : 'Join code deactivated.', 'info');
  } catch (e) {
    toast('Failed to toggle code.', 'error');
  }
}

async function uploadScript() {
  if (!isOwner()) return;
  const fileInput = panel.querySelector('#panel-script-file');
  const file = fileInput.files[0];
  if (!file || file.type !== 'application/pdf') {
    toast('Please select a PDF file.', 'error');
    return;
  }

  const progressDiv = panel.querySelector('#panel-upload-progress');
  const bar = panel.querySelector('#panel-upload-bar');
  progressDiv.style.display = 'block';

  const pid = state.activeProduction.id;
  const storageRef = ref(storage, `productions/${pid}/script.pdf`);
  const task = uploadBytesResumable(storageRef, file);

  task.on('state_changed',
    snap => { bar.style.width = `${(snap.bytesTransferred / snap.totalBytes) * 100}%`; },
    err => {
      toast('Upload failed.', 'error');
      progressDiv.style.display = 'none';
      console.error(err);
    },
    async () => {
      try {
        const scriptPath = `productions/${pid}/script.pdf`;
        await updateDoc(doc(db, 'productions', pid), { scriptPath, scriptPageCount: null });
        state.activeProduction.scriptPath = scriptPath;
        state.activeProduction.scriptPageCount = null;
        toast('Script uploaded!', 'success');
        renderPanel();
      } catch (e) {
        toast('Failed to update production.', 'error');
      }
    }
  );
}

async function loadMembers() {
  const list = panel.querySelector('#panel-member-list');
  const pid = state.activeProduction.id;
  try {
    const snap = await getDocs(collection(db, 'productions', pid, 'members'));
    if (snap.empty) {
      list.innerHTML = '<li style="color:#555;font-size:13px;">No members.</li>';
      return;
    }
    list.innerHTML = '';
    const ownerCount = snap.docs.filter(d => d.data().role === 'owner').length;

    snap.docs.forEach(memberDoc => {
      const data = memberDoc.data();
      const memberId = memberDoc.id;
      const isMe = memberId === state.currentUser.uid;
      const li = document.createElement('li');
      li.className = 'member-item';

      let actionsHtml = '';
      if (isOwner() && !isMe) {
        const canDemote = data.role === 'owner' && ownerCount > 1;
        actionsHtml = `
          ${data.role === 'member'
            ? `<button class="promote-btn">Promote</button>`
            : canDemote ? `<button class="demote-btn">Demote</button>` : ''
          }
          <button class="remove-btn">Remove</button>
        `;
      }

      li.innerHTML = `
        <span class="role-badge role-badge--${data.role}" style="font-size:10px;">${escapeHtml(data.role)}</span>
        <span class="member-email">${escapeHtml(data.email || memberId)}</span>
        <span class="member-actions">${actionsHtml}</span>
      `;

      li.querySelector('.promote-btn')?.addEventListener('click', async () => {
        if (!isOwner()) return;
        try {
          await updateDoc(doc(db, 'productions', pid, 'members', memberId), { role: 'owner' });
          toast('Member promoted to owner.', 'success');
          loadMembers();
        } catch (e) { toast('Failed.', 'error'); }
      });

      li.querySelector('.demote-btn')?.addEventListener('click', async () => {
        if (!isOwner()) return;
        try {
          await updateDoc(doc(db, 'productions', pid, 'members', memberId), { role: 'member' });
          toast('Owner demoted to member.', 'success');
          loadMembers();
        } catch (e) { toast('Failed.', 'error'); }
      });

      li.querySelector('.remove-btn')?.addEventListener('click', async () => {
        if (!isOwner()) return;
        if (!confirmDialog(`Remove ${data.email || memberId} from this production?`)) return;
        try {
          await deleteDoc(doc(db, 'productions', pid, 'members', memberId));
          toast('Member removed.', 'success');
          loadMembers();
        } catch (e) { toast('Failed.', 'error'); }
      });

      list.appendChild(li);
    });
  } catch (e) {
    list.innerHTML = '<li style="color:#e63946;font-size:13px;">Error loading members.</li>';
    console.error(e);
  }
}
