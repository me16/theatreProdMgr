import { db } from '../firebase.js';
import { state } from '../shared/state.js';
import { isOwner } from '../shared/roles.js';
import { toast } from '../shared/toast.js';
import { escapeHtml, sanitizeName, confirmDialog } from '../shared/ui.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';

const COLORS = [
  '#c45c4a','#d4844a','#c8a96e','#7ab87a','#5b9bd4',
  '#8b6cc4','#c46ca4','#6ab4b4','#d4b44a','#7a9ab4',
];

const TYPES = ['Actor', 'Director', 'Stage Manager', 'Crew', 'Other'];

let castMembers = []; // in-memory sorted array

export function initCast() {
  // no-op — wired in main.js for symmetry
}

export function subscribeToCast(onChange) {
  const pid = state.activeProduction?.id;
  if (!pid) return;
  const unsub = onSnapshot(collection(db, 'productions', pid, 'cast'), snap => {
    castMembers = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ti = TYPES.indexOf(a.type) - TYPES.indexOf(b.type);
        if (ti !== 0) return ti;
        return (a.name || '').localeCompare(b.name || '');
      });
    if (onChange) onChange(castMembers);
    // Re-render if cast tab is active
    const castTab = document.getElementById('tab-cast');
    if (castTab?.classList.contains('tab-panel--active')) {
      renderCastTab();
    }
  });
  state.unsubscribers.push(unsub);
}

export function getCastMembers() {
  return castMembers;
}

