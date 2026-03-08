import MultiSlider from '@ptomasroos/react-native-multi-slider';
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    ImageStyle,
    Keyboard,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextStyle,
    TouchableOpacity,
    View,
    ViewStyle
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
// Map native désactivée en web: import dynamique dans le rendu ci-dessous
import NativeMap from "@/components/map/NativeMap";
import { BlurView } from 'expo-blur';
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import DailyLocationPrompt from "../../components/DailyLocationPrompt";
import GlassCard from "../../components/ui/GlassCard";

import * as Location from 'expo-location';

import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { KeyboardAvoidingView, TextInput } from "react-native";
import Logo from "../../assets/images/icon.png";
import { useToast } from "../../components/ui/Toast";
import { Colors } from "../../constants/Colors";
import { auth, db } from "../../firebaseconfig";
import { sendInvitation as sendInvitationApi } from "../../lib/invitations";
import { getApproxPosition, getPrecisePosition } from "../../lib/location";
import { getMatchId } from "../../lib/matches";
import { FEATURE_COSTS, performActionUpdates } from "../../lib/monetization";
import { NearbyUser as NearbyUserPos, subscribeNearbyUsers } from "../../lib/positions";
import { getUserProfile, userPrivateRef } from "../../lib/profile";
dayjs.locale('fr');

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

type NearbyUser = {
  id: string;
  name: string;
  age: number;
  lat: number;
  lng: number;
  distanceKm: number;
  img?: string;
  isBlur?: boolean;
  isOnline?: boolean;
};

const PARIS = { latitude: 48.8566, longitude: 2.3522 };

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

function getRandomOffset(id: string, lat: number, lng: number, radiusMeters: number = 300) {
  // Simple pseudo-random hash based on ID to ensure stability without storage
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash) / 2147483647;
  
  // Random angle
  const angle = seed * 2 * Math.PI;
  // Random distance (avoid 0)
  const dist = (0.2 + 0.8 * seed) * (radiusMeters / 111300);

  const dLat = dist * Math.cos(angle);
  const dLng = dist * Math.sin(angle) / Math.cos(lat * Math.PI / 180);
  
  return { lat: lat + dLat, lng: lng + dLng };
}

import { useOutgoingInvites } from "../../hooks/useOutgoingInvites";

