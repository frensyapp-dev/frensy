const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();
const vision = require('@google-cloud/vision');
const visionClient = new vision.ImageAnnotatorClient();

function logInfo(msg, data) { functions.logger.info(msg, data || {}); }
function logError(msg, data) { functions.logger.error(msg, data || {}); }

async function isBlockedBetween(uidA, uidB) {
  try {
    const aDoc = await db.doc(`blocks/${uidA}/users/${uidB}`).get();
    if (aDoc.exists) return true;
    const bDoc = await db.doc(`blocks/${uidB}/users/${uidA}`).get();
    return bDoc.exists;
  } catch (e) {
    logError('isBlockedBetween error', { uidA, uidB, e });
    return false;
  }
}

async function userExists(uid) {
  try {
    const snap = await db.doc(`users/${uid}`).get();
    return snap.exists;
  } catch (e) {
    logError("userExists error", { uid, e });
    return false;
  }
}

async function deleteSubcollection(path) {
  const colRef = db.collection(path);
  const docs = await colRef.listDocuments();
  if (!docs.length) return 0;
  const batch = db.batch();
  for (const d of docs) batch.delete(d);
  await batch.commit();
  return docs.length;
}

async function cleanupMatchByChatId(chatId) {
  let deletedMatch = false;
  let deletedMessages = 0;
  let deletedStatus = 0;
  try {
    const matchRef = db.doc(`matches/${chatId}`);
    const matchSnap = await matchRef.get();
    if (matchSnap.exists) {
      await matchRef.delete();
      deletedMatch = true;
    }
  } catch (e) { logError("Failed deleting match", { chatId, e }); }

  try {
    deletedMessages = await deleteSubcollection(`messages/${chatId}/items`);
    await db.doc(`messages/${chatId}`).delete().catch(()=>{});
  } catch (e) { logError("Failed deleting messages", { chatId, e }); }

  try {
    deletedStatus = await deleteSubcollection(`chatStatus/${chatId}/users`);
    await db.doc(`chatStatus/${chatId}`).delete().catch(()=>{});
  } catch (e) { logError("Failed deleting chatStatus", { chatId, e }); }

  return { deletedMatch, deletedMessages, deletedStatus };
}

async function cleanupOrphansImpl() {
  let matchesChecked = 0;
  let matchesRemoved = 0;
  let convsRemoved = 0;

  const matches = await db.collection("matches").listDocuments();
  for (const m of matches) {
    const snap = await m.get();
    matchesChecked++;
    const data = snap.data() || {};
    const users = Array.isArray(data.users) ? data.users : [];
    if (users.length !== 2) {
      const res = await cleanupMatchByChatId(m.id);
      matchesRemoved += res.deletedMatch ? 1 : 0;
      convsRemoved += res.deletedMessages + res.deletedStatus;
      continue;
    }
    const [u1, u2] = users;
    const exists1 = await userExists(u1);
    const exists2 = await userExists(u2);
    if (!exists1 || !exists2) {
      const res = await cleanupMatchByChatId(m.id);
      matchesRemoved += res.deletedMatch ? 1 : 0;
      convsRemoved += res.deletedMessages + res.deletedStatus;
    }
  }

  const convRoots = await db.collection("messages").listDocuments();
  for (const c of convRoots) {
    const chatId = c.id;
    const parts = chatId.split("_");
    if (parts.length !== 2) {
      const res = await cleanupMatchByChatId(chatId);
      convsRemoved += res.deletedMessages + res.deletedStatus;
      continue;
    }
    const [uidA, uidB] = parts;
    const existsA = await userExists(uidA);
    const existsB = await userExists(uidB);
    if (!existsA || !existsB) {
      const res = await cleanupMatchByChatId(chatId);
      convsRemoved += res.deletedMessages + res.deletedStatus;
    }
  }

  const statusRoots = await db.collection("chatStatus").listDocuments();
  for (const s of statusRoots) {
    const chatId = s.id;
    const parts = chatId.split("_");
    if (parts.length !== 2) {
      const res = await cleanupMatchByChatId(chatId);
      convsRemoved += res.deletedStatus;
      continue;
    }
    const [uidA, uidB] = parts;
    const existsA = await userExists(uidA);
    const existsB = await userExists(uidB);
    if (!existsA || !existsB) {
      const res = await cleanupMatchByChatId(chatId);
      convsRemoved += res.deletedStatus;
    }
  }

  return { matchesChecked, matchesRemoved, convsRemoved };
}

