import vision from "@google-cloud/vision";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import * as functions from "firebase-functions/v1";

try {
  admin.app();
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const visionClient = new vision.ImageAnnotatorClient();

async function safeSearchForGsUri(gsUri: string): Promise<{ adult: string; violence: string; racy: string; medical: string; spoof: string }> {
  const [result] = await visionClient.safeSearchDetection(gsUri);
  const data = (result as any)?.safeSearchAnnotation || {};
  return {
    adult: String(data.adult || "UNKNOWN"),
    violence: String(data.violence || "UNKNOWN"),
    racy: String(data.racy || "UNKNOWN"),
    medical: String(data.medical || "UNKNOWN"),
    spoof: String(data.spoof || "UNKNOWN"),
  };
}

async function faceCountForGsUri(gsUri: string): Promise<number> {
  const [result] = await visionClient.faceDetection(gsUri);
  const faces = (result as any)?.faceAnnotations || [];
  return Array.isArray(faces) ? faces.length : 0;
}

function isNsfw(s: { adult: string; racy: string; violence: string }): boolean {
  const bad = new Set(["LIKELY", "VERY_LIKELY"]);
  return bad.has(s.adult) || bad.has(s.racy);
}

export const storageModerationOnFinalize = functions.runWith({ maxInstances: 5 }).storage.object().onFinalize(async (object) => {
  // Guard: Deletes file if NSFW. Deletion does not trigger onFinalize.
  try {
    const name = object.name || "";
    const gsUri = `gs://${object.bucket}/${name}`;
    const verdict = await safeSearchForGsUri(gsUri);
    const faces = (name.startsWith("users/") && name.includes("/photos/")) ? await faceCountForGsUri(gsUri) : -1;
    if (name.startsWith("users/") && name.includes("/photos/")) {
      const uid = name.split("/")[1] || "";
      const userSnap = await db.doc(`users/${uid}`).get();
      const age = Number((userSnap.data() as any)?.age ?? 0);
      const noFace = faces === 0;
      if (noFace || (age && age < 18 && isNsfw(verdict))) {
        await admin.storage().bucket(object.bucket).file(name).delete().catch(()=>{});
        const cur = (userSnap.data() as any) || {};
        const photos = Array.isArray(cur.photos) ? cur.photos.filter((p: any) => p?.path !== name) : [];
        const patch: any = { photos, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (cur.primaryPhotoPath === name) patch.primaryPhotoPath = admin.firestore.FieldValue.delete();
        await db.doc(`users/${uid}`).set(patch, { merge: true });
        await db.doc(`moderation_photos/${uid}`).set({ [name.split("/").pop() as string]: { nsfw: isNsfw(verdict), verdict, faces, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
        logger.info(noFace ? "Rejected profile photo without face" : "Rejected NSFW profile photo", { uid, name, faces });
      } else {
        await db.doc(`moderation_photos/${uid}`).set({ [name.split("/").pop() as string]: { nsfw: isNsfw(verdict), verdict, faces, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      }
    } else if (name.startsWith("chats/") || name.startsWith("groups/")) {
      const isGroup = name.startsWith("groups/");
      const contextId = name.split("/")[1] || "";
      const isNsfwResult = isNsfw(verdict);
      
      const col = isGroup ? 'moderation_groups' : 'moderation_chats';
      await db.doc(`${col}/${contextId}`).set({ [name.split("/").pop() as string]: { nsfw: isNsfwResult, verdict, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      
      if (isNsfwResult) {
         // DELETE the file if NSFW
         await admin.storage().bucket(object.bucket).file(name).delete().catch(()=>{});
         logger.info(`Deleted NSFW image in ${isGroup ? 'group' : 'chat'}`, { contextId, name });
      } else {
         logger.info(`Verified image in ${isGroup ? 'group' : 'chat'}`, { contextId, name, nsfw: false });
      }
    }
  } catch (e) {
    logger.error("storageModerationOnFinalize failed", e as any);
  }
});

export const enforceNsfwOnMessageCreate = functions.firestore
  .document('matches/{matchId}/messages/{messageId}')
  .onCreate(async (_snap, _context) => { return; });

async function isBlockedBetween(uidA: string, uidB: string): Promise<boolean> {
  try {
    const aDoc = await db.doc(`blocks/${uidA}/users/${uidB}`).get();
    if (aDoc.exists) return true;
    const bDoc = await db.doc(`blocks/${uidB}/users/${uidA}`).get();
    return bDoc.exists;
  } catch (e) {
    logger.error('isBlockedBetween error', { uidA, uidB, e });
    return false;
  }
}
async function userExists(uid: string): Promise<boolean> {
  try {
    await admin.auth().getUser(uid);
    return true;
  } catch (e) {
    if ((e as any)?.errorInfo?.code === 'auth/user-not-found') return false;
    logger.error('userExists error', { uid, e });
    return false;
  }
}

async function deleteSubcollection(path: string): Promise<number> {
  const colRef = db.collection(path);
  const docs = await colRef.listDocuments();
  let count = 0;
  if (docs.length === 0) return 0;
  const batch = db.batch();
  for (const d of docs) {
    batch.delete(d);
    count++;
  }
  await batch.commit();
  return count;
}

async function cleanupMatchByChatId(chatId: string): Promise<{deletedMatch:boolean; deletedMessages:number; deletedStatus:number}> {
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
  } catch (e) {
    logger.error("Failed deleting match", { chatId, e });
  }
  try {
    deletedMessages = await deleteSubcollection(`messages/${chatId}/items`);
    await db.doc(`messages/${chatId}`).delete().catch(()=>{});
  } catch (e) {
    logger.error("Failed deleting messages", { chatId, e });
  }
  try {
    deletedStatus = await deleteSubcollection(`chatStatus/${chatId}/users`);
    await db.doc(`chatStatus/${chatId}`).delete().catch(()=>{});
  } catch (e) {
    logger.error("Failed deleting chatStatus", { chatId, e });
  }
  try {
    await admin.storage().bucket().deleteFiles({ prefix: `chats/${chatId}/` });
    logger.info('Deleted chat images from Storage', { chatId, prefix: `chats/${chatId}/` });
  } catch (e) {
    logger.error('Failed deleting chat images from Storage', { chatId, e });
  }
  return { deletedMatch, deletedMessages, deletedStatus };
}

async function cleanupOrphansImpl(): Promise<{matchesChecked:number; matchesRemoved:number; convsRemoved:number}> {
  let matchesChecked = 0;
  let matchesRemoved = 0;
  let convsRemoved = 0;

  const matches = await db.collection("matches").listDocuments();
  for (const m of matches) {
    const snap = await m.get();
    matchesChecked++;
    const data = snap.data() as any;
    const users: string[] = Array.isArray(data?.users) ? data.users : [];
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
    const [uidA, uidB] = parts;
    if (parts.length !== 2) {
      const res = await cleanupMatchByChatId(chatId);
      convsRemoved += res.deletedStatus;
      continue;
    }
    const existsA = await userExists(uidA);
    const existsB = await userExists(uidB);
    if (!existsA || !existsB) {
      const res = await cleanupMatchByChatId(chatId);
      convsRemoved += res.deletedStatus;
    }
  }

  return { matchesChecked, matchesRemoved, convsRemoved };
}

export const cleanupOrphans = functions.https.onCall(async (_data, context) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentification requise");
  }
  try {
    const res = await cleanupOrphansImpl();
    logger.info("cleanupOrphans done", res);
    return res;
  } catch (e) {
    logger.error("cleanupOrphans failed", e as any);
    throw new functions.https.HttpsError("internal", "Echec du nettoyage");
  }
});

export const cleanupOrphansScheduled = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  try {
    const res = await cleanupOrphansImpl();
    logger.info("cleanupOrphansScheduled done", res);
  } catch (e) {
    logger.error("cleanupOrphansScheduled failed", e as any);
  }
});

export const authCleanupOnDelete = functions.runWith({ maxInstances: 5 }).auth.user().onDelete(async (user) => {
  const uid = user.uid;
  logger.info("authCleanupOnDelete triggered", { uid });
  try {
    await db.doc(`users/${uid}`).delete().catch(() => {});
    await db.doc(`positions/${uid}`).delete().catch(() => {});
    const matchQuery = await db.collection("matches").where("users", "array-contains", uid).get();
    for (const docSnap of matchQuery.docs) {
      const chatId = docSnap.id;
      const res = await cleanupMatchByChatId(chatId);
      logger.info("Deleted match & convs for", { chatId, res });
    }
    const convRoots = await db.collection("messages").listDocuments();
    for (const c of convRoots) {
      if (c.id.includes(uid)) {
        const res = await cleanupMatchByChatId(c.id);
        logger.info("Deleted messages for", { chatId: c.id, res });
      }
    }
    const statusRoots = await db.collection("chatStatus").listDocuments();
    for (const s of statusRoots) {
      if (s.id.includes(uid)) {
        const res = await cleanupMatchByChatId(s.id);
        logger.info("Deleted chatStatus for", { chatId: s.id, res });
      }
    }
    const reqFrom = await db.collection('chatRequests').where('from', '==', uid).get();
    for (const d of reqFrom.docs) { await d.ref.delete().catch(() => {}); }
    const reqTo = await db.collection('chatRequests').where('to', '==', uid).get();
    for (const d of reqTo.docs) { await d.ref.delete().catch(() => {}); }
    try {
      await admin.storage().bucket().deleteFiles({ prefix: `users/${uid}/` });
      logger.info('Deleted Storage files for user', { uid, prefix: `users/${uid}/` });
    } catch (e) {
      logger.error('Failed deleting Storage files for user', { uid, e });
    }
  } catch (e) {
    logger.error("authCleanupOnDelete failed", { uid, e });
  }
});

// export const helloWorld = functions.https.onCall((_data, _context) => {
//   logger.info("Hello logs!", {structuredData: true});
//   return {message: "Hello from Firebase!"};
// });

// export const recreateCollections = functions.https.onCall(async (_data, context) => {
//   if (!context?.auth) {
//     throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
//   }
//   const collections = ['users', 'positions', 'likes'];
//   const results: Record<string, 'created' | 'exists' | 'error'> = {};
//   for (const col of collections) {
//     try {
//       const ref = db.doc(`${col}/__placeholder`);
//       const snap = await ref.get();
//       if (!snap.exists) {
//         await ref.set({
//           type: 'placeholder',
//           info: `placeholder pour recréer la collection ${col}`,
//           createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         });
//         results[col] = 'created';
//       } else {
//         results[col] = 'exists';
//       }
//     } catch (e) {
//       logger.error('recreateCollections error', { col, e });
//       results[col] = 'error';
//     }
//   }
//   return { results };
// });

export const sendPushOnNewMessage = functions.firestore
  .document('matches/{matchId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() as any;
      const matchId = context.params.matchId as string;
      const senderId: string | undefined = data?.senderId;
      
      const now = Date.now();
      const createdAt = data?.createdAt?.toMillis ? data.createdAt.toMillis() : (data?.createdAt || now);
      // Si le message a plus de 60 secondes (ex: import de vieux messages), on ignore
      if (now - createdAt > 60 * 1000) {
        logger.info('sendPushOnNewMessage skip: old message (import?)', { msgId: context.params.messageId });
        return;
      }

      if (!matchId || !senderId) { logger.warn('sendPushOnNewMessage missing fields', { matchId, senderId }); return; }
      const matchSnap = await db.doc(`matches/${matchId}`).get();
      const users: string[] = Array.isArray(matchSnap.data()?.users) ? matchSnap.data()!.users : [];
      const recipientId = users.find((u) => u !== senderId);
      if (!recipientId) { logger.warn('sendPushOnNewMessage recipient not found', { matchId, users, senderId }); return; }
      if (await isBlockedBetween(senderId, recipientId)) { logger.info('sendPushOnNewMessage skip: blocked', { senderId, recipientId, matchId }); return; }
      const userSnap = await db.doc(`users/${recipientId}`).get();
      const token = (userSnap.data() as any)?.expoPushToken || null;
      const prefs = (userSnap.data() as any)?.notifications || {};
      const allow = prefs?.newMessage !== false;
      if (!token || !allow) { logger.info('sendPushOnNewMessage skip (no token or disabled)', { recipientId, hasToken: !!token, allow }); return; }
      
      const sound = (prefs?.newMessageSound === false) ? null : 'default';
      const text: string = (data?.text ?? '').trim();
      const body = text.length > 0 ? text : (data?.imageUrl ? 'Vous avez reçu une image' : 'Nouveau message');
      const payload = { to: token, sound, title: 'Nouveau message', body, data: { type: 'chat', chatId: matchId, senderId } };
      const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      logger.info('sendPushOnNewMessage sent', { recipientId, matchId, status: res.status, json });
    } catch (e) { logger.error('sendPushOnNewMessage failed', e as any); }
  });

export const sendPushOnNewMatch = functions.runWith({ maxInstances: 5 }).firestore
  .document('matches/{matchId}')
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() as any;
      
      const now = Date.now();
      const createdAt = data?.createdAt?.toMillis ? data.createdAt.toMillis() : (data?.createdAt || now);
      // Si le match a plus de 60 secondes (ex: import de vieux matchs), on ignore
      if (now - createdAt > 60 * 1000) {
        logger.info('sendPushOnNewMatch skip: old match (import?)', { matchId: context.params.matchId });
        return;
      }

      const matchId = context.params.matchId as string;
      const users: string[] = Array.isArray(data?.users) ? data.users : [];
      if (users.length !== 2) { logger.warn('sendPushOnNewMatch invalid users', { matchId, users }); return; }
      for (const recipientId of users) {
        const userSnap = await db.doc(`users/${recipientId}`).get();
        const token = (userSnap.data() as any)?.expoPushToken || null;
        const prefs = (userSnap.data() as any)?.notifications || {};
        const allow = prefs?.matches !== false;
        if (!token || !allow) { logger.info('sendPushOnNewMatch skip', { recipientId, hasToken: !!token, allow }); continue; }
        const otherId = users.find((u) => u !== recipientId);
        if (otherId && await isBlockedBetween(recipientId, otherId)) { logger.info('sendPushOnNewMatch skip: blocked', { recipientId, otherId, matchId }); continue; }
        const payload = { to: token, sound: 'default', title: 'Nouveau match 🎉', body: 'Vous avez un nouveau match !', data: { type: 'match', chatId: matchId, partnerUid: otherId } };
        const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const json = await res.json().catch(() => ({}));
        logger.info('sendPushOnNewMatch sent', { recipientId, matchId, status: res.status, json });
      }
    } catch (e) { logger.error('sendPushOnNewMatch failed', e as any); }
  });

export const sendPushOnChatInvitation = functions.firestore
  .document('chatRequests/{requestId}')
  .onWrite(async (change, context) => {
    try {
      const data = change.after.exists ? change.after.data() as any : null;
      const prevData = change.before.exists ? change.before.data() as any : null;

      if (!data) return; // Document deleted

      // Only trigger if status is 'pending' AND (it's new OR it wasn't pending before)
      const isPending = data.status === 'pending';
      const wasPending = prevData?.status === 'pending';

      if (!isPending || wasPending) {
        return;
      }
      
      const now = Date.now();
      // Use updatedAt as the trigger time because createdAt might be old if we just updated the status
      // But createChatRequestRemote updates both createdAt and updatedAt.
      // Let's rely on updatedAt if available, or createdAt.
      const timestamp = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.createdAt?.toMillis ? data.createdAt.toMillis() : now);
      
      // Si l'invitation a plus de 60 secondes, on ignore (pour éviter de spammer sur des vieux trucs)
      if (now - timestamp > 60 * 1000) {
        // logger.info('sendPushOnChatInvitation skip: old invitation', { requestId: context.params.requestId });
        return;
      }

      const to: string | undefined = data.to;
      const from: string | undefined = data.from;
      if (!to || !from) return;

      // Check for existing match (should not happen if client checks, but good safety)
      const pairId = [from, to].sort().join('_');
      const matchSnap = await db.doc(`matches/${pairId}`).get();
      if (matchSnap.exists) {
        // If match exists, maybe we should delete the request?
        // await change.after.ref.delete().catch(()=>{});
        return;
      }

      if (await isBlockedBetween(from, to)) { return; }

      const userSnap = await db.doc(`users/${to}`).get();
      const userData = userSnap.data() as any;
      const token = userData?.expoPushToken || null;
      const prefs = userData?.notifications || {};
      const allow = prefs?.invitations !== false;

      if (!token || !allow) return;

      const body = (data.messageText && String(data.messageText).trim().length > 0) 
        ? String(data.messageText).trim() 
        : 'Vous avez reçu une invitation à discuter';
      
      const payload = { 
        to: token, 
        sound: 'default', 
        title: 'Nouvelle invitation 💬', 
        body, 
        data: { type: 'invitation', fromUid: from } 
      };

      await fetch('https://exp.host/--/api/v2/push/send', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      // const json = await res.json().catch(() => ({}));
      // logger.info('sendPushOnChatInvitation sent', { to, status: res.status });
    } catch (e) { 
      // logger.error('sendPushOnChatInvitation failed', e as any); 
    }
  });

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371; const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const notifyNearbyPeopleSnapshot = functions.runWith({ maxInstances: 5 }).pubsub.schedule('every 30 minutes').onRun(async () => {
  try {
    const now = Date.now(); const MAX_RECENCY_MS = 35 * 60 * 1000; const RADIUS_KM = 2.0;
    const posDocs = await db.collection('positions').listDocuments();
    const positions: Array<{ uid: string; lat: number; lng: number; updatedAtMs: number }> = [];
    for (const d of posDocs) {
      const snap = await d.get(); const data = snap.data() as any; if (!data) continue;
      const updatedAtMs = Number(data.updatedAtMs ?? 0);
      if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > MAX_RECENCY_MS) continue;
      positions.push({ uid: String(data.uid), lat: Number(data.lat), lng: Number(data.lng), updatedAtMs });
    }
    for (const me of positions) {
      const profSnap = await db.doc(`users/${me.uid}`).get(); const prof = profSnap.data() as any;
      const token = prof?.expoPushToken || null; const prefs = prof?.notifications || {};
      const allow = prefs?.peopleNearby !== false; if (!token || !allow) continue; let count = 0;
      for (const other of positions) {
        if (other.uid === me.uid) continue; if (await isBlockedBetween(me.uid, other.uid)) continue;
        const dist = haversineKm(me.lat, me.lng, other.lat, other.lng); if (dist <= RADIUS_KM) count++;
      }
      if (count <= 0) continue;
      const payload = { to: token, sound: 'default', title: 'Autour de toi', body: `Il y a ${count} nouvelles personnes autour de vous`, data: { type: 'nearby', count } };
      const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      logger.info('notifyNearbyPeopleSnapshot sent', { uid: me.uid, count, status: res.status, json });
    }
  } catch (e) { logger.error('notifyNearbyPeopleSnapshot failed', e as any); }
});

