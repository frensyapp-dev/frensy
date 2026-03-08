// lib/chat/storage.ts
// Facade for chat storage logic (Local Cache + Remote Sync)

import {
  markConversationReadRemote,
  revokeLocationShare,
  sendImageMessageToUser,
  sendRichMessageToUser,
  sendTextMessageToUser,
  createChatRequestRemote,
  respondToChatRequestRemote,
  deleteChatRequestRemote
} from './remoteSync';
import {
  removeConversationLocal,
  setReadAtLocal
} from './localCache';

// Re-export types
export * from './types';

// Re-export Local Cache functions
export * from './localCache';

// Re-export Remote Sync functions
export * from './remoteSync';

// Aliases for backward compatibility
export const createChatRequest = createChatRequestRemote;
export const respondToChatRequest = respondToChatRequestRemote;
export const deleteChatRequest = deleteChatRequestRemote;

// Facade / Combined Functions

/**
 * Marque une conversation comme lue localement et à distance.
 * @param chatId Identifiant de la conversation (matchId)
 * @param at Timestamp de lecture (défaut: maintenant)
 */
export async function markConversationRead(chatId: string, at: number = Date.now()) {
  await setReadAtLocal(chatId, at);
  try {
    await markConversationReadRemote(chatId);
  } catch {}
}

/**
 * Supprime une conversation localement et révoque le partage de position associé.
 * @param id Identifiant de la conversation
 */
export async function removeConversation(id: string) {
  await removeConversationLocal(id);
  try {
    await revokeLocationShare(id);
  } catch {}
}

// Retry wrappers

/**
 * Envoie un message texte avec mécanisme de réessai automatique.
 * @param partnerUid UID du destinataire
 * @param text Contenu du message
 * @param retries Nombre de tentatives (défaut: 2)
 */
export async function sendTextMessageToUserRetry(partnerUid: string, text: string, retries: number = 2): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      await sendTextMessageToUser(partnerUid, text);
      return;
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      attempt++;
    }
  }
}

/**
 * Envoie une image avec mécanisme de réessai automatique.
 * @param partnerUid UID du destinataire
 * @param imageUrl URL de l'image
 */
export async function sendImageMessageToUserRetry(partnerUid: string, imageUrl: string, imageW?: number, imageH?: number, retries: number = 2): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      await sendImageMessageToUser(partnerUid, imageUrl, imageW, imageH);
      return;
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      attempt++;
    }
  }
}

import { collection, doc } from 'firebase/firestore';
import { db } from '../../firebaseconfig';

/**
 * Envoie un message enrichi (texte, image, vidéo) avec réessai.
 * Gère aussi les réponses (replyTo).
 */
export async function sendRichMessageToUserRetry(
  partnerUid: string, 
  text: string | null, 
  imageUrl: string | null, 
  imageW?: number, 
  imageH?: number, 
  retries: number = 2,
  replyTo?: { id: string; text: string | null; senderName: string } | null,
  mediaType: 'image' | 'video' = 'image'
): Promise<void> {
  // Générer un ID unique pour le message afin d'assurer l'idempotence (éviter les doublons en cas de retry)
  const tempCol = collection(db, 'matches', 'temp', 'messages'); // Collection fictive juste pour générer l'ID
  const messageId = doc(tempCol).id;

  let attempt = 0;
  while (true) {
    try {
      await sendRichMessageToUser(partnerUid, text, imageUrl, imageW, imageH, replyTo, mediaType, messageId);
      return;
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      attempt++;
    }
  }
}
