#!/usr/bin/env node
/**
 * CUE Patch — Dashboard Duplicates + Email Notes Overhaul
 *
 * Usage:  node patch-cue-fixes.mjs            (run from project root)
 *    or:  node patch-cue-fixes.mjs /path/to/project
 *
 * Patches:
 *   1. src/dashboard/dashboard.js  — dedup guard in renderProductionCards
 *   2. src/RunShow/Runshow.js      — rewrite rsOpenEmailNotes + add helpers
 *   3. index.html                  — CSS for Email All button + warning banner
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const root = resolve(process.argv[2] || '.');
let applied = 0;
let failed = 0;

function read(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) { console.error(`✗ File not found: ${rel}`); failed++; return null; }
  return { path: p, content: readFileSync(p, 'utf-8') };
}

function write(p, content) { writeFileSync(p, content, 'utf-8'); }

// ═══════════════════════════════════════════════════════════
// PATCH 1 — Dashboard: dedup guard in renderProductionCards
// ═══════════════════════════════════════════════════════════
console.log('\n── Patch 1: Dashboard dedup ──');
{
  const f = read('src/dashboard/dashboard.js');
  if (f) {
    // Anchor: the function signature + first lines are stable
    const anchor = 'async function renderProductionCards(memberSnaps) {';
    const idx = f.content.indexOf(anchor);
    if (idx === -1) {
      console.error('  ✗ Could not find renderProductionCards function');
      failed++;
    } else {
      // Find the body we need to replace: from the anchor to just before
      // "async function openProduction" (next function in the file)
      const endAnchor = 'async function openProduction(';
      const endIdx = f.content.indexOf(endAnchor, idx);
      if (endIdx === -1) {
        console.error('  ✗ Could not find openProduction function boundary');
        failed++;
      } else {
        // Walk back from endIdx to find the closing brace + newlines of renderProductionCards
        // The function ends with "}\n\n" before the next function
        let funcEnd = endIdx;
        while (funcEnd > idx && f.content[funcEnd - 1] === '\n') funcEnd--;

        const oldFunc = f.content.slice(idx, funcEnd);

        const newFunc = `async function renderProductionCards(memberSnaps) {
  if (memberSnaps.empty) {
    grid.innerHTML = '<div class="empty-state">No productions yet. Create one or join with a code.</div>';
    return;
  }
  grid.innerHTML = '';
  const uid = state.currentUser.uid;
  // Safety dedup: track rendered production IDs to prevent duplicate cards
  const renderedProdIds = new Set();

  for (const memberDoc of memberSnaps.docs) {
    const productionRef = memberDoc.ref.parent.parent;
    const prodId = productionRef.id;

    // Skip if we already rendered a card for this production
    if (renderedProdIds.has(prodId)) continue;

    const role = memberDoc.data().role || 'member';

    try {
      const prodSnap = await getDoc(productionRef);
      if (!prodSnap.exists()) continue;
      const prod = prodSnap.data();

      // Final dedup check (covers async race)
      if (renderedProdIds.has(prodSnap.id)) continue;
      renderedProdIds.add(prodSnap.id);

      const membersSnap = await getDocs(collection(db, 'productions', prodSnap.id, 'members'));
      const memberCount = membersSnap.size;

      const card = document.createElement('div');
      card.className = 'production-card';
      card.innerHTML = \`
        <h3>\${escapeHtml(prod.title)}</h3>
        <span class="role-badge role-badge--\${role}">\${escapeHtml(role)}</span>
        <div class="meta">\${memberCount} member\${memberCount !== 1 ? 's' : ''}</div>
        <button class="open-btn">Open</button>
      \`;
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
}`;

        f.content = f.content.slice(0, idx) + newFunc + f.content.slice(funcEnd);
        write(f.path, f.content);
        console.log('  ✓ renderProductionCards patched with dedup guard');
        applied++;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// PATCH 2 — RunShow: rewrite rsOpenEmailNotes + add helpers
// ═══════════════════════════════════════════════════════════
console.log('\n── Patch 2: Email Notes overhaul ──');
{
  const f = read('src/RunShow/Runshow.js');
  if (f) {
    // The feature block starts with this comment header
    const startAnchor = '/* ═══════════════════════════════════════════════════════════\n   FEATURE 7: PER-ACTOR EMAIL NOTES\n   ═══════════════════════════════════════════════════════════ */';
    let startIdx = f.content.indexOf(startAnchor);

    // Fallback: try just the comment text
    if (startIdx === -1) {
      const alt = 'FEATURE 7: PER-ACTOR EMAIL NOTES';
      const altIdx = f.content.indexOf(alt);
      if (altIdx !== -1) {
        // Walk back to start of comment block
        startIdx = f.content.lastIndexOf('/*', altIdx);
      }
    }

    if (startIdx === -1) {
      console.error('  ✗ Could not find FEATURE 7 comment block');
      failed++;
    } else {
      // The function ends right before "// Keyboard in FAB popover"
      const endAnchor = '// Keyboard in FAB popover';
      const endIdx = f.content.indexOf(endAnchor, startIdx);
      if (endIdx === -1) {
        console.error('  ✗ Could not find "// Keyboard in FAB popover" boundary');
        failed++;
      } else {
        // Trim trailing whitespace between end of function and next comment
        let sliceEnd = endIdx;
        while (sliceEnd > startIdx && (f.content[sliceEnd - 1] === '\n' || f.content[sliceEnd - 1] === ' ')) sliceEnd--;

        const replacement = `/* ═══════════════════════════════════════════════════════════
   FEATURE 7: PER-ACTOR EMAIL NOTES (revised)
   ═══════════════════════════════════════════════════════════ */

/** Build a formatted email body for one actor's line notes. */
function _buildActorEmailBody(actorName, notes, show, dateStr) {
  const NOTE_TYPE_LABELS = { skp: 'SKIP', para: 'PARAPHRASE', line: 'LINE', add: 'ADDITION', gen: 'GENERAL' };
  const sorted = [...notes].sort((a, b) =>
    a.page !== b.page ? a.page - b.page : (a.bounds?.y || 0) - (b.bounds?.y || 0)
  );
  let body = 'Hi ' + actorName + ',\\n\\nHere are your line notes from ' + show + ' on ' + dateStr + ':\\n';
  sorted.forEach(n => {
    const typeLabel = NOTE_TYPE_LABELS[n.type] || n.type.toUpperCase();
    const lineText = (n.lineText || '').slice(0, 150) + ((n.lineText || '').length > 150 ? '...' : '');
    body += '\\n---------';
    body += '\\nPage: ' + rsScriptLabel(n.page, n.half);
    body += '\\nType: ' + typeLabel;
    if (lineText) body += '\\nLine: "' + lineText + '"';
    if (n.noteBody && n.noteBody.trim()) body += '\\nNote: ' + n.noteBody.trim();
  });
  body += '\\n---------\\n\\n' + sorted.length + ' note' + (sorted.length !== 1 ? 's' : '') + ' total.\\n\\n\\u2014 ' + show + ' Stage Management';
  return body;
}

/** Build a mailto: URI, truncating body if needed to stay under browser limits. */
function _buildMailtoUri(email, subject, body) {
  const maxLen = 1800;
  const safeBody = body.length > maxLen
    ? body.slice(0, maxLen) + '\\n\\n[Truncated \\u2014 use the Copy button for the full list.]'
    : body;
  return 'mailto:' + encodeURIComponent(email)
    + '?subject=' + encodeURIComponent(subject)
    + '&body=' + encodeURIComponent(safeBody);
}

/** Copy text to clipboard with fallback for older browsers. */
function _copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard'),
    () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Copied \\u2014 paste into your email client');
    }
  );
}

/**
 * Opens the Email Notes modal.
 *
 * Features:
 *  \\u2022 "Email All N Actors" button \\u2014 opens staggered mailto windows
 *  \\u2022 Per-actor Email + Copy buttons
 *  \\u2022 Warning banner when actors are missing email addresses
 *  \\u2022 Email body includes Page, Type, Line, and Note for every note
 */
function rsOpenEmailNotes() {
  if (rsNotes.length === 0) { toast('No notes to email'); return; }
  const emailModal = document.getElementById('rs-email-notes-modal');
  if (!emailModal) return;
  emailModal.classList.add('open');

  // ── Group notes by cast member ──
  const cast = getCastMembers();
  const byCastId = {};
  rsNotes.forEach(n => {
    const castId = n.castId || n.charId;
    if (!byCastId[castId]) {
      const member = cast.find(m => m.id === castId);
      byCastId[castId] = {
        actorName: member?.name || n.characterName || n.charName || '?',
        actorEmail: member?.email || '',
        color: member?.color || n.charColor || '#888',
        notes: [],
      };
    }
    byCastId[castId].notes.push(n);
  });

  const show = state.activeProduction?.title || '';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const subject = 'Line Notes \\u2014 ' + show + ' \\u2014 ' + dateStr;
  const totalNotes = rsNotes.length;
  const actorEntries = Object.entries(byCastId).filter(([, d]) => d.notes.length > 0);
  const actorCount = actorEntries.length;
  const actorsWithEmail = actorEntries.filter(([, d]) => !!d.actorEmail);
  const actorsWithoutEmail = actorEntries.filter(([, d]) => !d.actorEmail);

  // ── Per-actor rows ──
  const actorRows = actorEntries.map(([cid, data]) => {
    const noteCount = data.notes.length;
    const hasEmail = !!data.actorEmail;
    const body = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
    const mailtoUri = hasEmail ? _buildMailtoUri(data.actorEmail, subject, body) : '';
    const emailDisplay = hasEmail
      ? '<span class="actor-email">' + escapeHtml(data.actorEmail) + '</span>'
      : '<span class="actor-email actor-email--warn">No email \\u2014 update in Cast &amp; Crew tab</span>';

    return '<div class="email-actor-row" data-castid="' + escapeHtml(cid) + '">'
      + '<div class="actor-dot" style="background:' + escapeHtml(data.color) + '"></div>'
      + '<div class="actor-info"><span class="actor-name">' + escapeHtml(data.actorName) + '</span>' + emailDisplay + '</div>'
      + '<span class="actor-note-count">' + noteCount + ' note' + (noteCount !== 1 ? 's' : '') + '</span>'
      + '<button class="modal-btn-primary email-single-btn' + (hasEmail ? '' : ' email-open-btn--disabled') + '"'
      +   ' data-mailto="' + escapeHtml(mailtoUri) + '"'
      +   ' title="Email ' + escapeHtml(data.actorName) + '">Email</button>'
      + '<button class="modal-btn-cancel email-copy-btn"'
      +   ' data-body="' + escapeHtml(body) + '"'
      +   ' title="Copy notes for ' + escapeHtml(data.actorName) + '">Copy</button>'
      + '</div>';
  }).join('');

  // ── Warning + Email All ──
  const emailAllDisabled = actorsWithEmail.length === 0;
  const emailAllLabel = emailAllDisabled
    ? 'No actors have email addresses'
    : 'Email All ' + actorsWithEmail.length + ' Actor' + (actorsWithEmail.length !== 1 ? 's' : '');
  const warningBanner = actorsWithoutEmail.length > 0
    ? '<div class="email-notes-warning">'
      + actorsWithoutEmail.length + ' actor' + (actorsWithoutEmail.length !== 1 ? 's' : '')
      + ' missing email \\u2014 update in Cast &amp; Crew tab</div>'
    : '';

  // ── Render modal ──
  emailModal.innerHTML = '<div class="send-notes-card">'
    + '<h3>Email Notes</h3>'
    + '<div class="email-notes-meta">' + escapeHtml(dateStr)
    +   ' \\u00b7 ' + totalNotes + ' notes \\u00b7 ' + actorCount + ' actors</div>'
    + warningBanner
    + '<div class="email-all-section">'
    +   '<button class="email-all-btn' + (emailAllDisabled ? ' email-open-btn--disabled' : '')
    +     '" id="rs-email-all-btn">' + emailAllLabel + '</button>'
    + '</div>'
    + actorRows
    + '<div class="send-notes-actions">'
    +   '<button class="modal-btn-cancel" id="rs-email-notes-close">Close</button>'
    + '</div></div>';

  // ── Event listeners ──

  // Close
  emailModal.querySelector('#rs-email-notes-close').addEventListener('click', () => emailModal.classList.remove('open'));
  emailModal.addEventListener('click', e => { if (e.target === emailModal) emailModal.classList.remove('open'); });

  // "Email All" \\u2014 stagger mailto opens to avoid popup-blocker issues
  if (!emailAllDisabled) {
    emailModal.querySelector('#rs-email-all-btn').addEventListener('click', () => {
      let delay = 0;
      actorsWithEmail.forEach(([cid, data]) => {
        const body = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
        const uri = _buildMailtoUri(data.actorEmail, subject, body);
        setTimeout(() => { window.open(uri, '_blank'); }, delay);
        delay += 300;
      });
      toast('Opening ' + actorsWithEmail.length + ' email' + (actorsWithEmail.length !== 1 ? 's' : '') + '\\u2026');
    });
  }

  // Per-actor email buttons
  emailModal.querySelectorAll('.email-single-btn:not(.email-open-btn--disabled)').forEach(btn => {
    btn.addEventListener('click', () => { window.open(btn.dataset.mailto, '_blank'); });
  });

  // Per-actor copy buttons
  emailModal.querySelectorAll('.email-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => _copyToClipboard(btn.dataset.body));
  });
}

`;

        f.content = f.content.slice(0, startIdx) + replacement + f.content.slice(endIdx);
        write(f.path, f.content);
        console.log('  ✓ rsOpenEmailNotes replaced with Email All + per-actor buttons');
        applied++;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// PATCH 3 — index.html: CSS for Email All + warning banner
// ═══════════════════════════════════════════════════════════
console.log('\n── Patch 3: CSS additions ──');
{
  const f = read('index.html');
  if (f) {
    const anchor = '.email-open-btn--disabled { opacity:0.35; cursor:not-allowed; pointer-events:none; }';
    const idx = f.content.indexOf(anchor);
    if (idx === -1) {
      console.error('  ✗ Could not find .email-open-btn--disabled CSS rule');
      failed++;
    } else {
      const insertAt = idx + anchor.length;

      const newCSS = `

    /* Email All button + warning banner */
    .email-all-section { margin-bottom:16px; }
    .email-all-btn {
      width:100%; padding:12px 20px; background:var(--gold); color:var(--bg-deep);
      border:none; border-radius:8px; font-size:14px; font-weight:600;
      cursor:pointer; transition:background 0.2s, opacity 0.2s;
      font-family:'DM Sans',sans-serif; letter-spacing:0.3px;
    }
    .email-all-btn:hover:not(.email-open-btn--disabled) { background:var(--gold-light, #e0c04a); }
    .email-all-btn.email-open-btn--disabled {
      background:var(--bg-border); color:var(--text-muted);
      opacity:0.5; cursor:not-allowed; pointer-events:none;
    }
    .email-notes-warning {
      background:rgba(212,175,55,0.1); border:1px solid rgba(212,175,55,0.25);
      border-radius:6px; padding:8px 12px; margin-bottom:12px;
      font-family:'DM Mono',monospace; font-size:11px; color:var(--gold);
    }
    .email-single-btn { min-width:60px; text-align:center; }`;

      // Check if already patched
      if (f.content.includes('.email-all-btn')) {
        console.log('  ⊘ CSS already contains .email-all-btn — skipping (already patched?)');
      } else {
        f.content = f.content.slice(0, insertAt) + newCSS + f.content.slice(insertAt);
        write(f.path, f.content);
        console.log('  ✓ Added .email-all-btn, .email-notes-warning, .email-single-btn CSS');
        applied++;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`Done.  ${applied} applied, ${failed} failed.`);
if (failed > 0) {
  console.log('\n⚠  Failed patches may mean the source files have changed.');
  console.log('   Review the errors above and apply those changes by hand.');
  process.exit(1);
}
console.log('');
