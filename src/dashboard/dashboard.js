import { db, auth, storage, functions } from '../firebase.js';
import { state, cleanup } from '../shared/state.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where,
  serverTimestamp, collectionGroup
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

import { showApp, hideApp } from '../props/props.js';
import { resetLineNotes } from '../linenotes/linenotes.js';
import { resetRunShow } from '../RunShow/Runshow.js';
import { isOwner } from '../shared/roles.js';

const dashView = document.getElementById('dashboard-view');
const grid = document.getElementById('productions-grid');

export function initDashboard() {
  document.getElementById('dash-logout-btn').addEventListener('click', () => {
    auth.signOut();
  });
  document.getElementById('create-production-btn').addEventListener('click', openCreateModal);
  document.getElementById('join-production-btn').addEventListener('click', openJoinModal);
  document.getElementById('app-back-logo').addEventListener('click', backToDashboard);
}

export async function showDashboard() {
  hideApp();
  dashView.style.display = 'block';
  document.getElementById('dash-user-email').textContent = state.currentUser.email;
  await loadProductions();
}

export function hideDashboard() {
  dashView.style.display = 'none';
}

async function loadProductions() {
  grid.innerHTML = '';
  const uid = state.currentUser.uid;

  try {
    // collectionGroup query to find all member docs where email matches current user.
    // Security rule allows reading member docs where email == your auth email.
    const memberSnaps = await getDocs(
      query(collectionGroup(db, 'members'), where('email', '==', state.currentUser.email))
    );
    const myDocs = memberSnaps.docs.filter(d => d.id === uid);
    if (myDocs.length > 0) {
      await renderProductionCards({ docs: myDocs, empty: false });
      return;
    }
    if (!memberSnaps.empty) {
      await renderProductionCards(memberSnaps);
      return;
    }
    grid.innerHTML = '<div class="empty-state">No productions yet. Create one or join with a code.</div>';
  } catch (e) {
    console.error('Failed to load productions:', e);
    grid.innerHTML = '<div class="empty-state">Could not load productions. Check the browser console for details.</div>';
  }
}

async function renderProductionCards(memberSnaps) {
  if (memberSnaps.empty) {
    grid.innerHTML = '<div class="empty-state">No productions yet. Create one or join with a code.</div>';
    return;
  }
  grid.innerHTML = '';
  const uid = state.currentUser.uid;

  for (const memberDoc of memberSnaps.docs) {
    // memberDoc path: productions/{productionId}/members/{uid}
    const productionRef = memberDoc.ref.parent.parent;
    const role = memberDoc.data().role || 'member';

    try {
      const prodSnap = await getDoc(productionRef);
      if (!prodSnap.exists()) continue;
      const prod = prodSnap.data();

      // Get member count
      const membersSnap = await getDocs(collection(db, 'productions', prodSnap.id, 'members'));
      const memberCount = membersSnap.size;

      const card = document.createElement('div');
      card.className = 'production-card';
      card.innerHTML = `
        <h3>${escapeHtml(prod.title)}</h3>
        <span class="role-badge role-badge--${role}">${escapeHtml(role)}</span>
        <div class="meta">${memberCount} member${memberCount !== 1 ? 's' : ''}</div>
        <button class="open-btn">Open</button>
      `;
      card.querySelector('.open-btn').addEventListener('click', () => {
        openProduction(prodSnap.id, prod, role);
      });
      grid.appendChild(card);
    } catch (e) {
      console.warn('Failed to load production:', productionRef.id, e);
    }
  }

  if (grid.children.length === 0) {
    grid.innerHTML = '<div class="empty-state">No productions yet. Create one or join with a code.</div>';
  }
}

async function openProduction(id, prod, role) {
  cleanup();
  state.activeProduction = {
    id,
    title: prod.title,
    scriptPath: prod.scriptPath || null,
    scriptPageCount: prod.scriptPageCount || null,
    joinCode: prod.joinCode || '',
    joinCodeActive: prod.joinCodeActive !== false,
    createdBy: prod.createdBy || '',
  };
  state.activeRole = (state.isSuperAdmin) ? 'owner' : role;
  hideDashboard();
  showApp();
}

export function backToDashboard() {
  cleanup();
  resetLineNotes();
  resetRunShow();
  state.activeProduction = null;
  state.activeRole = null;
  state.runSession = null;
  hideApp();
  showDashboard();
}

