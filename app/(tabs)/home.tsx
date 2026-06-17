import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  ImageStyle,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
// Map native désactivée en web: import dynamique dans le rendu ci-dessous
import NativeMap from "@/components/map/NativeMap";
import MultiSlider from '@ptomasroos/react-native-multi-slider';
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { BlurView } from 'expo-blur';
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import GlassCard from "../../components/ui/GlassCard";

import * as Location from 'expo-location';

import FontAwesome from '@expo/vector-icons/FontAwesome';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import Logo from "../../assets/images/icon.png";
import Avatar from "../../components/ui/Avatar";
import { useDialog } from "../../components/ui/Dialog";
import { SafetyInfoModal } from "../../components/ui/SafetyInfoModal";
import { useToast } from "../../components/ui/Toast";
import { Colors } from "../../constants/Colors";
import { auth, db } from "../../firebaseconfig";
import { useOutgoingInvites } from "../../hooks/useOutgoingInvites";
import { useSubscription } from "../../hooks/useSubscription";
import { sendInvitation as sendInvitationApi } from "../../lib/invitations";
import { getApproxPositionIfGranted, getPrecisePosition } from "../../lib/location";
import { getMatchId } from "../../lib/matches";
import { FEATURE_COSTS, performActionUpdates } from "../../lib/monetization";
import { NearbyUser as NearbyUserPos, setDailyLocation, startRealtimePositionTracking, subscribeNearbyUsers } from "../../lib/positions";
import { getUserProfile, userPrivateRef, type UserProfile } from "../../lib/profile";
import { syncRevenueCatPurchases } from "../../lib/revenuecat";
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

