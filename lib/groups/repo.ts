import { getAuth } from 'firebase/auth'
import { addDoc, collection, doc, documentId, DocumentSnapshot, getDoc, getDocs, limit, orderBy, query, startAfter, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '../../firebaseconfig'
import { validateMessage } from '../moderation'

export type Group = {
  id: string
  name: string
  memberCount: number
  city?: string
  description?: string
  ageLock?: 'adult'
}

export async function listGroups(options?: {
  limit?: number
  lastDoc?: DocumentSnapshot
  search?: string
  sortBy?: 'popular' | 'recent'
}): Promise<{ groups: Group[]; lastDoc: DocumentSnapshot | null; fetchedCount?: number }> {
  const uid = getAuth().currentUser?.uid;

  let q = collection(db, 'groups') as any

  if (options?.search) {
    // Note: Firestore does not support native full-text search.
    // We use a simple prefix match here (case-sensitive usually).
    // For production, use Algolia or similar.
    q = query(q, where('name', '>=', options.search), where('name', '<=', options.search + '\uf8ff'))
  } else {
    if (options?.sortBy === 'popular') {
      q = query(q, orderBy('memberCount', 'desc'))
    } else {
      // Default to recent or just consistent order
      q = query(q, orderBy('name')) // or createdAt if available
    }
  }

  if (options?.limit) {
    q = query(q, limit(options.limit))
  }

  if (options?.lastDoc) {
    q = query(q, startAfter(options.lastDoc))
  }

  const snap = await getDocs(q)
  let groups = snap.docs.map(d => ({
    id: d.id,
    name: (d.data() as any).name || 'Groupe',
    memberCount: (d.data() as any).memberCount || 0,
    city: (d.data() as any).city,
    description: (d.data() as any).description,
    ageLock: (d.data() as any).ageLock,
  }))

  return { 
    groups, 
    lastDoc: (snap.docs[snap.docs.length - 1] as DocumentSnapshot) || null,
    fetchedCount: snap.docs.length 
  }
}

export async function createGroup(data: { name: string; description?: string }): Promise<string> {
  const uid = getAuth().currentUser?.uid
  if (!uid) throw new Error('Utilisateur non authentifié')
  
  // App 18+ : tous les groupes sont marqués 'adult'
  const ageLock: 'adult' = 'adult';

  const batch = writeBatch(db);
  
  // Create group doc ref
  const groupRef = doc(collection(db, 'groups'));
  
  batch.set(groupRef, {
    ...data,
    ageLock,
    createdBy: uid,
    createdAt: Date.now(),
    memberCount: 0,
  });

  // Add creator as member
  const memberRef = doc(db, 'groups', groupRef.id, 'members', uid);
  batch.set(memberRef, {
    userId: uid,
    joinedAt: Date.now(),
    role: 'admin'
  });

  // Add group to user's joined_groups subcollection
  const joinedGroupRef = doc(db, 'users', uid, 'joined_groups', groupRef.id);
  batch.set(joinedGroupRef, {
    joinedAt: Date.now(),
    role: 'admin'
  });

  await batch.commit();

  return groupRef.id
}



export async function joinGroup(uid: string, groupId: string): Promise<void> {
  // Charger le groupe et le profil (si besoin)
  const [group] = await Promise.all([
     getGroup(groupId),
  ]);
  
  if (!group) throw new Error("Groupe introuvable");

  // Tentative 1: Méthode complète avec incrément (peut échouer selon les règles)
  try {
    const batch = writeBatch(db);
    
    // Add member
    const memberRef = doc(db, 'groups', groupId, 'members', uid);
    batch.set(memberRef, {
      userId: uid,
      joinedAt: Date.now()
    });

    // Add group to user's joined_groups subcollection
    const joinedGroupRef = doc(db, 'users', uid, 'joined_groups', groupId);
    batch.set(joinedGroupRef, {
      joinedAt: Date.now()
    });
    
    // Increment member count - REMOVED because Cloud Function onGroupMemberWrite handles it
    // const groupRef = doc(db, 'groups', groupId);
    // batch.update(groupRef, { memberCount: increment(1) });

    await batch.commit();
  } catch (e: any) {
    console.warn("joinGroup: full batch failed, retrying without increment", e);
    // Tentative 2: Fallback sans toucher au compteur du groupe (pour contourner les règles strictes sur le doc parent)
    // On fait des écritures séparées pour identifier laquelle bloque, ou juste un batch réduit.
    try {
        const batch = writeBatch(db);
        const memberRef = doc(db, 'groups', groupId, 'members', uid);
        batch.set(memberRef, { userId: uid, joinedAt: Date.now() });
        const joinedGroupRef = doc(db, 'users', uid, 'joined_groups', groupId);
        batch.set(joinedGroupRef, { joinedAt: Date.now() });
        await batch.commit();
    } catch (e2) {
        console.error("joinGroup: fallback failed", e2);
        throw e2;
    }
  }
}


export async function getJoinedGroups(uid: string): Promise<string[]> {
  const snapshot = await getDocs(collection(db, 'users', uid, 'joined_groups'));
  return snapshot.docs.map(d => d.id);
}

export async function getGroupsByIds(ids: string[]): Promise<Group[]> {
  if (ids.length === 0) return [];
  
  // Firestore 'in' query is limited to 10 items
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) {
    chunks.push(ids.slice(i, i + 10));
  }
  
  const allGroups: Group[] = [];
  for (const chunk of chunks) {
    const q = query(collection(db, 'groups'), where(documentId(), 'in', chunk));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      allGroups.push({
        id: d.id,
        name: data.name || 'Groupe',
        memberCount: data.memberCount || 0,
        city: data.city,
        description: data.description,
        ageLock: data.ageLock,
      });
    });
  }
  return allGroups;
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const d = await getDoc(doc(db, 'groups', groupId));
  if (!d.exists()) return null;
  const data = d.data();
  return {
    id: d.id,
    name: data.name || 'Groupe',
    memberCount: data.memberCount || 0,
    city: data.city,
    description: data.description,
    ageLock: data.ageLock,
  };
}

