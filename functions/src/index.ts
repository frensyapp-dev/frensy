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
  let count = 0;
  while (true) {
    const snap = await colRef.limit(450).get();
    if (snap.empty) return count;
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
      count++;
    }
    await batch.commit();
    if (snap.size < 450) return count;
  }
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
    deletedMessages += await deleteSubcollection(`matches/${chatId}/messages`);
  } catch (e) {
    logger.error("Failed deleting match messages", { chatId, e });
  }
  try {
    deletedStatus += await deleteSubcollection(`matches/${chatId}/status`);
  } catch (e) {
    logger.error("Failed deleting match status", { chatId, e });
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

  const existsCache = new Map<string, boolean>();
  const existsChecked = new Map<string, boolean>();
  const checkUser = async (uid: string): Promise<boolean> => {
    if (existsChecked.has(uid)) return existsCache.get(uid) === true;
    const ok = await userExists(uid);
    existsChecked.set(uid, true);
    existsCache.set(uid, ok);
    return ok;
  };

  let page = 0;
  let lastDocId: string | null = null;
  while (true) {
    page++;
    let q = db.collection("matches").select("users").orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (lastDocId) q = q.startAfter(lastDocId);
    const snap = await q.get();
    if (snap.empty) break;
    for (const docSnap of snap.docs) {
      matchesChecked++;
      const data = docSnap.data() as any;
      const users: string[] = Array.isArray(data?.users) ? data.users : [];
      if (users.length !== 2) {
        const res = await cleanupMatchByChatId(docSnap.id);
        matchesRemoved += res.deletedMatch ? 1 : 0;
        convsRemoved += res.deletedMessages + res.deletedStatus;
        continue;
      }
      const [u1, u2] = users;
      const [exists1, exists2] = await Promise.all([checkUser(u1), checkUser(u2)]);
      if (!exists1 || !exists2) {
        const res = await cleanupMatchByChatId(docSnap.id);
        matchesRemoved += res.deletedMatch ? 1 : 0;
        convsRemoved += res.deletedMessages + res.deletedStatus;
      }
    }
    lastDocId = snap.docs[snap.docs.length - 1].id;
    if (snap.size < 500) break;
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
    await db.doc(`users/${uid}/private/settings`).delete().catch(() => {});
    await db.doc(`positions/${uid}`).delete().catch(() => {});
    await db.doc(`blocks/${uid}`).delete().catch(() => {});
    await deleteSubcollection(`blocks/${uid}/users`).catch(() => {});
    await db.doc(`moderation_photos/${uid}`).delete().catch(() => {});
    const matchQuery = await db.collection("matches").where("users", "array-contains", uid).get();
    for (const docSnap of matchQuery.docs) {
      const chatId = docSnap.id;
      const res = await cleanupMatchByChatId(chatId);
      logger.info("Deleted match & convs for", { chatId, res });
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
      const privateSnap = await db.doc(`users/${recipientId}/private/settings`).get();
      const privateData = (privateSnap.exists ? privateSnap.data() : {}) as any;
      const publicData = (userSnap.exists ? userSnap.data() : {}) as any;
      const token = privateData?.expoPushToken || publicData?.expoPushToken || null;
      const prefs = privateData?.notifications || publicData?.notifications || {};
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
        const privateSnap = await db.doc(`users/${recipientId}/private/settings`).get();
        const privateData = (privateSnap.exists ? privateSnap.data() : {}) as any;
        const publicData = (userSnap.exists ? userSnap.data() : {}) as any;
        const token = privateData?.expoPushToken || publicData?.expoPushToken || null;
        const prefs = privateData?.notifications || publicData?.notifications || {};
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
      const privateSnap = await db.doc(`users/${to}/private/settings`).get();
      const privateData = (privateSnap.exists ? privateSnap.data() : {}) as any;
      const publicData = (userSnap.exists ? userSnap.data() : {}) as any;
      const token = privateData?.expoPushToken || publicData?.expoPushToken || null;
      const prefs = privateData?.notifications || publicData?.notifications || {};
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
      logger.error('sendPushOnChatInvitation failed', { requestId: context.params.requestId, e });
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
    const cutoff = now - MAX_RECENCY_MS;
    const posSnap = await db.collection('positions').select('uid', 'lat', 'lng', 'updatedAtMs').where('updatedAtMs', '>=', cutoff).get();
    const positions: Array<{ uid: string; lat: number; lng: number; updatedAtMs: number }> = [];
    for (const d of posSnap.docs) {
      const data = d.data() as any;
      const uid = String(data?.uid || d.id);
      const lat = Number(data?.lat);
      const lng = Number(data?.lng);
      const updatedAtMs = Number(data?.updatedAtMs ?? 0);
      if (!uid || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > MAX_RECENCY_MS) continue;
      positions.push({ uid, lat, lng, updatedAtMs });
    }

    const CELL = 0.02;
    const buckets = new Map<string, Array<{ uid: string; lat: number; lng: number; updatedAtMs: number }>>();
    const keyFor = (lat: number, lng: number) => `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;
    for (const p of positions) {
      const k = keyFor(p.lat, p.lng);
      const arr = buckets.get(k);
      if (arr) arr.push(p);
      else buckets.set(k, [p]);
    }

    const blocksCache = new Map<string, Set<string>>();
    const getBlockedSet = async (uid: string): Promise<Set<string>> => {
      const cached = blocksCache.get(uid);
      if (cached) return cached;
      const snap = await db.collection('blocks').doc(uid).collection('users').select().get().catch(() => null as any);
      const set = new Set<string>();
      if (snap && snap.docs) {
        for (const d of snap.docs) set.add(d.id);
      }
      blocksCache.set(uid, set);
      return set;
    };

    for (const me of positions) {
      const [profSnap, privSnap] = await Promise.all([
        db.doc(`users/${me.uid}`).get(),
        db.doc(`users/${me.uid}/private/settings`).get()
      ]);
      const priv = (privSnap.exists ? privSnap.data() : {}) as any;
      const pub = (profSnap.exists ? profSnap.data() : {}) as any;
      const token = priv?.expoPushToken || pub?.expoPushToken || null;
      const prefs = priv?.notifications || pub?.notifications || {};
      const allow = prefs?.peopleNearby !== false; if (!token || !allow) continue; let count = 0;
      const myBlocked = await getBlockedSet(me.uid);
      const baseX = Math.floor(me.lat / CELL);
      const baseY = Math.floor(me.lng / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const k = `${baseX + dx}_${baseY + dy}`;
          const arr = buckets.get(k);
          if (!arr) continue;
          for (const other of arr) {
            if (other.uid === me.uid) continue;
            if (myBlocked.has(other.uid)) continue;
            const dist = haversineKm(me.lat, me.lng, other.lat, other.lng);
            if (dist <= RADIUS_KM) count++;
          }
        }
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

export const processPurchase = functions.runWith({ secrets: ['REVENUECAT_SECRET_KEY'] }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    try {
        const res = await syncRevenueCatPurchasesImpl(uid);
        return { success: true, ...res };
    } catch (e: any) {
        const msg = e?.message || 'Sync RevenueCat échoué';
        logger.error('processPurchase failed', { uid, msg });
        throw new functions.https.HttpsError('internal', msg);
    }
});

type RevenueCatSubscriber = {
    subscriptions?: Record<string, { expires_date_ms?: number | string | null }>;
    entitlements?: Record<string, { expires_date_ms?: number | string | null; product_identifier?: string }>;
    non_subscriptions?: Record<string, Array<{ id?: string; transaction_id?: string; purchase_date_ms?: number | string | null }>>;
};

async function fetchRevenueCatSubscriber(appUserId: string): Promise<RevenueCatSubscriber> {
    const secret = process.env.REVENUECAT_SECRET_KEY;
    if (!secret) {
        throw new Error('REVENUECAT_SECRET_KEY manquant côté serveur');
    }
    const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
    const r = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
        },
    });
    if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`RevenueCat API error ${r.status}: ${body || r.statusText}`);
    }
    const json = await r.json();
    const sub = (json as any)?.subscriber || {};
    return sub as RevenueCatSubscriber;
}

function parseMs(v: any): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function pinsAmountForProduct(productId: string): number {
    const raw = typeof productId === 'string' ? productId : '';
    const normalized = raw.trim().toLowerCase();
    
    // Security: explicitly ignore subscription IDs to prevent giving pins instead of/in addition to sub
    if (normalized.includes('plus') || normalized.includes('pro') || normalized.includes('sub')) {
        return 0;
    }

    const suffix = normalized.includes('.') ? (normalized.split('.').pop() || normalized) : normalized;

    if (suffix === 'coins_30' || normalized.endsWith('coins_30')) return 30;
    if (suffix === 'coins_120' || normalized.endsWith('coins_120')) return 120;
    if (suffix === 'coins_300' || normalized.endsWith('coins_300')) return 300;
    if (suffix === 'coins_1000' || normalized.endsWith('coins_1000')) return 1000;
    if (suffix === 'coins_3500' || normalized.endsWith('coins_3500')) return 3500;
    return 0;
}

function computeSubscriptionFromRevenueCat(subscriber: RevenueCatSubscriber): { tier: 'FREE' | 'PLUS' | 'PRO'; expiryMs: number } {
    const now = Date.now();
    let bestTier: 'FREE' | 'PLUS' | 'PRO' = 'FREE';
    let bestExpiryMs = 0;

    // 1. Check Entitlements (Best practice)
    const entitlements = subscriber.entitlements || {};
    for (const [entId, e] of Object.entries(entitlements)) {
        const rawExp = e?.expires_date_ms;
        const exp = rawExp ? parseMs(rawExp) : null;
        
        // Subscription is active if expiry is null (lifetime) or in the future
        const isActive = exp === null || exp > now;
        if (!isActive) continue;

        const normalizedId = entId.toLowerCase();
        let tier: 'PLUS' | 'PRO' | null = null;
        
        if (normalizedId.includes('pro') || normalizedId.includes('premium')) {
            tier = 'PRO';
        } else if (normalizedId.includes('plus')) {
            tier = 'PLUS';
        }

        if (!tier) continue;

        if (tier === 'PRO') {
            if (bestTier !== 'PRO' || (exp !== null && (bestExpiryMs === 0 || exp > bestExpiryMs))) {
                bestTier = 'PRO';
                bestExpiryMs = exp || 0;
            } else if (exp === null) {
                bestTier = 'PRO';
                bestExpiryMs = 0; // 0 represents lifetime/no expiry in our system
            }
        } else if (tier === 'PLUS') {
            if (bestTier === 'FREE' || (bestTier === 'PLUS' && (exp !== null && (bestExpiryMs === 0 || exp > bestExpiryMs)))) {
                bestTier = 'PLUS';
                bestExpiryMs = exp || 0;
            } else if (bestTier === 'FREE' && exp === null) {
                bestTier = 'PLUS';
                bestExpiryMs = 0;
            }
        }
    }

    // 2. Fallback to Subscriptions (Product ID matching)
    const subs = subscriber.subscriptions || {};
    for (const [productId, s] of Object.entries(subs)) {
        const rawExp = (s as any)?.expires_date_ms;
        const exp = rawExp ? parseMs(rawExp) : null;
        
        const isActive = exp === null || exp > now;
        if (!isActive) continue;

        const normalizedId = productId.toLowerCase();
        let tier: 'PLUS' | 'PRO' | null = null;
        
        if (normalizedId.includes('pro') || normalizedId.includes('premium')) {
            tier = 'PRO';
        } else if (normalizedId.includes('plus')) {
            tier = 'PLUS';
        }

        if (!tier) continue;

        if (tier === 'PRO') {
            if (bestTier !== 'PRO' || (exp !== null && (bestExpiryMs === 0 || exp > bestExpiryMs))) {
                bestTier = 'PRO';
                bestExpiryMs = exp || 0;
            } else if (exp === null) {
                bestTier = 'PRO';
                bestExpiryMs = 0;
            }
        } else if (tier === 'PLUS') {
            if (bestTier === 'FREE' || (bestTier === 'PLUS' && (exp !== null && (bestExpiryMs === 0 || exp > bestExpiryMs)))) {
                bestTier = 'PLUS';
                bestExpiryMs = exp || 0;
            } else if (bestTier === 'FREE' && exp === null) {
                bestTier = 'PLUS';
                bestExpiryMs = 0;
            }
        }
    }

    return { tier: bestTier, expiryMs: bestExpiryMs };
}

async function syncRevenueCatPurchasesImpl(uid: string): Promise<{ grantedPins: number; subscription: { tier: 'FREE' | 'PLUS' | 'PRO'; expiryMs: number } }> {
    const subscriber = await fetchRevenueCatSubscriber(uid);
    const subscription = computeSubscriptionFromRevenueCat(subscriber);

    const userRef = db.doc(`users/${uid}`);
    const privateRef = db.doc(`users/${uid}/private/settings`);
    const posRef = db.doc(`positions/${uid}`);

    // Update subscription info in a single batch
    const subBatch = db.batch();
    const subUpdate = {
        subscription: subscription.tier,
        subscriptionExpiryMs: subscription.expiryMs || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    subBatch.set(privateRef, subUpdate, { merge: true });
    subBatch.set(userRef, subUpdate, { merge: true });

    // Update positions doc if it exists so the map badge updates immediately
    const posSnap = await posRef.get();
    if (posSnap.exists) {
        subBatch.set(posRef, {
            subscription: subscription.tier,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    await subBatch.commit();

    const nonSubs = subscriber.non_subscriptions || {};
    const grantCandidates: Array<{ key: string; productId: string; amount: number }> = [];

    for (const [productId, entries] of Object.entries(nonSubs)) {
        const amount = pinsAmountForProduct(productId);
        if (!amount) continue;
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
            const key =
                (typeof (e as any)?.transaction_id === 'string' && (e as any).transaction_id) ||
                (typeof (e as any)?.id === 'string' && (e as any).id) ||
                `${productId}:${parseMs((e as any)?.purchase_date_ms) || 'unknown'}`;
            grantCandidates.push({ key, productId, amount });
        }
    }

    let grantedPins = 0;

    if (grantCandidates.length > 0) {
        await db.runTransaction(async (t) => {
            let delta = 0;
            const pendingRewards: Array<{ 
                ref: FirebaseFirestore.DocumentReference; 
                gRef: FirebaseFirestore.DocumentReference; 
                candidate: { key: string; productId: string; amount: number } 
            }> = [];

            for (const c of grantCandidates) {
                const docId = `${uid}_${c.key}`;
                const pRef = db.doc(`iap_processed/${docId}`);
                const globalRef = db.doc(`iap_global/${c.key}`);

                const [snap, gSnap] = await Promise.all([t.get(pRef), t.get(globalRef)]);
                if (snap.exists || gSnap.exists) continue;

                pendingRewards.push({ ref: pRef, gRef: globalRef, candidate: c });
                delta += c.amount;
            }

            for (const entry of pendingRewards) {
                const data = {
                    uid,
                    productId: entry.candidate.productId,
                    key: entry.candidate.key,
                    amount: entry.candidate.amount,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    source: 'revenuecat',
                };
                t.set(entry.ref, data);
                t.set(entry.gRef, data);
            }

            if (delta > 0) {
                t.set(
                    privateRef,
                    {
                        pins: admin.firestore.FieldValue.increment(delta),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    },
                    { merge: true }
                );
                grantedPins = delta;
            }
        });
    }

    return { grantedPins, subscription };
}

export const syncRevenueCatPurchases = functions.runWith({ secrets: ['REVENUECAT_SECRET_KEY'] }).https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    try {
        const res = await syncRevenueCatPurchasesImpl(uid);
        return { success: true, ...res };
    } catch (e: any) {
        const msg = e?.message || 'Sync RevenueCat échoué';
        logger.error('syncRevenueCatPurchases failed', { uid, msg });
        throw new functions.https.HttpsError('internal', msg);
    }
});

export const buyItemWithPins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const itemType = typeof data?.itemType === 'string' ? data.itemType : '';
    const requestId = typeof data?.requestId === 'string' ? data.requestId : '';

    const PIN_COST_BY_ITEM: Record<string, number> = {
        INVITE: 60,
        INVITE_BUNDLE_5: 250,
        INVITE_BUNDLE_15: 650,
        SUPER_INVITE: 120,
        SUPER_INVITE_BUNDLE_5: 500,
        SUPER_INVITE_BUNDLE_15: 1100,
        BOOST: 300,
        BOOST_BUNDLE_5: 1200,
        UNLOCK_LIKE: 30,
        UNLOCK_LIKE_BUNDLE_10: 250,
        UNDO: 20,
        UNDO_BUNDLE_10: 150,
    };

    const cost = PIN_COST_BY_ITEM[itemType];
    if (!itemType || typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Article invalide');
    }
    if (!requestId || requestId.length < 8 || requestId.length > 80) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId invalide');
    }
    
    const userRef = db.doc(`users/${uid}/private/settings`);
    const processedRef = db.doc(`pin_spends/${uid}_${requestId}`);
    
    await db.runTransaction(async (t) => {
        const processed = await t.get(processedRef);
        if (processed.exists) {
            return;
        }
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
        } else if (itemType === 'UNDO') {
             updates.bonusUndos = admin.firestore.FieldValue.increment(1);
        } else if (itemType === 'UNDO_BUNDLE_10') {
             updates.bonusUndos = admin.firestore.FieldValue.increment(10);
        }
        
        t.set(userRef, updates, { merge: true });
        t.set(processedRef, {
            uid,
            itemType,
            cost,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    
    return { success: true };
});

export const claimEarnPins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const type = typeof data?.type === 'string' ? data.type : '';
    const requestId = typeof data?.requestId === 'string' ? data.requestId : '';

    const REWARD_BY_TYPE: Record<string, { amount: number; cooldownMs: number; lastKey: 'lastProfileSharedAt' | 'lastAppSharedAt' }> = {
        share_profile: { amount: 10, cooldownMs: 7 * 24 * 60 * 60 * 1000, lastKey: 'lastProfileSharedAt' },
        share_app: { amount: 5, cooldownMs: 24 * 60 * 60 * 1000, lastKey: 'lastAppSharedAt' },
    };
    const def = REWARD_BY_TYPE[type];
    if (!def) {
        throw new functions.https.HttpsError('invalid-argument', 'Type invalide');
    }
    if (!requestId || requestId.length < 8 || requestId.length > 80) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId invalide');
    }

    const privateRef = db.doc(`users/${uid}/private/settings`);
    const processedRef = db.doc(`earn_processed/${uid}_${type}_${requestId}`);
    const now = Date.now();

    let grantedPins = 0;

    await db.runTransaction(async (t) => {
        const processed = await t.get(processedRef);
        if (processed.exists) {
            return;
        }
        const snap = await t.get(privateRef);
        const d = (snap.exists ? snap.data() : {}) as any;
        const rawLast = d?.[def.lastKey] || null;
        const lastMs =
            typeof rawLast === 'number' ? rawLast :
            (rawLast?.toMillis ? rawLast.toMillis() : 0);
        if (lastMs && now - lastMs < def.cooldownMs) {
            throw new functions.https.HttpsError('failed-precondition', 'COOLDOWN');
        }
        t.set(privateRef, {
            pins: admin.firestore.FieldValue.increment(def.amount),
            [def.lastKey]: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        t.set(processedRef, {
            uid,
            type,
            amount: def.amount,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        grantedPins = def.amount;
    });

    return { success: true, grantedPins };
});

export const unlockProfilesWithPins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const requestId = typeof data?.requestId === 'string' ? data.requestId : '';
    const idsRaw: any[] = Array.isArray(data?.profileIds) ? (data.profileIds as any[]) : [];
    const ids: string[] = Array.from(new Set(idsRaw.map((x) => String(x)).filter(Boolean))).slice(0, 50);

    if (!requestId || requestId.length < 8 || requestId.length > 80) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId invalide');
    }
    if (ids.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Aucun profil');
    }

    const privateRef = db.doc(`users/${uid}/private/settings`);
    const processedRef = db.doc(`unlock_processed/${uid}_${requestId}`);
    const UNIT_COST = 30;

    let charged = 0;
    let unlockedCount = 0;
    let unlockedIds: string[] = [];

    await db.runTransaction(async (t) => {
        const processed = await t.get(processedRef);
        if (processed.exists) {
            return;
        }
        const snap = await t.get(privateRef);
        const d = (snap.exists ? snap.data() : {}) as any;
        const currentPins = Number(d?.pins ?? 0);
        const existing = Array.isArray(d?.unlockedLikes) ? new Set<string>(d.unlockedLikes.map(String)) : new Set<string>();
        const toUnlock = ids.filter((id) => !existing.has(id));
        if (toUnlock.length === 0) {
            t.set(processedRef, { uid, profileIds: ids, cost: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            return;
        }
        const bonus = Math.max(0, Number(d?.bonusUnlockLikes ?? 0) || 0);
        const useBonus = Math.min(bonus, toUnlock.length);
        const paidCount = toUnlock.length - useBonus;
        const cost = paidCount * UNIT_COST;
        if (!Number.isFinite(currentPins) || currentPins < cost) {
            throw new functions.https.HttpsError('failed-precondition', 'Pins insuffisants');
        }
        const updates: any = {
            unlockedLikes: admin.firestore.FieldValue.arrayUnion(...toUnlock),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (cost > 0) updates.pins = admin.firestore.FieldValue.increment(-cost);
        if (useBonus > 0) updates.bonusUnlockLikes = admin.firestore.FieldValue.increment(-useBonus);
        t.set(privateRef, updates, { merge: true });
        t.set(processedRef, {
            uid,
            profileIds: toUnlock,
            cost,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        charged = cost;
        unlockedCount = toUnlock.length;
        unlockedIds = toUnlock;
    });

    return { success: true, charged, unlockedCount, unlockedIds };
});

export const claimDailyReward = functions.runWith({ maxInstances: 5 }).https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const userRef = db.doc(`users/${uid}`);
    const privateRef = db.doc(`users/${uid}/private/settings`);

    try {
        let streak = 0;
        let reward: any = null;

        await db.runTransaction(async (t) => {
            const [userSnap, privateSnap] = await Promise.all([t.get(userRef), t.get(privateRef)]);
            const pData = privateSnap.exists ? (privateSnap.data() as any) : {};
            const uData = userSnap.exists ? (userSnap.data() as any) : {};

            const rawLast = pData?.lastDailyRewardClaimedAt || uData?.lastDailyRewardClaimedAt || 0;
            const lastClaimTime =
                typeof rawLast === 'number' ? rawLast :
                (rawLast?.toMillis ? rawLast.toMillis() : 0);

            const rawStreak = pData?.dailyStreak ?? uData?.dailyStreak ?? 0;
            streak = Number(rawStreak) || 0;

            const now = Date.now();
            const lastDate = new Date(lastClaimTime);
            const today = new Date(now);
            const oneDay = 24 * 60 * 60 * 1000;

            if (lastClaimTime && lastDate.toDateString() === today.toDateString()) {
                reward = null;
                return;
            }

            const yesterday = new Date(now - oneDay);
            if (lastClaimTime && lastDate.toDateString() === yesterday.toDateString()) {
                streak = streak + 1;
            } else {
                streak = 1;
            }

            const dayIndex = (streak - 1) % 7;
            const REWARDS = [
              { day: 1, type: 'pins', amount: 5, label: '5 Pins' },
              { day: 2, type: 'invite', amount: 1, label: '1 Invitation' },
              { day: 3, type: 'pins', amount: 10, label: '10 Pins' },
              { day: 4, type: 'undo', amount: 1, label: '1 Undo' },
              { day: 5, type: 'pins', amount: 10, label: '10 Pins' },
              { day: 6, type: 'unlock_like', amount: 1, label: '1 Révélation' },
              { day: 7, type: 'boost', amount: 1, label: '1 Boost' },
            ];
            reward = REWARDS[dayIndex];

            const updatesPrivate: any = {
                lastDailyRewardClaimedAt: now,
                dailyStreak: streak,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            const updatesPublic: any = {
                lastDailyRewardClaimedAt: now,
                dailyStreak: streak,
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

            t.set(privateRef, updatesPrivate, { merge: true });
            t.set(userRef, updatesPublic, { merge: true });
        });

        if (!reward) {
            return { success: false, message: 'Déjà réclamé aujourd\'hui', streak };
        }

        return { success: true, streak, reward };
    } catch (e: any) {
        logger.error('claimDailyReward error', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});
