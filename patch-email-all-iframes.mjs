#!/usr/bin/env node
/**
 * patch-email-all-iframes.mjs
 *
 * Fixes the "Email All" button in both the inline report email UI and the
 * live-run Email Notes modal. Replaces window.open() (which browsers block
 * after the first popup) with hidden iframes that trigger the OS mailto
 * handler without hitting popup blockers.
 *
 * Patches applied to: src/runshow/Runshow.js
 *
 * Usage:
 *   node patch-email-all-iframes.mjs          # dry-run (default)
 *   node patch-email-all-iframes.mjs --apply  # apply changes
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = !process.argv.includes('--apply');
const TARGET  = 'src/runshow/Runshow.js';

function bail(msg) { console.error(`\n❌ FATAL: ${msg}`); process.exit(1); }

function applyPatch(source, label, find, replace) {
  if (!source.includes(find)) {
    bail(`Patch "${label}" — search string not found.`);
  }
  const count = source.split(find).length - 1;
  if (count > 1) {
    bail(`Patch "${label}" — matched ${count} times (expected 1).`);
  }
  console.log(`  ✅ ${label}`);
  return source.replace(find, replace);
}

const filePath = path.resolve(TARGET);
if (!fs.existsSync(filePath)) {
  bail(`File not found: ${filePath}\nRun this script from the project root.`);
}

console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '🔧 APPLYING'} — patching ${TARGET}\n`);

let src = fs.readFileSync(filePath, 'utf-8');

/* ═══════════════════════════════════════════════════════════
   P1: Add _openMailto helper (iframe-based, no popup blocker)
       Insert right before the FEATURE 7 section header.
   ═══════════════════════════════════════════════════════════ */
const FEATURE7_MARKER = `/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   FEATURE 7: PER-ACTOR EMAIL NOTES (revised)`;

src = applyPatch(src, 'P1 — Add _openMailto helper',

FEATURE7_MARKER,

`/** Open a mailto: URI via hidden iframe to avoid popup blockers. */
function _openMailto(uri) {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = uri;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 4000);
}

` + FEATURE7_MARKER
);

/* ═══════════════════════════════════════════════════════════
   P2: Fix "Email All" in rsOpenEmailNotes (live-run modal)
   ═══════════════════════════════════════════════════════════ */
src = applyPatch(src, 'P2 — rsOpenEmailNotes Email All → iframe',

// --- find: the Email All handler in rsOpenEmailNotes ---
`    emailModal.querySelector('#rs-email-all-btn').addEventListener('click', () => {
      let delay = 0;
      actorsWithEmail.forEach(([cid, data]) => {
        const body = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
        const uri = _buildMailtoUri(data.actorEmail, subject, body);
        setTimeout(() => { window.open(uri, '_blank'); }, delay);
        delay += 300;
      });`,

// --- replace ---
`    emailModal.querySelector('#rs-email-all-btn').addEventListener('click', () => {
      let delay = 0;
      actorsWithEmail.forEach(([cid, data]) => {
        const body = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
        const uri = _buildMailtoUri(data.actorEmail, subject, body);
        setTimeout(() => { _openMailto(uri); }, delay);
        delay += 600;
      });`
);

/* ═══════════════════════════════════════════════════════════
   P3: Fix "Email All" in emailReport (inline report email UI)
   ═══════════════════════════════════════════════════════════ */
src = applyPatch(src, 'P3 — emailReport Email All → iframe',

// --- find: the Email All handler in emailReport ---
`    document.getElementById('rs-rpt-email-all')?.addEventListener('click', () => {
      let delay = 0;
      actorsWithEmail.forEach(([cid, data]) => {
        const mbody = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
        const uri = _buildMailtoUri(data.actorEmail, subject, mbody);
        setTimeout(() => { window.open(uri, '_blank'); }, delay);
        delay += 300;
      });`,

// --- replace ---
`    document.getElementById('rs-rpt-email-all')?.addEventListener('click', () => {
      let delay = 0;
      actorsWithEmail.forEach(([cid, data]) => {
        const mbody = _buildActorEmailBody(data.actorName, data.notes, show, dateStr);
        const uri = _buildMailtoUri(data.actorEmail, subject, mbody);
        setTimeout(() => { _openMailto(uri); }, delay);
        delay += 600;
      });`
);

/* ═══════════════════════════════════════════════════════════
   P4: Fix per-actor Email buttons in emailReport (inline UI)
       These use window.open too — single clicks are usually fine
       but let's be consistent.
   ═══════════════════════════════════════════════════════════ */
src = applyPatch(src, 'P4 — Per-actor Email buttons in report → iframe',

// --- find ---
`    reportBody.querySelectorAll('.email-single-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uri = btn.dataset.mailto;
        if (uri) window.open(uri, '_blank');
      });
    });`,

// --- replace ---
`    reportBody.querySelectorAll('.email-single-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uri = btn.dataset.mailto;
        if (uri) _openMailto(uri);
      });
    });`
);

/* ═══════════════════════════════════════════════════════════
   P5: Fix per-actor Email buttons in rsOpenEmailNotes (live modal)
   ═══════════════════════════════════════════════════════════ */
src = applyPatch(src, 'P5 — Per-actor Email buttons in live modal → iframe',

// --- find ---
`  emailModal.querySelectorAll('.email-single-btn:not(.email-open-btn--disabled)').forEach(btn => {
    btn.addEventListener('click', () => { window.open(btn.dataset.mailto, '_blank'); });
  });`,

// --- replace ---
`  emailModal.querySelectorAll('.email-single-btn:not(.email-open-btn--disabled)').forEach(btn => {
    btn.addEventListener('click', () => { _openMailto(btn.dataset.mailto); });
  });`
);

/* ───────────────────────────────────────────────────────────
   Write or report
   ─────────────────────────────────────────────────────────── */
if (DRY_RUN) {
  console.log(`\n✅ Dry run passed — all 5 patches matched.`);
  console.log(`   Re-run with --apply to write changes:\n`);
  console.log(`   node patch-email-all-iframes.mjs --apply\n`);
} else {
  fs.writeFileSync(filePath, src, 'utf-8');
  console.log(`\n✅ All 5 patches applied to ${TARGET}`);
  console.log(`\n📋 What changed:`);
  console.log(`   P1  Added _openMailto() helper — uses hidden iframe instead of window.open`);
  console.log(`   P2  "Email All" in live-run modal → iframe + 600ms stagger`);
  console.log(`   P3  "Email All" in report email UI → iframe + 600ms stagger`);
  console.log(`   P4  Per-actor Email in report UI → iframe`);
  console.log(`   P5  Per-actor Email in live modal → iframe`);
  console.log(`\n🧪 Verify:`);
  console.log(`   1. Open report → Send Email → click "Email All N Actors"`);
  console.log(`      → all N compose windows should open in your mail client`);
  console.log(`   2. During a live run → Email Notes → "Email All" → same result`);
  console.log(`   3. Individual per-actor "Email" buttons still work`);
  console.log(`   4. Run  npx vite build  to confirm no build errors\n`);
}
