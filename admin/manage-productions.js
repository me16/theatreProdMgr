#!/usr/bin/env node

/**
 * CUE Admin — Manage Productions
 *
 * Usage:
 *   node manage-productions.js list                           — list all productions
 *   node manage-productions.js members <productionId>         — list members of a production
 *   node manage-productions.js promote <productionId> <email> — promote to owner
 *   node manage-productions.js demote <productionId> <email>  — demote to member
 *   node manage-productions.js remove <productionId> <email>  — remove from production
 *   node manage-productions.js delete <productionId>          — delete production + all subcollections
 *   node manage-productions.js migrate                        — one-time migration (see below)
 *
 * Requires: serviceAccountKey.json in this directory (gitignored).
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const args = process.argv.slice(2);
const command = args[0];

async function listProductions() {
  const snap = await db.collection('productions').get();
  if (snap.empty) { console.log('No productions found.'); return; }
  console.log('Productions:');
  for (const doc of snap.docs) {
    const d = doc.data();
    const membersSnap = await db.collection('productions').doc(doc.id).collection('members').get();
    console.log(`  [${doc.id}] "${d.title}" — ${membersSnap.size} members, code: ${d.joinCode || 'N/A'} (${d.joinCodeActive ? 'active' : 'inactive'})`);
  }
}

async function listMembers(productionId) {
  const snap = await db.collection('productions').doc(productionId).collection('members').get();
  if (snap.empty) { console.log('No members found.'); return; }
  console.log(`Members of ${productionId}:`);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(`  [${doc.id}] ${d.email || '?'} — ${d.role}`);
  }
}

async function promoteToOwner(productionId, email) {
  const user = await admin.auth().getUserByEmail(email);
  const memberRef = db.collection('productions').doc(productionId).collection('members').doc(user.uid);
  const snap = await memberRef.get();
  if (!snap.exists) { console.error('User is not a member of this production.'); process.exit(1); }
  await memberRef.update({ role: 'owner' });
  console.log(`✓ Promoted ${email} to owner in ${productionId}`);
}

async function demoteToMember(productionId, email) {
  const user = await admin.auth().getUserByEmail(email);
  const memberRef = db.collection('productions').doc(productionId).collection('members').doc(user.uid);
  const snap = await memberRef.get();
  if (!snap.exists) { console.error('User is not a member of this production.'); process.exit(1); }
  await memberRef.update({ role: 'member' });
  console.log(`✓ Demoted ${email} to member in ${productionId}`);
}

async function removeMember(productionId, email) {
  const user = await admin.auth().getUserByEmail(email);
  await db.collection('productions').doc(productionId).collection('members').doc(user.uid).delete();
  console.log(`✓ Removed ${email} from ${productionId}`);
}

async function deleteProduction(productionId) {
  const subcollections = ['members', 'props', 'propNotes', 'zones', 'lineNotes'];
  for (const sub of subcollections) {
    const snap = await db.collection('productions').doc(productionId).collection(sub).get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    if (snap.size > 0) await batch.commit();
    console.log(`  Deleted ${snap.size} docs from ${sub}`);
  }
  await db.collection('productions').doc(productionId).delete();
  console.log(`✓ Deleted production ${productionId}`);
}

/**
 * Migration: reads all docs from root /props and /propNotes collections
 * and writes them into a new production.
 *
 * UPDATE THESE CONSTANTS before running:
 */