export default function HomeScreen() {
  const scheme = 'dark';
  const C = Colors['dark'];
  const mapRef = useRef<any>(null);
  const { focusUid } = useLocalSearchParams<{ focusUid?: string }>();
  const { hasPendingInvite } = useOutgoingInvites();

  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<Region>({
    latitude: PARIS.latitude,
    longitude: PARIS.longitude,
    latitudeDelta: 0.08,
    longitudeDelta: 0.04
});
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [mePrecise, setMePrecise] = useState<{ lat: number; lng: number } | null>(null);
  const [myAvatar, setMyAvatar] = useState<string | undefined>(undefined);
  const [myFocusX, setMyFocusX] = useState<number>(0.5);
  const [myFocusY, setMyFocusY] = useState<number>(0.5);
  const [myZoom, setMyZoom] = useState<number>(1);
  const [selected, setSelected] = useState<NearbyUser | null>(null);
  const [clusterSel, setClusterSel] = useState<NearbyUser[] | null>(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [hasMatch, setHasMatch] = useState(false);
  // inviteStatus is now derived from hasPendingInvite
  const { showToast } = useToast();
  const [clusterStatuses, setClusterStatuses] = useState<Record<string, { online: boolean; last: number | null }>>({});
  const [inviteTarget, setInviteTarget] = useState<NearbyUser | null>(null);
  const [isGoldInvite, setIsGoldInvite] = useState(false);
  const keyboardHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
        // On remonte la modale de la hauteur du clavier
        // On ajoute un petit offset négatif pour être sûr que ça ne colle pas trop
        // Sur Android, on utilise duration 0 ou e.duration car l'animation est parfois différente
        Animated.timing(keyboardHeight, {
            toValue: -e.endCoordinates.height, 
            duration: e.duration || 250,
            useNativeDriver: true
        }).start();
    };

    const onHide = (e: any) => {
        Animated.timing(keyboardHeight, {
            toValue: 0,
            duration: e.duration || 250,
            useNativeDriver: true
        }).start();
    };

    const sub1 = Keyboard.addListener(showEvent, onShow);
    const sub2 = Keyboard.addListener(hideEvent, onHide);

    return () => {
        sub1.remove();
        sub2.remove();
    };
  }, []);

  useEffect(() => {
    setInviteMessage('');
    setIsGoldInvite(false);
  }, [selected]);

  const isInvitePending = useMemo(() => {
    const target = inviteTarget || selected;
    if (!target) return false;
    return hasPendingInvite(target.id);
  }, [selected, inviteTarget, hasPendingInvite]);

  useEffect(() => {
    const target = inviteTarget || selected;
    if (!target) return;
    (async () => {
       try {
          const me = auth.currentUser?.uid;
          if (me) {
             const matchId = getMatchId(me, target.id);
             const matchSnap = await getDoc(doc(db, 'matches', matchId));
             setHasMatch(matchSnap.exists());
          }
       } catch {}
    })();
  }, [selected, inviteTarget]);

  const sendInvitation = async (isGold: boolean = false) => {
    const target = inviteTarget || selected;
    if (!target) return;
    const uid = target.id;
    const me = auth.currentUser?.uid;

    if (isInvitePending) {
        showToast('Info', 'Une invitation est déjà en attente.', 'info');
        return;
    }

    if (me) {
        const profile = await getUserProfile(me);
        if (profile) {
            const action = isGold ? 'SUPER_INVITE' : 'INVITE';
            const check = performActionUpdates(profile, action);
            
            if (!check.allowed) {
                // Use setTimeout to avoid Modal/Alert conflict causing crash
                setTimeout(() => {
                    if (check.reason === 'insufficient_coins') {
                        Alert.alert(
                            'Pins insuffisants',
                            'Vous n\'avez pas assez de pins pour envoyer une invitation.',
                            [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Acheter des pins', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
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
                }, 100);
                return;
            }
        }
    }

    setSendingInvite(true);
    try {
      if (!sendInvitationApi) throw new Error("Fonction d'envoi non disponible");
      await sendInvitationApi(uid, inviteMessage, isGold);
      setInviteModalVisible(false);
      setInviteTarget(null);
      showToast('Succès', 'Invitation envoyée avec succès.', 'success');
    } catch (error: any) {
      const msg = error.message || "";
      if (msg.startsWith('ACTION_DENIED')) {
          const reason = msg.split(':')[1];
          setInviteModalVisible(false);
          setInviteTarget(null);
          
          setTimeout(() => {
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
          }, 100);
      } else {
          showToast('Erreur', msg || "Impossible d'envoyer l'invitation.", 'error');
      }
    } finally {
      setSendingInvite(false);
    }
  };
const sheetAnim = useRef(new Animated.Value(0)).current;
const fadeAnim = useRef(new Animated.Value(0)).current;
const sheetH = 220;
const pan = useRef(PanResponder.create({
  onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
  onPanResponderMove: (_, g) => {
    if (g.dy > 0) {
      const v = Math.max(0, 1 - g.dy / sheetH);
      sheetAnim.setValue(v);
      fadeAnim.setValue(v);
    }
  },
  onPanResponderRelease: (_, g) => {
    if (g.dy > 80) {
      Animated.parallel([
        Animated.timing(sheetAnim, { toValue: 0, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true })
      ]).start(({ finished }) => { if (finished) { setSelected(null); setClusterSel(null); } });
    } else {
      Animated.parallel([
        Animated.timing(sheetAnim, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true })
      ]).start();
    }
  },
})).current;
const [rawNearbyUsers, setRawNearbyUsers] = useState<NearbyUserPos[]>([]);
  const [nearbyAll, setNearbyAll] = useState<NearbyUserPos[]>([]);
  const [profilesByUid, setProfilesByUid] = useState<Record<string, { img?: string; name?: string; deleted?: boolean } | undefined>>({});
const [selStatus, setSelStatus] = useState<{ online: boolean; last: number | null }>({ online: false, last: null });

  useEffect(() => {
    (async () => {
      try {
        if (selected) {
          const snap = await getDoc(doc(db, 'positions', selected.id));
          const d: any = snap.data();
          const last = d?.updatedAtMs || null;
          const online = typeof last === 'number' && (Date.now() - last) < 2 * 60 * 1000;
          setSelStatus({ online, last });
        } else {
          setSelStatus({ online: false, last: null });
        }
      } catch {}
    })();
  }, [selected]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!clusterSel || clusterSel.length === 0) { if (alive) setClusterStatuses({}); return; }
        const updates: Record<string, { online: boolean; last: number | null }> = {};
        for (const u of clusterSel) {
          try {
            const snap = await getDoc(doc(db, 'positions', u.id));
            const d: any = snap.data();
            const last = d?.updatedAtMs || null;
            const online = typeof last === 'number' && (Date.now() - last) < 2 * 60 * 1000;
            updates[u.id] = { online, last };
          } catch {}
        }
        if (alive) setClusterStatuses(updates);
      } catch {}
    })();
    return () => { alive = false; };
  }, [clusterSel]);
  const [friendUids, setFriendUids] = useState<string[]>([]);
  const [shareFromUids, setShareFromUids] = useState<string[]>([]);
  const [sharingEnabled, setSharingEnabled] = useState(true);
  const [radiusKm, setRadiusKm] = useState<number>(100);
  const [isRadiusChanging, setIsRadiusChanging] = useState(false);
  const [tempRadius, setTempRadius] = useState<number>(100);
  const insets = useSafeAreaInsets();

  const updateRadius = async (val: number[]) => {
      const newRadius = val[0];
      setRadiusKm(newRadius);
      setTempRadius(newRadius);
      setIsRadiusChanging(false);
      
      const uid = auth.currentUser?.uid;
      if (uid) {
          // Update Firestore
          const { updateDoc, doc } = await import('firebase/firestore');
          await updateDoc(doc(db, 'users', uid), { discoveryRadiusKm: newRadius });
      }
  };

  const didCenterRef = useRef(false);
  const handledFocusRef = useRef<string | null>(null);

  // Les utilisateurs proches proviennent désormais de Firestore via subscribeNearbyUsers (état `nearby`).

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'undetermined') {
             await new Promise<void>(resolve => {
                 Alert.alert(
                     "Localisation",
                     "Frendzy utilise ta position pour te montrer les personnes autour de toi.",
                     [{ text: "Continuer", onPress: () => resolve() }]
                 );
             });
        }

        const pos = await getApproxPosition();
        setMe({ lat: pos.lat, lng: pos.lng });
        setRegion({
          latitude: pos.lat,
          longitude: pos.lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.03
        });
      } catch (e) {
        console.warn("Location error", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // S’abonner aux matchs pour obtenir la liste d’amis (utilisateurs matchés)
  useEffect(() => {
    (async () => {
      try {
        const { auth } = await import("../../firebaseconfig");
        const meUid = auth.currentUser?.uid;
        if (!meUid) return;
        const { collection, query, where, onSnapshot } = await import('firebase/firestore');
        const q = query(collection(db, 'matches'), where('users', 'array-contains', meUid));
        const unsub = onSnapshot(q, (snap) => {
          const others = new Set<string>();
          snap.forEach(d => {
            const users = (d.data() as any)?.users || [];
            for (const u of users) { if (u !== meUid) others.add(u); }
          });
          setFriendUids(Array.from(others));
        });
        return () => { try { unsub(); } catch {} };
      } catch {}
    })();
  }, []);

  // S’abonner aux partages de localisation entrants (amis qui partagent vers moi)
  useEffect(() => {
    (async () => {
      try {
        const { auth } = await import("../../firebaseconfig");
        const meUid = auth.currentUser?.uid;
        if (!meUid) return;
        const { collection, query, where, onSnapshot } = await import('firebase/firestore');
        const q = query(collection(db, 'locationShares'), where('to', '==', meUid));
        const unsub = onSnapshot(q, (snap) => {
          const arr: string[] = [];
          const now = Date.now();
          snap.forEach((d) => {
            const data = d.data() as any;
            const active = data?.active === true && data?.revoked !== true;
            const notExpired = typeof data?.expiresAtMs !== 'number' || data.expiresAtMs > now;
            if (active && notExpired && typeof data?.from === 'string') arr.push(data.from);
          });
          setShareFromUids(arr);
        });
        return () => { try { unsub(); } catch {} };
      } catch {}
    })();
  }, []);

  // Écouter les changements de profil (rayon, avatar, focusX/Y) et mettre à jour en direct
  useEffect(() => {
    (async () => {
      try {
        const { auth } = await import("../../firebaseconfig");
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        
        const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
          const data = snap.data() as any;
        const r = data?.discoveryRadiusKm;
        if (typeof r === 'number' && Number.isFinite(r)) {
          setRadiusKm(r);
        }
        const fx = data?.avatarFocusX; const fy = data?.avatarFocusY;
        if (typeof fx === 'number' && Number.isFinite(fx)) setMyFocusX(fx);
        if (typeof fy === 'number' && Number.isFinite(fy)) setMyFocusY(fy);
        const z = data?.avatarZoom;
        if (typeof z === 'number' && Number.isFinite(z)) setMyZoom(z);

        // setSharingEnabled(!data?.ghostMode); // Moved to private listener
          
          // Mettre à jour l’avatar si la photo principale change
          try {
            let url: string | undefined = data?.photos?.find((ph: any) => ph?.path === data?.primaryPhotoPath)?.url || data?.photos?.[0]?.url;
            if (!url) {
              const path = data?.primaryPhotoPath || data?.photos?.[0]?.path;
              if (path) {
                (async () => {
                  try {
                    const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
                    const storage = getStorage();
                    const dl = await getDownloadURL(ref(storage, path));
                    setMyAvatar(dl);
                  } catch {}
                })();
              }
            } else {
              setMyAvatar(url);
            }
          } catch {}
        });

        // Listen to private profile for ghostMode
        const unsubPrivate = onSnapshot(userPrivateRef(uid), (snap) => {
            if (snap.exists()) {
                const d = snap.data();
                setSharingEnabled(!(d?.ghostMode === true));
            }
        });

        return () => { try { unsub(); unsubPrivate(); } catch {} };
      } catch {}
    })();
  }, []);

  // S’abonner à tous les utilisateurs proches et réagir si le rayon change
  useEffect(() => {
    if (!me) return;
    // On n'inclut que les amis qui partagent leur position (shareFromUids).
    // Les autres amis ne seront visibles que s'ils sont dans le rayon (via nearby).
    const include = [...shareFromUids]; 
    const unsub = subscribeNearbyUsers({ lat: me.lat, lng: me.lng }, radiusKm, include, (users) => {
      setRawNearbyUsers(users as any);
    });
    return () => { try { unsub(); } catch {} };
  }, [me, radiusKm, shareFromUids]);

  // Filtrer les utilisateurs (âge, etc.) sans re-souscrire
  useEffect(() => {
      const filtered = rawNearbyUsers
        .filter(u => u.id !== auth.currentUser?.uid);
      setNearbyAll(filtered);
  }, [rawNearbyUsers, shareFromUids]);

  // Check Daily Gift (open store once per day, de-duped with index.tsx)
  useEffect(() => {
      (async () => {
         try {
             const { doc, getDoc } = await import('firebase/firestore');
             const { auth } = await import('../../firebaseconfig');
             const dayjs = (await import('dayjs')).default;
             
             const uid = auth.currentUser?.uid;
             if (!uid) return;

             const userDoc = await getDoc(doc(db, 'users', uid));
             if (userDoc.exists()) {
                 const d = userDoc.data();
                 const rawLastClaim = (d as any).lastDailyRewardClaimedAt;
                 let lastClaim = null as dayjs.Dayjs | null;
                 if (rawLastClaim) {
                     if (typeof rawLastClaim === 'number') {
                         lastClaim = dayjs(rawLastClaim);
                     } else if (typeof (rawLastClaim as any).toMillis === 'function') {
                         lastClaim = dayjs(rawLastClaim.toMillis());
                     } else if (rawLastClaim instanceof Date) {
                         lastClaim = dayjs(rawLastClaim.getTime());
                     }
                 }
                 const now = dayjs();
                 
                 if (!lastClaim || !now.isSame(lastClaim, 'day')) {
                     const key = `dailyReward:opened:${now.format('YYYY-MM-DD')}`;
                     const wasOpened = await AsyncStorage.getItem(key);
                     if (!wasOpened) {
                        try { await AsyncStorage.setItem(key, '1'); } catch {}
                        setTimeout(() => { router.push('/store'); }, 250);
                     }
                 }
             }
         } catch(e) {}
      })();
  }, []);


  useEffect(() => {
    (async () => {
      try {
        const { auth } = await import("../../firebaseconfig");
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const { getUserProfile } = await import("../../lib/profile");
        const p = await getUserProfile(uid);
        let profileUrl = p?.photos?.find(ph => ph.path === p?.primaryPhotoPath)?.url || p?.photos?.[0]?.url;
        if (!profileUrl) {
          const path = p?.primaryPhotoPath || p?.photos?.[0]?.path;
          if (path) {
            try {
              const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
              const storage = getStorage();
              profileUrl = await getDownloadURL(ref(storage, path));
            } catch {}
          }
        }
        const authUrl = (await import("firebase/auth")).getAuth().currentUser?.photoURL || undefined;
        setMyAvatar(profileUrl || authUrl);
        setMyFocusX(typeof p?.avatarFocusX === 'number' ? p.avatarFocusX : 0.5);
        setMyFocusY(typeof p?.avatarFocusY === 'number' ? p.avatarFocusY : 0.5);
        const precise = await getPrecisePosition();
        setMePrecise({ lat: precise.lat, lng: precise.lng });
      } catch {}
    })();
  }, []);

  // Le tracking est maintenant géré globalement dans app/(tabs)/_layout.tsx pour persister hors de la home

  // Charger les avatars des amis visibles (position précise uniquement)
  // Séparer: amis dans la zone et amis ayant partagé une position précise
  const friendsNearbyAll = useMemo(() => {
    if (friendUids.length === 0) return [] as NearbyUserPos[];
    return nearbyAll.filter(u => friendUids.includes(u.id));
  }, [nearbyAll, friendUids]);

  // Charger les avatars pour la carte (tous les utilisateurs proches)
  // Amis précis -> position réelle, net
  // Amis non précis -> position aléatoire, net (mais lieu imprécis)
  // Autres -> position aléatoire, flou
  const mapUsers: NearbyUser[] = useMemo(() => {
    const now = Date.now();
    return nearbyAll.map(u => {
      const p = profilesByUid[u.id];
      if (p?.deleted) return null;

      // Est-ce un ami qui partage sa position précise ?
      const isFriend = friendUids.includes(u.id);
      const isSharingToMe = shareFromUids.includes(u.id);
      
      // Amélioration de la logique de précision pour les amis
      // Si c'est un ami qui partage sa position (via boussole/partage actif), on force l'affichage précis
      // même si la précision technique est moyenne (ex: GPS un peu faible).
      // On garde le seuil de 0.2km uniquement pour les inconnus ou le mode public.
      const isPrecise = (u as any).precisionKm <= 0.2;
      
      const showPrecise = isSharingToMe || (isFriend && isPrecise);

      let lat = u.lat;
      let lng = u.lng;
      // Les amis ne sont jamais floutés (on voit leur visage), mais leur position peut être floue
      let isBlur = !isFriend;

      if (!showPrecise) {
        // Position aléatoire stable pour protéger la vie privée
        const offset = getRandomOffset(u.id, u.lat, u.lng, 1000);
        lat = offset.lat;
        lng = offset.lng;
        // Si ce n'est pas un ami, on floute aussi l'image (déjà fait par isBlur = !isFriend)
      }

      const online = typeof (u as any).lastActive === 'number' && (now - (u as any).lastActive) < 2 * 60 * 1000;

      // Priorité à l'image venant du doc position (temps réel), sinon fallback sur profil chargé
      const img = u.img || p?.img;
      
      // Affichage du nom : "Utilisateur" uniquement pour les inconnus (non-amis)
      // Pour les amis, on veut toujours voir le nom (p?.name ou u.name).
      // Si le nom est manquant, on met "Ami" au lieu de "Utilisateur" pour distinguer.
      const rawName = p?.name || u.name;
      const displayName = isFriend ? (rawName === 'Utilisateur' ? 'Ami' : rawName) : rawName;

      return { 
        id: u.id, 
        name: displayName, 
        age: u.age, 
        lat, 
        lng, 
        distanceKm: u.distanceKm, 
        img,
        isBlur,
        isOnline: online
      };
    }).filter(u => u !== null) as NearbyUser[];
  }, [nearbyAll, friendUids, shareFromUids, profilesByUid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Charger les images pour les utilisateurs proches qui n'en ont pas dans leur doc position
      const missing = nearbyAll.slice(0, 50)
        .filter(u => !u.img) // Si u.img existe, pas besoin de charger
        .map(u => u.id)
        .filter(uid => profilesByUid[uid] === undefined);

      if (missing.length === 0) return;
      try {
        const { getUserProfile } = await import("../../lib/profile");
        const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage();

        const updates: Record<string, { img?: string; name?: string; deleted?: boolean } | undefined> = {};
        for (const uid of missing) {
          try {
            const p = await getUserProfile(uid);
            if (!p) {
               updates[uid] = { deleted: true };
               continue;
            }

            let url = p?.photos?.find(ph => ph.path === p?.primaryPhotoPath)?.url || p?.photos?.[0]?.url;
            
            if (!url) {
              const path = p?.primaryPhotoPath || p?.photos?.[0]?.path;
              if (path) {
                try {
                  url = await getDownloadURL(ref(storage, path));
                } catch {}
              }
            }
            updates[uid] = { img: url, name: p?.firstName };
          } catch {}
        }
        if (!cancelled && Object.keys(updates).length > 0) {
          setProfilesByUid(prev => ({ ...prev, ...updates }));
        }
      } catch {
        // silencieux
        }
      })();
      return () => { cancelled = true; };
  }, [nearbyAll, profilesByUid]);

  const recenter = () => {
    const base = mePrecise ?? me;
    if (!mapRef.current || !base) return;
    Haptics.selectionAsync();
    mapRef.current.animateToRegion(
      {
        latitude: base.lat,
        longitude: base.lng,
        latitudeDelta: 0.06,
        longitudeDelta: 0.03,
      },
      350
    );
  };

  // Focaliser un utilisateur spécifique si demandé via paramètre d’URL
  useEffect(() => {
    if (!focusUid || handledFocusRef.current === focusUid) return;
    if (mapUsers.length === 0 || !mapRef.current) return;
    
    const target = mapUsers.find(u => u.id === focusUid);
    if (!target) return;
    
    try {
      handledFocusRef.current = focusUid;
      mapRef.current.animateToRegion(
        {
          latitude: target.lat,
          longitude: target.lng,
          latitudeDelta: 0.03,
          longitudeDelta: 0.015,
        },
        350
      );
      setSelected(target);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(sheetAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true })
      ]).start();
    } catch {}
  }, [focusUid, mapUsers, sheetAnim, fadeAnim]);

  // Centrer automatiquement la carte sur ma position dès qu’elle est connue
  useEffect(() => {
    const base = mePrecise ?? me;
    if (didCenterRef.current) return;
    if (!mapRef.current || !base) return;
    didCenterRef.current = true;
    mapRef.current.animateToRegion(
      {
        latitude: base.lat,
        longitude: base.lng,
        latitudeDelta: 0.06,
        longitudeDelta: 0.03,
      },
      350
    );
  }, [mePrecise, me]);

  return (
    <View style={[s.container, { backgroundColor: C.background }]}>
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Image source={Logo} style={s.logo} contentFit="contain" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[s.appName, { color: C.text }]}>F R E N S Y</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Radius Slider Overlay */}
      <View style={{ position: 'absolute', top: insets.top + 70, left: 0, right: 0, zIndex: 90, alignItems: 'center', pointerEvents: 'box-none' }}>
          <View style={{ backgroundColor: 'rgba(20,20,20,0.85)', borderRadius: 24, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 10 }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', width: 50, textAlign: 'right' }}>
                  {isRadiusChanging ? `${tempRadius} km` : `${radiusKm} km`}
              </Text>
              <MultiSlider
                  values={[radiusKm]}
                  min={1}
                  max={150}
                  step={1}
                  sliderLength={160}
                  onValuesChangeStart={() => setIsRadiusChanging(true)}
                  onValuesChange={(val) => setTempRadius(val[0])}
                  onValuesChangeFinish={updateRadius}
                  selectedStyle={{ backgroundColor: C.tint }}
                  unselectedStyle={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                  containerStyle={{ height: 30 }}
                  trackStyle={{ height: 4, borderRadius: 2 }}
                  markerStyle={{ backgroundColor: '#fff', height: 20, width: 20, borderRadius: 10, borderWidth: 0, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3 }}
                  pressedMarkerStyle={{ height: 26, width: 26, borderRadius: 13 }}
              />
          </View>
      </View>



      {/* Map: affiche tout le monde (amis précis + autres floutés) */}
      <NativeMap
        mapRef={mapRef}
        style={s.map}
        scheme={scheme}
        C={C}
        region={region}
        setRegion={setRegion}
        nearby={mapUsers as any}
        onSelect={(u: any) => {
  try {
    setSelected({ id: u.id, name: u.name, age: (u.age ?? 0), lat: u.lat, lng: u.lng, distanceKm: u.distanceKm ?? 0, img: u.img, isBlur: u.isBlur });
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(sheetAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true })
    ]).start();
  } catch {}
}}
        self={mePrecise ? { lat: mePrecise.lat, lng: mePrecise.lng, img: myAvatar, focusX: myFocusX, focusY: myFocusY, zoom: myZoom } : null}
        radiusKm={radiusKm}
        onClusterSelect={(users: NearbyUser[]) => {
          try {
            setClusterSel(users.map((u: NearbyUser) => ({ ...(u as any), img: profilesByUid[u.id]?.img })) as any);
            fadeAnim.setValue(0);
            Animated.parallel([
              Animated.timing(sheetAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
              Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true })
            ]).start();
          } catch {}
        }}
      />

      <GlassCard style={s.hudGlass}> 
        <Text style={[s.hudCount, { color: C.tint }]}>{nearbyAll.length}</Text>
        <Text style={[s.hudText, { color: C.text }]}>personnes autour de toi</Text>
        <View style={s.hudRow}> 
          <Text style={[s.hudSub, { color: C.muted }]}>📡 Dans la zone : {radiusKm} km • dont {friendsNearbyAll.length} {friendsNearbyAll.length > 1 ? 'amis' : 'ami'}</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Informations sur la localisation"
            onPress={() => Alert.alert(
            'Localisation',
            'Tu peux activer/désactiver le partage de ta localisation. Lorsque désactivé, tu ne seras pas comptabilisé dans la zone.'
          )}>
            <Text style={[s.link, { color: C.muted }]}>ℹ︎</Text>
          </Pressable>
        </View>
      </GlassCard>

      {/* Panneau supprimé: icônes fantôme/paramètres déplacées près du logo */}

      {/* Dock des actions: fantôme + paramètres à gauche, recentrer à droite */}
      <View style={s.fabDock}>
        <View style={s.smallRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={sharingEnabled ? 'Désactiver le partage de localisation (Mode fantôme)' : 'Activer le partage de localisation'}
            onPress={() => {
              if (sharingEnabled) {
                Alert.alert(
                  'Mode fantôme',
                  "Voulez-vous vraiment désactiver votre localisation ?\nVous n'apparaitrez plus dans les swipe des utilisateurs et tous vos partages de position actifs seront interrompus.",
                  [
                    { text: 'Non', style: 'cancel' },
                    { text: 'Oui', style: 'destructive', onPress: async () => { 
                        setSharingEnabled(false); 
                        try { 
                          const { auth } = await import('../../firebaseconfig'); 
                          const uid = auth.currentUser?.uid; 
                          if (uid) { 
                             const batch = writeBatch(db);
                             // 1. Activer le mode fantôme dans les settings privés
                             batch.set(userPrivateRef(uid), { ghostMode: true }, { merge: true });
                             
                             // 2. Désactiver tous les partages de position actifs
                             const sharesQuery = query(
                                collection(db, 'locationShares'), 
                                where('from', '==', uid),
                                where('active', '==', true)
                             );
                             const sharesSnap = await getDocs(sharesQuery);
                             sharesSnap.forEach((doc) => {
                                batch.update(doc.ref, { active: false, revoked: true, updatedAt: Date.now() });
                             });

                             await batch.commit();
                             showToast('Mode fantôme activé', 'Votre position est masquée et les partages ont été arrêtés.', 'success');
                          } 
                        } catch (e) {
                          console.error(e);
                          showToast('Erreur', 'Impossible d\'activer le mode fantôme', 'error');
                          setSharingEnabled(true); // Rollback
                        } 
                      } 
                    },
                  ]
                );
              } else {
                (async () => { 
                  try { 
                    const { auth } = await import('../../firebaseconfig'); 
                    const uid = auth.currentUser?.uid; 
                    if (uid) { 
                      // Désactiver le mode fantôme dans les settings privés
                      await (await import('firebase/firestore')).setDoc(userPrivateRef(uid), { ghostMode: false }, { merge: true }); 
                      showToast('Mode fantôme désactivé', 'Vous êtes de nouveau visible.', 'success');
                    } 
                  } catch (e) {
                     console.error(e);
                  } 
                  setSharingEnabled(true); 
                })();
              }
            }}
            style={[s.smallFabBtn, { backgroundColor: !sharingEnabled ? C.tint : C.background, borderColor: !sharingEnabled ? C.tint : C.border }]}
          >
            <Text style={{ fontSize: 14 }}>{'👻'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Ouvrir les paramètres"
            onPress={() => router.push('/settings')}
            style={[s.smallFabBtn, { backgroundColor: C.background, borderColor: C.border }]}
          >
            <Text style={{ fontSize: 14 }}>{'⚙️'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Recentrer la carte"
            onPress={recenter} 
            style={[s.fabBtn, { backgroundColor: C.card, borderColor: C.border }]}
          >
            <Text style={{ fontSize: 18 }}>{'🎯'}</Text>
          </TouchableOpacity>
      </View>

      <Modal visible={!!selected} transparent animationType="none" onRequestClose={() => {
        Animated.parallel([
          Animated.timing(sheetAnim, { toValue: 0, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true })
        ]).start(({ finished }) => { if (finished) setSelected(null); });
      }}>
        <AnimatedBlurView 
          intensity={Platform.OS === 'ios' ? 80 : 50} 
          tint="dark" 
          style={[s.backdrop, { opacity: fadeAnim, backgroundColor: 'transparent' }]}
        >
          <Pressable style={{ flex: 1 }} onPress={() => {
            Animated.parallel([
              Animated.timing(sheetAnim, { toValue: 0, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
              Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true })
            ]).start(({ finished }) => { if (finished) setSelected(null); });
          }} />
        </AnimatedBlurView>
        <Animated.View
          {...pan.panHandlers}
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 110,
            height: sheetH,
            borderRadius: 24,
            overflow: 'hidden',
            transform: [
                { translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [sheetH + 110, 0] }) },
                { translateY: keyboardHeight }
            ],
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 20,
          }}
        >
          <BlurView intensity={Platform.OS === 'ios' ? 40 : 100} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: scheme === 'dark' ? 'rgba(30,30,30,0.6)' : 'rgba(255,255,255,0.7)' }]} />
          
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(150,150,150,0.3)', alignSelf: 'center', marginTop: 10 }} />

          {selected && (
            <View style={{ padding: 20, flex: 1, gap: 20 }}>
              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                  <Image source={selected.img ? { uri: selected.img } : Logo} style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)' }} contentFit="cover" blurRadius={(selected as any).isBlur ? 50 : 0} />
                  <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: C.text }}>{selected.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selStatus.online ? '#3BA55D' : '#999' }} />
                          <Text style={{ color: C.muted, fontSize: 13, fontWeight: '500' }}>
                              {selStatus.online ? 'En ligne' : (selStatus.last ? (dayjs(selStatus.last).isSame(dayjs(), 'day') ? `Vu à ${dayjs(selStatus.last).format('HH:mm')}` : `Vu le ${dayjs(selStatus.last).format('DD/MM')}`) : 'Hors ligne')}
                          </Text>
                      </View>
                      <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
                          {selected.distanceKm < 1 ? `À moins d'1 km` : `À ${selected.distanceKm.toFixed(1)} km`}
                      </Text>
                  </View>
              </View>

              {hasMatch ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Envoyer un message"
                    onPress={() => router.push(`/chat/${selected.id}` as any)}
                    style={{ borderRadius: 18, paddingVertical: 16, backgroundColor: C.tint, shadowColor: C.tint, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: {width: 0, height: 4}, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Envoyer un message</Text>
                  </TouchableOpacity>
              ) : isInvitePending ? (
                  <View style={{ borderRadius: 18, paddingVertical: 16, backgroundColor: '#444', alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontWeight: '800', fontSize: 16 }}>Invitation envoyée</Text>
                  </View>
              ) : (
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                     <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 24, paddingHorizontal: 14, borderWidth: 1, borderColor: isGoldInvite ? C.gold : 'rgba(255,255,255,0.15)' }}>
                       <TextInput 
                         style={{ flex: 1, color: C.text, paddingVertical: 10, fontSize: 15 }}
                         placeholder="Envoyer un message..."
                         placeholderTextColor="rgba(255,255,255,0.4)"
                         value={inviteMessage}
                         onChangeText={setInviteMessage}
                         multiline={false}
                         returnKeyType="send"
                         onSubmitEditing={() => sendInvitation(isGoldInvite)}
                       />
                       <TouchableOpacity
                         accessibilityRole="button"
                         accessibilityLabel={isGoldInvite ? "Désactiver l'invitation Gold" : "Activer l'invitation Gold"}
                         onPress={() => setIsGoldInvite(p => !p)}
                         style={{ padding: 4 }}
                       >
                          <FontAwesome name="star" size={18} color={isGoldInvite ? C.gold : 'rgba(255,255,255,0.3)'} />
                       </TouchableOpacity>
                     </View>
                     <TouchableOpacity 
                        accessibilityRole="button"
                        accessibilityLabel="Envoyer l'invitation"
                        onPress={() => sendInvitation(isGoldInvite)} 
                        disabled={sendingInvite}
                        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: isGoldInvite ? C.gold : C.text, alignItems: 'center', justifyContent: 'center', opacity: sendingInvite ? 0.7 : 1 }}
                     >
                       {sendingInvite ? <ActivityIndicator size="small" color={C.background} /> : <FontAwesome name="arrow-up" size={18} color={C.background} style={{ transform: [{ rotate: '45deg' }] }} />}
                     </TouchableOpacity>
                  </View>
                </KeyboardAvoidingView>
              )}
            </View>
          )}
        </Animated.View>
      </Modal>

      <Modal visible={!!clusterSel} transparent animationType="none" onRequestClose={() => {
        Animated.parallel([
          Animated.timing(sheetAnim, { toValue: 0, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true })
        ]).start(({ finished }) => { if (finished) setClusterSel(null); });
      }}>
        <AnimatedBlurView 
          intensity={Platform.OS === 'ios' ? 80 : 50} 
          tint="dark" 
          style={[s.backdrop, { opacity: fadeAnim, backgroundColor: 'transparent' }]}
        > 
          <Pressable style={{ flex: 1 }} onPress={() => {
            Animated.parallel([
              Animated.timing(sheetAnim, { toValue: 0, duration: 250, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
              Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true })
            ]).start(({ finished }) => { if (finished) setClusterSel(null); });
          }} />
        </AnimatedBlurView>
        <Animated.View
          {...pan.panHandlers}
          style={[
            s.sheet,
            {
              backgroundColor: C.card,
              borderColor: C.border,
              height: sheetH,
              transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [sheetH, 0] }) }],
            },
          ]}
        >
          <View style={s.sheetHandle} />
          {clusterSel && (
            <View style={[s.sheetContent, { gap: 14 }]}>
              <Text style={[s.sheetTitle, { color: C.text }]}>Regroupement ({clusterSel.length})</Text>
              <View style={{ height: 100 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4, gap: 12 }}>
                  {clusterSel.map(u => {
                    const st = clusterStatuses[u.id];
                    const online = !!st?.online;
                    return (
                      <TouchableOpacity
                        key={`cluster_u_${u.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Ouvrir le profil de ${u.name}`}
                        onPress={() => router.push(`/chat/${u.id}` as any)}
                        style={{ alignItems: 'center', width: 70 }}
                      > 
                        <Image source={u.img ? { uri: u.img } : Logo} style={{ width: 56, height: 56, borderRadius: 28 }} contentFit="cover" blurRadius={(u as any).isBlur ? 10 : 0} />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: online ? '#3BA55D' : '#999' }} />
                          <Text numberOfLines={1} style={{ color: online ? (scheme === 'dark' ? '#9CF99C' : '#0F7A0F') : C.muted, fontSize: 11, maxWidth: 60 }}>
                            {u.name}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          )}
        </Animated.View>
      </Modal>

      <Modal
        animationType="fade"
        transparent={true}
        visible={inviteModalVisible}
        onRequestClose={() => { setInviteModalVisible(false); setInviteTarget(null); }}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
        >
          <View style={{ width: '100%', backgroundColor: '#222', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#333' }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>Envoyer une invitation</Text>
            <Text style={{ color: '#aaa', marginBottom: 16 }}>Vous n&apos;êtes pas encore en relation. Envoyez une invitation pour discuter.</Text>
            
            <TextInput
              value={inviteMessage}
              onChangeText={setInviteMessage}
              placeholder="Message (optionnel)..."
              placeholderTextColor="#666"
              style={{ 
                backgroundColor: '#111', 
                color: '#fff', 
                padding: 12, 
                borderRadius: 12, 
                minHeight: 80, 
                textAlignVertical: 'top',
                marginBottom: 20,
                borderWidth: 1,
                borderColor: '#333'
              }}
              multiline
              maxLength={200}
            />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => { setInviteModalVisible(false); setInviteTarget(null); }} style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#333', alignItems: 'center' }}>
                 <Text style={{ color: '#fff', fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => sendInvitation(false)} disabled={sendingInvite} style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F97316', alignItems: 'center', opacity: sendingInvite ? 0.7 : 1 }}>
                 {sendingInvite ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: 'bold' }}>Envoyer</Text>}
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
                onPress={() => sendInvitation(true)} 
                disabled={sendingInvite} 
                style={{ 
                    marginTop: 12, 
                    padding: 14, 
                    borderRadius: 12, 
                    backgroundColor: '#FFD700', 
                    alignItems: 'center', 
                    opacity: sendingInvite ? 0.7 : 1, 
                    borderWidth: 1, 
                    borderColor: '#FFA500',
                    shadowColor: '#FFD700',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                }}
            >
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <FontAwesome name="star" size={16} color="#000" />
                    <Text style={{ color: '#000', fontWeight: '900' }}>Super Invitation ({FEATURE_COSTS.SUPER_INVITE} pins)</Text>
                 </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <DailyLocationPrompt />

      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={C.tint} />
        </View>
      )}
    </View>
  );
}

