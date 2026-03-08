// lib/exportData.ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
// Note: no expo-sharing import; we use web clipboard if available.
import { auth, db } from '../firebaseconfig';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

type ExportResult = { fileUri?: string; content?: string; size?: number };

export async function exportMyData(): Promise<ExportResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Utilisateur non authentifié');

  const res: any = { meta: { user: uid, exportedAt: new Date().toISOString(), version: 1 } };

  // Profil et position
  try { res.profile = (await getDoc(doc(db, 'users', uid))).data() ?? null; } catch { res.profile = null; }
  try { res.position = (await getDoc(doc(db, 'positions', uid))).data() ?? null; } catch { res.position = null; }

  // Likes et demandes de chat
  res.likes = { outgoing: [], incoming: [] };
  try {
    const qOut = query(collection(db, 'likes'), where('from', '==', uid));
    const qIn = query(collection(db, 'likes'), where('to', '==', uid));
    const [outSnap, inSnap] = await Promise.all([getDocs(qOut), getDocs(qIn)]);
    res.likes.outgoing = outSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.likes.incoming = inSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}

  res.chatRequests = { outgoing: [], incoming: [] };
  try {
    const qOut = query(collection(db, 'chatRequests'), where('from', '==', uid));
    const qIn = query(collection(db, 'chatRequests'), where('to', '==', uid));
    const [outSnap, inSnap] = await Promise.all([getDocs(qOut), getDocs(qIn)]);
    res.chatRequests.outgoing = outSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.chatRequests.incoming = inSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}

  // Matches avec sous-collections (messages: limite 200)
  res.matches = [];
  try {
    const qMatches = query(collection(db, 'matches'), where('users', 'array-contains', uid));
    const snap = await getDocs(qMatches);
    for (const d of snap.docs) {
      const match: any = { id: d.id, ...d.data(), messages: [], status: [] };
      try {
        const msgs = await getDocs(collection(db, 'matches', d.id, 'messages'));
        const list = msgs.docs.map((m) => ({ id: m.id, ...m.data() }));
        match.messages = list.slice(-200); // par sécurité
      } catch {}
      try {
        const stats = await getDocs(collection(db, 'matches', d.id, 'status'));
        match.status = stats.docs.map((s) => ({ id: s.id, ...s.data() }));
      } catch {}
      res.matches.push(match);
    }
  } catch {}

  // Blocks et reports
  res.blocks = { byMe: [], againstMe: [] };
  try {
    const qBy = query(collection(db, 'blocks'), where('from', '==', uid));
    const qAg = query(collection(db, 'blocks'), where('to', '==', uid));
    const [bySnap, agSnap] = await Promise.all([getDocs(qBy), getDocs(qAg)]);
    res.blocks.byMe = bySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.blocks.againstMe = agSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}
  res.reports = [];
  try {
    const qRep = query(collection(db, 'reports'), where('from', '==', uid));
    const repSnap = await getDocs(qRep);
    res.reports = repSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}

  const content = JSON.stringify(res, null, 2);

  if (Platform.OS === 'web') {
    try {
      // Tentative de copie dans le presse-papiers (web)
      // @ts-ignore
      if (navigator?.clipboard?.writeText) {
        // @ts-ignore
        await navigator.clipboard.writeText(content);
      }
    } catch {}
    return { content, size: content.length };
  }

  const cacheDir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory || '';
  const fileUri = `${cacheDir}frensy_export_${uid}_${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(fileUri, content, { encoding: 'utf8' as any });
  return { fileUri, size: content.length };
}