exports.cleanupOrphans = functions.https.onCall(async (_data, context) => {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentification requise");
  }
  try {
    const res = await cleanupOrphansImpl();
    logInfo("cleanupOrphans done", res);
    return res;
  } catch (e) {
    logError("cleanupOrphans failed", e);
    throw new functions.https.HttpsError("internal", "Echec du nettoyage");
  }
});

// Tâche planifiée quotidienne pour nettoyage préventif
exports.cleanupOrphansScheduled = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  try {
    const res = await cleanupOrphansImpl();
    logInfo("cleanupOrphansScheduled done", res);
  } catch (e) {
    logError("cleanupOrphansScheduled failed", e);
  }
});

// Nettoyage immédiat lors de suppression de compte
exports.authCleanupOnDelete = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;
  logInfo("authCleanupOnDelete triggered", { uid });
  try {
    const matchQuery = await db.collection("matches").where("users", "array-contains", uid).get();
    for (const docSnap of matchQuery.docs) {
      const chatId = docSnap.id;
      const res = await cleanupMatchByChatId(chatId);
      logInfo("Deleted match & convs for", { chatId, res });
    }

    const convRoots = await db.collection("messages").listDocuments();
    for (const c of convRoots) {
      if (c.id.includes(uid)) {
        const res = await cleanupMatchByChatId(c.id);
        logInfo("Deleted messages for", { chatId: c.id, res });
      }
    }

    const statusRoots = await db.collection("chatStatus").listDocuments();
    for (const s of statusRoots) {
      if (s.id.includes(uid)) {
        const res = await cleanupMatchByChatId(s.id);
        logInfo("Deleted chatStatus for", { chatId: s.id, res });
      }
    }
  } catch (e) {
    logError("authCleanupOnDelete failed", { uid, e });
  }
});

// Endpoint HTTP pour exécution immédiate avec clé secrète (temporaire)
const CLEANUP_KEY = process.env.CLEANUP_KEY || "temp-cleanup-key";
exports.cleanupOrphansHttp = functions.https.onRequest(async (req, res) => {
  const key = (req.query && req.query.key) || (req.body && req.body.key);
  if (key !== CLEANUP_KEY) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  try {
    const result = await cleanupOrphansImpl();
    logInfo("cleanupOrphansHttp done", result);
    res.json({ ok: true, result });
  } catch (e) {
    logError("cleanupOrphansHttp failed", e);
    res.status(500).json({ ok: false });
  }
});

