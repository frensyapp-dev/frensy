import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../firebaseconfig';
import { getMatchId } from '../matches';
import { saveMessages, touchConversation, unremoveConversation } from './localCache';
import { ChatMessage, ChatRequest, MatchSummary } from './types';

// Échapper le texte pour éviter toute injection HTML dans les rendus
export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ensureAuth(): string {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Utilisateur non authentifié');
  return me;
}

function chatCollectionForUsers(partnerUid: string) {
  const me = ensureAuth();
  const chatId = getMatchId(me, partnerUid);
  return { chatId, col: collection(db, 'matches', chatId, 'messages') };
}

export async function markConversationReadRemote(chatId: string) {
    const uid = auth.currentUser?.uid;
    if (uid) {
      await updateDoc(doc(db, 'matches', chatId), {
        [`readAt_${uid}`]: serverTimestamp()
      });
    }
}

export async function revokeLocationShare(chatId: string) {
    const uid = auth.currentUser?.uid;
    if (uid) {
        const shareId = `${uid}_${chatId}`;
        await setDoc(doc(db, 'locationShares', shareId), { active: false, revoked: true, updatedAt: serverTimestamp() }, { merge: true });
    }
}

export async function createChatRequestRemote(targetUid: string, messageText?: string, imageUrl?: string, imageW?: number, imageH?: number, isSuper: boolean = false): Promise<void> {
  const me = ensureAuth();

  

  // Empêcher les doublons: une demande en attente existante entre les mêmes utilisateurs
  try {
    const pairId = `${me}_${targetUid}`;
    const snap = await getDoc(doc(db, 'chatRequests', pairId));
    if (snap.exists() && (snap.data() as any)?.status === 'pending') {
      throw new Error('Une invitation en attente existe déjà.');
    }
  } catch (e: any) {
    if (e.message === 'Une invitation en attente existe déjà.') throw e;
  }
  
  // Vérifier s'il y a déjà un match
  try {
    const matchId = getMatchId(me, targetUid);
    const matchDoc = await getDoc(doc(db, 'matches', matchId));
    if (matchDoc.exists()) {
       throw new Error('Vous êtes déjà en relation avec cet utilisateur.');
    }
  } catch (e: any) {
    if (e.message === 'Vous êtes déjà en relation avec cet utilisateur.') throw e;
  }

  // Idempotent: écrire sous id fixe from_to
  await setDoc(
    doc(db, 'chatRequests', `${me}_${targetUid}`),
    {
      from: me,
      to: targetUid,
      status: 'pending',
      messageText: (messageText ?? '').trim().length > 0 ? sanitizeText(messageText!.trim()) : null,
      imageUrl: imageUrl || null,
      imageW: typeof imageW === 'number' ? imageW : null,
      imageH: typeof imageH === 'number' ? imageH : null,
      isSuper,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function respondToChatRequestRemote(fromUid: string, decision: 'accepted' | 'rejected'): Promise<void> {
  const me = ensureAuth();
  
  // Trouver la demande en attente correspondante
  const q = query(collection(db, 'chatRequests'), where('from', '==', fromUid), where('to', '==', me), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  const target = snap.docs[0];
  if (!target) throw new Error('Invitation introuvable');
  
  

  const reqData = target.data();
  await updateDoc(target.ref, { status: decision, updatedAt: serverTimestamp() });

  // Note: La création du match et du premier message est gérée par une Cloud Function (onChatRequestWrite)
  // pour éviter les problèmes de permissions et garantir la cohérence.
}

export async function deleteChatRequestRemote(fromUid: string): Promise<void> {
  const me = ensureAuth();
  const q = query(collection(db, 'chatRequests'), where('from', '==', fromUid), where('to', '==', me));
  const snap = await getDocs(q);
  const target = snap.docs[0];
  if (!target) return;
  await deleteDoc(target.ref);
}

export function listenMyChatInvitations(cb: (reqs: ChatRequest[]) => void): () => void {
  const me = auth.currentUser?.uid;
  if (!me) return () => {};
  const q = query(collection(db, 'chatRequests'), where('to', '==', me));
  return onSnapshot(q, (snap) => {
    const list: ChatRequest[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({ 
        id: d.id, 
        from: data.from, 
        to: data.to, 
        status: data.status, 
        messageText: data.messageText, 
        imageUrl: data.imageUrl, 
        imageW: data.imageW, 
        imageH: data.imageH,
        isSuper: data.isSuper 
      });
    });
    cb(list);
  });
}

export function listenMyOutgoingInvitations(cb: (reqs: ChatRequest[]) => void): () => void {
  const me = auth.currentUser?.uid;
  if (!me) return () => {};
  // Listen for pending requests sent by me
  const q = query(collection(db, 'chatRequests'), where('from', '==', me), where('status', '==', 'pending'));
  return onSnapshot(q, (snap) => {
    const list: ChatRequest[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({ 
        id: d.id, 
        from: data.from, 
        to: data.to, 
        status: data.status, 
        messageText: data.messageText, 
        imageUrl: data.imageUrl, 
        imageW: data.imageW, 
        imageH: data.imageH,
        isSuper: data.isSuper 
      });
    });
    cb(list);
  });
}

// Réconciliation: crée le document de match si les 2 likes existent
export async function ensureMatchExistsWithLikes(partnerUid: string): Promise<boolean> {
  const me = ensureAuth();
  // Vérifier les deux docs likes spécifiques (get est autorisé par les règles)
  const mine = await getDoc(doc(db, 'likes', `${me}_${partnerUid}`));
  const theirs = await getDoc(doc(db, 'likes', `${partnerUid}_${me}`));
  if (mine.exists() && theirs.exists()) {
    const matchId = getMatchId(me, partnerUid);
    await setDoc(
      doc(db, 'matches', matchId),
      { users: [me, partnerUid], createdAt: serverTimestamp(), lastMessageAt: serverTimestamp() },
      { merge: true }
    );
    return true;
  }
  return false;
}

export function listenMessagesForUser(partnerUid: string, cb: (msgs: ChatMessage[]) => void, onError?: (err: any) => void): () => void {
  const { chatId, col } = chatCollectionForUsers(partnerUid);
  
  try {
      // Limit to last 50 messages to prevent massive reads
      const q = query(col, orderBy('createdAt', 'desc'), limit(50));
      return onSnapshot(q, (snap) => {
        const res: ChatMessage[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          const ts = data.createdAt?.toMillis?.() ?? Date.now();
          res.push({
            id: d.id,
            senderId: data.senderId,
            text: data.text ?? '',
            createdAt: ts,
            imageUrl: data.imageUrl || null,
            imageW: data.imageW || null,
            imageH: data.imageH || null,
            replyTo: data.replyTo || null,
          });
        });
        // Reverse because we queried desc for limit, but UI expects asc or handled by merge
        res.reverse();
        
        saveMessages(chatId, res).catch(() => {});
        const last = res[res.length - 1];
        if (last) {
            const summary = (last.text && last.text.trim().length > 0 ? last.text : '');
            touchConversation(chatId, summary, last.createdAt, last.senderId).catch(() => {});
        }
        cb(res);
      }, (err) => {
        try { onError?.(err); } catch {}
      });
  } catch (e) {
      try { onError?.(e); } catch {}
      return () => {};
  }
}

export async function sendTextMessageToUser(partnerUid: string, text: string) {
  const me = ensureAuth();
  const { chatId, col } = chatCollectionForUsers(partnerUid);
  const safeText = sanitizeText(text.trim());
  await addDoc(col, {
    senderId: me,
    text: safeText,
    createdAt: serverTimestamp(),
  } as any);

  try {
    await setDoc(doc(db, 'matches', chatId), {
      users: [me, partnerUid],
      lastMessageAt: serverTimestamp(),
      lastMessageText: safeText,
      lastSenderId: me,
    }, { merge: true });
  } catch {}
}

export async function sendImageMessageToUser(partnerUid: string, imageUrl: string, imageW?: number, imageH?: number) {
  const me = ensureAuth();
  const { chatId, col } = chatCollectionForUsers(partnerUid);
  await addDoc(col, {
    senderId: me,
    text: null,
    imageUrl,
    imageW: typeof imageW === 'number' ? imageW : null,
    imageH: typeof imageH === 'number' ? imageH : null,
    createdAt: serverTimestamp(),
  } as any);

  try {
    await setDoc(doc(db, 'matches', chatId), {
    users: [me, partnerUid], 
    lastMessageAt: serverTimestamp(),
    lastMessageText: '📷 Image',
    lastSenderId: me,
  }, { merge: true });
  } catch {}
}

export function listenMyMatches(cb: (list: MatchSummary[]) => void): () => void {
  const me = auth.currentUser?.uid;
  if (!me) return () => {};
  const q = query(collection(db, 'matches'), where('users', 'array-contains', me));
  return onSnapshot(q, (snap) => {
    const arr: MatchSummary[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      const readStatus: Record<string, any> = {};
      Object.keys(data).forEach(k => {
        if (k.startsWith('readAt_')) {
          const uid = k.replace('readAt_', '');
          readStatus[uid] = data[k];
        }
      });
      arr.push({ 
        id: d.id, 
        users: data.users || [], 
        createdAt: data.createdAt,
        lastMessageAt: data.lastMessageAt,
        lastMessageText: data.lastMessageText,
        lastSenderId: data.lastSenderId,
        readStatus
      });
    });
    cb(arr);
  });
}

