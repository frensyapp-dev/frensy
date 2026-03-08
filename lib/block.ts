import { arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebaseconfig';

export async function blockUser(targetUid: string) {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Utilisateur non authentifié');
  
  const batch = writeBatch(db);

  // 1. Créer le blocage
  const ref = doc(db, 'blocks', me, 'users', targetUid);
  batch.set(ref, { blocker: me, blocked: targetUid, createdAt: serverTimestamp() });

  // 2. Mettre à jour le doc d'exclusions pour le filtrage rapide (Discover/Map)
  const exRef = doc(db, 'exclusions', me);
  batch.set(exRef, { blocked: arrayUnion(targetUid) }, { merge: true });

  // 3. Désactiver les partages de localisation (dans les deux sens)
  // Mon partage vers l'utilisateur bloqué
  const q1 = query(collection(db, 'locationShares'), where('from', '==', me), where('to', '==', targetUid));
  const snap1 = await getDocs(q1);
  snap1.forEach(d => {
    batch.update(d.ref, { active: false, revoked: true, updatedAt: serverTimestamp() });
  });

  // Le partage de l'utilisateur bloqué vers moi (autorisé par les règles car je suis destinataire)
  const q2 = query(collection(db, 'locationShares'), where('from', '==', targetUid), where('to', '==', me));
  const snap2 = await getDocs(q2);
  snap2.forEach(d => {
    batch.update(d.ref, { active: false, revoked: true, updatedAt: serverTimestamp() });
  });

  // 4. Supprimer le match (empêche la discussion future)
  const matchId = me < targetUid ? `${me}_${targetUid}` : `${targetUid}_${me}`;
  const matchRef = doc(db, 'matches', matchId);
  batch.delete(matchRef);

  await batch.commit();
}

export async function unblockUser(targetUid: string) {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Utilisateur non authentifié');
  const ref = doc(db, 'blocks', me, 'users', targetUid);
  
  const batch = writeBatch(db);
  batch.delete(ref);
  
  // Retirer des exclusions
  const exRef = doc(db, 'exclusions', me);
  batch.set(exRef, { blocked: arrayRemove(targetUid) }, { merge: true });
  
  await batch.commit();
}

export async function isBlockedByMe(targetUid: string): Promise<boolean> {
  const me = auth.currentUser?.uid;
  if (!me) return false;
  const ref = doc(db, 'blocks', me, 'users', targetUid);
  const snap = await getDoc(ref);
  return snap.exists();
}

export async function hasBlockedMe(otherUid: string): Promise<boolean> {
  const me = auth.currentUser?.uid;
  if (!me) return false;
  const ref = doc(db, 'blocks', otherUid, 'users', me);
  const snap = await getDoc(ref);
  return snap.exists();
}