async function migrateExistingData() {
  // ====== UPDATE THESE ======
  const OWNER_EMAIL = 'your-email@example.com';  // Email of the user who will own the migrated production
  const PRODUCTION_TITLE = 'Original Production';
  // ==========================

  console.log('Starting migration...');
  console.log(`  Owner: ${OWNER_EMAIL}`);
  console.log(`  Title: ${PRODUCTION_TITLE}`);

  // Get owner UID
  let ownerUid;
  try {
    const userRecord = await admin.auth().getUserByEmail(OWNER_EMAIL);
    ownerUid = userRecord.uid;
  } catch (e) {
    console.error(`Could not find user with email ${OWNER_EMAIL}. Create the account first.`);
    process.exit(1);
  }

  // Generate join code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let joinCode = '';
  for (let i = 0; i < 7; i++) joinCode += chars[Math.floor(Math.random() * chars.length)];

  // Create production
  const prodRef = await db.collection('productions').add({
    title: PRODUCTION_TITLE,
    createdBy: ownerUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    joinCode,
    joinCodeActive: true,
    scriptPath: null,
    scriptPageCount: null,
  });
  const productionId = prodRef.id;
  console.log(`  Created production: ${productionId}`);

  // Add owner as member
  await db.collection('productions').doc(productionId).collection('members').doc(ownerUid).set({
    role: 'owner',
    displayName: OWNER_EMAIL,
    email: OWNER_EMAIL,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('  Added owner as member');

  // Migrate props from root /props
  let propsCount = 0;
  try {
    const propsSnap = await db.collection('props').get();
    for (const propDoc of propsSnap.docs) {
      const data = propDoc.data();
      await db.collection('productions').doc(productionId).collection('props').doc(propDoc.id).set(data);
      propsCount++;
    }
    console.log(`  Migrated ${propsCount} props`);
  } catch (e) {
    console.log('  No root /props collection found or error:', e.message);
  }

  // Migrate propNotes from root /propNotes
  let notesCount = 0;
  try {
    const notesSnap = await db.collection('propNotes').get();
    for (const noteDoc of notesSnap.docs) {
      const data = noteDoc.data();
      await db.collection('productions').doc(productionId).collection('propNotes').doc(noteDoc.id).set(data);
      notesCount++;
    }
    console.log(`  Migrated ${notesCount} propNotes`);
  } catch (e) {
    console.log('  No root /propNotes collection found or error:', e.message);
  }

  console.log('');
  console.log('✓ Migration complete!');
  console.log(`  Production ID: ${productionId}`);
  console.log(`  Join Code: ${joinCode}`);
  console.log('');
  console.log('  The original root /props and /propNotes collections were NOT deleted.');
  console.log('  Verify the migration, then delete them manually if desired.');
}

async function main() {
  try {
    switch (command) {
      case 'list':
        await listProductions();
        break;
      case 'members':
        if (!args[1]) { console.error('Usage: node manage-productions.js members <productionId>'); process.exit(1); }
        await listMembers(args[1]);
        break;
      case 'promote':
        if (!args[1] || !args[2]) { console.error('Usage: node manage-productions.js promote <productionId> <email>'); process.exit(1); }
        await promoteToOwner(args[1], args[2]);
        break;
      case 'demote':
        if (!args[1] || !args[2]) { console.error('Usage: node manage-productions.js demote <productionId> <email>'); process.exit(1); }
        await demoteToMember(args[1], args[2]);
        break;
      case 'remove':
        if (!args[1] || !args[2]) { console.error('Usage: node manage-productions.js remove <productionId> <email>'); process.exit(1); }
        await removeMember(args[1], args[2]);
        break;
      case 'delete':
        if (!args[1]) { console.error('Usage: node manage-productions.js delete <productionId>'); process.exit(1); }
        await deleteProduction(args[1]);
        break;
      case 'migrate':
        await migrateExistingData();
        break;
      default:
        console.log(`CUE Admin — Manage Productions

Usage:
  node manage-productions.js list                           — list all productions
  node manage-productions.js members <productionId>         — list members of a production
  node manage-productions.js promote <productionId> <email> — promote to owner
  node manage-productions.js demote <productionId> <email>  — demote to member
  node manage-productions.js remove <productionId> <email>  — remove from production
  node manage-productions.js delete <productionId>          — delete production + all subcollections
  node manage-productions.js migrate                        — one-time migration (see below)`);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
  // Clean up Firebase connection so Node can exit
  await admin.app().delete();
  process.exit(0);
}

await main();

// ============================================================
// CLOUD FUNCTION: joinProduction
// Deploy this to Firebase Functions (functions/index.js)
// Run: firebase deploy --only functions
// ============================================================
//
// const functions = require('firebase-functions');
// const admin = require('firebase-admin');
// admin.initializeApp();
//
// exports.joinProduction = functions.https.onCall(async (data, context) => {
//   if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
//   const { code } = data;
//   if (!code || typeof code !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Code required.');
//
//   const db = admin.firestore();
//   // NOTE: This query requires a composite index on (joinCode, joinCodeActive).
//   // It will be auto-created when the query first runs in development.
//   const snap = await db.collection('productions')
//     .where('joinCode', '==', code.toUpperCase())
//     .where('joinCodeActive', '==', true)
//     .get();
//
//   if (snap.empty) throw new functions.https.HttpsError('not-found', 'Invalid or expired join code.');
//
//   const productionDoc = snap.docs[0];
//   const productionId = productionDoc.id;
//   const uid = context.auth.uid;
//
//   const memberRef = db.collection('productions').doc(productionId).collection('members').doc(uid);
//   const existing = await memberRef.get();
//   if (existing.exists) return { alreadyMember: true, productionId, title: productionDoc.data().title };
//
//   const userRecord = await admin.auth().getUser(uid);
//   await memberRef.set({
//     role: 'member',
//     displayName: userRecord.displayName || userRecord.email,
//     email: userRecord.email,
//     addedAt: admin.firestore.FieldValue.serverTimestamp(),
//   });
//
//   return { success: true, productionId, title: productionDoc.data().title };
// });
// ============================================================