export function renderCastTab() {
  const container = document.getElementById('cast-content');
  if (!container) return;

  const owner = isOwner();

  if (castMembers.length === 0) {
    container.innerHTML = `
      <div class="cast-header-row">
        <h2 style="font-family:'Instrument Serif',serif;font-size:22px;color:var(--text-primary)">Cast &amp; Crew</h2>
        ${owner ? '<button class="cast-add-btn" id="cast-add-btn">+ Add Member</button>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:12px;color:var(--text-muted);padding:60px 0;">
        <div style="font-size:48px">🎭</div>
        <div style="font-size:15px">No cast members yet.</div>
        ${owner ? '<div style="font-size:13px">Add members to enable cast pickers in Props and character tracking in Line Notes.</div>' : ''}
      </div>`;
  } else {
    // Group by type
    const groups = {};
    TYPES.forEach(t => { groups[t] = []; });
    castMembers.forEach(m => { (groups[m.type] || (groups['Other'] = groups['Other'] || [])).push(m); });

    let tableHtml = '';
    TYPES.forEach(type => {
      const members = groups[type];
      if (!members || members.length === 0) return;
      tableHtml += `<div style="margin-bottom:28px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:10px;">${escapeHtml(type)}</div>
        <table class="cast-table">
          <thead><tr><th>Name</th><th>Email</th><th>Characters</th>${owner ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${members.map(m => {
              const chars = (m.characters || []).map(ch =>
                `<span class="char-chip"><span class="char-chip-dot" style="background:${escapeHtml(m.color || '#888')}"></span>${escapeHtml(ch)}</span>`
              ).join('');
              return `<tr>
                <td class="cast-member-name">${escapeHtml(m.name)}</td>
                <td class="cast-member-email">${escapeHtml(m.email || '')}</td>
                <td><div class="cast-characters">${chars || '<span style="color:var(--text-muted);font-size:12px;">—</span>'}</div></td>
                ${owner ? `<td class="cast-actions">
                  <button class="cast-action-btn" data-action="edit" data-id="${escapeHtml(m.id)}">Edit</button>
                  <button class="cast-action-btn cast-action-btn--danger" data-action="remove" data-id="${escapeHtml(m.id)}">Remove</button>
                </td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    });

    container.innerHTML = `
      <div class="cast-header-row">
        <h2 style="font-family:'Instrument Serif',serif;font-size:22px;color:var(--text-primary)">Cast &amp; Crew</h2>
        ${owner ? '<button class="cast-add-btn" id="cast-add-btn">+ Add Member</button>' : ''}
      </div>
      ${tableHtml}`;
  }

  if (owner) {
    container.querySelector('#cast-add-btn')?.addEventListener('click', () => openCastModal(null));
    container.querySelectorAll('[data-action="edit"]').forEach(btn =>
      btn.addEventListener('click', () => {
        const m = castMembers.find(c => c.id === btn.dataset.id);
        if (m) openCastModal(m);
      })
    );
    container.querySelectorAll('[data-action="remove"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirmDialog('Remove this cast member?')) return;
        try {
          await deleteDoc(doc(db, 'productions', state.activeProduction.id, 'cast', btn.dataset.id));
          toast('Member removed.', 'success');
        } catch(e) { toast('Failed to remove.', 'error'); }
      })
    );
  }
}

function openCastModal(member) {
  const modal = document.getElementById('cast-modal');
  if (!modal) return;

  const usedColors = castMembers.map(c => c.color).filter(Boolean);
  const defaultColor = member?.color || COLORS.find(c => !usedColors.includes(c)) || COLORS[0];
  let selectedColor = defaultColor;
  let chips = [...(member?.characters || [])];

  modal.innerHTML = `<div class="cast-modal-card">
    <h3 style="font-family:'Instrument Serif',serif;font-size:20px;margin-bottom:20px;color:var(--text-primary)">${member ? 'Edit' : 'Add'} Cast Member</h3>
    <div class="cast-modal-field">
      <label>Full Name</label>
      <input type="text" id="cm-name" class="form-input" maxlength="100" placeholder="e.g. Jane Smith" value="${escapeHtml(member?.name || '')}" />
    </div>
    <div class="cast-modal-field">
      <label>Email</label>
      <input type="email" id="cm-email" class="form-input" maxlength="200" placeholder="jane@example.com" value="${escapeHtml(member?.email || '')}" />
    </div>
    <div class="cast-modal-field">
      <label>Role Type</label>
      <select id="cm-type" class="form-select">
        ${TYPES.map(t => `<option value="${t}" ${(member?.type || 'Actor') === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="cast-modal-field">
      <label>Characters</label>
      <div class="char-chips-editor" id="cm-chips"></div>
      <div class="char-chip-add-row">
        <input type="text" id="cm-char-input" class="form-input" maxlength="100" placeholder="Character name" style="flex:1;" />
        <button class="cast-add-btn" id="cm-char-add" style="margin-left:8px;">Add</button>
      </div>
    </div>
    <div class="cast-modal-field">
      <label>Color</label>
      <div class="color-grid" id="cm-colors">
        ${COLORS.map(c => `<div class="color-swatch${c === defaultColor ? ' color-swatch--selected' : ''}" data-color="${c}" style="background:${c};"></div>`).join('')}
      </div>
    </div>
    <div class="modal-btns" style="margin-top:20px;">
      <button class="modal-btn-cancel" id="cm-cancel">Cancel</button>
      <button class="modal-btn-primary" id="cm-save">${member ? 'Update' : 'Add'} Member</button>
    </div>
  </div>`;

  modal.classList.add('open');

  function renderChips() {
    const el = modal.querySelector('#cm-chips');
    el.innerHTML = chips.map((ch, i) =>
      `<span class="char-chip-editable">${escapeHtml(ch)}<button class="chip-remove" data-idx="${i}">×</button></span>`
    ).join('');
    el.querySelectorAll('.chip-remove').forEach(btn =>
      btn.addEventListener('click', () => { chips.splice(parseInt(btn.dataset.idx), 1); renderChips(); })
    );
  }
  renderChips();

  function addChip() {
    const inp = modal.querySelector('#cm-char-input');
    const val = sanitizeName(inp.value);
    if (val && !chips.includes(val)) { chips.push(val); renderChips(); }
    inp.value = '';
    inp.focus();
  }
  modal.querySelector('#cm-char-add').addEventListener('click', addChip);
  modal.querySelector('#cm-char-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } });

  modal.querySelectorAll('.color-swatch').forEach(s => s.addEventListener('click', () => {
    modal.querySelectorAll('.color-swatch').forEach(ss => ss.classList.remove('color-swatch--selected'));
    s.classList.add('color-swatch--selected');
    selectedColor = s.dataset.color;
  }));

  modal.querySelector('#cm-cancel').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  modal.querySelector('#cm-save').addEventListener('click', async () => {
    const name = sanitizeName(modal.querySelector('#cm-name').value);
    const email = modal.querySelector('#cm-email').value.trim();
    const type = modal.querySelector('#cm-type').value;
    if (!name) { toast('Name is required.', 'error'); return; }
    const data = {
      name, email, type,
      characters: chips,
      color: selectedColor,
      addedBy: state.currentUser.uid,
    };
    try {
      const pid = state.activeProduction.id;
      if (member) {
        await updateDoc(doc(db, 'productions', pid, 'cast', member.id), { ...data, updatedAt: serverTimestamp() });
        toast('Member updated.', 'success');
      } else {
        await addDoc(collection(db, 'productions', pid, 'cast'), { ...data, addedAt: serverTimestamp() });
        toast('Member added!', 'success');
      }
      modal.classList.remove('open');
    } catch(e) { console.error(e); toast('Failed to save.', 'error'); }
  });

  setTimeout(() => modal.querySelector('#cm-name').focus(), 50);
}

export function buildCastPicker(inputEl, onSelect, initialValue) {
  if (!inputEl) return { getValue: () => '', getSelectedId: () => '' };

  const wrapper = document.createElement('div');
  wrapper.className = 'cast-picker';

  const newInput = document.createElement('input');
  newInput.type = 'text';
  newInput.className = 'cast-picker-input form-input';
  newInput.value = initialValue || '';
  newInput.placeholder = inputEl.placeholder || '';
  newInput.maxLength = 100;

  const dropdown = document.createElement('div');
  dropdown.className = 'cast-picker-dropdown';

  wrapper.appendChild(newInput);
  wrapper.appendChild(dropdown);
  inputEl.replaceWith(wrapper);

  let selectedId = null;

  function renderDropdown(filter) {
    dropdown.innerHTML = '';
    const noneOpt = document.createElement('div');
    noneOpt.className = 'cast-picker-option';
    noneOpt.textContent = '— None —';
    noneOpt.addEventListener('mousedown', e => {
      e.preventDefault();
      newInput.value = '';
      selectedId = null;
      onSelect(null);
      dropdown.classList.remove('open');
    });
    dropdown.appendChild(noneOpt);

    const lower = filter.toLowerCase();
    const matches = castMembers.filter(m => {
      if (m.name.toLowerCase().includes(lower)) return true;
      return (m.characters || []).some(ch => ch.toLowerCase().includes(lower));
    });

    matches.forEach(m => {
      const opt = document.createElement('div');
      opt.className = 'cast-picker-option';
      opt.innerHTML = `<span>${escapeHtml(m.name)}</span>${m.characters?.length ? `<div class="opt-char">${m.characters.map(ch => escapeHtml(ch)).join(', ')}</div>` : ''}`;
      opt.addEventListener('mousedown', e => {
        e.preventDefault();
        newInput.value = m.name;
        selectedId = m.id;
        onSelect({ castId: m.id, castName: m.name, characters: m.characters || [] });
        dropdown.classList.remove('open');
      });
      dropdown.appendChild(opt);
    });

    if (filter && matches.length === 0) {
      const freeOpt = document.createElement('div');
      freeOpt.className = 'cast-picker-option';
      freeOpt.textContent = `Use "${filter}" as free text`;
      freeOpt.addEventListener('mousedown', e => {
        e.preventDefault();
        newInput.value = filter;
        selectedId = null;
        onSelect({ castId: null, castName: filter, characters: [] });
        dropdown.classList.remove('open');
      });
      dropdown.appendChild(freeOpt);
    }
  }

  newInput.addEventListener('focus', () => {
    renderDropdown(newInput.value);
    dropdown.classList.add('open');
  });

  newInput.addEventListener('input', () => {
    renderDropdown(newInput.value);
    dropdown.classList.add('open');
  });

  newInput.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.remove('open'), 150);
  });

  return {
    getValue: () => newInput.value,
    getSelectedId: () => selectedId,
  };
}