type Styles = {
  container: ViewStyle;
  safe: ViewStyle;
  header: ViewStyle;
  logo: ImageStyle;
  headerTextWrap: ViewStyle;
  appName: TextStyle;
  tag: TextStyle;
  map: ViewStyle;
  hudGlass: ViewStyle;
  hudCount: TextStyle;
  hudText: TextStyle;
  hudRow: ViewStyle;
  hudSub: TextStyle;
  link: TextStyle;
  fabDock: ViewStyle;
  fabBtn: ViewStyle;
  smallRow: ViewStyle;
  smallFabBtn: ViewStyle;
  primaryTxt: TextStyle;
  secondaryBtn: ViewStyle;
  secondaryTxt: TextStyle;
  actionRow: ViewStyle;
  actionBtn: ViewStyle;
  dangerTxt: TextStyle;
  backdrop: ViewStyle;
  sheet: ViewStyle;
  sheetHandle: ViewStyle;
  sheetContent: ViewStyle;
  sheetTitle: TextStyle;
  sheetSubtitle: TextStyle;
  loadingOverlay: ViewStyle;
  markerOuter: ViewStyle;
  markerInner: ViewStyle;
  overlayPanel: ViewStyle;
  bigBtn: ViewStyle;
  bigTxt: TextStyle;
};