// ===== CREATE PRODUCTION MODAL =====
function openCreateModal() {
  let existingBackdrop = document.querySelector('.modal-backdrop.create-modal');
  if (existingBackdrop) existingBackdrop.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop create-modal';
  backdrop.innerHTML = `
    <div class="modal-card">
      <h2>Create Production</h2>
      <label>Production Title</label>
      <input type="text" id="create-title" placeholder="e.g. Hamlet — Spring 2025" maxlength="200" />
      <label>Script PDF (optional)</label>
      <input type="file" id="create-script" accept="application/pdf" />
      <div class="upload-progress" id="create-upload-progress">
        <div class="upload-progress-bar" id="create-upload-bar"></div>
      </div>
      <div class="modal-btns">
        <button class="modal-btn-cancel" id="create-cancel">Cancel</button>
        <button class="modal-btn-primary" id="create-submit">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#create-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#create-submit').addEventListener('click', () => doCreate(backdrop));
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable: 0/O, 1/I
  let code = '';
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function doCreate(backdrop) {
  const titleInput = backdrop.querySelector('#create-title');
  const fileInput = backdrop.querySelector('#create-script');
  const submitBtn = backdrop.querySelector('#create-submit');
  const title = sanitizeName(titleInput.value);

  if (!title) {
    toast('Please enter a production title.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    const uid = state.currentUser.uid;
    const joinCode = generateJoinCode();

    // Create production doc
    const prodRef = await addDoc(collection(db, 'productions'), {
      title,
      createdBy: uid,
      createdAt: serverTimestamp(),
      joinCode,
      joinCodeActive: true,
      scriptPath: null,
      scriptPageCount: null,
    });

    // Add creator as owner
    await setDoc(doc(db, 'productions', prodRef.id, 'members', uid), {
      role: 'owner',
      displayName: state.currentUser.displayName || state.currentUser.email,
      email: state.currentUser.email,
      addedAt: serverTimestamp(),
    });

    // Upload script if selected
    const file = fileInput.files[0];
    if (file && file.type === 'application/pdf') {
      const progressDiv = backdrop.querySelector('#create-upload-progress');
      const bar = backdrop.querySelector('#create-upload-bar');
      progressDiv.style.display = 'block';

      const storageRef = ref(storage, `productions/${prodRef.id}/script.pdf`);
      const task = uploadBytesResumable(storageRef, file);

      await new Promise((resolve, reject) => {
        task.on('state_changed',
          snap => { bar.style.width = `${(snap.bytesTransferred / snap.totalBytes) * 100}%`; },
          reject,
          async () => {
            await updateDoc(doc(db, 'productions', prodRef.id), {
              scriptPath: `productions/${prodRef.id}/script.pdf`,
            });
            resolve();
          }
        );
      });
    }

    toast('Production created!', 'success');
    backdrop.remove();
    await loadProductions();
  } catch (e) {
    console.error('Create production error:', e);
    toast('Failed to create production.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create';
  }
}

// ===== JOIN WITH CODE MODAL =====
function openJoinModal() {
  let existingBackdrop = document.querySelector('.modal-backdrop.join-modal');
  if (existingBackdrop) existingBackdrop.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop join-modal';
  backdrop.innerHTML = `
    <div class="modal-card">
      <h2>Join Production</h2>
      <label>Enter 7-character join code</label>
      <input type="text" id="join-code" placeholder="e.g. HAMLET4" maxlength="7" style="text-transform:uppercase; font-family:'DM Mono',monospace; font-size:18px; letter-spacing:3px; text-align:center;" />
      <div class="modal-btns">
        <button class="modal-btn-cancel" id="join-cancel">Cancel</button>
        <button class="modal-btn-primary" id="join-submit">Join</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#join-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#join-submit').addEventListener('click', () => doJoin(backdrop));
  backdrop.querySelector('#join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoin(backdrop);
  });
}

async function doJoin(backdrop) {
  const codeInput = backdrop.querySelector('#join-code');
  const submitBtn = backdrop.querySelector('#join-submit');
  const code = codeInput.value.trim().toUpperCase();

  if (!code || code.length < 4) {
    toast('Please enter a valid join code.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Joining…';

  try {
    // Confirm we actually have a current user before proceeding
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated. Please refresh and log in again.');

    // Force-refresh the ID token. This ensures the Firebase Functions SDK
    // has a valid, non-expired bearer token to attach to the request.
    // This is the fix for new users hitting 401 on their first callable invocation.
    const idToken = await user.getIdToken(/* forceRefresh= */ true);

    // Call the function via raw fetch as a guaranteed fallback — this bypasses
    // any SDK-level token-attachment bugs and sends the token explicitly.
    const projectId = import.meta.env.VITE_PROJECT_ID;
    const region = 'us-central1';
    const url = `https://${region}-${projectId}.cloudfunctions.net/joinProduction`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ data: { code } }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Server error ${response.status}`);
    }

    const json = await response.json();
    const result = json.result ?? json;

    if (result.alreadyMember) {
      toast('You are already a member of this production.', 'info');
    } else {
      toast(`Joined "${escapeHtml(result.title)}"!`, 'success');
    }

    backdrop.remove();
    await loadProductions();
  } catch (e) {
    console.error('Join error:', e);
    const msg = e.message || 'Failed to join. Check the code and try again.';
    toast(msg, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Join';
  }
}