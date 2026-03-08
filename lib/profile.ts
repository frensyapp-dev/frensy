// lib/profile.ts
import dayjs from 'dayjs';
import { deleteDoc, deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebaseconfig';
import { checkAndResetLimits } from './monetization';

export type UserPhoto = {
  path: string;
  url: string;
  createdAt: number;
  w?: number;
  h?: number;
  status?: 'approved' | 'pending' | 'rejected'; // Moderation status
};

export type UserProfile = {
  uid?: string;
  firstName?: string;
  accountType?: 'individual' | 'group'; // Nouveau champ
  groupMembers?: number; // Nombre de membres dans le groupe (si accountType === 'group')
  groupComposition?: { males: number; females: number; others: number }; // Détail de la composition du groupe
  
  age?: number;
  birthDate?: string; // YYYY-MM-DD
  birthday?: string; // Legacy or alternative
  
  // Intérêts remplacés par des activités
  interests?: string[]; 
  
  genders?: ('hommes' | 'femmes' | 'autres')[];
  /** Identité de genre de l’utilisateur */
  genderIdentity?: 'hommes' | 'femmes' | 'autres';
  desiredMinAge?: number;
  desiredMaxAge?: number;
  /** Rayon de découverte pour la carte et la page Découverte (km) */
  discoveryRadiusKm?: number;

  /** Taille en centimètres (affichée sur la carte Découvrir) */
  heightCm?: number;

  photos?: UserPhoto[];
  primaryPhotoPath?: string;

  /** Verrou d'âge pour conformité (app 18+) */
  ageLock?: 'adult';

  contacts?: { instagram?: string; tiktok?: string; email?: string };

  // Nouveaux champs UI
  avatarFocusX?: number; // 0..1 pour le cadrage horizontal de l’avatar
  avatarFocusY?: number; // 0..1 pour le cadrage vertical de l’avatar
  /** Facteur de zoom de l’avatar (>=1, ex. 1.0 à 1.8) */
  avatarZoom?: number;
  noteText?: string;     // texte affiché en bulle sur l’avatar

  // Stats & Social
  followersCount?: number;
  followingCount?: number;
  score?: number;
  pins?: number; // Monnaie de l'application
  messagesSentCount?: number;

  // Subscription & Limits
  subscription?: 'FREE' | 'PLUS' | 'PRO';
  subscriptionExpiryMs?: number;

  invitesUsedToday?: number;
  invitesUsedThisWeek?: number;
  undoUsedToday?: number;
  boostsUsedThisWeek?: number;
  boostExpiresAt?: number; // Timestamp when boost expires
  superInvitesUsedThisWeek?: number;
  groupsCreatedThisMonth?: number;

  // Bonus items (Inventory)
  bonusInvites?: number;
  bonusUndos?: number;
  bonusBoosts?: number;
  bonusUnlockLikes?: number;
  bonusSuperInvites?: number;

  lastDailyReset?: number;
  lastWeeklyReset?: number;
  lastMonthlyReset?: number;

  // Specific features
  unlockedLikes?: string[]; // UIDs of users unlocked via pins

  // Settings
  ghostMode?: boolean;
  useStrictFilters?: boolean;

  pinnedGroups?: string[];

  deleted?: boolean;
  completed?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export const userDocRef = (uid: string) => doc(db, 'users', uid);
export const userPrivateRef = (uid: string) => doc(db, 'users', uid, 'private', 'settings');

const PRIVATE_FIELDS = new Set([
  'expoPushToken', 'notifications',
  'pins', 'score',
  'subscription', 'subscriptionExpiryMs',
  'invitesUsedToday', 'invitesUsedThisWeek', 'undoUsedToday',
  'boostsUsedThisWeek', 'boostExpiresAt', 'superInvitesUsedThisWeek',
  'groupsCreatedThisMonth',
  'bonusInvites', 'bonusUndos', 'bonusBoosts', 'bonusUnlockLikes', 'bonusSuperInvites',
  'lastDailyReset', 'lastWeeklyReset', 'lastMonthlyReset',
  'unlockedLikes',
  'ghostMode', 'useStrictFilters', 'pinnedGroups'
]);

async function migratePrivateData(uid: string, data: UserProfile) {
    const privateData: any = {};
    const publicUpdates: any = {};
    let hasPrivate = false;

    for (const key of Object.keys(data)) {
        if (PRIVATE_FIELDS.has(key)) {
            privateData[key] = (data as any)[key];
            publicUpdates[key] = deleteField();
            hasPrivate = true;
        }
    }

    if (hasPrivate) {
        try {
            const batch = writeBatch(db);
            batch.set(userPrivateRef(uid), privateData, { merge: true });
            batch.update(userDocRef(uid), publicUpdates);
            await batch.commit();
        } catch (e) {
            console.warn('Migration failed', e);
        }
    }
}

/**
 * Récupère le profil complet de l'utilisateur.
 * Si l'utilisateur est l'utilisateur connecté, récupère aussi les données privées (pins, abonnements, etc.)
 * Gère la migration des données privées si nécessaire.
 * @param uid Identifiant de l'utilisateur
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const userSnap = await getDoc(userDocRef(uid));
  if (!userSnap.exists()) return null;

  let data = userSnap.data() as UserProfile;
  data.uid = uid;

  // If it's me, fetch private data
  if (auth.currentUser && auth.currentUser.uid === uid) {
    try {
        const privateSnap = await getDoc(userPrivateRef(uid));
        if (privateSnap.exists()) {
           const privateData = privateSnap.data();
           data = { ...data, ...privateData };
        } else {
           // Lazy migration: Check if private fields are in public doc
           // If so, move them.
           // We can do this async or block. Let's do it async to not slow down read.
           migratePrivateData(uid, data).catch(console.error);
        }
    } catch (e: any) {
        if (e.code === 'permission-denied') {
             // This can happen if the rule isn't propagated yet or specific context issues
        } else {
             console.warn('Failed to load private data', e);
        }
    }
    
    // Check resets
    const resets = checkAndResetLimits(data);
    if (resets) {
        // Update local data
        Object.assign(data, resets);
        // Save resets to private doc (via savePartialProfile which handles split)
        if (auth.currentUser && auth.currentUser.uid === uid) {
             savePartialProfile(uid, resets).catch(e => {
                 console.warn('Error resetting limits (sync)', e);
             });
        }
    }
  }

  // Recalculate age if birthDate is present
  if (data.birthDate) {
    const calculatedAge = dayjs().diff(dayjs(data.birthDate), 'year');
    if (typeof calculatedAge === 'number' && !isNaN(calculatedAge)) {
      data.age = calculatedAge;
    }
  }

  return data;
}

export async function ensureUserDoc(uid: string, seed: Partial<UserProfile> = {}) {
  const ref = userDocRef(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Initial creation - public fields only
    // seed might contain private fields?
    // We should split seed too.
    await savePartialProfile(uid, {
      photos: [],
      ...seed,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Met à jour une partie du profil utilisateur.
 * Trie automatiquement les champs entre le document public et le document privé.
 * @param uid Identifiant de l'utilisateur
 * @param data Données à mettre à jour
 */
export async function savePartialProfile(uid: string, data: Partial<UserProfile> | Record<string, any>) {
  const publicData: any = {};
  const privateData: any = {};
  
  // Always update timestamp on public profile to show activity?
  publicData.updatedAt = serverTimestamp();

  for (const [key, val] of Object.entries(data)) {
      if (PRIVATE_FIELDS.has(key)) {
          privateData[key] = val;
      } else {
          publicData[key] = val;
      }
  }

  const promises: Promise<void>[] = [];
  // Use setDoc with merge:true for both
  if (Object.keys(publicData).length > 0) {
      promises.push(setDoc(userDocRef(uid), publicData, { merge: true }));
  }
  if (Object.keys(privateData).length > 0) {
      promises.push(setDoc(userPrivateRef(uid), privateData, { merge: true }));
  }
  
  await Promise.all(promises);
}

export const applyUserUpdates = savePartialProfile;

export async function setPrimaryPhoto(uid: string, path: string) {
  await updateDoc(userDocRef(uid), { primaryPhotoPath: path, updatedAt: serverTimestamp() });
}

/**
 * Supprime toutes les données d'un utilisateur (Document public et privé).
 * @param uid Identifiant de l'utilisateur
 */
export async function deleteUserData(uid: string) {
  // 1. Delete user document from Firestore
  await deleteDoc(userDocRef(uid));
  // Delete private doc too
  await deleteDoc(userPrivateRef(uid));
  
  // 2. Note: We should also delete storage files (photos), 
  // but for now we focus on account data. 
  // A Cloud Function would be better for cleanup.
}

