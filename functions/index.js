const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

exports.joinProduction = onCall(async (request) => {
  // v2: auth is at request.auth, not context.auth
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }

  const { code } = request.data;
  if (!code || typeof code !== 'string') {
    throw new HttpsError('invalid-argument', 'Code required.');
  }

  const db = admin.firestore();
  const snap = await db.collection('productions')
    .where('joinCode', '==', code.toUpperCase())
    .where('joinCodeActive', '==', true)
    .get();

  if (snap.empty) {
    throw new HttpsError('not-found', 'Invalid or expired join code.');
  }

  const productionDoc = snap.docs[0];
  const productionId = productionDoc.id;
  const uid = request.auth.uid;

  const memberRef = db.collection('productions').doc(productionId).collection('members').doc(uid);
  const existing = await memberRef.get();
  if (existing.exists) {
    return { alreadyMember: true, productionId, title: productionDoc.data().title };
  }

  const userRecord = await admin.auth().getUser(uid);
  await memberRef.set({
    role: 'member',
    displayName: userRecord.displayName || userRecord.email,
    email: userRecord.email,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, productionId, title: productionDoc.data().title };
});