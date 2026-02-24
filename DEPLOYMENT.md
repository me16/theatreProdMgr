# CUE — Complete Setup Guide (macOS, from scratch)

This guide assumes you're starting fresh: no Firebase project yet, just the CUE source code on your Mac. We'll create everything from zero.

---

## Part A: Install Tools

### A1. Check for Node.js

Open **Terminal** (press **⌘ Space**, type `Terminal`, hit Enter).

```bash
node --version
```

If you see `v18.x.x` or higher, you're good. If you get "command not found" or a version below 18, install it:

**Option 1 — Homebrew** (if you have Homebrew):
```bash
brew install node
```

**Option 2 — Installer**: Go to [nodejs.org](https://nodejs.org), download the macOS installer, double-click it, follow the prompts.

After installing, close and reopen Terminal, then verify:
```bash
node --version
npm --version
```

Both should print version numbers.

### A2. Install Firebase CLI

```bash
npm install -g firebase-tools
```

Verify:
```bash
firebase --version
```

Should print something like `13.x.x`.

---

## Part B: Create a Firebase Project

### B1. Go to Firebase Console

1. Open your browser and go to **[console.firebase.google.com](https://console.firebase.google.com)**
2. Sign in with your Google account (or create one)
3. Click **Create a project** (or "Add project")

### B2. Name your project

1. Enter a project name — something like `cue-stage-mgr` (this becomes your **Project ID** and shows in your app's URL, so keep it short and clean)
2. Firebase may suggest a modified Project ID below the name field — note what it says, you'll need it later
3. Click **Continue**

### B3. Google Analytics

1. You can toggle Google Analytics **off** — CUE doesn't use it
2. Click **Create project**
3. Wait 30 seconds or so while Firebase provisions everything
4. Click **Continue** when it's done

You're now in your new project's dashboard.

### B4. Enable Authentication

1. In the left sidebar, click **Build** → **Authentication**
2. Click **Get started**
3. Under "Sign-in method", click **Email/Password**
4. Toggle the first switch **Enable** to on (leave "Email link" off)
5. Click **Save**

### B5. Enable Firestore

1. In the left sidebar, click **Build** → **Firestore Database**
2. Click **Create database**
3. Choose a location (pick whatever is closest to your users — `us-east1` or `nam5` are fine for US-based)
4. Select **Start in test mode** (we'll deploy proper security rules shortly)
5. Click **Create**

### B6. Enable Storage

1. In the left sidebar, click **Build** → **Storage**
2. Click **Get started**
3. It may ask about security rules — accept the defaults for now
4. Click **Done**

### B7. Register a Web App

1. On the project's main page (click the house icon 🏠 at top-left), look for **"Add an app"** or the `</>` icon (Web)
2. Click the **</>** (web) icon
3. Enter a nickname: `CUE Web`
4. **Don't** check "Also set up Firebase Hosting" — we'll do that from the command line
5. Click **Register app**
6. You'll see a code block with your `firebaseConfig`. **Don't close this page yet.** It has all the values you need:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

Keep this browser tab open — you'll paste these values in Step 2 below.

7. Click **Continue to console**

### B8. Enable Hosting

1. In the left sidebar, click **Build** → **Hosting**
2. Click **Get started**
3. It will show instructions for the Firebase CLI — you don't need to follow them yet, just click through until it says you're done

### B9. Upgrade to Blaze Plan (required for Cloud Functions)

The "Join with Code" feature uses a Cloud Function, which requires the pay-as-you-go Blaze plan. With CUE's light usage, you will almost certainly stay within the free tier and pay nothing.

1. In the bottom-left of the Firebase Console, you'll see **Spark** (your current plan)
2. Click it, then click **Upgrade**
3. Select **Blaze (pay as you go)**
4. Follow the prompts to add a billing account (a credit card is required but won't be charged for free-tier usage)

---

## Part C: Set Up CUE Locally

### Step 1: Unzip and Install

In Terminal, navigate to wherever you downloaded the zip:

```bash
cd ~/Desktop
unzip cue-stage-manager.zip -d cue-stage-manager
cd cue-stage-manager
```

Install dependencies:

```bash
npm install
```

Install admin script dependencies:

```bash
cd admin
npm install
cd ..
```

### Step 2: Configure Environment

CUE needs your Firebase config to know which project to connect to. These values go in a `.env` file that stays on your machine and never gets committed to Git.

#### 2a. Create the .env file

```bash
cp .env.example .env
```

#### 2b. Open it in TextEdit

```bash
open -e .env
```

You'll see:

```
VITE_API_KEY=your-api-key-here
VITE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_PROJECT_ID=your-project-id
VITE_STORAGE_BUCKET=your-project-id.firebasestorage.app
VITE_MESSAGING_SENDER_ID=000000000000
VITE_APP_ID=1:000000000000:web:xxxxxxxxxx
```

#### 2c. Fill in the values

Go back to the browser tab from step B7 where Firebase showed you the `firebaseConfig`. Copy each value (without quotes) and paste it into the corresponding line:

| .env variable | Firebase config field |
|---|---|
| `VITE_API_KEY` | `apiKey` |
| `VITE_AUTH_DOMAIN` | `authDomain` |
| `VITE_PROJECT_ID` | `projectId` |
| `VITE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_APP_ID` | `appId` |

When done, your `.env` should look something like (with your real values):

```
VITE_API_KEY=AIzaSyBx7m3kE9Rp_exampleKey
VITE_AUTH_DOMAIN=cue-stage-mgr.firebaseapp.com
VITE_PROJECT_ID=cue-stage-mgr
VITE_STORAGE_BUCKET=cue-stage-mgr.firebasestorage.app
VITE_MESSAGING_SENDER_ID=570540287252
VITE_APP_ID=1:570540287252:web:cb731e19ff7ce6cc
```

**No spaces** around the `=` signs. **No quotes** around the values.

Save (**⌘S**) and close (**⌘W**).

#### 2d. Verify

```bash
cat .env
```

Should print your six config lines.

> **Lost the config values?** Go to Firebase Console → gear icon (⚙) → **Project settings** → **General** tab → scroll to "Your apps" → your web app card shows the config.

### Step 3: Download Service Account Key

The admin scripts (for creating users, managing superadmins) need a private key to talk to Firebase as an administrator.

1. In Firebase Console, click the **gear icon** (⚙) → **Project settings**
2. Click the **Service accounts** tab
3. Make sure **Firebase Admin SDK** is selected and language is **Node.js**
4. Click **Generate new private key** → **Generate key**
5. A `.json` file downloads (something like `cue-stage-mgr-firebase-adminsdk-xxxxx.json`)

Move it into your project's `admin/` folder and rename it:

```bash
mv ~/Downloads/cue-stage-mgr-*.json admin/serviceAccountKey.json
```

(Adjust the filename if yours looks different — the key part is it ends up as `admin/serviceAccountKey.json`.)

### Step 4: Log in to Firebase CLI

```bash
firebase login
```

A browser tab opens. Sign in with the same Google account you used to create the project.

Then tell the CLI which project to use. Replace `cue-stage-mgr` with **your actual Project ID**:

```bash
firebase use cue-stage-mgr
```

You should see: `Now using project cue-stage-mgr`.

### Step 5: Create Your User Account

CUE doesn't have a "Sign Up" button — accounts are created by admins. Let's create yours.

```bash
cd admin
node manage-admins.js create your@email.com YourPassword "Your Name"
```

Replace `your@email.com` with your real email, `YourPassword` with whatever password you want, and `"Your Name"` with your actual name in quotes.

You should see: `✓ Created user your@email.com (uid: ...)`.

Now grant yourself superadmin access:

```bash
node manage-admins.js grant your@email.com
```

You should see: `✓ Granted superadmin to your@email.com`.

Go back to the project root:

```bash
cd ..
```

### Step 6: Deploy Security Rules

```bash
firebase deploy --only firestore:rules,storage
```

This uploads `firestore.rules` and `storage.rules` to your project, which control who can read/write what data.

### Step 7: Deploy the Cloud Function

The "Join with Code" feature needs a serverless function running on Firebase.

```bash
mkdir -p functions
cd functions
npm init -y
npm install firebase-functions firebase-admin
```

Now create the function file:

```bash
cat > index.js << 'EOF'
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.joinProduction = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  const { code } = data;
  if (!code || typeof code !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Code required.');

  const db = admin.firestore();
  const snap = await db.collection('productions')
    .where('joinCode', '==', code.toUpperCase())
    .where('joinCodeActive', '==', true)
    .get();

  if (snap.empty) throw new functions.https.HttpsError('not-found', 'Invalid or expired join code.');

  const productionDoc = snap.docs[0];
  const productionId = productionDoc.id;
  const uid = context.auth.uid;

  const memberRef = db.collection('productions').doc(productionId).collection('members').doc(uid);
  const existing = await memberRef.get();
  if (existing.exists) return { alreadyMember: true, productionId, title: productionDoc.data().title };

  const userRecord = await admin.auth().getUser(uid);
  await memberRef.set({
    role: 'member',
    displayName: userRecord.displayName || userRecord.email,
    email: userRecord.email,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, productionId, title: productionDoc.data().title };
});
EOF
```

Go back to the project root and deploy:

```bash
cd ..
firebase deploy --only functions
```

This may take a minute. If it asks about the Blaze plan, make sure you completed step B9 above.

### Step 8: Create the Firestore Index

CUE's dashboard queries across all productions to find the ones you belong to. This requires an index.

**Easiest way:** Just skip this step for now. When you first log into the app, open the browser's developer console (**⌘ Option J** in Chrome) and you'll see an error with a direct link to create the needed index. Click it, confirm, and wait a few minutes for it to build.

**Manual way** (if you'd rather do it now):

1. Firebase Console → **Firestore Database** → **Indexes** tab
2. Click **Create index**
3. Collection group: `members`
4. Field: `email` — Ascending
5. Click **Create**

### Step 9: Build and Deploy

```bash
npm run build
firebase deploy --only hosting
```

When it finishes, it prints your live URL:

```
✔ Hosting URL: https://cue-stage-mgr.web.app
```

Open that URL in your browser. You should see the CUE login screen. Sign in with the email and password you created in Step 5.

---

## Part D: After Deployment

### Creating accounts for your team

CUE has no self-registration. You have two options for adding people:

**Option 1 — Admin script** (you create their account):
```bash
cd admin
node manage-admins.js create teammate@email.com TheirPassword "Their Name"
cd ..
```

**Option 2 — Join Code** (they already have an account): Create a production in the app, share the 7-character join code with them, and they enter it on the dashboard.

### Migrating from the old Props Tracker

If you had data in the old `props-tracker-app` project (root-level `/props` and `/propNotes` collections), you can migrate it. Open `admin/manage-productions.js`, find the `migrateExistingData()` function near line 130, and update:

```javascript
const OWNER_EMAIL = 'your@email.com';
const PRODUCTION_TITLE = 'Original Production';
```

Then run:
```bash
cd admin
node manage-productions.js migrate
cd ..
```

Note: the admin scripts need a `serviceAccountKey.json` for whichever project contains the data — if migrating from the old project, you'd temporarily swap in that project's key.

### Redeploying after changes

```bash
npm run build
firebase deploy --only hosting
```

Or deploy everything at once:
```bash
npm run build
firebase deploy
```

### Local development

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000) with hot reload.

---

## Admin Command Reference

Run all commands from the project root.

```bash
# User accounts
node admin/manage-admins.js create email password "Name"
node admin/manage-admins.js grant email          # make superadmin
node admin/manage-admins.js revoke email         # remove superadmin
node admin/manage-admins.js list                 # list all superadmins

# Productions
node admin/manage-productions.js list
node admin/manage-productions.js members PRODUCTION_ID
node admin/manage-productions.js promote PRODUCTION_ID email
node admin/manage-productions.js demote PRODUCTION_ID email
node admin/manage-productions.js remove PRODUCTION_ID email
node admin/manage-productions.js delete PRODUCTION_ID
```

---

## Troubleshooting

**Login screen shows but sign-in fails silently**
Check the browser console (**⌘ Option J**). If you see a Firebase error about the API key, your `.env` values are wrong. Fix them, then `npm run build` and `firebase deploy --only hosting` again.

**"Missing or insufficient permissions"**
Run `firebase deploy --only firestore:rules,storage` — you may not have deployed the security rules yet.

**Dashboard is empty after creating a production**
The Firestore index hasn't been created yet. Check the browser console for the link. See Step 8.

**"Join with Code" gives an error**
The Cloud Function isn't deployed. Run `firebase deploy --only functions`. Also make sure you're on the Blaze plan.

**Admin script hangs (cursor just blinks)**
Hit **Ctrl+C** and make sure you're using the latest `manage-admins.js` / `manage-productions.js`.

**Script doesn't load in Line Notes**
Make sure the PDF was uploaded in Production Settings. It must be a real PDF under 100 MB.
