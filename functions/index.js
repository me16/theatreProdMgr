const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const JOIN_RATE_LIMIT_MAX = 10;
const JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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
  const uid = request.auth.uid;
  const now = Date.now();

  // Rate limiting: max 10 join attempts per user per hour
  const rateLimitRef = db.collection('_joinRateLimits').doc(uid);
  const rlDoc = await rateLimitRef.get();
  if (rlDoc.exists) {
    const { count, windowStart } = rlDoc.data();
    if (now - windowStart < JOIN_RATE_LIMIT_WINDOW_MS) {
      if (count >= JOIN_RATE_LIMIT_MAX) {
        throw new HttpsError('resource-exhausted', 'Too many join attempts. Try again later.');
      }
      await rateLimitRef.update({ count: admin.firestore.FieldValue.increment(1) });
    } else {
      await rateLimitRef.set({ count: 1, windowStart: now });
    }
  } else {
    await rateLimitRef.set({ count: 1, windowStart: now });
  }

  const snap = await db.collection('productions')
    .where('joinCode', '==', code.toUpperCase())
    .where('joinCodeActive', '==', true)
    .get();

  if (snap.empty) {
    throw new HttpsError('not-found', 'Invalid or expired join code.');
  }

  const productionDoc = snap.docs[0];
  const productionId = productionDoc.id;
  const prod = productionDoc.data();

  // Check join code expiration
  if (prod.joinCodeExpiresAt) {
    const expiresAt = prod.joinCodeExpiresAt.toMillis ? prod.joinCodeExpiresAt.toMillis() : prod.joinCodeExpiresAt;
    if (expiresAt < now) {
      throw new HttpsError('not-found', 'Invalid or expired join code.');
    }
  }

  const memberRef = db.collection('productions').doc(productionId).collection('members').doc(uid);
  const existing = await memberRef.get();
  if (existing.exists) {
    return { alreadyMember: true, productionId, title: prod.title };
  }

  const userRecord = await admin.auth().getUser(uid);
  await memberRef.set({
    role: 'member',
    displayName: userRecord.displayName || userRecord.email,
    email: userRecord.email,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, productionId, title: prod.title };
});
