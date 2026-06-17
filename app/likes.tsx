import FontAwesome from '@expo/vector-icons/FontAwesome';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    Image as RNImage,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/ui/Avatar';
import { useDialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { Colors } from '../constants/Colors';
import { auth, functions } from '../firebaseconfig';
import { useSubscription } from '../hooks/useSubscription';
import { FEATURE_COSTS, performActionUpdates } from '../lib/monetization';
import { getUserProfile, UserProfile } from '../lib/profile';

const PINS_IMG = require('../assets/images/pins2.png');

type LikeProfile = UserProfile & { distance?: number };

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function LikesScreen() {
  const C = Colors['dark'];
  const accent = C.tint;

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<LikeProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const mySubscription = useSubscription(myProfile?.subscription);
  const [showRevealOptions, setShowRevealOptions] = useState(false);
  const { showToast } = useToast();
  const { alert, confirm } = useDialog();
  const insets = useSafeAreaInsets();
  const db = getFirestore();

  const loadLikes = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      // Charger mon profil pour l'abonnement
      const me = await getUserProfile(uid);
      setMyProfile(me);

      // Charger ma position
      let myLat: number | undefined;
      let myLng: number | undefined;
      try {
        const myPosSnap = await getDoc(doc(db, 'positions', uid));
        if (myPosSnap.exists()) {
           const d = myPosSnap.data();
           myLat = d.lat;
           myLng = d.lng;
        }
      } catch {}

      // 1. Récupérer les documents "likes" où "to" == moi
      const q = query(collection(db, 'likes'), where('to', '==', uid));
      const snapshot = await getDocs(q);

      const senderIds = new Set<string>();
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.from) senderIds.add(data.from);
      });

      // 1.5. Exclure les amis / matchs
      // On regarde si on a aussi liké ces personnes (match) ou si elles sont dans nos amis
      // Pour faire simple, on va checker si on a un doc "likes" de nous vers eux
      // Ou plus robuste : on check si ils sont dans une collection "friends" ou si le like est mutuel
      
      // Récupérer mes likes (ceux que j'ai liké)
      const myLikesQ = query(collection(db, 'likes'), where('from', '==', uid));
      const myLikesSnap = await getDocs(myLikesQ);
      const myLikedIds = new Set<string>();
      myLikesSnap.forEach((doc) => {
          const data = doc.data();
          if (data.to) myLikedIds.add(data.to);
      });

      // Filtrer : on garde ceux qui nous ont liké MAIS qu'on n'a PAS liké en retour
      const filteredSenderIds = Array.from(senderIds).filter(id => !myLikedIds.has(id));

      // 2. Charger les profils de ces utilisateurs et leurs positions
      const loadedProfiles: LikeProfile[] = [];
      await Promise.all(
        filteredSenderIds.map(async (senderId) => {
          try {
            const [p, posSnap] = await Promise.all([
               getUserProfile(senderId),
               getDoc(doc(db, 'positions', senderId))
            ]);
            
            if (p) {
               let distance: number | undefined;
               if (myLat !== undefined && myLng !== undefined && posSnap.exists()) {
                  const d = posSnap.data();
                  if (typeof d.lat === 'number' && typeof d.lng === 'number') {
                     distance = haversineKm(myLat, myLng, d.lat, d.lng);
                  }
               }
               loadedProfiles.push({ ...p, distance });
            }
          } catch (e) {
            console.warn('Erreur chargement profil', senderId, e);
          }
        })
      );

      setProfiles(loadedProfiles);
    } catch (e) {
      console.error('Erreur chargement likes:', e);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    loadLikes();
  }, [loadLikes]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLikes();
    setRefreshing(false);
  };

  const handleBulkReveal = async (count: number) => {
    if (!myProfile || !myProfile.uid) return;

    // Filter locked profiles
    const lockedProfiles = profiles.filter(p => !myProfile.unlockedLikes?.includes(p.uid!));
    if (lockedProfiles.length === 0) {
        showToast('Info', 'Tous les profils sont déjà débloqués.', 'info');
        return;
    }

    const toReveal = lockedProfiles.slice(0, count);
    const cost = toReveal.length * FEATURE_COSTS.UNLOCK_LIKE;

    if ((myProfile.pins || 0) < cost) {
         Alert.alert(
            'Pins insuffisants',
            `Il vous faut ${cost} pins pour révéler ces profils.`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Acheter des pins', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
            ]
         );
         return;
    }

    Alert.alert(
        'Révéler les profils ?',
        `Voulez-vous utiliser ${cost} pins pour révéler ${toReveal.length} profil(s) ?`,
        [
            { text: 'Annuler', style: 'cancel' },
            {
                text: 'Révéler',
                onPress: async () => {
                    try {
                        const ids = toReveal.map(p => p.uid!);
                        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                        const unlockFn = httpsCallable(functions, 'unlockProfilesWithPins');
                        const r: any = await unlockFn({ profileIds: ids, requestId });
                        const charged = typeof r?.data?.charged === 'number' ? r.data.charged : cost;
                        const unlockedIds = Array.isArray(r?.data?.unlockedIds) ? r.data.unlockedIds : ids;

                        setMyProfile(prev => prev ? ({
                            ...prev,
                            pins: (prev.pins || 0) - charged,
                            unlockedLikes: Array.from(new Set([...(prev.unlockedLikes || []), ...unlockedIds]))
                        }) : null);
                        
                        showToast('Succès', `${toReveal.length} profils révélés !`, 'success');
                    } catch (e) {
                        console.error(e);
                        showToast('Erreur', 'Impossible de révéler les profils.', 'error');
                    }
                }
            }
        ]
    );
  };

  const handleUnlockLike = async (profileId: string) => {
    if (!myProfile || !myProfile.uid) return;

    const check = performActionUpdates(myProfile, 'UNLOCK_LIKE');
    if (!check.allowed) {
        if (check.reason === 'insufficient_coins') {
             alert(
                'Pins insuffisants', 
                'Vous n\'avez pas assez de pins pour débloquer ce profil.',
                [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Acheter des pins', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                ]
             );
        } else {
            showToast('Erreur', 'Action impossible : Vous ne pouvez pas effectuer cette action.', 'error');
        }
        return;
    }

    // Show confirmation
    alert(
        'Débloquer le profil ?',
        `Voulez-vous utiliser ${check.cost} pins pour voir ce profil ?`,
        [
            { text: 'Annuler', style: 'cancel' },
            { 
                text: 'Débloquer', 
                onPress: async () => {
                    try {
                        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                        const unlockFn = httpsCallable(functions, 'unlockProfilesWithPins');
                        const r: any = await unlockFn({ profileIds: [profileId], requestId });
                        const charged = typeof r?.data?.charged === 'number' ? r.data.charged : (check.cost || 0);
                        const unlockedIds = Array.isArray(r?.data?.unlockedIds) ? r.data.unlockedIds : [profileId];

                        // Update local state immediately
                        setMyProfile(prev => prev ? ({
                            ...prev,
                            pins: (prev.pins || 0) - charged,
                            unlockedLikes: Array.from(new Set([...(prev.unlockedLikes || []), ...unlockedIds]))
                        }) : null);

                        showToast('Succès', 'Profil débloqué !', 'success');
                    } catch (e) {
                        console.error('Error unlocking profile:', e);
                        showToast('Erreur', 'Impossible de débloquer le profil.', 'error');
                    }
                }
            }
        ]
    );
  };

  const isPro = mySubscription === 'PRO';
  // Si FREE: on ne montre rien (teaser)
  // Si PLUS: on montre flouté (teaser light)
  // Si PRO: on montre tout

  const renderItem = ({ item }: { item: UserProfile }) => {
    const primaryUrl = item.primaryPhotoPath 
        ? item.photos?.find(p => p.path === item.primaryPhotoPath)?.url 
        : item.photos?.[0]?.url;

    const initials = (item.firstName || 'U')[0].toUpperCase();
    
    // Check if unlocked specifically
    const isUnlocked = isPro || (myProfile?.unlockedLikes?.includes(item.uid!));

    if (isUnlocked) {
        return (
          <TouchableOpacity 
            style={s.userRow} 
            onPress={() => router.push(`/user/${item.uid}` as any)}
          >
            <Avatar 
                uri={primaryUrl} 
                initials={initials} 
                size={56} 
                ring 
                ringColor="#F97316"
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.userName}>
                    {item.firstName}{item.age ? `, ${item.age}` : ''}
                </Text>
                <Text style={s.userSubtitle} numberOfLines={1}>
                    A aimé votre profil
                </Text>
            </View>
            <FontAwesome name="chevron-right" size={14} color="#666" />
          </TouchableOpacity>
        );
    }

    // Cas NON PRO et NON UNLOCKED (PLUS ou FREE si on décide d'afficher quand même en flouté pour teaser)
    // On floute tout
    return (
        <TouchableOpacity 
            style={s.userRow} 
            onPress={() => {
                alert(
                    'Profil flouté', 
                    'Passez PRO pour tout voir, ou débloquez ce profil avec des pins.', 
                    [
                        { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'subs' } } as any) },
                        { text: `Débloquer (${FEATURE_COSTS.UNLOCK_LIKE} pins)`, onPress: () => handleUnlockLike(item.uid!) },
                        { text: 'Annuler', style: 'cancel' }
                    ]
                );
            }}
        >
            <View>
                <Avatar 
                    uri={primaryUrl} 
                    initials={initials} 
                    size={56} 
                    ring 
                    ringColor={accent}
                />
                <BlurView intensity={20} style={StyleSheet.absoluteFillObject} tint="dark" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ backgroundColor: C.panel, height: 20, width: 100, borderRadius: 4, marginBottom: 6 }} />
                <Text style={s.userSubtitle} numberOfLines={1}>
                    Quelqu&apos;un a montre de l&apos;interet
                </Text>
            </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ backgroundColor: 'rgba(249, 115, 22, 0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: accent, fontSize: 12, fontWeight: '700' }}>{FEATURE_COSTS.UNLOCK_LIKE}</Text>
                    <RNImage source={PINS_IMG} style={{ width: 12, height: 12 }} resizeMode="contain" />
                </View>
                <FontAwesome name="lock" size={16} color={C.subtleText} />
            </View>
        </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background, paddingTop: insets.top }}>
      {/* Header personnalisé */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <FontAwesome name="chevron-left" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Interets recus</Text>
        <TouchableOpacity onPress={() => router.push({ pathname: '/store', params: { tab: 'coins' } } as any)}>
            <Text style={{ color: accent, fontWeight: '700' }}>Store</Text>
        </TouchableOpacity>
      </View>
      
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={accent} />
        </View>
      ) : (
        <>
            {/* Cas FREE: Teaser complet si on veut suivre strict "aucun compteur", mais souvent on veut montrer qu'il y a des likes */}
            {mySubscription === 'FREE' && profiles.length > 0 && (!myProfile?.unlockedLikes || myProfile.unlockedLikes.length === 0) ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                        <FontAwesome name="heart" size={32} color={accent} />
                    </View>
                    <Text style={{ color: C.text, fontSize: 24, fontWeight: '900', textAlign: 'center', marginBottom: 12 }}>
                        Des personnes veulent vous decouvrir !
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 16, textAlign: 'center', marginBottom: 32 }}>
                        Passez a Frensy PLUS ou PRO pour voir les profils interesses, ou revelez-les avec des pins.
                    </Text>
                    <TouchableOpacity 
                        onPress={() => router.push({ pathname: '/store', params: { tab: 'coins' } } as any)}
                        style={{ backgroundColor: accent, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 999, width: '100%', alignItems: 'center', marginBottom: 20 }}
                    >
                        <Text style={{ color: '#000', fontWeight: '900', fontSize: 18 }}>VOIR LES OFFRES</Text>
                    </TouchableOpacity>

                    {/* Reveal Options */}
                    {!showRevealOptions ? (
                        <TouchableOpacity onPress={() => setShowRevealOptions(true)}>
                            <Text style={{ color: accent, fontWeight: '600', fontSize: 16, textDecorationLine: 'underline' }}>
                                Ou révéler avec des pins
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={{ width: '100%', gap: 12, alignItems: 'center' }}>
                            <Text style={{ color: C.subtleText, marginBottom: 4 }}>Choisir le nombre à révéler :</Text>
                            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                                <TouchableOpacity 
                                    onPress={() => handleBulkReveal(1)}
                                    style={[s.revealBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                                >
                                    <Text style={s.revealBtnText}>1 ({FEATURE_COSTS.UNLOCK_LIKE}</Text>
                                    <RNImage source={PINS_IMG} style={{ width: 14, height: 14 }} resizeMode="contain" />
                                    <Text style={s.revealBtnText}>)</Text>
                                </TouchableOpacity>
                                {profiles.length >= 3 && (
                                    <TouchableOpacity 
                                        onPress={() => handleBulkReveal(3)}
                                        style={[s.revealBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                                    >
                                        <Text style={s.revealBtnText}>3 ({FEATURE_COSTS.UNLOCK_LIKE * 3}</Text>
                                        <RNImage source={PINS_IMG} style={{ width: 14, height: 14 }} resizeMode="contain" />
                                        <Text style={s.revealBtnText}>)</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity 
                                    onPress={() => handleBulkReveal(profiles.length)}
                                    style={[s.revealBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                                >
                                    <Text style={s.revealBtnText}>Tout ({FEATURE_COSTS.UNLOCK_LIKE * profiles.length}</Text>
                                    <RNImage source={PINS_IMG} style={{ width: 14, height: 14 }} resizeMode="contain" />
                                    <Text style={s.revealBtnText}>)</Text>
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity onPress={() => setShowRevealOptions(false)} style={{ marginTop: 8 }}>
                                <Text style={{ color: C.subtleText }}>Annuler</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            ) : (
                // Cas PRO ou PLUS (ou FREE s'il n'y a personne, ça affiche empty state)
                profiles.length === 0 ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                        <FontAwesome name="heart-o" size={48} color={C.panel} />
                        <Text style={{ color: C.subtleText, marginTop: 16, fontSize: 16 }}>Aucun profil interesse pour le moment.</Text>
                    </View>
                ) : (
                    <FlatList
                        data={profiles}
                        keyExtractor={(item, idx) => item.uid ?? String(idx)}
                        renderItem={renderItem}
                        contentContainerStyle={{ padding: 16, gap: 12 }}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text} />
                        }
                    />
                )
            )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.panelBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: '700',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.panelBorder,
    overflow: 'hidden'
  },
  userName: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
  },
  userSubtitle: {
    color: Colors.dark.subtleText,
    fontSize: 14,
    marginTop: 2,
  },
  revealBtn: {
    backgroundColor: Colors.dark.panel,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.tint
  },
  revealBtnText: {
    color: Colors.dark.text,
    fontWeight: '700',
    fontSize: 14
  }
});
