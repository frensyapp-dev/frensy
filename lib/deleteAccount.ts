// lib/deleteAccount.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteUser, getAuth } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { deleteObject, getStorage, ref } from 'firebase/storage';
import { db } from '../firebaseconfig';
import { getJoinedGroups, quitGroup } from './groups/repo';
import { getUserProfile } from './profile';

/**
 * Supprime toutes les données de l’utilisateur dans Firestore/Storage et tente de supprimer le compte Auth.
 * - Supprime Storage (photos du profil)
 * - Quitte tous les groupes
 * - Supprime positions/{uid}
 * - Supprime users/{uid}
 * - Supprime likes (from==uid ou to==uid)
 * - Supprime chatRequests (from==uid ou to==uid)
 * - Supprime matches où users contient uid, y compris sous-collections messages et status
 * - Purge le cache local AsyncStorage lié au chat pour cet uid
 * - Supprime le compte Firebase Auth (si reauth récente, sinon erreur à afficher à l’appelant)
 */
export async function deleteEntireUserAccount(): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Utilisateur non authentifié');
  const uid = user.uid;

  // 0) Quitter tous les groupes
  try {
    const groups = await getJoinedGroups(uid);
    for (const groupId of groups) {
      try { await quitGroup(uid, groupId); } catch {}
    }
  } catch {}

  // 1) Récupérer profil pour obtenir les chemins Storage à effacer
  try {
    const p = await getUserProfile(uid);
    const storage = getStorage();
    const paths = new Set<string>();
    (p?.photos ?? []).forEach((ph: any) => { if (ph?.path) paths.add(ph.path); });
    if (p?.primaryPhotoPath) paths.add(p.primaryPhotoPath);
    for (const path of paths) {
      try { await deleteObject(ref(storage, path)); } catch {}
    }
  } catch {}

  // 2) Supprimer demandes de chat où je suis émetteur ou destinataire
  try {
    const qFrom = query(collection(db, 'chatRequests'), where('from', '==', uid));
    const qTo = query(collection(db, 'chatRequests'), where('to', '==', uid));
    for (const q of [qFrom, qTo]) {
      const snap = await getDocs(q);
      for (const d of snap.docs) { try { await deleteDoc(d.ref); } catch {} }
    }
  } catch {}

  // 3) Supprimer likes où je suis émetteur ou destinataire
  try {
    const qFrom = query(collection(db, 'likes'), where('from', '==', uid));
    const qTo = query(collection(db, 'likes'), where('to', '==', uid));
    for (const q of [qFrom, qTo]) {
      const snap = await getDocs(q);
      for (const d of snap.docs) { try { await deleteDoc(d.ref); } catch {} }
    }
  } catch {}

  // 3b) Supprimer locationShares (boussole) où je suis émetteur ou destinataire
  try {
    const qFrom = query(collection(db, 'locationShares'), where('from', '==', uid));
    const qTo = query(collection(db, 'locationShares'), where('to', '==', uid));
    for (const q of [qFrom, qTo]) {
      const snap = await getDocs(q);
      for (const d of snap.docs) { try { await deleteDoc(d.ref); } catch {} }
    }
  } catch {}

  // 4) Supprimer matches où users contient uid, y compris sous-collections
  try {
    const qMatches = query(collection(db, 'matches'), where('users', 'array-contains', uid));
    const snap = await getDocs(qMatches);
    for (const d of snap.docs) {
      const matchId = d.id;
      // Sous-collection messages
      try {
        const msgs = await getDocs(collection(db, 'matches', matchId, 'messages'));
        for (const m of msgs.docs) { try { await deleteDoc(m.ref); } catch {} }
      } catch {}
      // Sous-collection status
      try {
        const stats = await getDocs(collection(db, 'matches', matchId, 'status'));
        for (const s of stats.docs) { try { await deleteDoc(s.ref); } catch {} }
      } catch {}
      // Doc de match
      try { await deleteDoc(doc(db, 'matches', matchId)); } catch {}
    }
  } catch {}

  // 5) Supprimer ma position et mon profil
  try { await deleteDoc(doc(db, 'positions', uid)); } catch {}
  try { await deleteDoc(doc(db, 'users', uid)); } catch {}

  // 6) Purge locale des caches liés au chat pour cet uid
  try {
    const keys = await AsyncStorage.getAllKeys();
    const myPrefix = `chat:${uid}:`;
    const toRemove = keys.filter((k) => k.startsWith(myPrefix) || k === 'chat:data:version');
    if (toRemove.length) { await AsyncStorage.multiRemove(toRemove); }
  } catch {}

  // 7) Supprimer le compte Auth (peut échouer si reauth requise)
  try {
    await deleteUser(user);
  } catch (e: any) {
    // Laisser l’appelant gérer l’affichage; ici on relance l’erreur
    throw e;
  }
}

