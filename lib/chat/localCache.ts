import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../../firebaseconfig';
import { ChatMessage, Conversation } from './types';

// Clés de stockage portées par utilisateur pour éviter la fuite entre comptes
const currentUidForStorage = () => auth.currentUser?.uid ?? 'anon';
const kMsgs = (uid: string, id: string) => `chat:${uid}:messages:${id}`;
const kConvos = (uid: string) => `chat:${uid}:conversations`;
const kRead = (uid: string, id: string) => `chat:${uid}:last_read:${id}`;
const kChatDataVersion = `chat:data:version`;
const kRemoved = (uid: string) => `chat:${uid}:removed`;
const kInviteCooldown = (uid: string, targetUid: string) => `chat:${uid}:invite:last:${targetUid}`;
const INVITE_COOLDOWN_MS = 90 * 1000; // 90s

export async function loadMessages(chatId: string): Promise<ChatMessage[]> {
  const raw = await AsyncStorage.getItem(kMsgs(currentUidForStorage(), chatId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveMessages(chatId: string, msgs: ChatMessage[]) {
  await AsyncStorage.setItem(kMsgs(currentUidForStorage(), chatId), JSON.stringify(msgs));
}

export async function appendMessage(chatId: string, msg: ChatMessage) {
  const existing = await loadMessages(chatId);
  const merged = [...existing, msg];
  await saveMessages(chatId, merged);
  const summary = (msg.text && msg.text.trim().length > 0) ? msg.text : '';
  await touchConversation(chatId, summary, msg.createdAt);
}

export async function loadConversations(): Promise<Conversation[]> {
  const uid = currentUidForStorage();
  const raw = await AsyncStorage.getItem(kConvos(uid));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    const list = Array.isArray(arr) ? arr : [];
    try {
      const removedRaw = await AsyncStorage.getItem(kRemoved(uid));
      const removed: string[] = removedRaw ? JSON.parse(removedRaw) : [];
      return list.filter((c: Conversation) => !removed.includes(c.id));
    } catch {
      return list;
    }
  } catch {
    return [];
  }
}

export async function saveConversations(convos: Conversation[]) {
  await AsyncStorage.setItem(kConvos(currentUidForStorage()), JSON.stringify(convos));
}

export async function upsertConversation(c: Conversation) {
  const uid = currentUidForStorage();
  try {
    const removedRaw = await AsyncStorage.getItem(kRemoved(uid));
    const removed: string[] = removedRaw ? JSON.parse(removedRaw) : [];
    if (removed.includes(c.id)) return;
  } catch {}
  const list = await loadConversations();
  const idx = list.findIndex((x) => x.id === c.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...c };
  else list.unshift(c);
  await saveConversations(list);
}

export async function touchConversation(id: string, text: string, at: number, senderId?: string) {
  const list = await loadConversations();
  const idx = list.findIndex((x) => x.id === id);
  const patch = { lastMessageText: text, lastMessageAt: at, lastSenderId: senderId };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch };
  } else {
    list.unshift({ id, title: `Chat ${id}`, partnerUid: senderId || '', ...patch } as any);
  }
  await saveConversations(list);
}

// Purge des conversations de démo injectées auparavant
const DEMO_IDS = new Set(['lina','pink','heloise','naomie','ines','chloe']);
const DEMO_TITLES = new Set(['Lina','💗','Héloïse','naomie ♡','Inès 🇪🇸','chloe']);

export async function purgeDemoConversations(): Promise<void> {
  const list = await loadConversations();
  if (!list || list.length === 0) return;
  const toRemove = list.filter(c => DEMO_IDS.has(c.id) || (c.title && DEMO_TITLES.has(c.title)));
  if (toRemove.length === 0) return;
  const keep = list.filter(c => !DEMO_IDS.has(c.id) && !(c.title && DEMO_TITLES.has(c.title)));
  await saveConversations(keep);
  // Nettoyer messages et états de lecture associés
  for (const c of toRemove) {
    try {
      const uid = currentUidForStorage();
      await AsyncStorage.removeItem(kMsgs(uid, c.id));
      await AsyncStorage.removeItem(kRead(uid, c.id));
    } catch {}
  }
}

// Migration versionnée (exécutée une seule fois par appareil)
export async function ensureChatDataMigrated(): Promise<void> {
  const current = await AsyncStorage.getItem(kChatDataVersion);
  if (current !== '2' && current !== '3') {
    // Étape v2: purge des conversations de démo
    await purgeDemoConversations();
    await AsyncStorage.setItem(kChatDataVersion, '2');
  }
  // Étape v3: bascule des clés globales vers clés par utilisateur et purge des anciennes
  const afterV2 = await AsyncStorage.getItem(kChatDataVersion);
  if (afterV2 !== '3') {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const oldMsgKeys = keys.filter((k) => k.startsWith('chat:messages:'));
      const oldReadKeys = keys.filter((k) => k.startsWith('chat:last_read:'));
      const oldConvosKey = 'chat:conversations';
      for (const k of oldMsgKeys) { try { await AsyncStorage.removeItem(k); } catch {} }
      for (const k of oldReadKeys) { try { await AsyncStorage.removeItem(k); } catch {} }
      try { await AsyncStorage.removeItem(oldConvosKey); } catch {}
    } catch {}
    await AsyncStorage.setItem(kChatDataVersion, '3');
  }
}

// Lecture: timestamp de dernière ouverture de conversation
export async function getReadAt(chatId: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(kRead(currentUidForStorage(), chatId));
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function setReadAtLocal(chatId: string, at: number = Date.now()) {
  await AsyncStorage.setItem(kRead(currentUidForStorage(), chatId), String(at));
}

export async function getRemovedConversationIds(): Promise<string[]> {
  const uid = currentUidForStorage();
  try {
    const removedRaw = await AsyncStorage.getItem(kRemoved(uid));
    return removedRaw ? JSON.parse(removedRaw) : [];
  } catch {
    return [];
  }
}

export async function unremoveConversation(id: string) {
  const uid = currentUidForStorage();
  try {
    const removedRaw = await AsyncStorage.getItem(kRemoved(uid));
    const removed: string[] = removedRaw ? JSON.parse(removedRaw) : [];
    const next = removed.filter((x) => x !== id);
    await AsyncStorage.setItem(kRemoved(uid), JSON.stringify(next));
  } catch {}
}

export async function removeConversationLocal(id: string) {
    const uid = currentUidForStorage();
    const list = await loadConversations();
    const keep = list.filter(c => c.id !== id);
    await saveConversations(keep);
    
    try {
      await AsyncStorage.removeItem(`chat:${uid}:messages:${id}`);
      await AsyncStorage.removeItem(`chat:${uid}:last_read:${id}`);
    } catch {}
    try {
      const removedRaw = await AsyncStorage.getItem(kRemoved(uid));
      const removed: string[] = removedRaw ? JSON.parse(removedRaw) : [];
      if (!removed.includes(id)) {
        removed.push(id);
        await AsyncStorage.setItem(kRemoved(uid), JSON.stringify(removed));
      }
    } catch {}
}

export async function checkInviteCooldown(uid: string, targetUid: string) {
    const lastRaw = await AsyncStorage.getItem(kInviteCooldown(uid, targetUid));
    const last = lastRaw ? Number(lastRaw) : 0;
    if (Number.isFinite(last) && Date.now() - last < INVITE_COOLDOWN_MS) {
      throw new Error('Veuillez patienter avant de renvoyer une invitation.');
    }
}

export async function setInviteCooldown(uid: string, targetUid: string) {
    await AsyncStorage.setItem(kInviteCooldown(uid, targetUid), String(Date.now()));
}
