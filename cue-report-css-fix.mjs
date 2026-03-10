#!/usr/bin/env node
/**
 * CUE — Report CSS Leak Fix
 * ==========================
 * Root cause: generateRunReport() builds a full HTML document with <style> tags
 * that gets injected into #run-report-body via innerHTML. The browser activates
 * those <style> tags in the page context, causing:
 *   - body { color: #1a1814 } → dark text on dark background = invisible
 *   - * { margin: 0; padding: 0 } → spacing collapse
 *
 * Fix 1: Clear report body on modal close (removes leaked styles)
 * Fix 2: Render report in sandboxed iframe (prevents style leaking entirely)
 * Fix 3: Restore sidebar title after report close as safety net
 *
 * Usage:
 *   node cue-report-css-fix.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ROOT = process.cwd();

let applied = 0, failed = 0;
const results = [];

function strReplace(filePath, oldStr, newStr, label) {
  const abs = path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    console.error(`  ✗ FILE NOT FOUND: ${filePath}`);
    results.push({ label, status: 'FILE_NOT_FOUND' }); failed++;
    return false;
  }
  let content = fs.readFileSync(abs, 'utf-8');
  // Try exact match first, then trimmed-line match
  let target = oldStr;
  if (!content.includes(target)) {
    target = oldStr.split('\n').map(l => l.trimEnd()).join('\n');
    if (!content.includes(target)) {
      console.error(`  ✗ NOT FOUND: ${label}`);
      results.push({ label, status: 'NOT_FOUND' }); failed++;
      return false;
    }
  }
  if (DRY_RUN) {
    console.log(`  ✓ [DRY] ${label}`);
    results.push({ label, status: 'WOULD_APPLY' }); applied++;
    return true;
  }
  content = content.replace(target, newStr);
  fs.writeFileSync(abs, content, 'utf-8');
  console.log(`  ✓ ${label}`);
  results.push({ label, status: 'APPLIED' }); applied++;
  return true;
}


console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  CUE — REPORT CSS LEAK FIX                          ║');
console.log('╚══════════════════════════════════════════════════════╝\n');


// ═══════════════════════════════════════════════════════
// Fix 1: Render report in a sandboxed iframe
// ═══════════════════════════════════════════════════════
// Replace direct innerHTML injection with an iframe whose srcdoc
// contains the report HTML. This completely isolates report styles.
console.log('Fix 1: Render report in sandboxed iframe');
strReplace(
  'src/runshow/Runshow.js',
  // old_str
  `function openReportModal(title, html, sessionId) {
  _currentReportHtml = html;
  _currentReportSessionId = sessionId || '';
  _reportEmailMode = false;
  const modal = document.getElementById('run-report-modal');
  if (!modal) return;
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = title || 'Run Report';
  const body = document.getElementById('run-report-body');
  if (body) body.innerHTML = html;
  // Ensure header buttons are in report mode
  const printBtn = document.getElementById('run-report-print');
  const emailBtn = document.getElementById('run-report-email');
  if (printBtn) printBtn.style.display = '';
  if (emailBtn) emailBtn.textContent = 'Send Email';
  modal.style.display = 'flex';
}`,
  // new_str — use srcdoc iframe to sandbox report styles
  `function openReportModal(title, html, sessionId) {
  _currentReportHtml = html;
  _currentReportSessionId = sessionId || '';
  _reportEmailMode = false;
  const modal = document.getElementById('run-report-modal');
  if (!modal) return;
  const titleEl = document.getElementById('run-report-title');
  if (titleEl) titleEl.textContent = title || 'Run Report';
  const body = document.getElementById('run-report-body');
  if (body) {
    // Render report in sandboxed iframe to prevent CSS style leaking
    // into the main page (report HTML contains <style> tags with global selectors
    // like body{color:#1a1814} that would override the dark theme text colors).
    body.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.srcdoc = html;
    iframe.style.cssText = 'width:100%;border:none;background:#fff;border-radius:8px;min-height:400px;';
    // Auto-resize iframe to content height once loaded
    iframe.addEventListener('load', () => {
      try {
        const h = iframe.contentDocument?.documentElement?.scrollHeight;
        if (h) iframe.style.height = h + 'px';
      } catch(_e) { /* cross-origin safety */ }
    });
    body.appendChild(iframe);
  }
  // Ensure header buttons are in report mode
  const printBtn = document.getElementById('run-report-print');
  const emailBtn = document.getElementById('run-report-email');
  if (printBtn) printBtn.style.display = '';
  if (emailBtn) emailBtn.textContent = 'Send Email';
  modal.style.display = 'flex';
}`,
  'Fix 1: Render report in sandboxed iframe to prevent CSS leak'
);


// ═══════════════════════════════════════════════════════
// Fix 2: Clear report body on modal close
// ═══════════════════════════════════════════════════════
// Safety net: if any code path bypasses the iframe approach,
// clearing the body on close removes any leaked <style> tags.
console.log('\nFix 2: Clear report body on modal close');
strReplace(
  'src/runshow/Runshow.js',
  // old_str
  `function closeReportModal() {
  const modal = document.getElementById('run-report-modal');
  if (modal) modal.style.display = 'none';
  _reportEmailMode = false;
}`,
  // new_str
  `function closeReportModal() {
  const modal = document.getElementById('run-report-modal');
  if (modal) modal.style.display = 'none';
  // Clear report body to remove any <style> tags that could leak into the page
  const body = document.getElementById('run-report-body');
  if (body) body.innerHTML = '';
  _reportEmailMode = false;

  // Refresh controls to restore any styles that were affected
  renderRunShowControls();
  // Re-populate sidebar title in case it was cleared by leaked styles
  const showNameEl = document.getElementById('rs-show-name');
  if (showNameEl) showNameEl.textContent = state.activeProduction?.title || '';
}`,
  'Fix 2: Clear report body on close + refresh controls'
);


// ═══════════════════════════════════════════════════════
// Fix 3: Update _restoreReportView to use iframe too
// ═══════════════════════════════════════════════════════
// The email toggle swaps between report view and email view.
// When restoring the report, it re-injects HTML via innerHTML.
// Make it use the iframe approach too.
console.log('\nFix 3: Update _restoreReportView to use iframe');
strReplace(
  'src/runshow/Runshow.js',
  // old_str
  `function _restoreReportView() {
  _reportEmailMode = false;

  const reportBody = document.getElementById('run-report-body');
  if (reportBody) {
    reportBody.innerHTML = _currentReportHtml;
    reportBody.style.background = '#fff';
  }`,
  // new_str
  `function _restoreReportView() {
  _reportEmailMode = false;

  const reportBody = document.getElementById('run-report-body');
  if (reportBody) {
    // Use iframe to prevent CSS leak (same as openReportModal)
    reportBody.innerHTML = '';
    reportBody.style.background = '#fff';
    const iframe = document.createElement('iframe');
    iframe.srcdoc = _currentReportHtml;
    iframe.style.cssText = 'width:100%;border:none;background:#fff;border-radius:8px;min-height:400px;';
    iframe.addEventListener('load', () => {
      try {
        const h = iframe.contentDocument?.documentElement?.scrollHeight;
        if (h) iframe.style.height = h + 'px';
      } catch(_e) {}
    });
    reportBody.appendChild(iframe);
  }`,
  'Fix 3: Use iframe in _restoreReportView to prevent CSS leak'
);


// ═══════════════════════════════════════════════════════
// Fix 4: Update printReport to read from _currentReportHtml
// ═══════════════════════════════════════════════════════
// Print already uses window.open and writes _currentReportHtml,
// so it should be unaffected. Let's verify and ensure it works.
// (No change needed — printReport already uses _currentReportHtml)
console.log('\nFix 4: Verify printReport — no changes needed (already uses _currentReportHtml)');
{
  const runshowPath = path.join(ROOT, 'src/runshow/Runshow.js');
  if (fs.existsSync(runshowPath)) {
    const content = fs.readFileSync(runshowPath, 'utf-8');
    if (content.includes('w.document.write(_currentReportHtml)')) {
      console.log('  ✓ printReport already uses _currentReportHtml — no change needed');
      results.push({ label: 'Fix 4: printReport verification', status: 'VERIFIED' }); applied++;
    } else {
      console.log('  ⊘ Could not verify printReport — check manually');
      results.push({ label: 'Fix 4: printReport verification', status: 'UNVERIFIED' });
    }
  }
}


// ═══════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  SUMMARY                                             ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

if (DRY_RUN) console.log('  🔍 DRY RUN — no files modified\n');

console.log(`  Applied:  ${applied} / ${applied + failed}`);
console.log(`  Failed:   ${failed} / ${applied + failed}\n`);

results.forEach(r => {
  const icon = ['APPLIED', 'WOULD_APPLY', 'VERIFIED'].includes(r.status) ? '✓' : '✗';
  console.log(`  ${icon} ${r.label} → ${r.status}`);
});

console.log('\n─────────────────────────────────────────────');
console.log('  Root cause: The run report HTML is a full document');
console.log('  with <style> tags containing global selectors like');
console.log('  body { color: #1a1814 } and * { margin: 0 }.');
console.log('  When injected via innerHTML, these styles leak into');
console.log('  the page, making dark-theme text invisible.');
console.log('');
console.log('  The iframe sandbox completely isolates report styles.');
console.log('  Clearing on close is a safety net.');
console.log('─────────────────────────────────────────────\n');

process.exit(failed > 0 ? 1 : 0);
