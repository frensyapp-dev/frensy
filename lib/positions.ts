import { getBackgroundPermissionsAsync, LocationAccuracy, requestForegroundPermissionsAsync, watchPositionAsync } from 'expo-location';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import { geohashForLocation } from 'geofire-common';
import { auth, db } from '../firebaseconfig';
import { startBackgroundTracking } from './backgroundLocation';

export type PositionDoc = {
  uid: string;
  lat: number;
  lng: number;
  geohash: string;
  updatedAt: any; // serverTimestamp
  updatedAtMs: number; // client ms pour filtrage
  precisionKm?: number;
  accuracy?: number | null;
  name?: string | null;
  age?: number | null;
  boostExpiresAt?: number | null;
  manualBaseExpiresAt?: number | null; // Timestamp expiration position "Base"
  isManualBase?: boolean; // Si c'est une position déclarée manuellement
  baseLat?: number; // Lat de la zone journalière
  baseLng?: number; // Lng de la zone journalière
  img?: string | null;
};

const round = (x: number, step = 0.01) => Math.round(x / step) * step;

/** Démarre la mise à jour temps réel de la position de l'utilisateur courant dans Firestore. */
export async function startRealtimePositionTracking(): Promise<() => void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Utilisateur non authentifié');

  const { status } = await requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Permission localisation refusée');

  // Check and start background tracking if permitted
  try {
    const { status: bgStatus } = await getBackgroundPermissionsAsync();
    if (bgStatus === 'granted') {
      await startBackgroundTracking();
    }
  } catch (e) {
    console.warn('[positions] background check failed', e);
  }

  // Récupérer l'avatar URL au démarrage du tracking
  let avatarUrl: string | null = user.photoURL || null;
  try {
    const { getUserProfile } = await import('./profile');
    const p = await getUserProfile(user.uid);
    let url = p?.photos?.find(ph => ph.path === p?.primaryPhotoPath)?.url || p?.photos?.[0]?.url;
    if (!url) {
        const path = p?.primaryPhotoPath || p?.photos?.[0]?.path;
        if (path) {
            const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
            const storage = getStorage();
            url = await getDownloadURL(ref(storage, path));
        }
    }
    if (url) avatarUrl = url;
  } catch (e) {
    console.warn('[positions] failed to fetch avatar', e);
  }

  // Throttle pour stabilité/perf
  let lastWriteMs = 0;
  const minIntervalMs = 12_000; // écrire au max toutes les 12s

  const unsubscribe = await watchPositionAsync(
    {
      accuracy: LocationAccuracy.Balanced,
      timeInterval: 10_000,
      distanceInterval: 40, // n'écrire qu'après ~40m
    },
    async ({ coords }) => {
      const now = Date.now();
      
      // On n'empêche plus la mise à jour GPS, même si une zone manuelle est active.
      // La zone manuelle servira de fallback quand le user est offline.

      if (now - lastWriteMs < minIntervalMs) return;
      lastWriteMs = now;

      const lat = round(coords.latitude, 0.01);
      const lng = round(coords.longitude, 0.01);
      const geohash = geohashForLocation([lat, lng]);

      const name = user.displayName ?? null; // Firestore n'accepte pas undefined

      const payload: PositionDoc = {
        uid: user.uid,
        lat,
        lng,
        geohash,
        updatedAt: serverTimestamp(),
        updatedAtMs: now,
        precisionKm: 0.1,
        accuracy: coords.accuracy ?? null,
        name,
        age: null,
        // On ne touche pas à isManualBase ni baseLat/baseLng
        img: avatarUrl,
      };

      // Éviter d'envoyer des champs undefined: payload ne contient que null ou valeurs définies
      try {
        await setDoc(doc(db, 'positions', user.uid), payload, { merge: true });
      } catch (e: any) {
        if (e.code !== 'permission-denied') {
          console.warn('[positions] write error', e);
        }
      }
    }
  );

  return () => {
    try { unsubscribe.remove(); } catch {}
  };
}

/**
 * Définit une position fixe pour la journée (valide 24h).
 * Utilise une précision réduite (0.5km) pour indiquer que c'est une position "Base".
 */
export async function setDailyLocation(lat: number, lng: number) {
  const user = auth.currentUser;
  if (!user) throw new Error('Non connecté');

  // Récupérer l'avatar URL
  let avatarUrl: string | null = user.photoURL || null;
  try {
    const { getUserProfile } = await import('./profile');
    const p = await getUserProfile(user.uid);
    let url = p?.photos?.find(ph => ph.path === p?.primaryPhotoPath)?.url || p?.photos?.[0]?.url;
    if (!url) {
        const path = p?.primaryPhotoPath || p?.photos?.[0]?.path;
        if (path) {
            const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
            const storage = getStorage();
            url = await getDownloadURL(ref(storage, path));
        }
    }
    if (url) avatarUrl = url;
  } catch (e) {
    console.warn('[positions] failed to fetch avatar', e);
  }

  const now = Date.now();
  // Expire à la fin de la journée (minuit) ou dans 24h. 
  // Le user demande "pour la journée", donc disons 24h ou 4h du mat le lendemain.
  // Simplifions : 18h de validité (couvre la journée) ou minuit.
  // Prenons 24h pour être safe.
  const expiresAt = now + 24 * 60 * 60 * 1000;

  const geohash = geohashForLocation([lat, lng]);
  
  const payload: PositionDoc = {
    uid: user.uid,
    lat, // On met à jour la lat courante aussi pour que ce soit immédiat
    lng,
    geohash,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
    precisionKm: 0.5, // Moins précis car manuel/statique
    accuracy: 100,
    name: user.displayName || null,
    isManualBase: true,
    manualBaseExpiresAt: expiresAt,
    baseLat: lat, // On sauvegarde la base séparément
    baseLng: lng,
    img: avatarUrl
  };

  await setDoc(doc(db, 'positions', user.uid), payload, { merge: true });
}

