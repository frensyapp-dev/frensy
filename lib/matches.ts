// lib/matches.ts
import { auth, db } from '../firebaseconfig';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

export function getMatchId(a: string, b: string) {
  return [a, b].sort().join('_');
}

export async function likeUser(targetUid: string) {
  const me = auth.currentUser?.uid;
  if (!me) return;

  // 1) J’aime — écraser le doc pour respecter strictement les clés autorisées
  await setDoc(
    doc(db, 'likes', `${me}_${targetUid}`),
    { from: me, to: targetUid, createdAt: serverTimestamp() }
  );

  // 1b) Enregistrer le swipe pour ne plus proposer ce profil dans Discover
  // On utilise setDoc pour être sûr que le doc existe
  await setDoc(
    doc(db, 'swipes', me, 'outgoing', targetUid),
    { v: 1, at: serverTimestamp() } // v=1 (like), v=-1 (pass)
  );

  // 2) Si l’autre m’a déjà liké → match
  const reverse = await getDoc(doc(db, 'likes', `${targetUid}_${me}`));
  if (reverse.exists()) {
    const matchId = getMatchId(me, targetUid);
    await setDoc(
      doc(db, 'matches', matchId),
      {
        users: [me, targetUid],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}
