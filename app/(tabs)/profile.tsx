// app/(tabs)/profile.tsx
import FontAwesome from '@expo/vector-icons/FontAwesome';
import dayjs from 'dayjs';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router as Router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { arrayUnion, doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Easing,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Logo from '../../assets/images/frensylogo.png';
import Avatar from '../../components/ui/Avatar';
import { useToast } from '../../components/ui/Toast';
import { Colors } from '../../constants/Colors';
import { auth } from '../../firebaseconfig';
import { checkPhotoSafety, NO_FACE_MSG, REJECTION_MSG, validateName } from '../../lib/moderation';
import { getLimits, performActionUpdates } from '../../lib/monetization';
import { applyUserUpdates, getUserProfile, userDocRef, userPrivateRef, UserProfile } from '../../lib/profile';
import { pickProfilePhotoOnly, processAndUploadProfilePhoto } from '../../lib/uploadImages';

const AnimatedImage = ReAnimated.createAnimatedComponent(ExpoImage);
const PINS_IMG = require('../../assets/images/pins2.png');

const screenW = Dimensions.get('window').width;

/* ---------- Helpers ---------- */
// Removed unused Row component
// Removed unused Pills and Empty components

// Removed unused fallback helpers

/* --------------------------------- Écran --------------------------------- */
export default function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [focusDraft, setFocusDraft] = useState(0.5);
  const [focusDraftX, setFocusDraftX] = useState(0.5);
  const [zoomDraft, setZoomDraft] = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [photoToReplace, setPhotoToReplace] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const limits = useMemo(() => getLimits(profile?.subscription || 'FREE'), [profile?.subscription]);
  const boostLimit = limits.boostPerWeek;
  const boostUsed = profile?.boostsUsedThisWeek || 0;
  const boostRemaining = Math.max(0, boostLimit - boostUsed);
  const boostDisplay = boostLimit === 0 ? '0' : (boostLimit === Infinity ? '∞' : `${boostRemaining}/${boostLimit}`);

  const inviteLimit = limits.invitesPerDay;
  const inviteUsed = profile?.invitesUsedToday || 0;
  const bonusInvites = profile?.bonusInvites || 0;
  const inviteRemaining = Math.max(0, (Number.isFinite(inviteLimit) ? inviteLimit : 0) - inviteUsed);
  const inviteAvailableTotal = (inviteLimit === Infinity ? Infinity : inviteRemaining + bonusInvites);
  const inviteDisplay = inviteAvailableTotal === Infinity ? '∞' : String(inviteAvailableTotal);

  const undoLimit = limits.undoPerDay;
  const undoUsed = profile?.undoUsedToday || 0;
  const bonusUndos = profile?.bonusUndos || 0;
  const undoRemaining = Math.max(0, (Number.isFinite(undoLimit) ? undoLimit : 0) - undoUsed);
  const undoAvailableTotal = (undoLimit === Infinity ? Infinity : undoRemaining + bonusUndos);
  const undoDisplay = undoAvailableTotal === Infinity ? '∞' : String(undoAvailableTotal);

  const revealDisplay = limits.showLikesDetails ? 'Illimité' : 'Payant';
  
  // Missing states restored
  const [cropOpen, setCropOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const slideAnim = React.useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const neonAnim = React.useRef(new Animated.Value(0)).current;

  const animateOpen = useCallback(() => {
    slideAnim.setValue(Dimensions.get('window').height);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start();
  }, [slideAnim, fadeAnim]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(neonAnim, { toValue: 1, duration: 1400, useNativeDriver: false }),
        Animated.timing(neonAnim, { toValue: 0, duration: 1400, useNativeDriver: false }),
      ])
    ).start();
  }, [neonAnim]);

  const animateClose = useCallback((onClose: () => void) => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: Dimensions.get('window').height,
        duration: 250,
        useNativeDriver: true,
        easing: Easing.in(Easing.cubic),
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      })
    ]).start(onClose);
  }, [slideAnim, fadeAnim]);

  useEffect(() => {
    if (editOpen || cropOpen || replaceOpen) {
       animateOpen();
    }
  }, [editOpen, cropOpen, replaceOpen, animateOpen]);

  const closeEdit = () => animateClose(() => setEditOpen(false));
  const closeCrop = () => animateClose(() => setCropOpen(false));
  const closeReplace = () => animateClose(() => setReplaceOpen(false));

  const C = Colors['dark'];
  const insets = useSafeAreaInsets();
  const db = getFirestore();

  // Real-time Profile Sync
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    let publicData: UserProfile | null = null;
    let privateData: any = {};

    const updateState = () => {
        if (!publicData) return;
        
        // Merge private data (like pins) into public profile state for UI display
        const merged = { ...publicData, ...privateData };
        // If private pins exist, override public pins (legacy)
        if (typeof privateData.pins === 'number') {
            merged.pins = privateData.pins;
        }

        setProfile(merged);
    };

    const unsubPublic = onSnapshot(userDocRef(uid), async (docSnap) => {
        try {
            if (docSnap.exists()) {
                const data = docSnap.data() as UserProfile;
                data.uid = uid;
                
                // Recalculate age locally
                if (data.birthDate) {
                    try {
                        const calculatedAge = dayjs().diff(dayjs(data.birthDate), 'year');
                        if (typeof calculatedAge === 'number' && !isNaN(calculatedAge)) {
                            data.age = calculatedAge;
                        }
                    } catch (e) {
                        console.warn('[Profile] Age calc error', e);
                    }
                }
                
                // Fix photo URLs if needed (migration)
                if (data.photos?.some((ph: any) => !ph.url)) {
                    try {
                        const storage = getStorage();
                        const fixed = await Promise.all(
                            (data.photos ?? []).map(async (ph: any) =>
                                ph.url ? ph : { ...ph, url: await getDownloadURL(ref(storage, ph.path)) }
                            )
                        );
                        data.photos = fixed;
                    } catch (e) {
                        console.warn('[Profile] Photo fix error', e);
                    }
                }

                publicData = data;
                updateState();
            }
        } catch (err) {
            console.error('[Profile] onSnapshot public error', err);
        }
    });

    const unsubPrivate = onSnapshot(userPrivateRef(uid), (docSnap) => {
        try {
            if (docSnap.exists()) {
                privateData = docSnap.data();
                updateState();
            }
        } catch (err) {
             console.error('[Profile] onSnapshot private error', err);
        }
    });

    return () => {
        unsubPublic();
        unsubPrivate();
    };
  }, []);

  // Manual load (refresh only)
  const load = useCallback(async () => {
    // onSnapshot handles the main data, this is just for manual refresh if needed
    // or to trigger specific logic like limit resets explicitly.
    const u = auth.currentUser;
    if (!u) return;
    const p = await getUserProfile(u.uid);
    if (p) setProfile(p);
  }, [db]);

  useEffect(() => {
    // Initial auth check
    const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
            // Setup is handled by the other useEffect
        } else {
            setProfile(null);
        }
    });
    return unsub;
  }, []);

  // Removed duplicate useFocusEffect since onSnapshot handles updates
  // But kept onRefresh for Pull-to-Refresh functionality
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const initials = useMemo(() => {
    const n = (profile?.firstName ?? 'U').trim();
    return n ? n[0].toUpperCase() : 'U';
  }, [profile?.firstName]);

  // Router imported above

  const addPhoto = useCallback(async () => {
    try {
      // 1. Pick
      // On demande une validation stricte (visage) UNIQUEMENT si c'est pour la photo principale (si l'utilisateur n'en a pas encore)
      const requireFace = !profile?.primaryPhotoPath;
      const asset = await pickProfilePhotoOnly(requireFace);
      if (!asset) return;
      
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      // 2. Optimistic Update
      const tempPath = asset.uri; // Local URI
      const tempPhoto = { path: tempPath, url: tempPath, createdAt: Date.now() }; // Use local URI as URL
      
      setProfile(prev => {
         if (!prev) return prev;
         const newPhotos = [...(prev.photos || []), tempPhoto];
         // If no primary, set this as primary
         const updates: any = { photos: newPhotos };
         if (!prev.primaryPhotoPath) updates.primaryPhotoPath = tempPath;
         return { ...prev, ...updates };
      });

      // 3. Upload in background
      (async () => {
         setIsUploading(true);
         try {
             // Utilisation de requireFace pour valider ou non le visage
             const res = await processAndUploadProfilePhoto(asset, requireFace);
             
             // 4. Update Firestore with REAL path/url
            await updateDoc(doc(db, 'users', uid), {
               photos: arrayUnion({ 
                 path: res.path, 
                 url: res.url, 
                 createdAt: Date.now(),
                 // status: 'approved' // checkPhotoSafety throws if rejected
               }),
               ...(profile?.primaryPhotoPath ? {} : { primaryPhotoPath: res.path }),
               updatedAt: serverTimestamp(),
            });
             // 5. Refresh to get clean state
             await onRefresh();
             showToast('Succès', 'Photo ajoutée', 'success');
         } catch (e: any) {
             // Revert
             showToast('Erreur', e?.message ?? String(e), 'error');
             await onRefresh(); // Reload from DB to clear optimistic
         } finally {
             setIsUploading(false);
         }
      })();
    } catch (e: any) {
      showToast('Erreur', e?.message ?? String(e), 'error');
    }
  }, [db, profile?.primaryPhotoPath, onRefresh]);

  const setPrimary = useCallback(async (path: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // 1. Optimistic Update
    // On met à jour l'UI tout de suite avant d'attendre le serveur
    const previousProfile = profile;
    setProfile(prev => {
       if (!prev) return prev;
       return { ...prev, primaryPhotoPath: path };
    });

    try {
      // Vérifier que la photo contient un visage humain avant de la définir comme principale
      const photo = profile?.photos?.find((p: any) => p.path === path);
      if (photo?.url) {
        const safety = await checkPhotoSafety(photo.url, true);
        if (safety === 'rejected') throw new Error(REJECTION_MSG);
        if (safety === 'rejected_no_face') throw new Error(NO_FACE_MSG);
      }

      await updateDoc(doc(db, 'users', uid), { primaryPhotoPath: path, updatedAt: serverTimestamp() });
      await onRefresh();
    } catch (e: any) {
      // Revert if error
      setProfile(previousProfile);
      showToast('Erreur', e?.message ?? String(e), 'error');
    }
  }, [db, onRefresh, profile]);

  const saveName = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const trimmed = nameDraft.trim();
      
      const check = validateName(trimmed);
      if (!check.valid) {
        Alert.alert('Nom invalide', check.error);
        return;
      }
      
      // Format: Capitalize first letter
      const formatted = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();

      await updateDoc(doc(db, 'users', uid), { firstName: formatted, updatedAt: serverTimestamp() });
      closeEdit();
      await onRefresh();
    } catch (e: any) {
      showToast('Erreur', e?.message ?? String(e), 'error');
    }
  }, [db, nameDraft, onRefresh]);

  const saveAvatarFocus = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid; if (!uid) return;
      // Note: On sauvegarde les valeurs "draft" qui ont été mises à jour par le Cropper
      const clampZoom = (z: number) => Math.max(1, Math.min(3, z)); // Max zoom 3 comme dans add-photo
      await updateDoc(doc(db, 'users', uid), { 
        avatarFocusX: focusDraftX, 
        avatarFocusY: focusDraft, 
        avatarZoom: clampZoom(zoomDraft), 
        updatedAt: serverTimestamp() 
      });
      await onRefresh();
      showToast('Succès', 'Cadrage mis à jour', 'success');
    } catch (e: any) { showToast('Erreur', e?.message ?? String(e), 'error'); }
  }, [db, focusDraftX, focusDraft, zoomDraft, onRefresh]);

  // Removed unused saveNote

  const replacePhoto = useCallback(async () => {
    if (!photoToReplace) return;
    closeReplace(); // On ferme le menu tout de suite pour fluidifier
    try {
      const asset = await pickProfilePhotoOnly(true);
      if (!asset) {
          setPhotoToReplace(null);
          return;
      }
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      // Optimistic
      setProfile(prev => {
          if (!prev) return prev;
          const currentPhotos = prev.photos || [];
          const newPhotos = currentPhotos.map((p: any) => {
            if (p.path === photoToReplace) {
                 return { ...p, path: asset.uri, url: asset.uri, updatedAt: Date.now() }; // Use local URI
            }
            return p;
          });
          
          let updates: any = { photos: newPhotos };
          if (prev.primaryPhotoPath === photoToReplace) {
              updates.primaryPhotoPath = asset.uri;
          }
          return { ...prev, ...updates };
      });

      // Background Upload
      (async () => {
          try {
              const res = await processAndUploadProfilePhoto(asset, true);
              
              const safety = await checkPhotoSafety(res.url);
              if (safety === 'rejected') throw new Error(REJECTION_MSG);

              // We need to fetch the LATEST profile from DB to ensure we don't overwrite concurrent changes
              const snap = await getDoc(doc(db, 'users', uid));
              if (snap.exists()) {
                  const data = snap.data();
                  const currentPhotos = data.photos || [];
                  const newPhotos = currentPhotos.map((p: any) => {
                    if (p.path === photoToReplace) {
                         return { 
                           ...p, 
                           path: res.path, 
                           url: res.url, 
                           updatedAt: Date.now(),
                           status: safety 
                         };
                    }
                    return p;
                  });
                  
                  let updates: any = { photos: newPhotos, updatedAt: serverTimestamp() };
                  if (data.primaryPhotoPath === photoToReplace) {
                      updates.primaryPhotoPath = res.path;
                  }
                  
                  await updateDoc(doc(db, 'users', uid), updates);
              }
              
              setPhotoToReplace(null);
              await onRefresh();
              showToast('Succès', 'Photo remplacée', 'success');
          } catch (e: any) {
              setPhotoToReplace(null);
              showToast('Erreur', e?.message ?? String(e), 'error');
              await onRefresh(); // Revert
          }
      })();
    } catch (e: any) {
        setPhotoToReplace(null);
        showToast('Erreur', e?.message ?? String(e), 'error');
    }
  }, [db, photoToReplace, onRefresh, closeReplace, showToast]);

  const deletePhoto = useCallback(async () => {
      if (!photoToReplace) return;

      if (profile?.primaryPhotoPath === photoToReplace) {
        showToast('Impossible', 'Vous ne pouvez pas supprimer votre photo principale.', 'warning');
        return;
      }

      Alert.alert('Supprimer', 'Veux-tu vraiment supprimer cette photo ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
            try {
                const uid = auth.currentUser?.uid;
                if (!uid) return;
                
                const currentPhotos = profile?.photos || [];
                const newPhotos = currentPhotos.filter((p: any) => p.path !== photoToReplace);
                
                let updates: any = { photos: newPhotos, updatedAt: serverTimestamp() };
                if (profile?.primaryPhotoPath === photoToReplace) {
                    updates.primaryPhotoPath = newPhotos.length > 0 ? newPhotos[0].path : null;
                }
                
                await updateDoc(doc(db, 'users', uid), updates);
                closeReplace();
                setPhotoToReplace(null);
                await onRefresh();
            } catch (e: any) {
                Alert.alert('Erreur', e?.message ?? String(e));
            }
        }}
      ]);
  }, [db, photoToReplace, profile, onRefresh, closeReplace, showToast]);

  const handleBoost = async () => {
    if (!profile || !auth.currentUser?.uid) return;
    
    const now = Date.now();
    if (profile.boostExpiresAt && profile.boostExpiresAt > now) {
        Alert.alert('Boost actif', `Votre boost est encore actif pour ${Math.ceil((profile.boostExpiresAt - now) / 60000)} minutes.`);
        return;
    }

    const check = performActionUpdates(profile, 'BOOST');
    let confirmMessage = '';

    if (!check.allowed) {
        if (check.reason === 'insufficient_coins') {
             Alert.alert('Pins insuffisants', 'Achetez des pins pour booster votre profil !', [
                 { text: 'Annuler', style: 'cancel' },
                 { text: 'Boutique', onPress: () => Router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
             ]);
        } else {
             showToast('Impossible', 'Action non autorisée.', 'error');
        }
        return;
    }

    if (check.cost && check.cost > 0) {
        confirmMessage = `Boost (${check.cost} pins). Vous n'avez plus de boost gratuit. Utiliser ${check.cost} pins ?`;
    } else {
        confirmMessage = `Utiliser un boost gratuit ? (Durée 10 min)`;
    }

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
                    
                    await applyUserUpdates(auth.currentUser!.uid, updates);
                    
                    // Update Position Doc for visibility
                    await setDoc(doc(db, 'positions', auth.currentUser!.uid), {
                        boostExpiresAt: expiresAt,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    
                    showToast('Boost activé !', 'Votre profil sera mis en avant pendant 10 minutes.', 'success');
                    await onRefresh();
                } catch (e) {
                    console.error(e);
                    showToast('Erreur', 'Impossible d\'activer le boost.', 'error');
                }
            }
        }
    ]);
  };

  // données photos
  const photos = (profile?.photos ?? []) as { path: string; url: string; createdAt: number }[];
  const primaryPath = profile?.primaryPhotoPath ?? null;
  const primaryUrl = primaryPath ? photos.find((p) => p.path === primaryPath)?.url ?? null : null;

  // ordre d'affichage pour le viewer
  const photosOrdered = primaryPath
    ? [photos.find((p) => p.path === primaryPath)!, ...photos.filter((p) => p.path !== primaryPath).sort((a, b) => a.createdAt - b.createdAt)]
    : [...photos].sort((a, b) => a.createdAt - b.createdAt);

  const onViewerTap = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    const w = Dimensions.get('window').width;
    if (x > w / 2) {
       if (viewerIndex < photosOrdered.length - 1) setViewerIndex(viewerIndex + 1);
       else setViewerOpen(false);
    } else {
       if (viewerIndex > 0) setViewerIndex(viewerIndex - 1);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      
      {/* Background Header Blur */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400, opacity: 0.6 }}>
        {primaryUrl ? (
          <ExpoImage source={{ uri: primaryUrl }} style={{ flex: 1 }} contentFit="cover" blurRadius={40} />
        ) : (
          <View style={{ flex: 1, backgroundColor: '#111' }} />
        )}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, backgroundColor: '#000', opacity: 1, transform: [{ scaleY: 1.5 }, { translateY: 50 }] }} />
        <LinearGradient
          colors={['transparent', '#000']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            progressViewOffset={insets.top + 120}
          />
        }
      >
        {/* Header Content */}
        <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16 }}>
          {/* Top Bar */}
          <View style={{ height: 44, justifyContent: 'center', marginBottom: 20 }}>
            <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
              <Image 
                source={Logo} 
                style={{ width: 100, height: 30 }} 
                resizeMode="contain" 
              />
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <TouchableOpacity onPress={() => Router.push('/notifications' as any)} style={s.iconBtnGlass}>
                <FontAwesome name="bell-o" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Router.push('/settings' as any)} style={s.iconBtnGlass}>
                <FontAwesome name="cog" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Profile Main */}
          <View style={{ alignItems: 'center', gap: 12 }}>
            <TouchableOpacity
              onPress={() => photosOrdered.length && setViewerOpen(true)}
              onLongPress={() => setCropOpen(true)}
              activeOpacity={0.9}
              style={s.avatarContainer}
            >
               <Avatar 
                  uri={primaryUrl ?? undefined} 
                  initials={initials} 
                  size={128} 
                  ring 
                  ringColor={profile?.subscription === 'PRO' ? Colors.dark.gold : Colors.dark.tint} 
                  ringWidth={3} 
                  focusX={profile?.avatarFocusX ?? 0.5} 
                  focusY={profile?.avatarFocusY ?? 0.5} 
                  zoom={typeof (profile as any)?.avatarZoom === 'number' ? (profile as any).avatarZoom : 1} 
                  note={profile?.noteText ?? undefined} 
                />
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={s.nameLarge}>
                     {(profile?.firstName ?? 'Utilisateur')}{profile?.age ? `, ${profile.age}` : ''}
                  </Text>
                  <TouchableOpacity onPress={() => setEditOpen(true)} style={{ padding: 6 }}>
                     <FontAwesome name="pencil" size={14} color="rgba(255,255,255,0.5)" />
                  </TouchableOpacity>
               </View>
               {profile?.accountType && (
                 <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: profile.accountType === 'group' ? '#F97316' : '#333', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginTop: 8 }}>
                   <FontAwesome name={profile.accountType === 'group' ? 'users' : 'user'} size={12} color="#fff" style={{ marginRight: 6 }} />
                   <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{profile.accountType === 'group' ? 'Groupe' : 'Solo'}</Text>
                 </View>
               )}
            </View>

            {/* Stats Row */}
            <View style={s.statsContainer}>
               <TouchableOpacity style={s.statItem} onPress={() => Router.push({ pathname: '/store', params: { tab: 'coins' } } as any)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                     <Text style={s.statValue}>
                       {typeof profile?.pins === 'number' && !isNaN(profile.pins) ? profile.pins : 0}
                     </Text>
                     <Image source={PINS_IMG} style={{ width: 18, height: 18 }} resizeMode="contain" />
                  </View>
                  <Text style={s.statLabel}>Pins</Text>
               </TouchableOpacity>
               <View style={s.statDivider} />
               <TouchableOpacity style={s.statItem} onPress={() => Router.push({ pathname: '/store', params: { tab: 'subs' } } as any)}>
                  <Text style={[s.statValue, { color: profile?.subscription === 'PRO' ? Colors.dark.gold : (profile?.subscription === 'PLUS' ? '#EA4C89' : Colors.dark.text) }]}>
                    {profile?.subscription || 'FREE'}
                  </Text>
                  <Text style={s.statLabel}>Abonnement</Text>
               </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Actions & Content */}
        <View style={{ marginTop: 24, paddingHorizontal: 16, gap: 24 }}>
           
           {/* Main Actions */}
           <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity 
                 onPress={() => {
                    const url = `https://frensy.app/u/${auth.currentUser?.uid}`;
                    Share.share({
                       message: `Retrouve-moi sur Frensy ! ${url}`,
                       url: url,
                    });
                 }} 
                 style={[s.actionBtn, { backgroundColor: Colors.dark.tint, flex: 2 }]}
              >
                <Text style={[s.actionBtnTxt, { color: Colors.light.text }]}>Partager mon profil</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Router.push('/likes' as any)} style={[s.actionBtn, { backgroundColor: Colors.dark.card, flex: 1 }]}>
                 <Text style={s.actionBtnTxt}>Likes</Text>
              </TouchableOpacity>
           </View>

           {/* Photos */}
           <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                 <Text style={s.sectionTitle}>Mes Photos</Text>
                 <Animated.View
                   style={{
                     position: 'absolute',
                     bottom: 6,
                     left: 16,
                     height: 2,
                     borderRadius: 2,
                     backgroundColor: '#f97316',
                     opacity: neonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] }),
                     width: neonAnim.interpolate({ inputRange: [0, 1], outputRange: ['28%', '42%'] })
                   }}
                 />
                 <TouchableOpacity onPress={() => setMoreOpen(!moreOpen)}>
                    <Text style={{ color: Colors.dark.tint, fontWeight: '600' }}>{moreOpen ? 'Voir moins' : 'Voir tout'}</Text>
                 </TouchableOpacity>
              </View>
              
              <View style={{ flexDirection: 'row', gap: 10 }}>
                 {Array.from({ length: 3 }).map((_, idx) => {
                    const p = photos[idx];
                    const isPrimary = p && primaryPath === p.path;
                    const isInteractive = !!p && (p.url.startsWith('http://') || p.url.startsWith('https://'));
                    if (!p) {
                       return (
                          <TouchableOpacity key={idx} onPress={addPhoto} style={s.photoSlotEmpty}>
                             <FontAwesome name="plus" size={20} color="#333" />
                          </TouchableOpacity>
                       );
                    }
                    return (
                       <TouchableOpacity
                         key={idx}
                         onPress={isInteractive ? () => setPrimary(p.path) : undefined}
                         onLongPress={isInteractive ? () => { setPhotoToReplace(p.path); setReplaceOpen(true); } : undefined}
                         disabled={!isInteractive}
                         style={[s.photoSlot, isPrimary && { borderColor: Colors.dark.tint, borderWidth: 2 }]}
                       >
                          <ExpoImage source={{ uri: p.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                       </TouchableOpacity>
                    );
                 })}
              </View>
              
              {moreOpen && (
                 <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    {Array.from({ length: 3 }).map((_, i) => {
                       const idx = i + 3;
                       const p = photos[idx];
                       const isPrimary = p && primaryPath === p.path;
                       const isInteractive = !!p && (p.url.startsWith('http://') || p.url.startsWith('https://'));
                       if (!p) {
                          return (
                             <TouchableOpacity key={idx} onPress={addPhoto} style={s.photoSlotEmpty}>
                                <FontAwesome name="plus" size={20} color={Colors.dark.subtleText} />
                             </TouchableOpacity>
                          );
                       }
                       return (
                          <TouchableOpacity
                            key={idx}
                            onPress={isInteractive ? () => setPrimary(p.path) : undefined}
                            onLongPress={isInteractive ? () => { setPhotoToReplace(p.path); setReplaceOpen(true); } : undefined}
                            disabled={!isInteractive}
                            style={[s.photoSlot, isPrimary && { borderColor: Colors.dark.tint, borderWidth: 2 }]}
                          >
                             <ExpoImage source={{ uri: p.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          </TouchableOpacity>
                       );
                    })}
                 </View>
              )}
           </View>

           {/* Compteurs - Modern */}
           <View style={{ marginTop: 24, gap: 12 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {/* Boost */}
                  <TouchableOpacity 
                      style={{ flex: 1, minWidth: '45%', backgroundColor: Colors.dark.card, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }} 
                      onPress={handleBoost}
                      activeOpacity={0.8}
                  >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(249, 115, 22, 0.15)', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 18 }}>🚀</Text>
                      </View>
                      <View>
                          <Text style={{ color: Colors.dark.text, fontSize: 18, fontWeight: '800' }}>{boostDisplay}</Text>
                          <Text style={{ color: Colors.dark.subtleText, fontSize: 12, fontWeight: '600' }}>Boosts</Text>
                      </View>
                  </TouchableOpacity>

                  {/* Invites */}
                  <View 
                      style={{ flex: 1, minWidth: '45%', backgroundColor: Colors.dark.card, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }} 
                  >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(59, 130, 246, 0.15)', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 18 }}>💌</Text>
                      </View>
                      <View>
                          <Text style={{ color: Colors.dark.text, fontSize: 18, fontWeight: '800' }}>{inviteDisplay}</Text>
                          <Text style={{ color: Colors.dark.subtleText, fontSize: 12, fontWeight: '600' }}>Invites</Text>
                      </View>
                  </View>

                  {/* Revelations */}
                  <View 
                      style={{ flex: 1, minWidth: '45%', backgroundColor: Colors.dark.card, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }} 
                  >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(236, 72, 153, 0.15)', justifyContent: 'center', alignItems: 'center' }}>
                          <FontAwesome name="heart" size={18} color="#EC4899" />
                      </View>
                      <View>
                          <Text style={{ color: Colors.dark.text, fontSize: 16, fontWeight: '800' }}>{revealDisplay}</Text>
                          <Text style={{ color: Colors.dark.subtleText, fontSize: 12, fontWeight: '600' }}>Révélation</Text>
                      </View>
                  </View>

                  {/* Undos */}
                  <View 
                      style={{ flex: 1, minWidth: '45%', backgroundColor: Colors.dark.card, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }} 
                  >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(168, 85, 247, 0.15)', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 18 }}>↩️</Text>
                      </View>
                      <View>
                          <Text style={{ color: Colors.dark.text, fontSize: 18, fontWeight: '800' }}>{undoDisplay}</Text>
                          <Text style={{ color: Colors.dark.subtleText, fontSize: 12, fontWeight: '600' }}>Undo</Text>
                      </View>
                  </View>
              </View>

              <TouchableOpacity 
                onPress={() => Router.push({ pathname: '/store', params: { openStore: '1', tab: 'coins' } } as any)}
                activeOpacity={0.9}
                style={{ marginTop: 24 }}
              >
                <LinearGradient
                  colors={['#1a1a1a', '#0b0b0b']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    borderRadius: 24,
                    padding: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(249,115,22,0.25)',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 10 },
                    shadowOpacity: 0.35,
                    shadowRadius: 20,
                elevation: 12,
                position: 'relative'
                  }}
                >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject as any,
                  {
                    borderRadius: 24,
                    backgroundColor: '#f97316',
                    opacity: neonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.12] }),
                    transform: [{ scale: neonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.02] }) }]
                  }
                ]}
              />
                  <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(249,115,22,0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)' }}>
                    <Image source={PINS_IMG} style={{ width: 30, height: 30 }} resizeMode="contain" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.dark.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.2 }}>Boutique</Text>
                    <Text style={{ color: Colors.dark.tint, fontSize: 12, fontWeight: '700' }}>Cadeaux, pins, abonnements</Text>
                  </View>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.15)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)' }}>
                    <Text style={{ color: Colors.dark.tint, fontWeight: '900', fontSize: 12 }}>
                      {typeof profile?.pins === 'number' && !isNaN(profile.pins) ? `${profile.pins} pins` : 'Découvrir'}
                    </Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
           </View>
        </View>

        {/* Footer Brand */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 40, opacity: 0.3 }}>
           <FontAwesome name="bolt" size={12} color="#fff" />
           <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2 }}>FRENSY</Text>
        </View>

      </ScrollView>

      {/* Modal édition nom */}
      <Modal visible={editOpen} transparent animationType="none" onRequestClose={closeEdit}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
             <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }}>
                <Pressable onPress={closeEdit} style={{ flex: 1 }} />
             </Animated.View>
             <Animated.View style={[{ width: '100%' }, { transform: [{ translateY: slideAnim }] }]}>
               <Pressable style={{ backgroundColor: '#1c1c1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: '#333', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 20 }}>
                  {/* Handle */}
                  <View style={{ width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 24 }} />
                  
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8, textAlign: 'center' }}>Modifier ton pseudo</Text>
                  <Text style={{ fontSize: 14, color: '#999', marginBottom: 24, textAlign: 'center' }}>Choisis un nom qui te correspond.</Text>
                  
                  <TextInput
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    placeholder="Ton pseudo"
                    placeholderTextColor="#666"
                    style={{ backgroundColor: '#2c2c2e', borderWidth: 1, borderColor: '#333', borderRadius: 16, padding: 16, color: '#fff', fontSize: 16, marginBottom: 24 }}
                  />
                  
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity onPress={closeEdit} style={{ flex: 1, padding: 16, borderRadius: 16, backgroundColor: '#333', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '600', color: '#fff', fontSize: 16 }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={saveName} style={{ flex: 1, padding: 16, borderRadius: 16, backgroundColor: '#F97316', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '700', color: '#000', fontSize: 16 }}>Enregistrer</Text>
                    </TouchableOpacity>
                  </View>
               </Pressable>
             </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal cadrage circulaire */}
      <Modal visible={cropOpen} transparent animationType="none" onRequestClose={closeCrop}>
        <View style={{ flex: 1 }}>
          <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }}>
            <Pressable onPress={closeCrop} style={{ flex: 1 }} />
          </Animated.View>
          <View style={{ flex: 1, justifyContent: 'flex-end', pointerEvents: 'box-none' }}>
            <Animated.View style={[{ width: '100%' }, { transform: [{ translateY: slideAnim }] }]}>
              <Pressable onPress={() => {}} style={{ backgroundColor: '#1c1c1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: '#333', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 20 }}>
                {/* Handle */}
                <View style={{ width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 24 }} />
                
                <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 8, color: '#fff', textAlign: 'center' }}>Ajuster l&apos;avatar</Text>
                <Text style={{ fontSize: 14, color: '#999', marginBottom: 24, textAlign: 'center' }}>Déplace et zoome pour un rendu parfait.</Text>

                {primaryUrl ? (
                  <View style={{ alignItems: 'center', marginVertical: 20 }}>
                     <AvatarEditor 
                       uri={primaryUrl} 
                       initialZoom={zoomDraft} 
                       initialFocusX={focusDraftX} 
                       initialFocusY={focusDraft}
                       onChange={(z, x, y) => {
                          setZoomDraft(z);
                          setFocusDraftX(x);
                          setFocusDraft(y);
                       }}
                     />
                  </View>
                ) : (
                  <Text style={{ color: '#6b7280', textAlign: 'center', padding: 20 }}>Ajoute d’abord une photo principale.</Text>
                )}
                
                {primaryUrl && (
                   <View style={{ marginTop: 8, marginBottom: 24, alignItems: 'center' }}>
                       <Text style={{ color: '#666', fontSize: 11, textAlign: 'center' }}>
                         Pince pour zoomer et glisse pour déplacer
                       </Text>
                   </View>
                )}

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity onPress={closeCrop} style={{ flex: 1, padding: 16, borderRadius: 16, backgroundColor: '#333', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '600', color: '#fff', fontSize: 16 }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={async () => { await saveAvatarFocus(); closeCrop(); }} style={{ flex: 1, padding: 16, borderRadius: 16, backgroundColor: '#F97316', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: '#000', fontSize: 16 }}>Enregistrer</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Animated.View>
          </View>
        </View>
      </Modal>

      {/* Modal remplacement photo */}
      <Modal visible={replaceOpen} transparent animationType="none" onRequestClose={closeReplace}>
        <View style={{ flex: 1 }}>
          <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }}>
            <Pressable onPress={closeReplace} style={{ flex: 1 }} />
          </Animated.View>
          <View style={{ flex: 1, justifyContent: 'flex-end', pointerEvents: 'box-none' }}>
            <Animated.View style={[{ width: '100%' }, { transform: [{ translateY: slideAnim }] }]}>
              <Pressable style={{ backgroundColor: '#1c1c1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: '#333', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 20 }}>
                {/* Handle */}
                <View style={{ width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 24 }} />
                
                <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 8, color: '#fff', textAlign: 'center' }}>Modifier la photo</Text>
                <Text style={{ fontSize: 14, color: '#999', marginBottom: 24, textAlign: 'center' }}>Que veux-tu faire ?</Text>

                <View style={{ gap: 12 }}>
                  <TouchableOpacity onPress={deletePhoto} style={{ padding: 16, borderRadius: 16, backgroundColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <FontAwesome name="trash" size={20} color="#ff453a" />
                    <Text style={{ fontWeight: '600', color: '#ff453a', fontSize: 16 }}>Supprimer la photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={replacePhoto} style={{ padding: 16, borderRadius: 16, backgroundColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <FontAwesome name="refresh" size={20} color="#fff" />
                    <Text style={{ fontWeight: '600', color: '#fff', fontSize: 16 }}>Remplacer par une nouvelle</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={closeReplace} style={{ padding: 16, borderRadius: 16, backgroundColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <FontAwesome name="close" size={20} color="#fff" />
                    <Text style={{ fontWeight: '600', color: '#fff', fontSize: 16 }}>Annuler</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Animated.View>
          </View>
        </View>
      </Modal>

      {/* Viewer "story" (Popup style) */}
      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' }}>
           <Pressable onPress={() => setViewerOpen(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
           
           <View style={{ width: Dimensions.get('window').width - 40, height: Dimensions.get('window').height * 0.65, backgroundColor: '#000', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#333', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 }}>
               <Pressable onPress={onViewerTap} style={{ flex: 1 }}>
                  {photosOrdered[viewerIndex] && (
                    <ExpoImage 
                        source={{ uri: photosOrdered[viewerIndex].url }} 
                        style={{ flex: 1, width: '100%' }} 
                        contentFit="cover" 
                    />
                  )}
                  
                  {/* Progress Bars */}
                  <View style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 4 }}>
                     {photosOrdered.map((_, i) => (
                        <View key={i} style={{ flex: 1, height: 3, backgroundColor: i === viewerIndex ? '#fff' : 'rgba(255,255,255,0.3)', borderRadius: 2 }} />
                     ))}
                  </View>

                  {/* Header */}
                  <View style={{ position: 'absolute', top: 24, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                     <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Avatar size={32} ring initials={initials} uri={primaryUrl ?? undefined} />
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 }}>
                            {profile?.firstName ?? 'Utilisateur'}
                        </Text>
                     </View>
                  </View>

                  {/* Info Overlay */}
                   <View style={{ position: 'absolute', bottom: 16, left: 16, right: 16, gap: 8 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                         {profile?.genderIdentity && (
                           <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                             <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{profile.genderIdentity.charAt(0).toUpperCase() + profile.genderIdentity.slice(1)}</Text>
                           </View>
                         )}
                         {profile?.heightCm && (
                           <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                             <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{profile.heightCm} cm</Text>
                           </View>
                         )}
                      </View>

                      {(profile?.interests ?? []).length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {(profile?.interests ?? []).map((i: string) => (
                             <View key={i} style={{ backgroundColor: '#F97316', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                               <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{i.charAt(0).toUpperCase() + i.slice(1)}</Text>
                             </View>
                          ))}
                        </View>
                      )}
                      
                       {(profile?.genders ?? []).length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                           <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 2 }}>Cherche :</Text>
                          {(profile?.genders ?? []).map((g: string) => (
                             <View key={g} style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                               <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{g === 'autres' ? 'Les deux' : g.charAt(0).toUpperCase() + g.slice(1)}</Text>
                             </View>
                          ))}
                        </View>
                      )}
                   </View>
               </Pressable>
           </View>
        </View>
      </Modal>

      {/* Upload Loader */}
      <Modal visible={isUploading} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={C.tint} style={{ marginBottom: 20 }} />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center', paddingHorizontal: 40 }}>
                Nous analysons votre photo pour voir si elle respecte les règles...
            </Text>
        </View>
      </Modal>
    </View>
  );
}

/* --------------------------- Composant AvatarEditor --------------------------- */
function AvatarEditor({ uri, initialZoom = 1, initialFocusX = 0.5, initialFocusY = 0.5, onChange }: { uri: string; initialZoom?: number; initialFocusX?: number; initialFocusY?: number; onChange: (z: number, x: number, y: number) => void }) {
  const scale = useSharedValue(initialZoom);
  const savedScale = useSharedValue(initialZoom);
  const transX = useSharedValue(0);
  const savedTransX = useSharedValue(0);
  const transY = useSharedValue(0);
  const savedTransY = useSharedValue(0);

  // Initialisation : on calcule la translation pour centrer sur le focus
  // (0.5, 0.5) => (0, 0)
  // (x, y) => delta par rapport au centre
  // Si zoom > 1, on peut être décalé.
  // La logique de Avatar.tsx est : 
  // translateX: (0.5 - focusX) * width * (zoom - 1)
  // Ici on travaille dans un repère local de 200x200
  useEffect(() => {
     // Forcer l'initialisation correcte des shared values
     scale.value = initialZoom;
     savedScale.value = initialZoom;
     
     if (initialZoom > 1) {
         const tx = (0.5 - initialFocusX) * 200 * (initialZoom - 1);
         const ty = (0.5 - initialFocusY) * 200 * (initialZoom - 1);
         transX.value = tx;
         transY.value = ty;
         savedTransX.value = tx;
         savedTransY.value = ty;
     } else {
         transX.value = 0;
         transY.value = 0;
         savedTransX.value = 0;
         savedTransY.value = 0;
     }
  }, [initialZoom, initialFocusX, initialFocusY, scale, savedScale, transX, transY, savedTransX, savedTransY]); // Dépendances importantes pour re-init quand on rouvre le modal

  const updateFocusState = (currentScale: number, tx: number, ty: number) => {
    // Inverse de la formule :
    // tx = (0.5 - focusX) * 200 * (zoom - 1)
    // tx / (200 * (zoom - 1)) = 0.5 - focusX
    // focusX = 0.5 - tx / (200 * (zoom - 1))
    
    let fx = 0.5;
    let fy = 0.5;
    
    if (currentScale > 1.05) { // Marge pour éviter division par ~0
        fx = 0.5 - tx / (200 * (currentScale - 1));
        fy = 0.5 - ty / (200 * (currentScale - 1));
    }
    
    // Clamp
    fx = Math.max(0, Math.min(1, fx));
    fy = Math.max(0, Math.min(1, fy));
    
    onChange(currentScale, fx, fy);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      let nextX = savedTransX.value + e.translationX;
      let nextY = savedTransY.value + e.translationY;
      
      // Limite la translation pour que l'image couvre toujours le cercle
      // Taille de l'image = 200 * scale
      // Taille du cercle = 200
      // Marge de débordement disponible = (200 * scale - 200) / 2 = 100 * (scale - 1)
      // Donc la translation max dans chaque direction est 100 * (scale - 1)
      const max = Math.max(0, 100 * (scale.value - 1));
      
      transX.value = Math.min(Math.max(nextX, -max), max);
      transY.value = Math.min(Math.max(nextY, -max), max);
    })
    .onEnd(() => {
      savedTransX.value = transX.value;
      savedTransY.value = transY.value;
      runOnJS(updateFocusState)(scale.value, transX.value, transY.value);
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      let nextScale = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(nextScale, 1), 3);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const max = Math.max(0, 100 * (scale.value - 1));
      if (Math.abs(transX.value) > max) {
         transX.value = withSpring(Math.sign(transX.value) * max);
         savedTransX.value = Math.sign(transX.value) * max;
      }
      if (Math.abs(transY.value) > max) {
         transY.value = withSpring(Math.sign(transY.value) * max);
         savedTransY.value = Math.sign(transY.value) * max;
      }
      runOnJS(updateFocusState)(scale.value, transX.value, transY.value);
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: transX.value },
      { translateY: transY.value },
      { scale: scale.value },
    ]
  }));

  return (
    <GestureDetector gesture={composed}>
        <View style={{ 
          width: 200, 
          height: 200, 
          borderRadius: 100, 
          overflow: 'hidden', 
          borderWidth: 2, 
          borderColor: '#F97316',
          backgroundColor: '#000',
          position: 'relative'
        }}>
           <AnimatedImage 
             source={{ uri }} 
             style={[{ width: '100%', height: '100%', backgroundColor: '#1c1c1e' }, animatedStyle]} 
             contentFit="cover"
           />
        </View>
    </GestureDetector>
  );
}

/* ------------------------------- Styles ------------------------------- */
const s = StyleSheet.create({
  iconBtnGlass: {
    padding: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  avatarContainer: {
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  nameLarge: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,20,20,0.6)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    width: '100%',
  },
  statItem: { alignItems: 'center', flex: 1 },
  statDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.1)' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginTop: 4 },
  
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  
  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  
  photoSlot: {
    flex: 1,
    aspectRatio: 3/4,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1c1c1e',
  },
  photoSlotEmpty: {
    flex: 1,
    aspectRatio: 3/4,
    borderRadius: 16,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  planCard: {
    width: screenW * 0.75,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'space-between',
    minHeight: 160,
  },

  // Helpers styles
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: '#333', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  pillTxt: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