const s = StyleSheet.create<Styles>({
  container: { flex: 1 },
  safe: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 8, android: 12 }),
    paddingBottom: 8,
  },
  logo: { width: 40, height: 40 },
  headerTextWrap: { flexDirection: "column" },
  appName: { fontSize: 18, fontWeight: "900", letterSpacing: 3 },
  tag: { fontSize: 12, marginTop: 2 },

  map: { ...StyleSheet.absoluteFillObject },

  hudGlass: {
    position: "absolute",
    alignSelf: 'center',
    width: 'auto',
    minWidth: 220,
    bottom: 90,
    zIndex: 20,
  },
  hudCount: { textAlign: 'center', fontSize: 24, fontWeight: '900', color: '#fff' },
  hudText: { textAlign: 'center', fontSize: 13, fontWeight: '700', marginTop: 2, color: '#ccc' },
  hudRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 },
  hudSub: { fontSize: 12 },
  link: { fontSize: 13, fontWeight: "700" },

  fabDock: { position: 'absolute', right: 16, bottom: 36, zIndex: 25, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fabBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  smallRow: { flexDirection: 'row', gap: 10 },
  smallFabBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: "#fff", fontWeight: "900", fontSize: 15 },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  secondaryTxt: { fontWeight: "700", fontSize: 15 },
  actionRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  actionBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 999, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  dangerTxt: { fontWeight: "700" },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#444",
    marginBottom: 24,
  },
  sheetContent: { gap: 8 },
  sheetTitle: { fontSize: 18, fontWeight: "900" },
  sheetSubtitle: { fontSize: 13 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },

  markerOuter: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  markerInner: { width: 12, height: 12, borderRadius: 6 },
  overlayPanel: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    borderRadius: 22,
    padding: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 22,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }
  },
  bigBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 999, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  bigTxt: { fontSize: 16, fontWeight: '900' }
});
