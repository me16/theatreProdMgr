#!/usr/bin/env node

/**
 * CUE Admin — Manage Superadmin Claims
 *
 * Usage:
 *   node manage-admins.js grant someone@example.com    — grants superadmin custom claim
 *   node manage-admins.js revoke someone@example.com   — revokes superadmin custom claim
 *   node manage-admins.js list                         — lists all superadmins
 *   node manage-admins.js create email@x.com password DisplayName — creates a new user account
 *
 * Requires: serviceAccountKey.json in this directory (gitignored).
 *
 * IMPORTANT: Any existing accounts that were granted `admin: true` via the old script need
 * to be re-granted with this script. The old `admin` claim is not recognized by the new app.
 * The claim name used by CUE is `superadmin`.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const args = process.argv.slice(2);
const command = args[0];

async function grantSuperAdmin(email) {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { superadmin: true });
  console.log(`✓ Granted superadmin to ${email} (uid: ${user.uid})`);
  console.log('  Note: user must sign out and sign back in for the claim to take effect.');
}

async function revokeSuperAdmin(email) {
  const user = await admin.auth().getUserByEmail(email);
  const currentClaims = (await admin.auth().getUser(user.uid)).customClaims || {};
  delete currentClaims.superadmin;
  await admin.auth().setCustomUserClaims(user.uid, currentClaims);
  console.log(`✓ Revoked superadmin from ${email} (uid: ${user.uid})`);
}

async function listSuperAdmins() {
  console.log('Superadmins:');
  let found = 0;
  let nextPageToken;
  do {
    const listResult = await admin.auth().listUsers(1000, nextPageToken);
    for (const user of listResult.users) {
      if (user.customClaims?.superadmin === true) {
        console.log(`  ${user.email} (uid: ${user.uid})`);
        found++;
      }
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);
  if (found === 0) console.log('  (none)');
  console.log(`Total: ${found}`);
}

async function createUser(email, password, displayName) {
  const user = await admin.auth().createUser({
    email,
    password,
    displayName: displayName || email,
    emailVerified: true,
  });
  console.log(`✓ Created user ${email} (uid: ${user.uid})`);
}

async function main() {
  try {
    switch (command) {
      case 'grant':
        if (!args[1]) { console.error('Usage: node manage-admins.js grant <email>'); process.exit(1); }
        await grantSuperAdmin(args[1]);
        break;
      case 'revoke':
        if (!args[1]) { console.error('Usage: node manage-admins.js revoke <email>'); process.exit(1); }
        await revokeSuperAdmin(args[1]);
        break;
      case 'list':
        await listSuperAdmins();
        break;
      case 'create':
        if (!args[1] || !args[2]) { console.error('Usage: node manage-admins.js create <email> <password> [DisplayName]'); process.exit(1); }
        await createUser(args[1], args[2], args.slice(3).join(' '));
        break;
      default:
        console.log(`CUE Admin — Manage Superadmins

Usage:
  node manage-admins.js grant <email>                      — grants superadmin custom claim
  node manage-admins.js revoke <email>                     — revokes superadmin custom claim
  node manage-admins.js list                               — lists all superadmins
  node manage-admins.js create <email> <password> [name]   — creates a new user account`);
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