type CachedProfile = {
  img?: string;
  name?: string;
  deleted?: boolean;
  age?: number;
  genderIdentity?: UserProfile['genderIdentity'];
  interests?: UserProfile['interests'];
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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function HomeScreen() {
  const scheme = 'dark';
  const C = Colors['dark'];
  const mapRef = useRef<any>(null);
  const { focusUid } = useLocalSearchParams<{ focusUid?: string }>();
  const { hasPendingInvite } = useOutgoingInvites();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Suppression des states de filtrage manuel
  const [region, setRegion] = useState<Region>({
    latitude: PARIS.latitude,
    longitude: PARIS.longitude,
    latitudeDelta: 0.08,
    longitudeDelta: 0.04
});
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [myFilters, setMyFilters] = useState<{ interests: string[]; minAge: number; maxAge: number; genders: string[]; useStrict: boolean }>({
     interests: [], minAge: 18, maxAge: 100, genders: [], useStrict: false
  });
  const [mePrecise, setMePrecise] = useState<{ lat: number; lng: number } | null>(null);
  const [myAvatar, setMyAvatar] = useState<string | undefined>(undefined);
  const [myFocusX, setMyFocusX] = useState<number>(0.5);
  const [myFocusY, setMyFocusY] = useState<number>(0.5);
  const [myZoom, setMyZoom] = useState<number>(1);
  const mySubscription = useSubscription(profile?.subscription);
  const [selected, setSelected] = useState<NearbyUser | null>(null);
  const [clusterSel, setClusterSel] = useState<NearbyUser[] | null>(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [hasMatch, setHasMatch] = useState(false);
  // inviteStatus is now derived from hasPendingInvite
  const { showToast } = useToast();
  const { alert } = useDialog();
  const [clusterStatuses, setClusterStatuses] = useState<Record<string, { online: boolean; last: number | null }>>({});
  const [inviteTarget, setInviteTarget] = useState<NearbyUser | null>(null);
  const [isGoldInvite, setIsGoldInvite] = useState(false);
  const keyboardHeight = useRef(new Animated.Value(0)).current;
  const stopTrackingRef = useRef<(() => void) | null>(null);
  const mapSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapSessionUntilMsRef = useRef(0);
  const [mapSessionActive, setMapSessionActive] = useState(false);
  const mapSessionActiveRef = useRef(false);

  useEffect(() => {
    mapSessionActiveRef.current = mapSessionActive;
  }, [mapSessionActive]);

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
                        alert(
                            'Pins insuffisants',
                            'Vous n\'avez pas assez de pins pour envoyer une invitation.',
                            [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Acheter des pins', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                            ]
                        );
                    } else if (check.reason === 'subscription_required') {
                        alert(
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
                 alert(
                    'Pins insuffisants', 
                    'Vous n\'avez pas assez de pins pour envoyer une invitation. Achetez des pins ou abonnez-vous !',
                    [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                    ]
                 );
            } else if (reason === 'subscription_required') {
                alert(
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
  const [profilesByUid, setProfilesByUid] = useState<Record<string, CachedProfile | undefined>>({});
  const [hasDailyBase, setHasDailyBase] = useState(false);
  const [dailyBaseCoords, setDailyBaseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [hasDailyRewardAvailable, setHasDailyRewardAvailable] = useState(false);
  const [showGhostGuide, setShowGhostGuide] = useState(false);
  const isFocused = useIsFocused();
  const [selStatus, setSelStatus] = useState<{ online: boolean; last: number | null }>({ online: false, last: null });

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'positions', uid), (snap) => {
      const d = snap.data() as any;
      if (!d) return;

      const now = Date.now();
      const expires = d.manualBaseExpiresAt || 0;
      const isActive = d.isManualBase === true && expires > now;
      setHasDailyBase(isActive);
      
      if (isActive && typeof d.baseLat === 'number' && typeof d.baseLng === 'number') {
        setDailyBaseCoords({ lat: d.baseLat, lng: d.baseLng });
      } else {
        setDailyBaseCoords(null);
      }

      // S'assurer que 'me' suit la position réelle si on est "en ligne"
      const isFresh = d.updatedAtMs && (now - d.updatedAtMs < 10 * 60 * 1000);
      if (isFresh && typeof d.lat === 'number' && typeof d.lng === 'number') {
          // On ne met à jour 'me' que si c'est significatif ou si c'est le premier chargement
          setMe(prev => {
              if (!prev) return { lat: d.lat, lng: d.lng };
              const dist = haversineKm(prev.lat, prev.lng, d.lat, d.lng);
              if (dist > 0.05) return { lat: d.lat, lng: d.lng }; // 50m
              return prev;
          });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const val = await (await import('@react-native-async-storage/async-storage')).default.getItem('hasSeenSafetyInfo_v1');
        const guideSeen = await (await import('@react-native-async-storage/async-storage')).default.getItem('hasSeenGhostGuide_v1');
        // Show guide if safety info has been seen but guide hasn't
        if (val === 'true' && !guideSeen) {
          setShowGhostGuide(true);
        }
      } catch {}
    })();
  }, [isFocused]);

  const dismissGhostGuide = async () => {
    try {
      await (await import('@react-native-async-storage/async-storage')).default.setItem('hasSeenGhostGuide_v1', 'true');
      setShowGhostGuide(false);
    } catch {}
  };

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
  const [shareLiveByUid, setShareLiveByUid] = useState<Record<string, { lat: number; lng: number; updatedAtMs: number; accuracy: number | null }>>({});
  const [locPermission, setLocPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
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

  const refreshDailyRewardAvailability = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const userDoc = await getDoc(doc(db, 'users', uid));
      if (!userDoc.exists()) {
        setHasDailyRewardAvailable(false);
        return;
      }

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
      setHasDailyRewardAvailable(!lastClaim || !now.isSame(lastClaim, 'day'));
    } catch {
      setHasDailyRewardAvailable(false);
    }
  }, []);

  const refreshSelfProfile = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const p = await getUserProfile(uid);
      setProfile(p);
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
      setMyZoom(typeof p?.avatarZoom === 'number' ? p.avatarZoom : 1);
    } catch {}
  }, []);

  const refreshHomeSurface = useCallback(async () => {
    if (auth.currentUser?.uid) {
      await syncRevenueCatPurchases().catch(() => null);
    }
    await Promise.allSettled([
      refreshDailyRewardAvailability(),
      refreshSelfProfile(),
    ]);
  }, [refreshDailyRewardAvailability, refreshSelfProfile]);

  const endMapSession = useCallback(async () => {
    if (mapSessionTimerRef.current) {
      clearTimeout(mapSessionTimerRef.current);
      mapSessionTimerRef.current = null;
    }
    mapSessionUntilMsRef.current = 0;
    mapSessionActiveRef.current = false;
    if (stopTrackingRef.current) {
      try { stopTrackingRef.current(); } catch {}
      stopTrackingRef.current = null;
    }
    setMapSessionActive(false);
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        // Apple Guideline 5.1.2(i): Just hide from map, don't necessarily delete if sharing elsewhere
        await updateDoc(doc(db, 'positions', uid), {
          mapVisibleUntilMs: 0,
          updatedAt: serverTimestamp()
        });
      } catch {
        // doc peut être absent
      }
    }
  }, []);

  // Les utilisateurs proches proviennent désormais de Firestore via subscribeNearbyUsers (état `nearby`).

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void refreshHomeSurface();

      (async () => {
        try {
          setLoading(true);

          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== 'granted') {
            if (alive) setLocPermission('denied');
            return;
          }
          if (alive) setLocPermission('granted');

          const pos = await getApproxPositionIfGranted();
          if (!alive) return;

          if (pos) {
            setMe({ lat: pos.lat, lng: pos.lng });
            setMePrecise({ lat: pos.lat, lng: pos.lng }); // S'assurer que notre personnage apparaît direct
            const nextRegion = {
              latitude: pos.lat,
              longitude: pos.lng,
              latitudeDelta: 0.06,
              longitudeDelta: 0.03,
            };
            didCenterRef.current = false;
            setRegion(nextRegion);
            mapRef.current?.animateToRegion(nextRegion, 350);
          }

          // Apple Compliance: Automatic tracking starts if not in Ghost Mode.
          // Coordinates are fuzzy (rounded to 0.01) by default in startRealtimePositionTracking.
          if (sharingEnabled && !stopTrackingRef.current) {
            try {
              const stop = await startRealtimePositionTracking();
              if (!alive) {
                try { stop(); } catch {}
                return;
              }
              stopTrackingRef.current = stop;
            } catch (e) {
              try { if (__DEV__) console.warn('Automatic tracking start error', e); } catch {}
            }
          }
        } catch (e) {
          try { if (__DEV__) console.warn('Location error', e); } catch {}
        } finally {
          if (alive) setLoading(false);
        }
      })();

      return () => {
        alive = false;
        if (stopTrackingRef.current) {
          try { stopTrackingRef.current(); } catch {}
          stopTrackingRef.current = null;
        }
      };
    }, [refreshHomeSurface, sharingEnabled])
  );

  useEffect(() => {
    if (sharingEnabled) return;
    void endMapSession();
  }, [sharingEnabled, endMapSession]);

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
          const arr = Array.from(others);
          setFriendUids(prev => {
            if (prev.length === arr.length && prev.every((v, i) => v === arr[i])) return prev;
            return arr;
          });
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
          const live: Record<string, { lat: number; lng: number; updatedAtMs: number; accuracy: number | null }> = {};
          const now = Date.now();
          snap.forEach((d) => {
            const data = d.data() as any;
            const active = data?.active === true && data?.revoked !== true;
            const notExpired = typeof data?.expiresAtMs !== 'number' || data.expiresAtMs > now;
            if (active && notExpired && typeof data?.from === 'string') {
              arr.push(data.from);
              const liveLat = typeof data?.liveLat === 'number' ? data.liveLat : null;
              const liveLng = typeof data?.liveLng === 'number' ? data.liveLng : null;
              const liveUpdatedAtMs = typeof data?.liveUpdatedAtMs === 'number' ? data.liveUpdatedAtMs : null;
              if (liveLat !== null && liveLng !== null && liveUpdatedAtMs !== null) {
                live[data.from] = {
                  lat: liveLat,
                  lng: liveLng,
                  updatedAtMs: liveUpdatedAtMs,
                  accuracy: typeof data?.liveAccuracy === 'number' ? data.liveAccuracy : null,
                };
              }
            }
          });

          // Stabilisation : Ne mettre à jour que si le contenu a changé
          setShareFromUids(prev => {
            if (prev.length === arr.length && prev.every((v, i) => v === arr[i])) return prev;
            return arr;
          });
          setShareLiveByUid(prev => {
            const prevKeys = Object.keys(prev);
            const nextKeys = Object.keys(live);
            if (prevKeys.length !== nextKeys.length) return live;
            const hasChanged = nextKeys.some(k => {
              const p = prev[k];
              const n = live[k];
              return !p || p.lat !== n.lat || p.lng !== n.lng || p.updatedAtMs !== n.updatedAtMs;
            });
            return hasChanged ? live : prev;
          });
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
        setProfile(prev => prev ? { ...prev, ...data } : data as UserProfile);
        const r = data?.discoveryRadiusKm;
        if (typeof r === 'number' && Number.isFinite(r)) {
          setRadiusKm(r);
        }
        const fx = data?.avatarFocusX; const fy = data?.avatarFocusY;
        if (typeof fx === 'number' && Number.isFinite(fx)) setMyFocusX(fx);
        if (typeof fy === 'number' && Number.isFinite(fy)) setMyFocusY(fy);
        const z = data?.avatarZoom;
        if (typeof z === 'number' && Number.isFinite(z)) setMyZoom(z);

        // Charger les préférences de filtrage
        // Les filtres stricts (intérêts, genre précis) nécessitent un abonnement.
        setMyFilters({
            interests: Array.isArray(data?.interests) ? data.interests : [],
            minAge: typeof data?.desiredMinAge === 'number' ? data.desiredMinAge : 18,
            maxAge: typeof data?.desiredMaxAge === 'number' ? data.desiredMaxAge : 100,
            genders: Array.isArray(data?.genders) ? data.genders : [],
            useStrict: false
        });

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
                setProfile(prev => prev ? { ...prev, ...d } : d as UserProfile);
                setSharingEnabled(!(d?.ghostMode === true));
                const tier = (d?.subscription === 'PLUS' || d?.subscription === 'PRO' || d?.subscription === 'FREE') ? d.subscription : 'FREE';
                // Subscription is handled by useSubscription hook
                const isPremium = tier === 'PLUS' || tier === 'PRO';
                setMyFilters(prev => ({ ...prev, useStrict: isPremium ? !!d?.useStrictFilters : false }));
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
      const meUid = auth.currentUser?.uid;
      const filtered = rawNearbyUsers
        .filter(u => u.id !== meUid)
        .map((u) => {
          const live = shareLiveByUid[u.id];
          if (!live) return u;
          const d = me ? haversineKm(me.lat, me.lng, live.lat, live.lng) : u.distanceKm;
          return { ...u, lat: live.lat, lng: live.lng, distanceKm: d, accuracy: live.accuracy ?? (u as any).accuracy, precisionKm: 0.01 } as any;
        });
      setNearbyAll(filtered);
  }, [rawNearbyUsers, shareLiveByUid, me]);

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
  const handleSetDailyLocation = async () => {
    try {
      const pos = await getPrecisePosition();
      if (!pos) throw new Error('Impossible de récupérer ta position précise');
      
      alert(
        'Localisation journalière',
        `Veux-tu définir ce lieu comme ta zone de présence pour aujourd'hui ? Tu resteras visible des personnes à proximité même si tu fermes l'application.`,
        [
          { text: 'Annuler', style: 'cancel' },
          { 
            text: 'Confirmer', 
            onPress: async () => {
              try {
                setLoading(true);
                await setDailyLocation(pos.lat, pos.lng);
                showToast('Succès', 'Ta zone journalière est enregistrée !', 'success');
              } catch (e: any) {
                showToast('Erreur', e.message, 'error');
              } finally {
                setLoading(false);
              }
            }
          }
        ]
      );
    } catch (e: any) {
      showToast('Erreur', e.message, 'error');
    }
  };

  const mapUsers: NearbyUser[] = useMemo(() => {
    const now = Date.now();
    return nearbyAll.map(u => {
      // Application des filtres utilisateur (Paramètres)
      // Si l'utilisateur a activé les filtres stricts, on applique tous les critères.
      // Sinon, on applique uniquement la tranche d'âge de base pour éviter de montrer des profils trop éloignés.
      
      const p = profilesByUid[u.id];
      if (p?.deleted) return null;

      // Filtrage par âge (toujours appliqué un minimum)
      const age = u.age || p?.age;
      if (typeof age === 'number') {
          if (age < myFilters.minAge || age > myFilters.maxAge) return null;
      }

      // Filtrage par genre (si spécifié)
      if (myFilters.genders.length > 0) {
          // Si le profil n'a pas de genre défini (ancien profil ?), on le garde par défaut sauf en strict
          const g = p?.genderIdentity;
          if (g && !myFilters.genders.includes(g)) return null;
          if (!g && myFilters.useStrict) return null;
      }

      // Filtrage par intérêts (uniquement si filtres stricts ou si l'utilisateur a des intérêts définis et veut matcher)
      // Note: Habituellement la map est "découverte large", mais si useStrict est true, on filtre.
      if (myFilters.useStrict && myFilters.interests.length > 0) {
          const userInterests = p?.interests || [];
          const hasMatch = myFilters.interests.some(fi => userInterests.includes(fi));
          if (!hasMatch) return null;
      }

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
      
      // Affichage du nom : "Utilisateur" systématiquement pour les inconnus (non-amis)
      // Seuls les amis voient le vrai nom.
      const rawName = p?.name || u.name;
      const displayName = isFriend ? (rawName === 'Utilisateur' ? 'Ami' : rawName) : 'Utilisateur';

      return { 
        id: u.id, 
        name: displayName, 
        age: isFriend ? (u.age || p?.age) : undefined, // On cache aussi l'âge pour les inconnus par sécurité
        lat, 
        lng, 
        distanceKm: u.distanceKm, 
        img,
        isBlur,
        isOnline: online
      };
    }).filter(u => u !== null) as NearbyUser[];
  }, [nearbyAll, friendUids, shareFromUids, profilesByUid, myFilters]);

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

        const updates: Record<string, CachedProfile | undefined> = {};
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
            updates[uid] = {
              img: url,
              name: p?.firstName,
              age: p?.age,
              genderIdentity: p?.genderIdentity,
              interests: p?.interests,
            };
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

  const recenter = async () => {
    let base = mePrecise ?? me;
    if (!base) return;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const precise = await getPrecisePosition();
        base = { lat: precise.lat, lng: precise.lng };
        setMePrecise(base);
      }
    } catch {}
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
    setSelected({ id: u.id, name: u.name, age: (typeof u.age === 'number' ? u.age : null), lat: u.lat, lng: u.lng, distanceKm: u.distanceKm ?? 0, img: u.img, isBlur: u.isBlur });
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
            setClusterSel(users.map((u: NearbyUser) => ({ ...(u as any), img: u.img || profilesByUid[u.id]?.img })) as any);
            fadeAnim.setValue(0);
            Animated.parallel([
              Animated.timing(sheetAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
              Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true })
            ]).start();
          } catch {}
        }}
        logoEnabled={false}
        rotateEnabled={true}
        pitchEnabled={true}
        dailyBase={dailyBaseCoords}
        subscription={mySubscription}
      />

      <GlassCard style={s.hudGlass}> 
        {locPermission === 'denied' ? (
          <View style={{ width: '100%', gap: 10, marginBottom: 12 }}>
            <Text style={{ color: C.text, fontWeight: '800', textAlign: 'center' }}>Localisation</Text>
            <Text style={{ color: C.muted, textAlign: 'center' }}>
              Frensy a besoin de ta position pour centrer la carte et, si tu le choisis, pour un pointage manuel sur la carte des personnes à proximité.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Continuer vers la demande de localisation du système"
              onPress={async () => {
                setLoading(true);
                try {
                  const req = await Location.requestForegroundPermissionsAsync();
                  if (req.status !== 'granted') {
                    setLocPermission('denied');
                    if (req.canAskAgain === false) {
                      try { await Linking.openSettings(); } catch {}
                    }
                    return;
                  }
                  setLocPermission('granted');
                  const pos = await getApproxPositionIfGranted();
                  if (pos) {
                    setMe({ lat: pos.lat, lng: pos.lng });
                    setMePrecise({ lat: pos.lat, lng: pos.lng });
                    setRegion({
                      latitude: pos.lat,
                      longitude: pos.lng,
                      latitudeDelta: 0.06,
                      longitudeDelta: 0.03,
                    });
                  }
                } catch (e) {
                  try { if (__DEV__) console.warn(e); } catch {}
                } finally {
                  setLoading(false);
                }
              }}
              style={{
                borderRadius: 16,
                paddingVertical: 10,
                paddingHorizontal: 14,
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.10)',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: C.text, fontWeight: '900' }}>Continuer</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {locPermission === 'granted' && !sharingEnabled ? (
          <View style={{ width: '100%', gap: 8, marginBottom: 12 }}>
            <Text style={{ color: C.muted, textAlign: 'center', fontSize: 13 }}>
              Mode fantôme actif : tu es invisible sur la carte. Désactive l’icône 👻 pour réapparaître.
            </Text>
          </View>
        ) : null}
        {locPermission === 'granted' && sharingEnabled ? (
          <View style={{ width: '100%', gap: 8, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3BA55D' }} />
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>Visibilité automatique active</Text>
            </View>
            <Text style={{ color: C.muted, textAlign: 'center', fontSize: 12 }}>
              Ta position approximative est visible des personnes à proximité.
            </Text>
            {hasDailyBase && (
               <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Text style={{ color: '#3BA55D', fontSize: 11, fontWeight: '600' }}>Zone journalière active</Text>
                  <FontAwesome name="check-circle" size={10} color="#3BA55D" />
               </View>
            )}
          </View>
        ) : null}
        <Text style={[s.hudCount, { color: C.tint }]}>{nearbyAll.length}</Text>
        <Text style={[s.hudText, { color: C.text }]}>personnes autour de toi</Text>
        <View style={s.hudRow}> 
          <Text style={[s.hudSub, { color: C.muted }]}>📡 Dans la zone : {radiusKm} km • dont {friendsNearbyAll.length} {friendsNearbyAll.length > 1 ? 'amis' : 'ami'}</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Informations sur la localisation"
            onPress={() => alert(
            'Localisation',
            `Frensy utilise ta position approximative (arrondie à ~1km) pour te montrer les personnes autour de toi. Ta position est mise à jour automatiquement quand tu es actif sur l'application. Le mode fantôme (👻) masque ta position instantanément.`
          )}>
            <Text style={[s.link, { color: C.muted }]}>ℹ︎</Text>
          </Pressable>
        </View>
      </GlassCard>

      {/* Floating Action Buttons */}
      {hasDailyRewardAvailable && (
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/store', params: { returnTo: '/(tabs)/home' } } as any)}
          style={{
            position: 'absolute',
            top: 170,
            right: 20,
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: C.card,
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: C.tint,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 5,
            elevation: 5,
            zIndex: 10
          }}
        >
          <FontAwesome name="gift" size={24} color={C.tint} />
          <View style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: '#EF4444',
            borderWidth: 2,
            borderColor: C.card
          }} />
        </TouchableOpacity>
      )}

      {sharingEnabled && !hasDailyBase && (
        <TouchableOpacity
          onPress={handleSetDailyLocation}
          style={{
            position: 'absolute',
            top: hasDailyRewardAvailable ? 235 : 170,
            right: 20,
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: C.card,
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: '#3BA55D',
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 5,
            elevation: 5,
            zIndex: 10
          }}
        >
          <FontAwesome name="map-pin" size={24} color="#3BA55D" />
          <View style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: '#3BA55D',
            borderWidth: 2,
            borderColor: C.card
          }} />
        </TouchableOpacity>
      )}

      {/* Panneau supprimé: icônes fantôme/paramètres déplacées près du logo */}

      {/* Dock des actions: fantôme + paramètres à gauche, recentrer à droite */}
      <View style={s.fabDock}>
        <View style={s.smallRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={sharingEnabled ? 'Désactiver le partage de localisation (Mode fantôme)' : 'Activer le partage de localisation'}
            onPress={async () => {
              if (showGhostGuide) await dismissGhostGuide();
              if (sharingEnabled) {
                alert(
                  'Mode fantôme',
                  "Voulez-vous vraiment désactiver votre localisation ?\nVous n'apparaitrez plus dans les swipe des utilisateurs et tous vos partages de position actifs seront interrompus.",
                  [
                    { text: 'Non', style: 'cancel' },
                    { text: 'Oui', style: 'destructive', onPress: async () => {
                        await endMapSession();
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
                             
                             batch.delete(doc(db, 'positions', uid));

                             await batch.commit();
                             showToast('Mode fantôme activé', 'Votre position est masquée et les partages ont été arrêtés.', 'success');
                          } 
                        } catch (e) {
                          try { if (__DEV__) console.error(e); } catch {}
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
                      showToast('Mode fantôme désactivé', 'Tu peux faire un pointage sur la carte (« Apparaître sur la carte ») quand tu veux être visible.', 'success');
                    } 
                  } catch (e) {
                     try { if (__DEV__) console.error(e); } catch {}
                  } 
                  setSharingEnabled(true); 
                })();
              }
            }}
            style={[s.smallFabBtn, { backgroundColor: !sharingEnabled ? C.tint : C.background, borderColor: !sharingEnabled ? C.tint : C.border }]}
          >
            <Text style={{ fontSize: 14 }}>{'👻'}</Text>
          </TouchableOpacity>

          {showGhostGuide && (
            <View 
              style={{
                position: 'absolute',
                bottom: 60,
                left: 0,
                backgroundColor: C.tint,
                padding: 10,
                borderRadius: 12,
                width: 140,
                shadowColor: '#000',
                shadowOpacity: 0.3,
                shadowRadius: 5,
                elevation: 10,
                zIndex: 999
              }}
            >
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
                Active le mode fantôme ici pour être invisible !
              </Text>
              <View 
                style={{
                  position: 'absolute',
                  bottom: -8,
                  left: 20,
                  width: 0,
                  height: 0,
                  borderLeftWidth: 8,
                  borderRightWidth: 8,
                  borderTopWidth: 8,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderTopColor: C.tint
                }}
              />
              <TouchableOpacity 
                onPress={dismissGhostGuide}
                style={{ position: 'absolute', top: -10, right: -10, backgroundColor: '#333', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#555' }}
              >
                <Text style={{ color: '#FFF', fontSize: 10 }}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

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
            width: '100%',
            maxWidth: 500,
            alignSelf: 'center',
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
                  <Image 
                    source={selected.img ? { uri: selected.img } : Logo} 
                    style={{ 
                        width: 72, 
                        height: 72, 
                        borderRadius: 36, 
                        borderWidth: 2, 
                        borderColor: (selected as any).subscription === 'PRO' ? C.gold : ((selected as any).subscription === 'PLUS' ? C.tint : 'rgba(255,255,255,0.1)') 
                    }} 
                    contentFit="cover" 
                    blurRadius={(selected as any).isBlur ? 50 : 0} 
                  />
                  <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 22, fontWeight: '800', color: C.text }}>{selected.name}</Text>
                          {((selected as any).subscription === 'PRO' || (selected as any).subscription === 'PLUS') && (
                              <View style={{ 
                                  backgroundColor: (selected as any).subscription === 'PRO' ? C.gold : C.tint, 
                                  paddingHorizontal: 8, 
                                  paddingVertical: 2, 
                                  borderRadius: 8 
                              }}>
                                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>
                                      {(selected as any).subscription}
                                  </Text>
                              </View>
                          )}
                      </View>
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
                    onPress={() => {
                      // Fermer le panneau avant de naviguer
                      Animated.parallel([
                        Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
                        Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true })
                      ]).start(() => {
                        setSelected(null);
                        router.push(`/chat/${selected.id}` as any);
                      });
                    }}
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
                        onPress={() => {
                           // On ferme le regroupement et on ouvre le profil individuel
                           setClusterSel(null);
                           setSelected(u);
                        }}
                        style={{ alignItems: 'center', width: 70 }}
                      > 
                        <Avatar 
                          uri={u.img} 
                          initials={u.name[0]} 
                          size={56} 
                          blurRadius={(u as any).isBlur ? 50 : 0} 
                        />
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



      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={C.tint} />
        </View>
      )}
      <SafetyInfoModal />
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
    width: '85%',
    maxWidth: 320,
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
