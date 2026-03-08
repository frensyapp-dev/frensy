import { FontAwesome } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import { arrayRemove, arrayUnion, collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, KeyboardAvoidingView, PanResponder, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MatchNotification from '../../components/ui/MatchNotification';
import { useToast } from '../../components/ui/Toast';

import { GroupView } from '../../components/groups/GroupView';
import GlassCard from '../../components/ui/GlassCard';
import { GradientButton } from '../../components/ui/GradientButton';
import { Colors } from '../../constants/Colors';
import { auth, db } from '../../firebaseconfig';
import { ensureMatchExistsWithLikes } from '../../lib/chat/storage';
import { getApproxPosition } from '../../lib/location';
import { likeUser } from '../../lib/matches';
import { performActionUpdates } from '../../lib/monetization';
import { NearbyUser as NearbyUserPos, subscribeNearbyUsers } from '../../lib/positions';
import { UserProfile, applyUserUpdates, getUserProfile, userDocRef, userPrivateRef } from '../../lib/profile';

type Card = {
  id: string;
  name: string;
  age: number | null;
  accountType?: 'individual' | 'group';
  groupMembers?: number;
  groupComposition?: { males: number; females: number; others: number };
  images: string[];
  uid: string;
  isSeen?: boolean;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SWIPE_DISTANCE = SCREEN_W * 0.35;

const SkeletonCard = () => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1000, useNativeDriver: true })
      ])
    ).start();
  }, [anim]);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <View style={{ flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1a1a1a', margin: 10 }}>
       <Animated.View style={{ flex: 1, backgroundColor: '#333', opacity }} />
       <View style={{ position: 'absolute', bottom: 40, left: 20 }}>
           <Animated.View style={{ width: 180, height: 32, backgroundColor: '#333', borderRadius: 8, marginBottom: 12, opacity }} />
           <Animated.View style={{ width: 120, height: 20, backgroundColor: '#333', borderRadius: 8, opacity }} />
       </View>
    </View>
  );
};

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const [stack, setStack] = useState<Card[]>([]);
  const [lastCard, setLastCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [nearby, setNearby] = useState<NearbyUserPos[]>([]);
  const [photosByUid, setPhotosByUid] = useState<Record<string, string[] | undefined>>({});
  const [profileByUid, setProfileByUid] = useState<Record<string, UserProfile | undefined>>({});
  const [currentPhotoIdxByUid, setCurrentPhotoIdxByUid] = useState<Record<string, number>>({});
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [viewMode, setViewMode] = useState<'swipe' | 'groups'>('swipe');
  const [joinedGroups, setJoinedGroups] = useState<Set<string>>(new Set());
  const [pinnedGroups, setPinnedGroups] = useState<Set<string>>(new Set());

  // Animation pour la transition de mode
  const modeAnim = useRef(new Animated.Value(0)).current; // 0 = swipe, 1 = groups

  const { showToast } = useToast();
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({ swipeEnabled: viewMode === 'groups' });
  }, [viewMode, navigation]);

  useEffect(() => {
    Animated.timing(modeAnim, {
      toValue: viewMode === 'groups' ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [viewMode, modeAnim]);

  const swipeOpacity = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const groupsOpacity = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const swipeScale = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] });
  const groupsScale = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const swipeTransY = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  const groupsTransY = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  
  // Z-index trick: when animating, ensure the target is on top or both visible?
  // Easier to just use pointerEvents.

  const historySeenRef = useRef<Set<string>>(new Set());
  const sessionSeenRef = useRef<Set<string>>(new Set());
  const excludeRef = useRef<{ matches: Set<string>; invites: Set<string>; principal: Set<string>; blocked: Set<string> }>({ matches: new Set(), invites: new Set(), principal: new Set(), blocked: new Set() });
  const C = Colors['dark'];

  const pan = useRef(new Animated.ValueXY()).current;
  const rotate = pan.x.interpolate({ inputRange: [-SCREEN_W, 0, SCREEN_W], outputRange: ['-18deg', '0deg', '18deg'] });
  const likeOverlayOpacity = pan.x.interpolate({ inputRange: [SWIPE_DISTANCE * 0.25, SWIPE_DISTANCE * 0.85], outputRange: [0, 1], extrapolate: 'clamp' });
  const nopeOverlayOpacity = pan.x.interpolate({ inputRange: [-SWIPE_DISTANCE * 0.85, -SWIPE_DISTANCE * 0.25], outputRange: [1, 0], extrapolate: 'clamp' });
  const likeFrameOpacity = pan.x.interpolate({ inputRange: [SWIPE_DISTANCE * 0.2, SWIPE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' });
  const nopeFrameOpacity = pan.x.interpolate({ inputRange: [-SWIPE_DISTANCE, -SWIPE_DISTANCE * 0.2], outputRange: [1, 0], extrapolate: 'clamp' });

  const handleUndo = async () => {
    if (!lastCard) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
        const profile = await getUserProfile(uid);
        if (profile) {
            const check = performActionUpdates(profile, 'UNDO');
            if (!check.allowed) {
                if (check.reason === 'insufficient_coins') {
                    Alert.alert(
                        'Pins insuffisants', 
                        'Achetez des pins pour annuler ce swipe.',
                        [
                            { text: 'Annuler', style: 'cancel' },
                            { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                        ]
                    );
                } else if (check.reason === 'subscription_required') {
                     Alert.alert(
                        'Abonnement requis', 
                        'Passez à Frensy PLUS pour annuler vos swipes, ou utilisez des pins.',
                        [
                            { text: 'Annuler', style: 'cancel' },
                            { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                        ]
                    );
                } else {
                     showToast('Limite atteinte', 'Limite quotidienne atteinte. Passez PRO pour l\'illimité !', 'warning');
                }
                return;
            }

            const executeUndo = async () => {
                if (check.updates) {
                    await applyUserUpdates(uid, check.updates);
                }
                // Remove swipe from Firestore
                const { deleteDoc, doc } = await import('firebase/firestore');
                const { db } = await import('../../firebaseconfig');
                await deleteDoc(doc(db, 'swipes', uid, 'outgoing', lastCard.uid));
                
                setStack(prev => [lastCard!, ...prev]);
                sessionSeenRef.current.delete(lastCard!.uid);
                setLastCard(null);
                setLastSwipe(null);
                showToast('Annulé', 'Swipe annulé', 'success');
            };

            if (check.cost && check.cost > 0) {
                 Alert.alert(
                    'Annuler le swipe',
                    `Utiliser ${check.cost} pins pour annuler ?`,
                    [
                        { text: 'Non', style: 'cancel' },
                        { text: 'Oui', onPress: executeUndo }
                    ]
                 );
            } else {
                await executeUndo();
            }
        }
    } catch (e) {
        console.error(e);
    }
  };

  const handleBoost = async () => {
    if (!myProfile || !auth.currentUser?.uid) return;
    
    // Check if already boosted
    const now = Date.now();
    // Ensure we check the latest profile state or valid timestamp
    const expiresAt = myProfile.boostExpiresAt;
    const isActive = typeof expiresAt === 'number' && expiresAt > now;
    
    if (isActive) {
        showToast('Boost actif', `Votre boost est encore actif pour ${Math.ceil((expiresAt - now) / 60000)} minutes.`, 'info');
        return;
    }

    const check = performActionUpdates(myProfile, 'BOOST');
    if (!check.allowed) {
         if (check.reason === 'insufficient_coins') {
             Alert.alert('Pins insuffisants', 'Achetez des pins pour booster votre profil !', [
                 { text: 'Annuler', style: 'cancel' },
                 { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
             ]);
         } else {
              showToast('Limite atteinte', 'Vous avez utilisé tous vos boosts gratuits cette semaine.', 'warning');
         }
         return;
     }

    const confirmMessage = check.cost 
        ? `Utiliser ${check.cost} pins pour un boost de 10 minutes ?`
        : `Utiliser un boost gratuit ?`;

    Alert.alert('Booster le profil', confirmMessage, [
        { text: 'Annuler', style: 'cancel' },
        { 
            text: 'Booster 🚀', 
            onPress: async () => {
                try {
                    const boostDuration = 10 * 60 * 1000; // 10 minutes
                    const expiresAt = Date.now() + boostDuration;
                    
                    const updates = {
                        ...(check.updates || {}),
                        boostExpiresAt: expiresAt
                    };
                    
                    // Update User Profile
                    await applyUserUpdates(auth.currentUser!.uid, updates);
                    
                    // Update Position Doc (for visibility)
                    await setDoc(doc(db, 'positions', auth.currentUser!.uid), {
                        boostExpiresAt: expiresAt,
                        updatedAt: serverTimestamp(),
                        updatedAtMs: Date.now()
                    }, { merge: true });
                    
                    showToast('Boost activé !', 'Votre profil sera mis en avant pendant 10 minutes.', 'success');
                } catch (e) {
                    console.error(e);
                    showToast('Erreur', 'Impossible d\'activer le boost.', 'error');
                }
            }
        }
    ]);
  };

  // Charger la position approx et le rayon utilisateur, puis s’abonner aux personnes proches
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const pos = await getApproxPosition();
        setMe({ lat: pos.lat, lng: pos.lng });
      } catch (e) {
        console.warn('Location error', e);
        showToast('Erreur de localisation', 'Impossible de récupérer votre position. Vérifiez vos paramètres.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        // Charger les swipes existants pour exclure immédiatement les profils déjà vus
        const seenSnap = await getDocs(collection(db, 'swipes', uid, 'outgoing'));
        const initialSeen = new Set<string>();
        seenSnap.forEach((d) => initialSeen.add(d.id));
        historySeenRef.current = initialSeen;
        // S’abonner aux matchs et invitations pour exclure ces utilisateurs des swipes
        const qMatches = query(collection(db, 'matches'), where('users', 'array-contains', uid));
        const unsubMatches = onSnapshot(qMatches, (snap) => {
          const s = new Set<string>();
          snap.forEach((d) => {
            const data = d.data() as any;
            const partner = Array.isArray(data?.users) ? data.users.find((u: string) => u !== uid) : null;
            if (partner) s.add(partner);
          });
          excludeRef.current.matches = s;
        }, (err) => { if (err.code !== 'permission-denied') console.warn('Matches sync error', err); });
        const qInvOut = query(collection(db, 'chatRequests'), where('from', '==', uid), where('status', '==', 'pending'));
        const qInvIn = query(collection(db, 'chatRequests'), where('to', '==', uid), where('status', '==', 'pending'));
        const unsubInvOut = onSnapshot(qInvOut, (snap) => {
          const cur = excludeRef.current.invites;
          const add = new Set<string>(); snap.forEach((d) => { const to = (d.data() as any)?.to; if (to) add.add(String(to)); });
          excludeRef.current.invites = new Set([...cur, ...add]);
        }, (err) => { if (err.code !== 'permission-denied') console.warn('InvOut sync error', err); });
        const unsubInvIn = onSnapshot(qInvIn, (snap) => {
          const cur = excludeRef.current.invites;
          const add = new Set<string>(); snap.forEach((d) => { const from = (d.data() as any)?.from; if (from) add.add(String(from)); });
          excludeRef.current.invites = new Set([...cur, ...add]);
        }, (err) => { if (err.code !== 'permission-denied') console.warn('InvIn sync error', err); });
        const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
          const data = snap.data() as any;
          const r = data?.discoveryRadiusKm;
          if (typeof r === 'number' && Number.isFinite(r)) setRadiusKm(r);
          
          if (Array.isArray(data?.pinnedGroups)) {
             setPinnedGroups(new Set(data.pinnedGroups));
          }
        }, (err) => { if (err.code !== 'permission-denied') console.warn('User sync error', err); });
        const unsubEx = onSnapshot(doc(db, 'exclusions', uid), (snap) => {
          try {
            const d = (snap.data() as any) || {};
            const ex = excludeRef.current;
            if (Array.isArray(d.matches)) ex.matches = new Set<string>([...ex.matches, ...d.matches.map(String)]);
            if (Array.isArray(d.invites)) ex.invites = new Set<string>([...ex.invites, ...d.invites.map(String)]);
            if (Array.isArray(d.principal)) ex.principal = new Set<string>([...ex.principal, ...d.principal.map(String)]);
            if (Array.isArray(d.blocked)) ex.blocked = new Set<string>([...ex.blocked, ...d.blocked.map(String)]);
          } catch {}
        }, (err) => { if (err.code !== 'permission-denied') console.warn('Exclusions sync error', err); });

        // Listen to joined groups
        const qJoined = collection(db, 'users', uid, 'joined_groups');
        const unsubJoined = onSnapshot(qJoined, (snap) => {
           const s = new Set<string>();
           snap.forEach(d => s.add(d.id));
           setJoinedGroups(s);
        }, (err) => { if (err.code !== 'permission-denied') console.warn('Joined groups sync error', err); });

        // Listen to pinned groups from user profile
        // Note: Pinned groups are in user doc, already listened above? No, user doc listener only gets radius.
        // Let's add it to user doc listener or separate one.
        // The user doc listener above only sets radiusKm. Let's expand it.
        
        try {
          const { loadConversations } = await import('../../lib/chat/storage');
          const convos = await loadConversations();
          const ids = convos.map(c => c.id);
          excludeRef.current.principal = new Set(ids);
        } catch {}
        return () => { try { unsub(); unsubMatches(); unsubInvOut(); unsubInvIn(); unsubEx(); unsubJoined(); } catch {} };
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!me) return;
    const unsub = subscribeNearbyUsers({ lat: me.lat, lng: me.lng }, radiusKm, [], async (users) => {
      let meUid: string | undefined;
      try { meUid = (await import('firebase/auth')).getAuth().currentUser?.uid || undefined; } catch {}
      const filtered = users.filter(u => u.id !== meUid);
      setNearby(filtered);
      // Arrêter l’animation de rafraîchissement dès qu’une mise à jour arrive
      // if (refreshing) setRefreshing(false);
    });
    return () => { try { unsub(); } catch {} };
  }, [me, radiusKm, refreshTick, refreshing]);

  async function manualRefresh() {
    try {
      setRefreshing(true);
      if (!me) {
        const pos = await getApproxPosition();
        setMe({ lat: pos.lat, lng: pos.lng });
      } else {
        setRefreshTick((v) => v + 1);
      }
      // Simuler un temps de recherche pour l'UX (2.5s)
      setTimeout(() => setRefreshing(false), 2500);
    } catch {
      setRefreshing(false);
    }
  }

  // Charger et s'abonner au profil de l’utilisateur (tranche d’âge, taille, préférences)
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const { auth } = await import('../../firebaseconfig');
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const { collection, onSnapshot } = await import('firebase/firestore');
        const { db } = await import('../../firebaseconfig');
        
        let publicData: UserProfile | null = null;
        let privateData: any = {};

        const updateState = () => {
            if (!publicData) return;
            const merged = { ...publicData, ...privateData };
            
            // Ensure pins is a number
            if (typeof privateData.pins === 'number') {
                merged.pins = privateData.pins;
            }

            // Ensure boostExpiresAt is a number (handle Firestore Timestamp)
            if (privateData.boostExpiresAt) {
                if (typeof privateData.boostExpiresAt === 'object' && privateData.boostExpiresAt.toMillis) {
                    merged.boostExpiresAt = privateData.boostExpiresAt.toMillis();
                } else {
                    merged.boostExpiresAt = privateData.boostExpiresAt;
                }
            }

            setMyProfile(merged);
            
            if (merged?.pinnedGroups && Array.isArray(merged.pinnedGroups)) {
                setPinnedGroups(new Set(merged.pinnedGroups.map(String)));
            } else {
                setPinnedGroups(new Set());
            }
        };

        // Listen to user public profile
        const unsubProfile = onSnapshot(userDocRef(uid), (snap) => {
          const d = (snap.data() as any) || null;
          publicData = d;
          updateState();
        });

        // Listen to user private profile (pins, boost, subscription, etc.)
        const unsubPrivate = onSnapshot(userPrivateRef(uid), (snap) => {
           if (snap.exists()) {
               privateData = snap.data();
               updateState();
           }
        });

        // Listen to joined groups
        const unsubGroups = onSnapshot(collection(db, 'users', uid, 'joined_groups'), (snap) => {
          const ids = new Set<string>();
          snap.forEach(d => ids.add(d.id));
          setJoinedGroups(ids);
        });

        unsubscribe = () => {
          unsubProfile();
          unsubPrivate();
          unsubGroups();
        };
      } catch {}
    })();
    return () => { try { unsubscribe?.(); } catch {} };
  }, []);

  // Charger les profils et photos manquants pour les utilisateurs proches
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const missing = nearby.map(u => u.id).filter(uid => photosByUid[uid] === undefined || profileByUid[uid] === undefined);
        if (missing.length === 0) return;
        const { getUserProfile } = await import('../../lib/profile');
        
        // Optimisation: Fetch parallelisé au lieu de séquentiel
        const results = await Promise.all(missing.map(async (uid) => {
          try {
            const p = await getUserProfile(uid);
            const urls = (p?.photos || [])
              .slice()
              .sort((a, b) => (p?.primaryPhotoPath === a.path ? -1 : p?.primaryPhotoPath === b.path ? 1 : 0))
              .map(ph => ph.url)
              .filter(Boolean);
            return { uid, p, urls };
          } catch {
            return { uid, p: undefined, urls: undefined };
          }
        }));

        if (!cancelled) {
          const updatesPhotos: Record<string, string[] | undefined> = {};
          const updatesProfile: Record<string, UserProfile | undefined> = {};
          
          for (const res of results) {
            if (res.urls && res.urls.length > 0) {
              updatesPhotos[res.uid] = res.urls;
            } else {
              // Marquer comme vide pour ne plus re-fetcher inutilement
              updatesPhotos[res.uid] = [];
            }

            if (res.p) {
              updatesProfile[res.uid] = res.p;
            } else {
              // Marquer comme supprimé/introuvable pour ne plus re-fetcher
              updatesProfile[res.uid] = { deleted: true } as any;
            }
          }

          if (Object.keys(updatesPhotos).length > 0) {
            setPhotosByUid(prev => ({ ...prev, ...updatesPhotos }));
          }
          if (Object.keys(updatesProfile).length > 0) {
            setProfileByUid(prev => ({ ...prev, ...updatesProfile }));
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [nearby, photosByUid, profileByUid]);

  // Recalculer la pile à partir des utilisateurs proches et des photos
  useEffect(() => {
    // Exclure immédiatement les profils déjà vus et les comptes supprimés/profils manquants
    const candidates = nearby
      .filter(u => !sessionSeenRef.current.has(u.id))
      .filter(u => {
        const ex = excludeRef.current;
        return !ex.matches.has(u.id) && !ex.invites.has(u.id) && !ex.principal.has(u.id) && !ex.blocked.has(u.id);
      })
      .filter(u => {
        const p = profileByUid[u.id];
        // Profil doit exister et contenir au moins une photo utile
        const imgs = photosByUid[u.id] ?? [];
        return !!p && imgs.length > 0;
      });

    // Filtre d’âge (strict) côté viewer uniquement
    const myAge = myProfile?.age;
    
    const subscription = myProfile?.subscription || 'FREE';
    
    // Safety override: Everyone must be 18+
    let minA = typeof myProfile?.desiredMinAge === 'number' ? myProfile!.desiredMinAge! : 18;
    let maxA = typeof myProfile?.desiredMaxAge === 'number' ? myProfile!.desiredMaxAge! : undefined;

    if (subscription === 'FREE') {
        // Enforce +/- 10 years for free users to prevent 18/50 mix
        const myAge = myProfile?.age ?? 18;
        minA = Math.max(18, myAge - 10);
        maxA = myAge + 10;
    } 

    // Enforce minimum 18
    minA = Math.max(minA ?? 18, 18);

    const ageFiltered = candidates.filter(u => {
          const partnerProfile = profileByUid[u.id];
          if (!partnerProfile) return false;

          // Check age compatibility is not needed (adult-only app)

          // Utiliser l’âge depuis le profil (plus fiable que positions)
          const a = (partnerProfile.age ?? null) as number | null;
          
          if (typeof a !== 'number') return false; // Missing age = exclude

          // Double check: strict barrier (everyone must be 18+)
          if (a < 18) return false;

          // Preference filter
          // For FREE/PLUS users, minA/maxA are undefined (except for strict safety bounds), so this check is skipped
          if (subscription === 'PRO') {
              if (typeof minA === 'number' && a < minA) return false;
              if (typeof maxA === 'number' && a > maxA) return false;
          }

          // Strict Filters (PLUS or PRO)
          if ((subscription === 'PLUS' || subscription === 'PRO') && myProfile?.useStrictFilters) {
              // 1. Gender Identity
              if (myProfile.genders && myProfile.genders.length > 0) {
                  const pGender = partnerProfile.genderIdentity;
                  if (!pGender || !myProfile.genders.includes(pGender)) return false;
              }

              // 2. Relations (Interests)
              if (myProfile.interests && myProfile.interests.length > 0) {
                  const pInterests = partnerProfile.interests;
                  // Check intersection
                  if (!pInterests || !pInterests.some(i => myProfile.interests?.includes(i))) return false;
              }
          }
          
          return true;
        });

    // Construire les cartes: Priorité aux nouveaux (non vus dans l'historique)
    const newUsers = ageFiltered.filter(u => !historySeenRef.current.has(u.id));
    const seenUsers = ageFiltered.filter(u => historySeenRef.current.has(u.id));
    
    // Concaténer: Nouveaux d'abord, puis les "Déjà vu"
    const sortedUsers = [...newUsers, ...seenUsers];

    const cards: Card[] = sortedUsers.map(u => {
      const p = profileByUid[u.id];
      return {
        id: u.id,
        uid: u.id,
        name: (p?.firstName ?? u.name ?? 'Anonyme'),
        age: (p?.age ?? null),
        accountType: p?.accountType,
        groupMembers: p?.groupMembers,
        groupComposition: p?.groupComposition,
        images: photosByUid[u.id] || [],
        isSeen: historySeenRef.current.has(u.id)
      };
    }).filter(c => (c.images && c.images.length > 0)); // garder “au moins une photo”

    setStack(cards);

    // Réinitialiser l’état associé aux nouvelles cartes
    const nextIdx: Record<string, number> = {};
    for (const c of cards) nextIdx[c.uid] = 0;
    setCurrentPhotoIdxByUid(prev => ({ ...nextIdx }));

    // Préchargement des images des 3 premières cartes
    const toPreload: string[] = [];
    cards.slice(0, 3).forEach(c => {
       if (c.images && c.images.length > 0) {
           toPreload.push(...c.images.slice(0, 2)); // Précharger les 2 premières photos de chaque profil
       }
    });
    
    if (toPreload.length > 0) {
        Image.prefetch(toPreload).then(() => {
            // console.log('Images preloaded', toPreload.length);
        }).catch(() => {});
    }

  }, [nearby, photosByUid, profileByUid, myProfile]);

  // Cartes courante et suivante
  const top = stack[0];
  const next = stack[1];

  const [lastSwipe, setLastSwipe] = useState<'left' | 'right' | null>(null);
  const [inviteMessage, setInviteMessage] = useState('');
  const [isGoldInvite, setIsGoldInvite] = useState(false);
  // Pop-up de nouveau match
  const [matchPopup, setMatchPopup] = useState<{ partnerUid: string } | null>(null);

  const swipeOut = React.useCallback(async (dir: 'left' | 'right', options?: { like?: boolean }) => {
    const currentCard = stack[0];
    
    // Check permissions for Invitation BEFORE swiping
    if (dir === 'right' && inviteMessage.trim() && myProfile) {
        const action = isGoldInvite ? 'SUPER_INVITE' : 'INVITE';
        const check = performActionUpdates(myProfile, action);
        
        if (!check.allowed) {
            if (check.reason === 'insufficient_coins') {
                Alert.alert(
                    'Pins insuffisants', 
                    'Vous n\'avez pas assez de pins pour envoyer une invitation. Achetez des pins ou abonnez-vous !',
                    [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                    ]
                );
            } else if (check.reason === 'subscription_required') {
                Alert.alert(
                    'Abonnement recommandé', 
                  'Passez à Frensy PLUS pour des invitations quotidiennes, ou utilisez des pins.',
                  [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                    ]
                );
            } else {
                 showToast('Limite atteinte', 'Vous avez atteint votre limite d\'invitations pour aujourd\'hui.', 'warning');
             }
             // Reset card position since action is blocked
             Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
             return; // Stop swipe
         }
     }
 
     // Fluidité améliorée: Spring animation pour la sortie
    Animated.spring(pan, {
      toValue: { x: dir === 'right' ? SCREEN_W * 1.5 : -SCREEN_W * 1.5, y: 0 },
      friction: 9,
      tension: 40,
      useNativeDriver: true
    }).start(() => {
        if (currentCard) {
          setLastCard(currentCard);
          setLastSwipe(dir);
        }
        setStack(prev => prev.slice(1));
        // Délai pour éviter le "ghosting" (réapparition brève de l'ancienne carte avant le démontage)
        setTimeout(() => {
          pan.setValue({ x: 0, y: 0 });
        }, 20);
        
        setInviteMessage('');
        setIsGoldInvite(false);
        if (currentCard) {
          sessionSeenRef.current.add(currentCard.uid);
          // Réinitialiser l’index photo pour la carte suivante
          setCurrentPhotoIdxByUid(prev => ({ ...prev, [currentCard.uid]: 0 }));
        }
      });
    
    // Persistance en Firestore des profils vus (swipes)
    try {
      const meUid = auth.currentUser?.uid;
      if (meUid && currentCard) {
        if (dir === 'left') {
            await setDoc(doc(db, 'swipes', meUid, 'outgoing', currentCard.uid), {
              v: -1,
              createdAt: serverTimestamp(),
            });
        } else if (dir === 'right' && inviteMessage.trim()) {
            const { sendInvitation } = await import('../../lib/invitations');
            await sendInvitation(currentCard.uid, inviteMessage.trim(), isGoldInvite);
            showToast('Succès', 'Invitation envoyée avec succès', 'success');
        }
        // Pour dir === 'right', le likeUser() ci-dessous s'occupe de créer le doc swipes (v=1)
      }
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.startsWith('ACTION_DENIED')) {
          const reason = msg.split(':')[1];
          if (reason === 'insufficient_coins') {
               Alert.alert(
                  'Pins insuffisants', 
                  'Vous n\'avez pas assez de pins pour envoyer une invitation. Achetez des pins ou abonnez-vous !',
                  [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                  ]
               );
          } else if (reason === 'subscription_required') {
              Alert.alert(
                  'Abonnement recommandé', 
                  'Passez à Frensy PLUS pour des invitations quotidiennes, ou utilisez des pins.',
                  [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                  ]
              );
          } else {
              showToast('Limite atteinte', 'Vous avez atteint votre limite d\'invitations pour aujourd\'hui.', 'warning');
          }
      } else if (msg === 'Une invitation en attente existe déjà.') {
        showToast('Info', msg, 'info');
      }
    }

    // Swipe droite: LIKE (création de like et match potentiel)
    if (dir === 'right' && currentCard && (options?.like ?? true)) {
      try {
        await likeUser(currentCard.uid);
        try {
          const created = await ensureMatchExistsWithLikes(currentCard.uid);
          if (created) setMatchPopup({ partnerUid: currentCard.uid });
        } catch {}
      } catch (error: any) {
        // Tolérer l’erreur (ex: règles), le swipe reste visuel
      }
    }
  }, [stack, pan, inviteMessage, isGoldInvite, myProfile, showToast]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 || Math.abs(g.dy) > 20,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      const isTap = Math.abs(g.dx) < 14 && Math.abs(g.dy) < 14;
      if (g.dx > SWIPE_DISTANCE) {
        swipeOut('right', { like: true });
        return;
      }
      if (g.dx < -SWIPE_DISTANCE) {
        swipeOut('left');
        return;
      }
      if (isTap && top) {
        const tapOnRightHalf = (g.x0 ?? 0) > (SCREEN_W / 2);
        setCurrentPhotoIdxByUid(prev => {
          const cur = prev[top.uid] ?? 0;
          const max = (top.images?.length || 1) - 1;
          
          if (tapOnRightHalf) {
             if (cur < max) return { ...prev, [top.uid]: cur + 1 };
             return prev;
          } else {
             if (cur > 0) return { ...prev, [top.uid]: cur - 1 };
             return prev;
          }
        });
      }
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 10 }).start();
    },
  }), [pan, top, setCurrentPhotoIdxByUid, swipeOut]);

  const renderSwipeInner = () => {
    if (loading && stack.length === 0) {
      // Skeleton Loader pour une sensation de rapidité
      return <SkeletonCard />;
    }

    if (!loading && stack.length === 0) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {refreshing ? (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="large" color={C.tint} />
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '600' }}>Recherche de profils...</Text>
            </View>
          ) : (
            <>
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                 <FontAwesome name="search" size={32} color={C.muted} />
              </View>
              <Text style={{ color: C.text, fontSize: 18, textAlign: 'center', marginBottom: 24, maxWidth: '80%', lineHeight: 26, fontWeight: '500' }}>
                {stack.length === 0 && nearby.length === 0 ? "Personne autour de toi pour le moment..." : "Tu as vu tous les utilisateurs pour l’instant"}
              </Text>
              <GradientButton label="Actualiser" onPress={manualRefresh} style={{ width: 200 }} />
              
              {/* Bouton undo si le dernier swipe était "nope" */}
              {lastCard && lastSwipe === 'left' && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Annuler le dernier swipe"
                  onPress={handleUndo}
                  style={{ marginTop: 24, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}
                >
                  <FontAwesome name="undo" size={18} color="#fff" />
                </TouchableOpacity>
              )}
            </>
          )}
          
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Explorer les groupes"
            onPress={() => setViewMode('groups')}
            style={{ marginTop: 30, padding: 12 }}
          >
            <Text style={{ color: C.tint, fontWeight: '600' }}>Explorer les groupes</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={{ flex: 1 }}>
        {/* Spinner top pendant actualisation manuelle */}
        {refreshing && (
          <View style={{ position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center', zIndex: 60 }}>
            <ActivityIndicator size="small" color={C.tint} />
          </View>
        )}
        
        <View style={styles.deckArea}>
          {next && (
            <Animated.View style={[styles.card, { 
              transform: [{ 
                scale: pan.x.interpolate({
                  inputRange: [-SWIPE_DISTANCE, 0, SWIPE_DISTANCE],
                  outputRange: [1, 0.92, 1],
                  extrapolate: 'clamp'
                }) 
              }], 
              opacity: pan.x.interpolate({
                  inputRange: [-SWIPE_DISTANCE, 0, SWIPE_DISTANCE],
                  outputRange: [1, 0.7, 1],
                  extrapolate: 'clamp'
              }),
              backgroundColor: '#0b0b0b' 
            }]}>
              <Image source={{ uri: next.images[0] }} style={styles.photo} transition={0} contentFit="cover" />
              <View style={styles.infoOverlay}>
                <Text style={[styles.name, { color: '#fff' }]}>
                  {next.name}{next.age ? `, ${next.age}` : ''}
                  {(() => {
                    try {
                      const h = profileByUid[next.uid]?.heightCm;
                      return h ? ` · ${h} cm` : '';
                    } catch { return ''; }
                  })()}
                </Text>
              </View>
            </Animated.View>
          )}
          {top && (
            <Animated.View
              key={top.uid} // Clé unique pour forcer le remount et éviter le ghosting
              {...responder.panHandlers}
              style={[styles.card, { backgroundColor: '#0b0b0b', transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }, { scale: 1 }] }]}
            >
              <Image source={{ uri: top.images[currentPhotoIdxByUid[top.uid] ?? 0] }} style={styles.photo} transition={0} contentFit="cover" />
              
              {/* Preload next/prev images for smoother transition */}
              {top.images.map((uri, idx) => {
                 if (idx === (currentPhotoIdxByUid[top.uid] ?? 0)) return null;
                 return <Image key={uri} source={{ uri }} style={styles.preload} transition={0} />;
              })}

              <LinearGradient 
                colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)']} 
                locations={[0, 0.7, 1]}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}
                pointerEvents="none"
              />
              <Animated.View pointerEvents="none" style={[styles.frame, { borderColor: '#22c55e', opacity: likeFrameOpacity }]} />
              <Animated.View pointerEvents="none" style={[styles.frame, { borderColor: '#ef4444', opacity: nopeFrameOpacity }]} />
              <Animated.View pointerEvents="none" style={[styles.overlayLike, { opacity: likeOverlayOpacity }]}>
                <Text style={styles.overlayLikeTxt}>LIKE</Text>
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.overlayNope, { opacity: nopeOverlayOpacity }]}>
                <Text style={styles.overlayNopeTxt}>NOPE</Text>
              </Animated.View>
              {top.images?.length > 1 && (
                <View style={styles.progressBarWrap} pointerEvents="none">
                  {top.images.map((_, idx) => (
                    <View
                      key={`pb-${top.uid}-${idx}`}
                      style={[
                        styles.progressBarItem,
                        {
                          backgroundColor: (currentPhotoIdxByUid[top.uid] ?? 0) >= idx ? '#ffffff' : 'rgba(255,255,255,0.3)',
                          opacity: 1
                        }
                      ]}
                    />
                  ))}
                </View>
              )}
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={100} style={styles.infoOverlayGlassWrap}>
                <GlassCard style={[styles.infoOverlayGlass, { backgroundColor: 'rgba(20,20,20,0.75)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 16 }]}>
                  <View style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <Text style={[styles.name, { color: '#fff', fontSize: 30, lineHeight: 36 }]}>{top.name}, {top.age}</Text>
                      {top.accountType === 'group' && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F97316', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#F97316' }}>
                           <FontAwesome name="users" size={14} color="#fff" style={{ marginRight: 6 }} />
                           <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>GROUPE</Text>
                        </View>
                      )}
                      {(() => {
                         const g = profileByUid[top.uid]?.genderIdentity;
                         let iconName: any = 'genderless';
                         let iconColor = '#fff';
                         if (g === 'hommes') { iconName = 'mars'; iconColor = '#60a5fa'; }
                         else if (g === 'femmes') { iconName = 'venus'; iconColor = '#f472b6'; }
                         else if (g === 'autres') { iconName = 'transgender'; iconColor = '#a78bfa'; }
                         
                         if (g) {
                             return (
                                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                                   <FontAwesome name={iconName} size={18} color={iconColor} />
                                </View>
                             );
                         }
                         return null;
                      })()}

                      {(() => {
                        try {
                          const nearTop = nearby.find(u => u.id === top.uid);
                          if (!nearTop) return null;
                          const dist = nearTop.distanceKm;
                          return (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                              <FontAwesome name="location-arrow" size={14} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                                {dist < 1 ? '< 1 km' : `~ ${dist.toFixed(0)} km`}
                              </Text>
                            </View>
                          );
                        } catch { return null; }
                      })()}
                    </View>
                    
                    {top.accountType === 'group' && top.groupComposition && (
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, paddingHorizontal: 4 }}>
                            {top.groupComposition.males > 0 && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <FontAwesome name="mars" size={12} color="#90CAF9" />
                                    <Text style={{ color: '#90CAF9', fontSize: 13, fontWeight: '600' }}>{top.groupComposition.males}</Text>
                                </View>
                            )}
                            {top.groupComposition.females > 0 && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <FontAwesome name="venus" size={12} color="#F48FB1" />
                                    <Text style={{ color: '#F48FB1', fontSize: 13, fontWeight: '600' }}>{top.groupComposition.females}</Text>
                                </View>
                            )}
                            {top.groupComposition.others > 0 && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <FontAwesome name="transgender" size={12} color="#A5D6A7" />
                                    <Text style={{ color: '#A5D6A7', fontSize: 13, fontWeight: '600' }}>{top.groupComposition.others}</Text>
                                </View>
                            )}
                        </View>
                    )}
                  </View>

                  {top.isSeen && (
                    <View style={{ position: 'absolute', top: 16, right: 16, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}>
                       <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>DÉJÀ VU</Text>
                    </View>
                  )}

                  {(() => {
                    const prof = profileByUid[top.uid];
                    const genders = (prof?.genders ?? []).map(g => g.toString());
                    const interests = (prof?.interests ?? []).map(i => i.toString());
                    if (genders.length === 0 && interests.length === 0) return null;

                    return (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                        {genders.map((g) => {
                           let label = g.toString();
                           if (label.toLowerCase() === 'hommes') label = 'Hommes';
                           if (label.toLowerCase() === 'femmes') label = 'Femmes';
                           if (label.toLowerCase() === 'autres') label = 'Tous';
                           return (
                              <View key={`g-${g}`} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent' }}>
                             <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{label}</Text>
                           </View>
                        );
                     })}
                     {interests.map((t) => {
                        let label = t.charAt(0).toUpperCase() + t.slice(1);
                        if (t.toLowerCase() === 'amoureux') label = 'Relation sérieuse';
                        return (
                           <View key={`i-${t}`} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent' }}>
                             <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{label}</Text>
                           </View>
                        );
                      })}
                      </View>
                    );
                  })()}

                  {/* Zone de message d'invitation */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                     <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 24, paddingHorizontal: 14, borderWidth: 1, borderColor: isGoldInvite ? Colors.dark.gold : 'rgba(255,255,255,0.15)' }}>
                       <TextInput 
                         style={{ flex: 1, color: Colors.dark.text, paddingVertical: 10, fontSize: 15 }}
                         placeholder="Envoyer un message..."
                         placeholderTextColor="rgba(255,255,255,0.4)"
                         value={inviteMessage}
                         onChangeText={setInviteMessage}
                       />
                       <TouchableOpacity
                         accessibilityRole="button"
                         accessibilityLabel={isGoldInvite ? "Désactiver l'invitation Gold" : "Activer l'invitation Gold"}
                         onPress={() => setIsGoldInvite(p => !p)}
                         style={{ padding: 4 }}
                       >
                          <FontAwesome name="star" size={18} color={isGoldInvite ? Colors.dark.gold : 'rgba(255,255,255,0.3)'} />
                       </TouchableOpacity>
                     </View>
                     <TouchableOpacity 
                        accessibilityRole="button"
                        accessibilityLabel="Envoyer l'invitation"
                        onPress={() => swipeOut('right', { like: true })} 
                        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: isGoldInvite ? Colors.dark.gold : Colors.dark.text, alignItems: 'center', justifyContent: 'center' }}
                     >
                       <FontAwesome name="arrow-up" size={18} color={Colors.light.text} style={{ transform: [{ rotate: '45deg' }] }} />
                     </TouchableOpacity>
                  </View>
                </GlassCard>
              </KeyboardAvoidingView>
            </Animated.View>
          )}
        </View>

        {/* Action Buttons removed as swipe is restored */}


        {/* Bouton Profil précédent (Undo) - Seulement si dernier swipe était Left/Nope */}
        {lastCard && lastSwipe === 'left' && stack.length > 0 && (
          <View style={{ position: 'absolute', bottom: 30, left: 20, zIndex: 50 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Annuler le dernier swipe"
              onPress={handleUndo}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}
            >
              <FontAwesome name="undo" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.dark.background }]}>
      {/* Header Container */}
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16, zIndex: 100 }}>
        <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
           {viewMode === 'swipe' ? (
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image source={require('../../assets/images/icon.png')} style={{ width: 40, height: 40 }} resizeMode="contain" />
                <Text style={{ fontSize: 18, fontWeight: "900", letterSpacing: 3, color: Colors.dark.text }}>F R E N S Y</Text>
             </View>
           ) : (
             <View />
           )}
           
           <View style={{ flexDirection: 'row', backgroundColor: Colors.dark.card, borderRadius: 20, padding: 4, borderWidth: 1, borderColor: Colors.dark.panelBorder }}>
               <TouchableOpacity
                 accessibilityRole="button"
                 accessibilityLabel="Mode découverte de profils"
                 onPress={() => setViewMode('swipe')}
                 style={{ backgroundColor: viewMode === 'swipe' ? Colors.dark.tint : 'transparent', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }}
               >
                 <FontAwesome name="fire" size={16} color={viewMode === 'swipe' ? Colors.dark.text : Colors.dark.subtleText} />
               </TouchableOpacity>
               <TouchableOpacity
                 accessibilityRole="button"
                 accessibilityLabel="Mode découverte de groupes"
                 onPress={() => setViewMode('groups')}
                 style={{ backgroundColor: viewMode === 'groups' ? Colors.dark.tint : 'transparent', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginLeft: 4 }}
               >
                 <FontAwesome name="group" size={16} color={viewMode === 'groups' ? Colors.dark.text : Colors.dark.subtleText} />
               </TouchableOpacity>
           </View>
        </View>
      </View>

      {/* Boost Button (Swipe mode only) */}
        {viewMode === 'swipe' && !loading && (
        <View style={{ position: 'absolute', bottom: 30, right: 20, zIndex: 90 }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Booster mon profil"
            onPress={handleBoost}
            style={{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.dark.tint, shadowColor: "#000", shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 4, elevation: 8, borderWidth: 2, borderColor: Colors.dark.text }}
          >
             <FontAwesome name="rocket" size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>
      )}

      {/* Logo Fixed at Bottom Right (Groups only) */}
      {viewMode === 'groups' && (
      <View style={{ position: 'absolute', bottom: 10, right: -20, zIndex: 999 }} pointerEvents="none">
        <Image
           source={require('../../assets/images/frensylogo.png')}
           style={{ width: 100, height: 30 }} 
           resizeMode="contain" 
        />
      </View>
      )}
      {/* Pop-up Nouveau Match */}
      {matchPopup && (
        <MatchNotification 
          partnerUid={matchPopup.partnerUid} 
          onClose={() => setMatchPopup(null)} 
        />
      )}

      {/* Swipe View */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: swipeOpacity, transform: [{ scale: swipeScale }, { translateY: swipeTransY }], zIndex: viewMode === 'swipe' ? 10 : 0 }]} pointerEvents={viewMode === 'swipe' ? 'auto' : 'none'}>
          {renderSwipeInner()}
      </Animated.View>

      {/* Groups View */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: groupsOpacity, transform: [{ scale: groupsScale }, { translateY: groupsTransY }], zIndex: viewMode === 'groups' ? 10 : 0, paddingTop: 60 }]} pointerEvents={viewMode === 'groups' ? 'auto' : 'none'}>
          <GroupView 
            isVisible={viewMode === 'groups'}
            joinedGroups={joinedGroups} 
            pinnedGroups={pinnedGroups} 
            onTogglePin={async (id) => {
              const next = new Set(pinnedGroups);
              const isPinned = next.has(id);
              if (isPinned) next.delete(id); else next.add(id);
              setPinnedGroups(next);

              try {
                const uid = auth.currentUser?.uid;
                if (!uid) return;
                
                if (isPinned) {
                   await applyUserUpdates(uid, { pinnedGroups: arrayRemove(id) });
                } else {
                   await applyUserUpdates(uid, { pinnedGroups: arrayUnion(id) });
                }
              } catch (e) {
                console.error('Failed to toggle pin', e);
              }
          }}
          onJoinGroup={(id) => {
            const next = new Set(joinedGroups);
            next.add(id);
            setJoinedGroups(next);
          }} />
      </Animated.View>

      {/* Viewer plein écran pour photo sélectionnée */}
      {viewerOpen && viewerUri && (
        <View accessibilityViewIsModal style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' }}>
          <Image source={{ uri: viewerUri }} style={{ width: '88%', height: '70%', borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' }} transition={0} contentFit="cover" />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer le viewer" onPress={() => { setViewerOpen(false); setViewerUri(null); }} style={{ marginTop: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' }}>
            <Text style={{ color: '#fff', fontWeight: '900' }}>Fermer</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

  const styles = StyleSheet.create({
    container: { flex: 1 },
    // Limiter la hauteur pour éviter que la carte prenne tout l’écran sur petits appareils
    deckArea: { flex: 1, position: 'relative', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, marginTop: 40, marginBottom: 20, height: Math.min(SCREEN_H * 0.60, (SCREEN_W - 24) * 1.3) },
    card: { position: 'absolute', width: '100%', height: '100%', borderRadius: 32, overflow: 'hidden', backgroundColor: Colors.dark.card, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 15 },
    photo: { width: '100%', height: '100%', resizeMode: 'cover' },
    // Preload next image (hidden)
    preload: { width: 0, height: 0, opacity: 0 },
    frame: { position: 'absolute', inset: 0, borderWidth: 4, borderRadius: 32 },
    overlayLike: { position: 'absolute', top: 40, left: 30, transform: [{ rotate: '-15deg' }], borderWidth: 4, borderColor: Colors.dark.success, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
    overlayNope: { position: 'absolute', top: 40, right: 30, transform: [{ rotate: '15deg' }], borderWidth: 4, borderColor: Colors.dark.danger, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
    overlayLikeTxt: { fontSize: 36, fontWeight: '800', color: Colors.dark.success, letterSpacing: 2 },
    overlayNopeTxt: { fontSize: 36, fontWeight: '800', color: Colors.dark.danger, letterSpacing: 2 },
    progressBarWrap: { position: 'absolute', top: 12, left: 12, right: 12, height: 4, flexDirection: 'row', gap: 6, zIndex: 20 },
    progressBarItem: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
    infoOverlay: { position: 'absolute', left: 20, bottom: 40 },
    infoOverlayGlassWrap: { position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 20 },
    infoOverlayGlass: { borderRadius: 24, overflow: 'hidden' },
    name: { fontSize: 28, fontWeight: '800', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
    age: { fontSize: 24, fontWeight: '500' },
    actions: { flexDirection: 'row', gap: 18, alignItems: 'center', justifyContent: 'center', padding: 10 },
    circle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    badgeInvite: { position: 'absolute', top: 14, right: 14, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: '#22c55e', borderRadius: 8, backgroundColor: '#22c55e22' },
    badgeSkip: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: '#ef4444', borderRadius: 8, backgroundColor: '#ef444422' },
    badgeTxt: { color: '#fff', fontWeight: '900' },
  });
