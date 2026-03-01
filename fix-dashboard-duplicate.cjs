const fs = require('fs');
const path = require('path');

const FILE = path.join(process.cwd(), 'src/dashboard/dashboard.js');
let src = fs.readFileSync(FILE, 'utf8');
let errors = 0;

function patch(desc, search, replace) {
  if (!src.includes(search)) { console.error(`  ✗ FAILED [${desc}]`); errors++; return; }
  if (src.includes(replace))  { console.log(`  ⟳ Already applied [${desc}]`); return; }
  src = src.replace(search, replace);
  console.log(`  ✓ ${desc}`);
}

// 1. Add guard variable after the grid const
patch(
  'Add _loadingProductions guard variable',
  "const dashView = document.getElementById('dashboard-view');\nconst grid = document.getElementById('productions-grid');",
  "const dashView = document.getElementById('dashboard-view');\nconst grid = document.getElementById('productions-grid');\nlet _loadingProductions = false; // prevents concurrent duplicate loads"
);

// 2. Wrap loadProductions body with guard
patch(
  'Guard loadProductions against concurrent calls',
  "async function loadProductions() {\n  grid.innerHTML = '';\n  const uid = state.currentUser.uid;",
  "async function loadProductions() {\n  if (_loadingProductions) return;\n  _loadingProductions = true;\n  grid.innerHTML = '';\n  const uid = state.currentUser.uid;"
);

// 3. Clear guard in the catch block (end of loadProductions)
patch(
  'Clear guard on error',
  "    grid.innerHTML = '<div class=\"empty-state\">Could not load productions. Check the browser console for details.</div>';\n  }\n}",
  "    grid.innerHTML = '<div class=\"empty-state\">Could not load productions. Check the browser console for details.</div>';\n  } finally {\n    _loadingProductions = false;\n  }\n}"
);

// 4. Also need to clear it on success — find the success return path
// The success path ends with the "if grid empty" check
patch(
  'Clear guard on success',
  "  if (grid.children.length === 0) {\n    grid.innerHTML = '<div class=\"empty-state\">No productions yet. Create one or join with a code.</div>';\n  }\n}",
  "  if (grid.children.length === 0) {\n    grid.innerHTML = '<div class=\"empty-state\">No productions yet. Create one or join with a code.</div>';\n  }\n  _loadingProductions = false;\n}"
);

fs.writeFileSync(FILE, src, 'utf8');
console.log(errors === 0 ? '\n✅ Done — reload the dev server to test.' : `\n❌ ${errors} patch(es) failed.`);
if (errors) process.exit(1);