export type NearbyUser = {
  id: string;
  name: string;
  age: number | null;
  lat: number;
  lng: number;
  distanceKm: number;
  precisionKm?: number; // précision déclarée côté émetteur (approx si ~1km)
  accuracy?: number | null; // accuracy brute du GPS si disponible
  lastActive?: number; // Pour le tri
  img?: string;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Seuils de filtre (peuvent être ajustés si besoin)
const MAX_RECENCY_MIN = 10; // fraîcheur max autorisée
const MAX_ACCURACY_M = 400; // précision GPS max (au-delà, on ignore)
const MAX_PRECISION_KM = 1.2; // précision déclarée max (au-delà, on ignore)

/**
 * Abonnement: écoute toutes les positions récentes et filtre par rayon + précision.
 * @param includeUids Liste d'UIDs à inclure même si la position date de plus de MAX_RECENCY_MIN ou est hors rayon (si on veut forcer l'affichage).
 */
export function subscribeNearbyUsers(center: { lat: number; lng: number }, radiusKm: number, includeUids: string[], cb: (users: NearbyUser[]) => void): () => void {
  if (!auth.currentUser?.uid) return () => {};
  
  // Optimisation: ne charger que les positions actives dans les dernières 24h
  const oneDayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const q = query(collection(db, 'positions'), where('updatedAt', '>', oneDayAgo));

  const unsub = onSnapshot(q, {
    next: (snap) => {
      const meUid = auth.currentUser?.uid;
      const now = Date.now();
      const items: NearbyUser[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() as PositionDoc;
        const isIncluded = includeUids.includes(d.uid);
        
        const isBoosted = d.boostExpiresAt && d.boostExpiresAt > now;
        const isManualValid = d.isManualBase && d.manualBaseExpiresAt && d.manualBaseExpiresAt > now;
        const isFresh = d.updatedAtMs && (now - d.updatedAtMs <= MAX_RECENCY_MIN * 60 * 1000);

        // Si ni fresh, ni manuel valide, ni boosté, ni inclus => on ignore
        if (!isIncluded && !isBoosted && !isManualValid && !isFresh) return;
        
        // DÉCISION POSITION : GPS (Fresh) vs Base (Offline)
        // Si Fresh => GPS (d.lat, d.lng)
        // Si !Fresh mais ManualValid => Base (d.baseLat, d.baseLng) ou fallback GPS (d.lat, d.lng) si legacy
        
        let finalLat = d.lat;
        let finalLng = d.lng;
        let finalPrec = d.precisionKm;
        
        if (!isFresh && isManualValid) {
            // User est offline mais a une zone active
            if (d.baseLat !== undefined && d.baseLng !== undefined) {
                finalLat = d.baseLat;
                finalLng = d.baseLng;
                finalPrec = 0.5; // Précision forcée pour la base
            }
            // Sinon (ancien format), on garde lat/lng qui était la dernière connue (ou la base si pas bougé)
        }

        const acc = typeof d.accuracy === 'number' ? d.accuracy : null;
        const prec = typeof finalPrec === 'number' ? finalPrec : null;
        
        // Si c'est une base manuelle valide (non expirée) OU boosté, on tolère une précision déclarée plus grande
        // isManualActive ici signifie "On utilise la base" OU "On a une base active même si on est fresh (pour la permissivité)"
        const isManualActive = isManualValid; 
        const maxPrec = isManualActive ? 5.0 : MAX_PRECISION_KM; 
        
        if ((acc !== null && acc > MAX_ACCURACY_M) || (prec !== undefined && prec !== null && prec > maxPrec)) return;
        
        const dist = haversineKm(center.lat, center.lng, finalLat, finalLng);
        
        if (dist <= radiusKm || isIncluded) {
          items.push({
            id: d.uid,
            name: d.name || (d.uid === meUid ? 'Moi' : 'Utilisateur'),
            age: d.age ?? null,
            lat: finalLat,
            lng: finalLng,
            distanceKm: dist,
            precisionKm: finalPrec,
            accuracy: d.accuracy ?? null,
            lastActive: d.updatedAtMs,
            img: d.img || undefined
          });
        }
      });
      
      // Tri: d'abord par statut (Offline/Base en premier, Online en dernier pour être au dessus), puis par distance
      items.sort((a, b) => {
        const aFresh = (now - (a.lastActive || 0)) < MAX_RECENCY_MIN * 60 * 1000;
        const bFresh = (now - (b.lastActive || 0)) < MAX_RECENCY_MIN * 60 * 1000;
        
        if (aFresh !== bFresh) {
          return aFresh ? 1 : -1; // Fresh (Online) à la fin => zIndex supérieur sur la map
        }
        return a.distanceKm - b.distanceKm;
      });
      
      cb(items);
    },
    error: (err) => {
      if (err.code !== 'permission-denied') {
        console.warn('[positions] subscribe error', err);
      }
    },
  });
  return unsub;
}
