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
import {
  getProductionLocations, initProductionLocations, subscribeToLocations,
  saveLocation, deleteLocation, reorderLocations, DEFAULT_LOCATIONS
} from '../tracking/locations.js';

let _locationsSubbed = false;

export function initSettings() {
  // no-op — location subscription is started on first renderSettingsTab()
}

function _ensureLocationsSub() {
  if (_locationsSubbed) return;
  const pid = state.activeProduction?.id;
  if (!pid) return;
  _locationsSubbed = true;
  subscribeToLocations(pid, () => {
    // Refresh settings locations list if visible
    if (document.getElementById('settings-locations-list')) {
      loadSettingsLocations();
    }
  });
}

export async function renderSettingsTab() {
  const container = document.getElementById('settings-content');
  if (!container) return;

  _ensureLocationsSub();

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
      <h3>Venue Locations</h3>
      <div id="settings-locations-list"><div style="color:var(--text-muted);font-size:13px;">Loading…</div></div>
      ${owner ? `
        <button class="settings-btn settings-btn--primary" id="settings-add-location-btn" style="margin-top:10px;">+ Add Location</button>
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
        const rs = document.getElementById('rs-show-name');
        if (rs) rs.textContent = val;
        toast('Title updated.', 'success');
      } catch(e) { toast('Failed to save.', 'error'); }
    });

    // Regen join code
    container.querySelector('#settings-regen-code')?.addEventListener('click', async () => {
      if (!confirmDialog('Regenerate join code? The old code will stop working.')) return;
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = new Uint8Array(7);
      crypto.getRandomValues(bytes);
      const code = Array.from(bytes, b => chars[b % chars.length]).join('');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      try {
        await updateDoc(doc(db, 'productions', prod.id), { joinCode: code, joinCodeExpiresAt: expiresAt });
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

  // Load venue locations
  await loadSettingsLocations();

  // Wire add-location button
  if (owner) {
    container.querySelector('#settings-add-location-btn')?.addEventListener('click', () => {
      showAddLocationForm(prod.id);
    });
  }
}

async function loadSettingsLocations() {
  const container = document.getElementById('settings-locations-list');
  if (!container) return;
  const owner = isOwner();
  const pid = state.activeProduction.id;

  // Ensure default locations exist
  try {
    await initProductionLocations(pid);
  } catch (e) {
    console.warn('initProductionLocations error:', e);
  }

  const locations = getProductionLocations();

  if (locations.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted)">No locations configured.</div>';
    return;
  }

  container.innerHTML = locations.map((loc, idx) => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bg-border);" data-loc-id="${escapeHtml(loc.id)}">
      <span style="color:var(--gold);font-family:'DM Mono',monospace;font-size:12px;min-width:36px;">${escapeHtml(loc.shortName)}</span>
      <span style="color:var(--text-primary);font-size:14px;flex:1;">${escapeHtml(loc.name)}</span>
      <span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;">${escapeHtml(loc.side || '')}</span>
      ${owner ? `
        <button class="settings-btn loc-move-up-btn" data-loc-id="${escapeHtml(loc.id)}" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''} title="Move up">↑</button>
        <button class="settings-btn loc-move-down-btn" data-loc-id="${escapeHtml(loc.id)}" ${idx === locations.length - 1 ? 'disabled style="opacity:0.3"' : ''} title="Move down">↓</button>
        ${!loc.isDefault ? `<button class="settings-btn settings-btn--danger loc-delete-btn" data-loc-id="${escapeHtml(loc.id)}" data-loc-name="${escapeHtml(loc.name)}">Delete</button>` : ''}
      ` : ''}
    </div>`).join('');

  // Wire reorder buttons
  if (owner) {
    container.querySelectorAll('.loc-move-up-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const locId = btn.dataset.locId;
        const locs = getProductionLocations();
        const curIdx = locs.findIndex(l => l.id === locId);
        if (curIdx <= 0) return;
        const ids = locs.map(l => l.id);
        [ids[curIdx - 1], ids[curIdx]] = [ids[curIdx], ids[curIdx - 1]];
        try {
          await reorderLocations(pid, ids);
          toast('Location moved.', 'success');
          setTimeout(() => loadSettingsLocations(), 300);
        } catch (e) { toast('Failed to reorder.', 'error'); }
      });
    });

    container.querySelectorAll('.loc-move-down-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const locId = btn.dataset.locId;
        const locs = getProductionLocations();
        const curIdx = locs.findIndex(l => l.id === locId);
        if (curIdx < 0 || curIdx >= locs.length - 1) return;
        const ids = locs.map(l => l.id);
        [ids[curIdx], ids[curIdx + 1]] = [ids[curIdx + 1], ids[curIdx]];
        try {
          await reorderLocations(pid, ids);
          toast('Location moved.', 'success');
          setTimeout(() => loadSettingsLocations(), 300);
        } catch (e) { toast('Failed to reorder.', 'error'); }
      });
    });

    container.querySelectorAll('.loc-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirmDialog(`Delete location "${btn.dataset.locName}"? Items using this location will need reassignment.`)) return;
        try {
          await deleteLocation(pid, btn.dataset.locId);
          toast('Location deleted.', 'success');
          setTimeout(() => loadSettingsLocations(), 300);
        } catch (e) { toast('Failed to delete.', 'error'); }
      });
    });
  }
}

