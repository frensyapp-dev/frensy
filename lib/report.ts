import { auth, db } from '../firebaseconfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export type ReportReason = 'spam' | 'fake' | 'harassment' | 'inappropriate' | 'other';

export async function reportUser(targetUid: string, reason: ReportReason, message?: string) {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Utilisateur non authentifié');
  await addDoc(collection(db, 'reports'), {
    reporter: me,
    reported: targetUid,
    type: 'user',
    reason,
    message: message || null,
    createdAt: serverTimestamp(),
  });
}

export async function reportGroup(groupId: string, reason: ReportReason, message?: string) {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Utilisateur non authentifié');
  await addDoc(collection(db, 'reports'), {
    reporter: me,
    reportedGroup: groupId,
    type: 'group',
    reason,
    message: message || null,
    createdAt: serverTimestamp(),
  });
}

export async function reportMessage(messageId: string, contextId: string, reason: ReportReason, message?: string, isGroup: boolean = true) {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Utilisateur non authentifié');
  await addDoc(collection(db, 'reports'), {
    reporter: me,
    reportedMessage: messageId,
    contextId: contextId,
    contextType: isGroup ? 'group' : 'chat',
    type: 'message',
    reason,
    message: message || null,
    createdAt: serverTimestamp(),
  });
}