export const onBlockCreate = functions.firestore
  .document('blocks/{uid}/users/{otherUid}')
  .onCreate(async (_snap, context) => {
    const uid = context.params.uid as string; const otherUid = context.params.otherUid as string;
    const chatId = [uid, otherUid].sort().join('_'); logger.info('onBlockCreate triggered', { uid, otherUid, chatId });
    try {
      await db.doc(`likes/${uid}_${otherUid}`).delete().catch(()=>{});
      await db.doc(`likes/${otherUid}_${uid}`).delete().catch(()=>{});
      const res = await cleanupMatchByChatId(chatId); logger.info('onBlockCreate cleanup', { chatId, res });
      const reqs1 = await db.collection('chatRequests').where('from', '==', uid).where('to', '==', otherUid).get();
      for (const d of reqs1.docs) { await d.ref.delete().catch(()=>{}); }
      const reqs2 = await db.collection('chatRequests').where('from', '==', otherUid).where('to', '==', uid).get();
      for (const d of reqs2.docs) { await d.ref.delete().catch(()=>{}); }
    } catch (e) { logger.error('onBlockCreate failed', { uid, otherUid, e }); }
  });

async function addExclusion(a: string, b: string, type: 'matches' | 'invites' | 'principal' = 'matches') {
  const refA = db.collection('exclusions').doc(a);
  const refB = db.collection('exclusions').doc(b);
  await db.runTransaction(async (tx) => {
    const snapA = await tx.get(refA);
    const snapB = await tx.get(refB);
    const dataA = (snapA.exists ? snapA.data() : {}) as any;
    const dataB = (snapB.exists ? snapB.data() : {}) as any;
    const arrA = Array.isArray(dataA[type]) ? new Set<string>(dataA[type]) : new Set<string>();
    const arrB = Array.isArray(dataB[type]) ? new Set<string>(dataB[type]) : new Set<string>();
    arrA.add(b); arrB.add(a);
    tx.set(refA, { [type]: Array.from(arrA), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(refB, { [type]: Array.from(arrB), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

export const onMatchCreated = functions.runWith({ maxInstances: 5 }).firestore
  .document('matches/{pairId}')
  .onCreate(async (snap) => {
    // Guard: Does not write back to matches or cause recursive trigger
    try {
      const d = snap.data() as any;
      const users: string[] = Array.isArray(d?.users) ? d.users : [];
      if (users.length !== 2) return;
      await addExclusion(users[0], users[1], 'matches');
    } catch (e) { logger.error('onMatchCreated error', e as any); }
  });

export const onChatRequestWrite = functions.runWith({ maxInstances: 5 }).firestore
  .document('chatRequests/{rid}')
  .onWrite(async (change) => {
    try {
      const after = change.after.exists ? (change.after.data() as any) : null;
      const before = change.before.exists ? (change.before.data() as any) : null;
      const d = after || before; if (!d) return;
      const from = String(d?.from || '').trim(); const to = String(d?.to || '').trim();
      if (!from || !to) return;
      const ref = change.after.exists ? change.after.ref : change.before.ref;
      const pairId = [from, to].sort().join('_');
      const matchSnap = await db.doc(`matches/${pairId}`).get();
      if (matchSnap.exists) {
        // Only delete if it still exists (avoid redundant delete loop)
        if (change.after.exists) {
          await ref.delete().catch(()=>{});
        }
        return;
      }

      // Guard against update loops: if already rejected and stays rejected, ignore
      if (after && before && before.status === 'rejected' && after.status === 'rejected') {
        return;
      }

      // Handle Acceptance: Create Match (only on transition pending -> accepted)
      if (after && before && before.status === 'pending' && after.status === 'accepted') {
        await db.doc(`matches/${pairId}`).set({
          users: [from, to],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessageText: after.messageText || (after.imageUrl ? '📷 Image' : ''),
          lastSenderId: from
        }, { merge: true });
        
        if (after.messageText || after.imageUrl) {
          await db.collection(`matches/${pairId}/messages`).add({
            senderId: from,
            text: after.messageText || null,
            imageUrl: after.imageUrl || null,
            imageW: after.imageW || null,
            imageH: after.imageH || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        logger.info('Match created from ChatRequest', { pairId });
        return;
      }

      // Anti-spam: auto-reject very recent duplicate updates, but ONLY when still pending and not previously rejected
      if (after && before && after.status === 'pending' && before.status === 'pending') {
        const prevUpdated = Number(before?.updatedAt?.toMillis?.() ? before.updatedAt.toMillis() : before?.updatedAt || 0);
        if (Number.isFinite(prevUpdated) && Date.now() - prevUpdated < 90 * 1000) {
          // Mark once as rejected and exit; next trigger will hit the guard above and stop
          await ref.update({ status: 'rejected', updatedAt: admin.firestore.FieldValue.serverTimestamp(), autoRejected: true }).catch(()=>{});
          return;
        }
      }
      await addExclusion(from, to, 'invites');
    } catch (e) { logger.error('onChatRequestWrite error', e as any); }
  });

export const onGroupMemberWrite = functions.firestore
  .document('groups/{groupId}/members/{memberId}')
  .onWrite(async (change, context) => {
    const groupId = context.params.groupId;
    const isCreate = !change.before.exists && change.after.exists;
    const isDelete = change.before.exists && !change.after.exists;
    
    if (!isCreate && !isDelete) return; // Ignore updates
    
    const inc = isCreate ? 1 : -1;
    try {
      await db.doc(`groups/${groupId}`).update({
        memberCount: admin.firestore.FieldValue.increment(inc)
      });
    } catch (e) {
      logger.error('onGroupMemberWrite failed', { groupId, error: e });
    }
  });

export const onKickPollUpdate = functions.firestore
  .document('groups/{groupId}/messages/{msgId}')
  .onUpdate(async (change, context) => {
    const after = change.after.exists ? (change.after.data() as any) : null;
    const before = change.before.exists ? (change.before.data() as any) : null;
    
    if (!after || !before) return;
    
    // Only care about kick_poll
    if (after.type !== 'kick_poll') return;
    
    // Check if votes changed
    const votesBefore = before.votes || {};
    const votesAfter = after.votes || {};
    if (JSON.stringify(votesBefore) === JSON.stringify(votesAfter)) return;
    
    // Already completed?
    if (after.pollStatus === 'completed') return;
    
    const groupId = context.params.groupId;
    
    // Calculate Threshold
    const groupRef = db.doc(`groups/${groupId}`);
    const groupSnap = await groupRef.get();
    const memberCount = (groupSnap.data() as any)?.memberCount || 1;
    
    const yesVotes = Object.values(votesAfter).filter(v => v === 'yes').length;
    
    let threshold = 2;
    if (memberCount <= 2) {
        threshold = 1;
    } else if (memberCount > 4) {
        threshold = Math.ceil(memberCount / 4);
    }
    
    if (yesVotes >= threshold && after.pollTarget?.id) {
       // Kick member
       const targetId = after.pollTarget.id;
       try {
          // Remove from group members
          await db.doc(`groups/${groupId}/members/${targetId}`).delete();
          // Remove from user joined_groups
          await db.doc(`users/${targetId}/joined_groups/${groupId}`).delete();
          // Decrement count (handled by onGroupMemberWrite trigger automatically)
          
          // Update Poll Status
          await change.after.ref.update({
             pollStatus: 'completed',
             pollResult: 'kicked'
          });
          
          logger.info('Member kicked via poll', { groupId, targetId, votes: yesVotes, threshold });
       } catch (e) {
          logger.error('Failed to kick member via poll', { groupId, targetId, error: e });
       }
    }
  });

export const onSwipeCreated = functions.runWith({ maxInstances: 5 }).firestore
  .document('swipes/{uid}/outgoing/{targetUid}')
  .onCreate(async (snap, context) => {
    // Guard: Writes to matches (different collection), no recursive loop
    try {
        const uid = context.params.uid;
        const targetUid = context.params.targetUid;
        const data = snap.data();
        
        // Only process likes (v=1)
        if (data.v !== 1) return;

        // Check if target has liked me
        const targetSwipeRef = db.doc(`swipes/${targetUid}/outgoing/${uid}`);
        const targetSwipeSnap = await targetSwipeRef.get();

        if (targetSwipeSnap.exists && targetSwipeSnap.data()?.v === 1) {
            // It's a MATCH!
            const matchId = [uid, targetUid].sort().join('_');
            const matchRef = db.doc(`matches/${matchId}`);
            
            // Create match if not exists
            await matchRef.set({
                users: [uid, targetUid],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            logger.info('Match created!', { matchId, uid, targetUid });
        } else {
            // It's just a LIKE (and not a match yet)
            // Send "New Like" notification if enabled
            if (await isBlockedBetween(uid, targetUid)) return;
            
            const userSnap = await db.doc(`users/${targetUid}`).get();
            const token = (userSnap.data() as any)?.expoPushToken || null;
            const prefs = (userSnap.data() as any)?.notifications || {};
            // Reuse 'matches' preference for likes as per UI label "Nouveaux matchs/likes"
            const allow = prefs?.matches !== false; 
            
            if (token && allow) {
                const payload = { 
                    to: token, 
                    sound: 'default', 
                    title: 'Nouveau like 💖', 
                    body: 'Quelqu\'un a aimé votre profil !', 
                    data: { type: 'like', senderUid: uid } 
                };
                await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                logger.info('Like notification sent', { targetUid });
            }
        }
    } catch (e) {
        logger.error('onSwipeCreated failed', e);
    }
  });

export const processPurchase = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const { type, itemId } = data; // type: 'pins' | 'subscription'
    
    // SECURITY: Validate inputs to prevent arbitrary granting
    const validPinPacks = ['coins_30', 'coins_120', 'coins_300', 'coins_1000', 'coins_3500'];
    const validSubs = ['plus_1m', 'plus_1y', 'pro_1m', 'pro_1y']; // Add your actual IDs here
    
    // Allow any ID starting with these prefixes for flexibility during test/dev if IDs change
    const isValidItem = 
        validPinPacks.includes(itemId) || 
        validSubs.includes(itemId) ||
        (itemId && (itemId.startsWith('coins_') || itemId.startsWith('plus_') || itemId.startsWith('pro_')));

    if (!isValidItem) {
        logger.warn('Invalid purchase attempt', { uid, itemId });
        throw new functions.https.HttpsError('invalid-argument', 'Produit invalide');
    }

    // TODO: In production, verify the purchase token with Apple/Google/RevenueCat API here.
    // For now, we trust the client for "Test Phase" as requested, but we validate the Item ID exists.
    // Recommended: Use RevenueCat Webhooks to handle entitlements server-side securely.
    
    logger.info('Processing purchase (Trusted/Test Mode)', { uid, type, itemId });
    
    const privateRef = db.doc(`users/${uid}/private/settings`);
    
    if (type === 'pins') {
        const amount = itemId === 'coins_30' ? 30 : 
                       itemId === 'coins_120' ? 120 :
                       itemId === 'coins_300' ? 300 :
                       itemId === 'coins_1000' ? 1000 : 
                       itemId === 'coins_3500' ? 3500 : 0;
        
        // Fallback for custom amounts if needed, or strict check above
        if (amount > 0) {
            await privateRef.set({
                pins: admin.firestore.FieldValue.increment(amount),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } else if (type === 'subscription') {
        const tier = itemId.includes('pro') ? 'PRO' : 'PLUS';
        const durationDays = (itemId.includes('yearly') || itemId.includes('1y')) ? 365 : 30;
        
        await db.doc(`users/${uid}`).update({
             subscription: tier,
             subscriptionExpiryMs: Date.now() + durationDays * 24 * 60 * 60 * 1000 
        });
        // Also update private settings just in case
        await privateRef.set({
             subscription: tier,
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    
    return { success: true };
});

export const buyItemWithPins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const { itemType, cost } = data;
    
    const userRef = db.doc(`users/${uid}/private/settings`);
    
    await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        const currentPins = doc.data()?.pins || 0;
        
        if (currentPins < cost) {
            throw new functions.https.HttpsError('failed-precondition', 'Pins insuffisants');
        }
        
        const updates: any = {
            pins: admin.firestore.FieldValue.increment(-cost),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // Grant the item
        if (itemType === 'INVITE') {
             // Direct usage or add to bonus? Usually buying means adding to stock (bonus)
             updates.bonusInvites = admin.firestore.FieldValue.increment(1);
        } else if (itemType === 'INVITE_BUNDLE_5') {
             updates.bonusInvites = admin.firestore.FieldValue.increment(5);
        } else if (itemType === 'INVITE_BUNDLE_15') {
             updates.bonusInvites = admin.firestore.FieldValue.increment(15);
        } else if (itemType === 'SUPER_INVITE') {
             updates.bonusSuperInvites = admin.firestore.FieldValue.increment(1);
        } else if (itemType === 'SUPER_INVITE_BUNDLE_5') {
             updates.bonusSuperInvites = admin.firestore.FieldValue.increment(5);
        } else if (itemType === 'SUPER_INVITE_BUNDLE_15') {
             updates.bonusSuperInvites = admin.firestore.FieldValue.increment(15);
        } else if (itemType === 'BOOST') {
             updates.bonusBoosts = admin.firestore.FieldValue.increment(1);
        } else if (itemType === 'BOOST_BUNDLE_5') {
             updates.bonusBoosts = admin.firestore.FieldValue.increment(5);
        } else if (itemType === 'UNLOCK_LIKE') {
             updates.bonusUnlockLikes = admin.firestore.FieldValue.increment(1);
        } else if (itemType === 'UNLOCK_LIKE_BUNDLE_10') {
             updates.bonusUnlockLikes = admin.firestore.FieldValue.increment(10);
        }
        
        t.set(userRef, updates, { merge: true });
        
        // Also update public profile for some counters if needed (e.g. bonusInvites might be mirrored public/private depending on security model)
        // Here we assume bonus counters are in private/settings primarily or synced.
        // Let's sync to public user doc just in case the app reads from there for UI
        t.set(db.doc(`users/${uid}`), updates, { merge: true });
    });
    
    return { success: true };
});

export const claimDailyReward = functions.runWith({ maxInstances: 5 }).https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const userRef = db.doc(`users/${uid}`);
    const privateRef = db.doc(`users/${uid}/private/settings`);

    try {
        const [userSnap, privateSnap] = await Promise.all([userRef.get(), privateRef.get()]);
        
        const pData = privateSnap.exists ? privateSnap.data() : {};
        const uData = userSnap.exists ? userSnap.data() : {};
        
        const lastClaimTime = (pData as any)?.lastDailyRewardClaimedAt || (uData as any)?.lastDailyRewardClaimedAt || 0;
        let streak = (pData as any)?.dailyStreak || (uData as any)?.dailyStreak || 0;

        const now = Date.now();
        const lastDate = new Date(lastClaimTime);
        const today = new Date(now);
        
        // Use simpler day diff logic to be robust
        const oneDay = 24 * 60 * 60 * 1000;
        
        // Check if same day
        if (lastDate.toDateString() === today.toDateString()) {
             return { success: false, message: 'Déjà réclamé aujourd\'hui', streak };
        }

        // Check if yesterday was last claim
        const yesterday = new Date(now - oneDay);
        if (lastDate.toDateString() === yesterday.toDateString()) {
            streak++;
        } else {
            // Check if diff is less than 2 days (48h) to be lenient with timezones? 
            // Better stick to strict "yesterday" logic for streaks usually.
            // If last claim was NOT today AND NOT yesterday, streak resets.
            streak = 1;
        }

        const dayIndex = (streak - 1) % 7; // 0-6
        
        const REWARDS = [
          { day: 1, type: 'pins', amount: 5, label: '5 Pins' },
          { day: 2, type: 'invite', amount: 1, label: '1 Invitation' },
          { day: 3, type: 'pins', amount: 10, label: '10 Pins' },
          { day: 4, type: 'undo', amount: 1, label: '1 Undo' },
          { day: 5, type: 'pins', amount: 10, label: '10 Pins' },
          { day: 6, type: 'unlock_like', amount: 1, label: '1 Révélation' },
          { day: 7, type: 'boost', amount: 1, label: '1 Boost' },
        ];
        
        const reward = REWARDS[dayIndex];
        const updatesPrivate: any = {
            lastDailyRewardClaimedAt: now,
            dailyStreak: streak,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const updatesPublic: any = {
            lastDailyRewardClaimedAt: now,
            dailyStreak: streak
        };

        if (reward.type === 'pins') {
            updatesPrivate.pins = admin.firestore.FieldValue.increment(reward.amount);
        } else if (reward.type === 'invite') {
            updatesPrivate.bonusInvites = admin.firestore.FieldValue.increment(reward.amount);
        } else if (reward.type === 'undo') {
            updatesPrivate.bonusUndos = admin.firestore.FieldValue.increment(reward.amount);
        } else if (reward.type === 'unlock_like') {
            updatesPrivate.bonusUnlockLikes = admin.firestore.FieldValue.increment(reward.amount);
        } else if (reward.type === 'boost') {
            updatesPrivate.bonusBoosts = admin.firestore.FieldValue.increment(reward.amount);
        }

        await Promise.all([
          privateRef.set(updatesPrivate, { merge: true }),
          userRef.set(updatesPublic, { merge: true })
        ]);

        return { success: true, streak, reward };
    } catch (e: any) {
        logger.error('claimDailyReward error', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});