// Recrée les collections principales avec des documents placeholder
exports.recreateCollections = functions.https.onCall(async (_data, context) => {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentification requise");
  }
  const collections = ["users", "positions", "likes"];
  const results = {};
  for (const col of collections) {
    try {
      const ref = db.doc(`${col}/__placeholder`);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          type: "placeholder",
          info: `placeholder pour recréer la collection ${col}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results[col] = "created";
      } else {
        results[col] = "exists";
      }
    } catch (e) {
      logError("recreateCollections error", { col, e });
      results[col] = "error";
    }
  }
  return { results };
});

exports.helloWorld = functions.https.onCall((_data, _context) => {
  logInfo("Hello logs!", { structuredData: true });
  return { message: "Hello from Firebase!" };
});

// Envoi d'une notification push à la création d'un message
exports.sendPushOnNewMessage = functions.firestore
  .document('matches/{matchId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      const matchId = context.params.matchId;
      const senderId = data.senderId;
      if (!matchId || !senderId) {
        functions.logger.warn('sendPushOnNewMessage missing fields', { matchId, senderId });
        return;
      }

      const matchSnap = await db.doc(`matches/${matchId}`).get();
      const users = Array.isArray(matchSnap.data() && matchSnap.data().users) ? matchSnap.data().users : [];
      const recipientId = users.find((u) => u !== senderId);
      if (!recipientId) {
        functions.logger.warn('sendPushOnNewMessage recipient not found', { matchId, users, senderId });
        return;
      }

      // Skip push if blocked
      if (await isBlockedBetween(senderId, recipientId)) {
        functions.logger.info('sendPushOnNewMessage skip: blocked', { senderId, recipientId, matchId });
        return;
      }

      const userSnap = await db.doc(`users/${recipientId}`).get();
      const token = (userSnap.data() && userSnap.data().expoPushToken) || null;
      const prefs = (userSnap.data() && userSnap.data().notifications) || {};
      const allow = prefs && prefs.newMessage !== false;
      if (!token || !allow) {
        functions.logger.info('sendPushOnNewMessage skip (no token or disabled)', { recipientId, hasToken: !!token, allow });
        return;
      }

      const text = (data.text || '').trim();
      const body = text.length > 0 ? text : (data.imageUrl ? 'Vous avez reçu une image' : 'Nouveau message');
      const payload = {
        to: token,
        sound: 'default',
        title: 'Nouveau message',
        body,
        data: { type: 'chat', chatId: matchId, senderId },
      };

      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let json = {};
      try { json = await res.json(); } catch {}
      functions.logger.info('sendPushOnNewMessage sent', { recipientId, matchId, status: res.status, json });
    } catch (e) {
      functions.logger.error('sendPushOnNewMessage failed', e);
    }
  });

// Envoi d'une notification push à la création d'un match
exports.sendPushOnNewMatch = functions.firestore
  .document('matches/{matchId}')
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      const matchId = context.params.matchId;
      const users = Array.isArray(data.users) ? data.users : [];
      if (users.length !== 2) {
        functions.logger.warn('sendPushOnNewMatch invalid users', { matchId, users });
        return;
      }
      for (const recipientId of users) {
        const userSnap = await db.doc(`users/${recipientId}`).get();
        const token = (userSnap.data() && userSnap.data().expoPushToken) || null;
        const prefs = (userSnap.data() && userSnap.data().notifications) || {};
        const allow = prefs && prefs.matches !== false;
        if (!token || !allow) {
          functions.logger.info('sendPushOnNewMatch skip', { recipientId, hasToken: !!token, allow });
          continue;
        }
        const otherId = users.find((u) => u !== recipientId);
        if (otherId && await isBlockedBetween(recipientId, otherId)) {
          functions.logger.info('sendPushOnNewMatch skip: blocked', { recipientId, otherId, matchId });
          continue;
        }
        const payload = {
          to: token,
          sound: 'default',
          title: 'Nouveau match 🎉',
          body: 'Vous avez un nouveau match !',
          data: { type: 'match', chatId: matchId, partnerUid: otherId },
        };
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        let json = {}; try { json = await res.json(); } catch {}
        functions.logger.info('sendPushOnNewMatch sent', { recipientId, matchId, status: res.status, json });
      }
    } catch (e) {
      functions.logger.error('sendPushOnNewMatch failed', e);
    }
  });

// Envoi push lorsqu'une invitation de chat est reçue
exports.sendPushOnChatInvitation = functions.firestore
  .document('chatRequests/{requestId}')
  .onCreate(async (snap) => {
    try {
      const data = snap.data() || {};
      const to = data.to;
      const from = data.from;
      if (!to || !from) return;
      if (await isBlockedBetween(from, to)) {
        functions.logger.info('sendPushOnChatInvitation skip: blocked', { from, to });
        return;
      }
      const userSnap = await db.doc(`users/${to}`).get();
      const token = (userSnap.data() && userSnap.data().expoPushToken) || null;
      const prefs = (userSnap.data() && userSnap.data().notifications) || {};
      const allow = prefs && prefs.invitations !== false; // dedicated invitations pref
      if (!token || !allow) return;
      const body = (data.messageText && String(data.messageText).trim().length > 0)
        ? String(data.messageText).trim()
        : 'Vous avez reçu une invitation à discuter';
      const payload = {
        to: token,
        sound: 'default',
        title: 'Nouvelle invitation 💬',
        body,
        data: { type: 'invitation', fromUid: from },
      };
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      let json = {}; try { json = await res.json(); } catch {}
      functions.logger.info('sendPushOnChatInvitation sent', { to, status: res.status, json });
    } catch (e) {
      functions.logger.error('sendPushOnChatInvitation failed', e);
    }
  });

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Envoi périodique du nombre de personnes autour
exports.notifyNearbyPeopleSnapshot = functions.pubsub.schedule('every 30 minutes').onRun(async () => {
  try {
    const now = Date.now();
    const MAX_RECENCY_MS = 10 * 60 * 1000;
    const RADIUS_KM = 2.0;
    const posDocs = await db.collection('positions').listDocuments();
    const positions = [];
    for (const d of posDocs) {
      const snap = await d.get();
      const data = snap.data() || {};
      const updatedAtMs = Number(data.updatedAtMs || 0);
      if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > MAX_RECENCY_MS) continue;
      positions.push({ uid: String(data.uid), lat: Number(data.lat), lng: Number(data.lng), updatedAtMs });
    }
    for (const me of positions) {
      const userSnap = await db.doc(`users/${me.uid}`).get();
      const prof = userSnap.data() || {};
      const token = prof.expoPushToken || null;
      const prefs = prof.notifications || {};
      const allow = prefs && prefs.peopleNearby !== false;
      if (!token || !allow) continue;
      let count = 0;
      for (const other of positions) {
        if (other.uid === me.uid) continue;
        if (await isBlockedBetween(me.uid, other.uid)) continue;
        const dist = haversineKm(me.lat, me.lng, other.lat, other.lng);
        if (dist <= RADIUS_KM) count++;
      }
      if (count <= 0) continue;
      const payload = {
        to: token,
        sound: 'default',
        title: 'Autour de toi',
        body: `Il y a ${count} nouvelles personnes autour de vous`,
        data: { type: 'nearby', count },
      };
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      let json = {}; try { json = await res.json(); } catch {}
      functions.logger.info('notifyNearbyPeopleSnapshot sent', { uid: me.uid, count, status: res.status, json });
    }
  } catch (e) {
    functions.logger.error('notifyNearbyPeopleSnapshot failed', e);
  }
});

async function safeSearchForGsUri(gsUri) {
  const [result] = await visionClient.safeSearchDetection(gsUri);
  const data = (result && result.safeSearchAnnotation) || {};
  return {
    adult: String(data.adult || 'UNKNOWN'),
    violence: String(data.violence || 'UNKNOWN'),
    racy: String(data.racy || 'UNKNOWN'),
    medical: String(data.medical || 'UNKNOWN'),
    spoof: String(data.spoof || 'UNKNOWN'),
  };
}
function isNsfw(s) {
  const bad = new Set(['LIKELY','VERY_LIKELY']);
  return bad.has(s.adult) || bad.has(s.racy);
}

exports.storageModerationOnFinalize = functions.storage.object().onFinalize(async (object) => {
  try {
    const name = object.name || '';
    const gsUri = `gs://${object.bucket}/${name}`;
    const verdict = await safeSearchForGsUri(gsUri);
    if (name.startsWith('users/') && name.includes('/photos/')) {
      const uid = name.split('/')[1] || '';
      const userSnap = await db.doc(`users/${uid}`).get();
      const age = Number((userSnap.data() && userSnap.data().age) || 0);
      if (age && age < 18 && isNsfw(verdict)) {
        await admin.storage().bucket(object.bucket).file(name).delete().catch(()=>{});
        const cur = userSnap.data() || {};
        const photos = Array.isArray(cur.photos) ? cur.photos.filter((p) => p && p.path !== name) : [];
        const patch = { photos, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (cur.primaryPhotoPath === name) patch.primaryPhotoPath = admin.firestore.FieldValue.delete();
        await db.doc(`users/${uid}`).set(patch, { merge: true });
        await db.doc(`moderation/photos/${uid}`).set({ [name.split('/').pop()]: { nsfw: true, verdict, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
        logInfo('Rejected NSFW profile photo', { uid, name });
      } else {
        await db.doc(`moderation/photos/${uid}`).set({ [name.split('/').pop()]: { nsfw: isNsfw(verdict), verdict, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      }
    } else if (name.startsWith('chats/')) {
      const chatId = name.split('/')[1] || '';
      await db.doc(`moderation/chats/${chatId}`).set({ [name.split('/').pop()]: { nsfw: isNsfw(verdict), verdict, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      logInfo('Moderated chat image', { chatId, name, nsfw: isNsfw(verdict) });
    }
  } catch (e) {
    logError('storageModerationOnFinalize failed', e);
  }
});

exports.enforceNsfwOnMessageCreate = functions.firestore
  .document('matches/{matchId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      const matchId = context.params.matchId;
      const msgId = context.params.messageId;
      const matchSnap = await db.doc(`matches/${matchId}`).get();
      const users = Array.isArray(matchSnap.data() && matchSnap.data().users) ? matchSnap.data().users : [];
      if (users.length !== 2) return;
      const [u1, u2] = users;
      const u1Age = Number(((await db.doc(`users/${u1}`).get()).data() || {}).age || 0);
      const u2Age = Number(((await db.doc(`users/${u2}`).get()).data() || {}).age || 0);
      const hasUnderageUser = (u1Age && u1Age < 18) || (u2Age && u2Age < 18);
      const url = typeof data.imageUrl === 'string' ? data.imageUrl : null;
      if (!url) return;
      let nsfw = false;
      try {
        const parts = url.split('/');
        const i = parts.findIndex(p => p === 'chats');
        if (i >= 0 && parts[i+1]) {
          const chatId = parts[i+1];
          const file = parts[parts.length - 1];
          const modSnap = await db.doc(`moderation/chats/${chatId}`).get();
          const mod = modSnap.data() || {};
          nsfw = Boolean(mod[file] && mod[file].nsfw);
        }
      } catch {}
      if (hasUnderageUser && nsfw) {
        await snap.ref.delete().catch(()=>{});
        await db.doc(`violations/messages/${msgId}`).set({ matchId, reason: 'NSFW', at: admin.firestore.FieldValue.serverTimestamp() });
        logInfo('Deleted NSFW message', { matchId, msgId });
      }
    } catch (e) {
      logError('enforceNsfwOnMessageCreate failed', e);
    }
  });

// Cleanup when a block is created
exports.onBlockCreate = functions.firestore
  .document('blocks/{uid}/users/{otherUid}')
  .onCreate(async (_snap, context) => {
    const uid = context.params.uid;
    const otherUid = context.params.otherUid;
    const chatId = [uid, otherUid].sort().join('_');
    functions.logger.info('onBlockCreate triggered', { uid, otherUid, chatId });
    try {
      await db.doc(`likes/${uid}_${otherUid}`).delete().catch(()=>{});
      await db.doc(`likes/${otherUid}_${uid}`).delete().catch(()=>{});
      const res = await cleanupMatchByChatId(chatId);
      functions.logger.info('onBlockCreate cleanup', { chatId, res });
      const reqs1 = await db.collection('chatRequests').where('from', '==', uid).where('to', '==', otherUid).get();
      for (const d of reqs1.docs) { await d.ref.delete().catch(()=>{}); }
      const reqs2 = await db.collection('chatRequests').where('from', '==', otherUid).where('to', '==', uid).get();
      for (const d of reqs2.docs) { await d.ref.delete().catch(()=>{}); }
    } catch (e) {
      functions.logger.error('onBlockCreate failed', { uid, otherUid, e });
    }
  });