function showAddLocationForm(productionId) {
  const container = document.getElementById('settings-locations-list');
  if (!container) return;

  // Check if form already exists
  if (document.getElementById('settings-add-loc-form')) return;

  const form = document.createElement('div');
  form.id = 'settings-add-loc-form';
  form.style.cssText = 'padding:12px;background:var(--bg-raised);border:1px solid var(--bg-border);border-radius:8px;margin-top:10px;';
  form.innerHTML = `
    <div style="font-size:13px;color:var(--gold);margin-bottom:8px;font-weight:600;">New Location</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input type="text" id="new-loc-name" class="form-input" placeholder="Name (e.g. Balcony)" maxlength="50" style="flex:1;min-width:120px;" />
      <input type="text" id="new-loc-short" class="form-input" placeholder="Short (e.g. BAL)" maxlength="8" style="width:80px;" />
      <select id="new-loc-side" class="form-select" style="width:100px;">
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
        <option value="other">Other</option>
      </select>
      <button class="settings-btn settings-btn--primary" id="new-loc-save">Add</button>
      <button class="settings-btn" id="new-loc-cancel">Cancel</button>
    </div>
  `;

  container.parentElement.insertBefore(form, container.parentElement.querySelector('#settings-add-location-btn')?.nextSibling || null);

  form.querySelector('#new-loc-cancel').addEventListener('click', () => form.remove());
  form.querySelector('#new-loc-save').addEventListener('click', async () => {
    const name = form.querySelector('#new-loc-name').value.trim();
    const shortName = form.querySelector('#new-loc-short').value.trim().toUpperCase();
    const side = form.querySelector('#new-loc-side').value;

    if (!name) { toast('Location name is required.', 'error'); return; }
    if (!shortName) { toast('Short name is required.', 'error'); return; }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const locs = getProductionLocations();
    const sortOrder = locs.length > 0 ? Math.max(...locs.map(l => l.sortOrder || 0)) + 1 : 1;

    try {
      await saveLocation(productionId, { id, name, shortName, side, sortOrder, isDefault: false });
      toast('Location added!', 'success');
      form.remove();
      setTimeout(() => loadSettingsLocations(), 300);
    } catch (e) {
      toast('Failed to add location.', 'error');
    }
  });
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
    const ownerCount = members.filter(m => m.role === 'owner').length;
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
        if (ownerCount <= 1) { toast('Cannot demote the only owner.', 'error'); return; }
        if (!confirmDialog(`Demote ${btn.dataset.name} to member?`)) return;
        try {
          await updateDoc(doc(db, 'productions', pid, 'members', btn.dataset.id), { role: 'member' });
          toast('Member demoted.', 'success'); loadSettingsMembers();
        } catch(e) { toast('Failed.', 'error'); }
      })
    );
    container.querySelectorAll('[data-action="remove"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const target = members.find(m => m.id === btn.dataset.id);
        if (target?.role === 'owner' && ownerCount <= 1) { toast('Cannot remove the only owner.', 'error'); return; }
        if (!confirmDialog(`Remove ${btn.dataset.name} from this production?`)) return;
        try {
          await deleteDoc(doc(db, 'productions', pid, 'members', btn.dataset.id));
          toast('Member removed.', 'success'); loadSettingsMembers();
        } catch(e) { toast('Failed.', 'error'); }
      })
    );
  } catch(e) { container.innerHTML = '<div style="color:var(--text-muted)">Failed to load members.</div>'; }
}