export async function sendRichMessageToUser(
  partnerUid: string, 
  text: string | null, 
  _imageUrl: string | null, 
  _imageW?: number, 
  _imageH?: number,
  replyTo?: { id: string; text: string | null; senderName: string } | null,
  mediaType: 'image' | 'video' = 'image',
  messageId?: string
) {
  const me = ensureAuth();

  

  const { chatId, col } = chatCollectionForUsers(partnerUid);
  const safeText = (text && text.trim().length > 0) ? sanitizeText(text.trim()) : null;
  
  const batch = writeBatch(db);

  // 1. Préparer le message
  const msgRef = messageId ? doc(col, messageId) : doc(col);
  const msgData: any = {
    senderId: me,
    text: safeText,
    createdAt: serverTimestamp(),
  };
  if (_imageUrl) {
    msgData.imageUrl = _imageUrl;
    msgData.mediaType = mediaType;
    if (_imageW) msgData.imageW = _imageW;
    if (_imageH) msgData.imageH = _imageH;
  }
  if (replyTo) {
    msgData.replyTo = replyTo;
  }
  
  batch.set(msgRef, msgData);

  // 2. Mettre à jour la conversation
  const matchRef = doc(db, 'matches', chatId);
  batch.set(matchRef, {
    users: [me, partnerUid],
    lastMessageAt: serverTimestamp(),
    lastMessageText: safeText || (mediaType === 'video' ? '🎥 Vidéo' : 'Message'),
    lastSenderId: me,
  }, { merge: true });

  // S'assurer que la conversation n'est plus marquée comme supprimée (locale)
  try { await unremoveConversation(chatId); } catch {}

  // 3. Logique de score (tous les 10 messages) - Hors transaction pour éviter de bloquer l'envoi
  const userRef = doc(db, 'users', me);
  updateDoc(userRef, { messagesSentCount: increment(1) }).catch(e => {
    console.warn('Erreur update score:', e);
  });

  await batch.commit();
}

export async function setTyping(partnerUid: string, isTyping: boolean) {
  const me = auth.currentUser?.uid;
  if (!me) return;
  const matchId = getMatchId(me, partnerUid);
  try {
    await updateDoc(doc(db, 'matches', matchId), {
      [`typing_${me}`]: isTyping
    });
  } catch {}
}

export async function loadMoreMessages(partnerUid: string, lastCreatedAt: number, limitCount: number = 20): Promise<ChatMessage[]> {
  const { col } = chatCollectionForUsers(partnerUid);
  const dateLimit = new Date(lastCreatedAt);

  const q = query(
    col,
    orderBy('createdAt', 'desc'),
    where('createdAt', '<', dateLimit),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  const res: ChatMessage[] = [];
  snap.forEach((d) => {
    const data = d.data() as any;
    const ts = data.createdAt?.toMillis?.() ?? Date.now();
    res.push({
      id: d.id,
      senderId: data.senderId,
      text: data.text ?? '',
      createdAt: ts,
      imageUrl: data.imageUrl || null,
      imageW: data.imageW || null,
      imageH: data.imageH || null,
      replyTo: data.replyTo || null,
    });
  });
  return res;
}