export async function listMembers(groupId: string): Promise<{ id: string }[]> {
  const q = query(collection(db, 'groups', groupId, 'members'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id }))
}

export async function listMessages(groupId: string): Promise<{ id: string; user_uid: string; text: string; created_at: number }[]> {
  const q = query(collection(db, 'groups', groupId, 'messages'), orderBy('createdAt', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, user_uid: (d.data() as any).userUid, text: (d.data() as any).text || '', created_at: (d.data() as any).createdAt || 0 }))
}

export async function postMessage(groupId: string, text: string | null, imageUrl?: string, extra?: { replyTo?: any, type?: string, pollTarget?: { id: string, name: string } }): Promise<void> {
  const uid = getAuth().currentUser?.uid
  if (!uid) throw new Error('Utilisateur non authentifié')
  // Use senderId to match Firestore rules
  const data: any = { senderId: uid, userUid: uid, createdAt: Date.now() };
  if (text) {
    const valid = validateMessage(text);
    if (!valid.valid) throw new Error(valid.error);
    data.text = text;
  }
  if (imageUrl) data.imageUrl = imageUrl;
  
  if (extra?.replyTo) data.replyTo = extra.replyTo;
  if (extra?.type) data.type = extra.type;
  if (extra?.pollTarget) {
    data.pollTarget = extra.pollTarget;
    data.votes = {}; // { userId: 'yes' | 'no' }
    data.pollStatus = 'active';
  }

  await addDoc(collection(db, 'groups', groupId, 'messages'), data)
}

export async function kickMember(groupId: string, userId: string): Promise<void> {
  const batch = writeBatch(db);
  
  // Remove member from group
  const memberRef = doc(db, 'groups', groupId, 'members', userId);
  batch.delete(memberRef);
  
  // Remove group from user's joined_groups
  const joinedGroupRef = doc(db, 'users', userId, 'joined_groups', groupId);
  batch.delete(joinedGroupRef);
  
  // Decrement member count - REMOVED because Cloud Function onGroupMemberWrite handles it
  // const groupRef = doc(db, 'groups', groupId);
  // batch.update(groupRef, { memberCount: increment(-1) });

  await batch.commit();
}

export async function castPollVote(groupId: string, messageId: string, vote: 'yes' | 'no'): Promise<boolean> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return false;

  const msgRef = doc(db, 'groups', groupId, 'messages', messageId);
  const msgSnap = await getDoc(msgRef);
  
  if (!msgSnap.exists()) return false;
  const data = msgSnap.data();
  
  if (data.pollStatus !== 'active') return false;

  // Update vote
  // Use dot notation for nested object update in Firestore
  await updateDoc(msgRef, {
    [`votes.${uid}`]: vote
  });

  return true;
}

export async function quitGroup(uid: string, groupId: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    
    // Remove member from group
    const memberRef = doc(db, 'groups', groupId, 'members', uid);
    batch.delete(memberRef);
    
    // Remove group from user's joined_groups
    const joinedGroupRef = doc(db, 'users', uid, 'joined_groups', groupId);
    batch.delete(joinedGroupRef);
    
    // Decrement member count - REMOVED because Cloud Function onGroupMemberWrite handles it
    // const groupRef = doc(db, 'groups', groupId);
    // batch.update(groupRef, { memberCount: increment(-1) });

    await batch.commit();
  } catch (e) {
    console.warn("quitGroup: full batch failed, retrying without decrement", e);
    // Fallback: Quitter sans décrémenter (si règles strictes)
    const batch = writeBatch(db);
    batch.delete(doc(db, 'groups', groupId, 'members', uid));
    batch.delete(doc(db, 'users', uid, 'joined_groups', groupId));
    await batch.commit();
  }
}
