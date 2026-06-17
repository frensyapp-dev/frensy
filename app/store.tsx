import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PurchasesPackage } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { Colors } from '../constants/Colors';
import { auth, functions } from '../firebaseconfig';
import { COIN_PACKS, FEATURE_COSTS, lastActivationCache, SUBSCRIPTION_PLANS, type SubscriptionTier } from '../lib/monetization';
import { userDocRef, userPrivateRef } from '../lib/profile';
import { getOfferings, getRevenueCatConfigError, initRevenueCat, isRevenueCatConfigured, purchasePackage, restorePurchases, syncRevenueCatPurchases } from '../lib/revenuecat';

const PINS_IMG = require('../assets/images/pins2.png');

const TERMS_URL = 'https://frensyapp-dev.github.io/frensy/terms.html';

function privacyPolicyUrl(): string {
  const extra =
    (Constants.expoConfig as any)?.extra ||
    (Constants as any)?.manifest?.extra ||
    (Constants as any)?.manifest2?.extra ||
    {};
  const u = (extra as any)?.privacyPolicyUrl;
  return typeof u === 'string' && u.trim().length > 0 ? u.trim() : 'https://frensyapp-dev.github.io/frensy/privacy.html';
}

const FEATURES_CONFIG: any = {
  BOOST: {
    title: 'Booster mon profil',
    icon: '🚀',
    description: 'Soyez vu par plus de monde pendant 30 min !',
    packs: [
      { count: 1, price: FEATURE_COSTS.BOOST, id: 'BOOST', label: '1 Boost' },
      { count: 5, price: FEATURE_COSTS.BOOST_BUNDLE_5, id: 'BOOST_BUNDLE_5', label: '5 Boosts', tag: 'ECONOMIQUE', savings: '20%' },
    ]
  },
  SUPER_INVITE: {
    title: 'Super Invite',
    icon: '💌',
    description: 'Envoyez une invitation qui se démarque !',
    packs: [
      { count: 1, price: FEATURE_COSTS.SUPER_INVITE, id: 'SUPER_INVITE', label: '1 Super Invite' },
      { count: 5, price: FEATURE_COSTS.SUPER_INVITE_BUNDLE_5, id: 'SUPER_INVITE_BUNDLE_5', label: '5 Super Invites', tag: 'POPULAIRE', savings: '16%' },
      { count: 15, price: FEATURE_COSTS.SUPER_INVITE_BUNDLE_15, id: 'SUPER_INVITE_BUNDLE_15', label: '15 Super Invites', tag: 'BEST VALUE', savings: '38%' },
    ]
  },
  UNLOCK_LIKE: {
    title: 'Reveler un interet',
    icon: '👁️',
    description: 'Decouvrez qui a manifeste un interet pour votre profil.',
    packs: [
      { count: 1, price: FEATURE_COSTS.UNLOCK_LIKE, id: 'UNLOCK_LIKE', label: '1 Révélation' },
      { count: 10, price: FEATURE_COSTS.UNLOCK_LIKE_BUNDLE_10, id: 'UNLOCK_LIKE_BUNDLE_10', label: '10 Révélations', tag: 'ECONOMIQUE', savings: '16%' },
    ]
  },
  INVITE: {
    title: 'Invitations',
    icon: '✉️',
    description: 'Invitez plus de personnes à discuter !',
    packs: [
      { count: 1, price: FEATURE_COSTS.INVITE, id: 'INVITE', label: '1 Invitation' },
      { count: 5, price: FEATURE_COSTS.INVITE_BUNDLE_5, id: 'INVITE_BUNDLE_5', label: '5 Invitations', tag: 'POPULAIRE', savings: '16%' },
      { count: 15, price: FEATURE_COSTS.INVITE_BUNDLE_15, id: 'INVITE_BUNDLE_15', label: '15 Invitations', tag: 'BEST VALUE', savings: '27%' },
    ]
  },
  UNDO: {
    title: 'Annuler un swipe',
    icon: '↩️',
    description: 'Revenez en arrière sur votre dernier swipe à gauche.',
    packs: [
      { count: 1, price: FEATURE_COSTS.UNDO, id: 'UNDO', label: '1 Undo' },
      { count: 10, price: FEATURE_COSTS.UNDO_BUNDLE_10, id: 'UNDO_BUNDLE_10', label: '10 Undos', tag: 'ECONOMIQUE', savings: '25%' },
    ]
  }
};

const REWARDS = [
  { day: 1, label: '5 Pins', type: 'pins', amount: 5 },
  { day: 2, label: '1 Invitation', type: 'invite', amount: 1, icon: '💌' },
  { day: 3, label: '10 Pins', type: 'pins', amount: 10 },
  { day: 4, label: '1 Undo', type: 'undo', amount: 1, icon: '↩️' },
  { day: 5, label: '10 Pins', type: 'pins', amount: 10 },
  { day: 6, label: '1 Révélation', type: 'unlock_like', amount: 1, icon: '👁️' },
  { day: 7, label: '1 Boost', type: 'boost', amount: 1, icon: '🚀' },
];

const C = Colors.dark;
const ACCENT = C.tint;
const GOLD = C.gold;

export default function DailyRewardScreen() {
  const { showToast } = useToast();
  
  // États de persistance des cadeaux/partages
  const [lastClaimDate, setLastClaimDate] = useState<dayjs.Dayjs | null>(null);
  const [lastProfileSharedAt, setLastProfileSharedAt] = useState<dayjs.Dayjs | null>(null);
  const [lastAppSharedAt, setLastAppSharedAt] = useState<dayjs.Dayjs | null>(null);

  // Helper pour savoir si 7 jours sont passés
  const isWeekCooldown = (date: dayjs.Dayjs | null) => {
    if (!date) return false;
    const now = dayjs();
    const diff = now.diff(date, 'day');
    return diff < 7;
  };

  // Helper pour savoir si 1 jour est passé
  const isDayCooldown = (date: dayjs.Dayjs | null) => {
    if (!date) return false;
    const now = dayjs();
    const diff = now.diff(date, 'day');
    return diff < 1;
  };

  const isDailyRewardClaimed = useMemo(() => {
    if (!lastClaimDate) return false;
    return dayjs().isSame(lastClaimDate, 'day');
  }, [lastClaimDate]);

  const { alert } = useDialog();
  const params = useLocalSearchParams();
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : null;
  const [, tarSetClaiming] = useState(false);
  const [streak, setStreak] = useState(0);
  
  const [isDirectStoreAccess, setIsDirectStoreAccess] = useState(!!(params.tab || params.openStore));

  // Redirection automatique si le cadeau est déjà récupéré et qu'on n'est pas en accès direct store
  useEffect(() => {
    if (!isDirectStoreAccess && isDailyRewardClaimed) {
        router.replace('/(tabs)/profile');
    }
  }, [isDirectStoreAccess, isDailyRewardClaimed]);

  useEffect(() => {
    if (params.tab || params.openStore) {
      setIsDirectStoreAccess(true);
    }
  }, [params.tab, params.openStore]);

  const [showStore, setShowStore] = useState(false);
  const [userCoins, setUserCoins] = useState(0);
  const [claiming, setClaiming] = useState(false);

  // Animations
  const [scaleAnims] = useState(() => REWARDS.map(() => new Animated.Value(1)));

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
        setUserCoins(0);
        setStreak(0);
        setLastClaimDate(null);
        return;
    }

    // Reset for new user
    setUserCoins(0);
    setStreak(0);
    setLastClaimDate(null);

    const sourceOfTruth = {
        pins: false
    };

    const unsubPrivate = onSnapshot(userPrivateRef(uid), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            if (typeof d.pins === 'number') {
                setUserCoins(d.pins);
                sourceOfTruth.pins = true;
            }
        }
    });

    const unsubPublic = onSnapshot(userDocRef(uid), (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        
        // Fallback to public pins if not yet found in private
        if (!sourceOfTruth.pins && typeof d.pins === 'number') {
            setUserCoins(d.pins);
        }

        const rawLastClaim = (d as any).lastDailyRewardClaimedAt;
        let lastClaim: dayjs.Dayjs | null = null;
        if (rawLastClaim) {
            if (typeof rawLastClaim === 'number') {
                lastClaim = dayjs(rawLastClaim);
            } else if (typeof (rawLastClaim as any).toMillis === 'function') {
                lastClaim = dayjs(rawLastClaim.toMillis());
            } else if (rawLastClaim instanceof Date) {
                lastClaim = dayjs(rawLastClaim.getTime());
            }
        }
        const currentStreak = (d as any).dailyRewardStreak ?? (d as any).dailyStreak ?? 0;
        
        setLastClaimDate(lastClaim);
        
        if (lastClaim) {
           const now = dayjs();
           const diff = now.diff(lastClaim, 'day');
           
           if (lastClaim.isSame(now, 'day')) {
             setStreak(currentStreak);
           } else if (diff === 1 || (diff === 0 && !lastClaim.isSame(now, 'day'))) { 
             const isYesterday = now.subtract(1, 'day').isSame(lastClaim, 'day');
             if (isYesterday) {
                setStreak(currentStreak);
             } else {
                if (diff > 1) {
                    setStreak(0);
                } else {
                    setStreak(currentStreak);
                }
             }
           } else {
             setStreak(0);
           }
        } else {
            setStreak(0);
        }
      }
    });

    return () => {
        unsubPublic();
        unsubPrivate();
    };
  }, [auth.currentUser?.uid]);

  const isClaimable = () => {
    if (!lastClaimDate) return true;
    const now = dayjs();
    return !now.isSame(lastClaimDate, 'day');
  };

  const getNextDay = () => {
    return (streak % 7) + 1;
  };

  const shouldShowStoreOnly = isDirectStoreAccess || !isClaimable();

  const claimReward = async (dayToClaim: number) => {
    if (claiming) return;
    if (!isClaimable()) return;
    
    // Validate we are claiming the correct day
    const nextDay = getNextDay();
    if (dayToClaim !== nextDay) return;

    setClaiming(true);
    // Optimistic UI: appliquer immédiatement, puis confirmer avec le backend
    const prev = {
      streak,
      lastClaimDate,
      userCoins
    };
    const rewardDef = REWARDS.find(r => r.day === dayToClaim);
    const optimisticStreak = streak + 1;
    setStreak(optimisticStreak);
    setLastClaimDate(dayjs());
    if (rewardDef?.type === 'pins' && typeof rewardDef.amount === 'number') {
      setUserCoins(c => c + rewardDef.amount);
    }
    // Animation immédiate
    const idx = nextDay - 1;
    if (scaleAnims[idx]) {
      Animated.sequence([
        Animated.spring(scaleAnims[idx], { toValue: 1.2, friction: 3, useNativeDriver: true }),
        Animated.timing(scaleAnims[idx], { toValue: 1, duration: 200, useNativeDriver: true })
      ]).start();
    }
    if (rewardDef) {
      showToast('Cadeau récupéré !', `Vous avez reçu : ${rewardDef.label}`, 'success');
    }

    // On attend un court instant avant de rediriger pour que l'utilisateur voit le succès
    setTimeout(() => {
        handleClose();
    }, 1200);

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const claimDailyRewardFn = httpsCallable(functions, 'claimDailyReward');
      const result: any = await claimDailyRewardFn();
      const { data } = result;

      if (data.success) {
          // Harmoniser avec la réponse serveur au cas où
          setStreak(data.streak);
          // lastClaimDate déjà positionnée localement
          if (data.reward?.type === 'pins' && typeof data.reward?.amount === 'number') {
             setUserCoins(prevCoins => Math.max(prevCoins, prev.userCoins + data.reward.amount));
          }
      }
    } catch (e: any) {
      // Rollback si échec (mais on ne redirige pas forcément en arrière car c'est perturbant)
      console.error("Claim failed", e);
    } finally {
      setClaiming(false);
    }
  };

  const handleClose = () => {
    if (returnTo) {
        router.replace(returnTo as any);
        return;
    }
    // Si on vient de params.tab (accès direct Store), on retourne au profil
    if (isDirectStoreAccess) {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/profile');
        return;
    }
    
    // Si on est dans le flow Cadeau Quotidien, on retourne au profil aussi
    // Car l'utilisateur a fini son action quotidienne
    router.replace('/(tabs)/profile');
  };

  const closeLabel = returnTo === '/(tabs)/home' ? "Retour a l'accueil" : 'Retour au profil';

  // If accessed directly via params (e.g. from Profile > Pins), render ONLY the store
  if (shouldShowStoreOnly) {
      return (
        <View style={{ flex: 1, backgroundColor: C.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <StoreModalContent 
                onClose={handleClose} 
                initialTab={params.tab as any}
                returnTo={returnTo ?? undefined}
                onBalanceUpdate={setUserCoins}
            />
        </View>
      );
  }

  // Calculate effective streak for UI display (handle reset case)
  let effectiveStreak = streak % 7;
  // If we just claimed day 7 (streak is multiple of 7 > 0) and not claimable again today, show full progress
  if (effectiveStreak === 0 && streak > 0 && !isClaimable()) {
    effectiveStreak = 7;
  }

  // Otherwise, render Daily Reward with optional Store Modal
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
            colors={[C.card, C.background]}
            style={[StyleSheet.absoluteFill]}
      />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15 }}>
           <TouchableOpacity onPress={handleClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20 }}>
             <Ionicons name="close" size={24} color={C.text} />
           </TouchableOpacity>
           <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: 0.5 }}>CADEAU QUOTIDIEN</Text>
           <TouchableOpacity onPress={() => setShowStore(true)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 215, 0, 0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.3)' }}>
              <Image source={PINS_IMG} style={{ width: 18, height: 18, marginRight: 6 }} resizeMode="contain" />
              <Text style={{ color: GOLD, fontWeight: 'bold', fontSize: 14 }}>{userCoins}</Text>
           </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Progress / Hero Section */}
          <View style={{ alignItems: 'center', marginVertical: 20 }}>
              <View style={{ position: 'relative', marginBottom: 15 }}>
                  <LinearGradient
                      colors={['rgba(249, 115, 22, 0.3)', 'rgba(249, 115, 22, 0)']}
                      style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, top: -35, left: -35 }}
                  />
                  <Text style={{ fontSize: 70 }}>🔥</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 36, fontWeight: '900', textAlign: 'center' }}>
                 {streak} Jours
              </Text>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 2, marginTop: 5 }}>
                  Série en cours
              </Text>
              <Text style={{ color: C.muted, textAlign: 'center', fontSize: 14, marginTop: 15, maxWidth: 280, lineHeight: 22 }}>
                Connecte-toi chaque jour pour ne pas perdre ta progression et gagner de meilleures récompenses !
              </Text>
          </View>

          {/* Grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
            {REWARDS.map((r, index) => {
              const isCompleted = r.day <= effectiveStreak;
              const isCurrent = r.day === effectiveStreak + 1;
              const canClaim = isCurrent && isClaimable();
              
              // Special layout for day 7 (full width)
              const isBig = r.day === 7;
              const width = isBig ? '100%' : '30%';

              return (
                <TouchableOpacity 
                    key={r.day}
                    activeOpacity={canClaim ? 0.8 : 1}
                    onPress={() => canClaim && claimReward(r.day)}
                    style={{ 
                        width: width,
                        aspectRatio: isBig ? 2.5 : 0.85,
                        borderRadius: 16,
                        marginBottom: 8,
                        overflow: 'hidden',
                        opacity: (isCurrent || isCompleted) ? 1 : 0.6,
                        borderWidth: isCurrent ? 2 : 0,
                        borderColor: canClaim ? ACCENT : 'transparent',
                        shadowColor: canClaim ? ACCENT : C.background,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: canClaim ? 0.5 : 0.2,
                        shadowRadius: 8,
                        elevation: canClaim ? 8 : 2
                    }}
                >
                    <LinearGradient
                        colors={
                            isCompleted ? ['#14532d', '#052e16'] :
                            canClaim ? [ACCENT, C.tintAlt] :
                            isCurrent ? [C.panel, C.card] :
                            [C.card, C.background]
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 10, flexDirection: isBig ? 'row' : 'column' }}
                    >
                         {isCompleted && (
                             <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 2 }}>
                                 <Ionicons name="checkmark" size={14} color={C.success} />
                             </View>
                         )}

                         <Animated.View style={{ alignItems: 'center', transform: [{ scale: scaleAnims[index] || 1 }], flexDirection: isBig ? 'row' : 'column', gap: isBig ? 20 : 5 }}>
                            {r.type === 'pins' ? (
                                <Image source={PINS_IMG} style={{ width: isBig ? 50 : 32, height: isBig ? 50 : 32 }} resizeMode="contain" />
                            ) : (
                                <Text style={{ fontSize: isBig ? 40 : 28 }}>{r.icon}</Text>
                            )}
                            
                                <View style={{ alignItems: isBig ? 'flex-start' : 'center' }}>
                                <Text style={{ color: isCompleted ? C.success : C.text, fontWeight: '900', fontSize: isBig ? 20 : 13, textTransform: 'uppercase' }}>
                                    {isBig ? 'Super Cadeau' : `Jour ${r.day}`}
                                </Text>
                                <Text style={{ color: C.subtleText, fontSize: isBig ? 16 : 11, fontWeight: '600', marginTop: 2 }}>
                                    {r.label}
                                </Text>
                            </View>
                        </Animated.View>
                    </LinearGradient>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer Link */}
          <View style={{ marginTop: 30, alignItems: 'center' }}>
            <TouchableOpacity onPress={handleClose} style={{ padding: 15 }}>
               <Text style={{ color: C.subtleText, textDecorationLine: 'underline', fontWeight: '500' }}>{closeLabel}</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </SafeAreaView>

      <Modal visible={showStore} animationType="slide" presentationStyle="pageSheet">
         <StoreModalContent 
            onClose={() => setShowStore(false)} 
            initialTab={params.tab as any} 
            returnTo={returnTo ?? undefined}
            onBalanceUpdate={setUserCoins}
         />
      </Modal>
    </View>
  );
}

function StoreModalContent({ onClose, initialTab, returnTo, onBalanceUpdate }: { onClose: () => void, initialTab?: 'subs' | 'coins', returnTo?: string, onBalanceUpdate?: (val: number) => void }) {
  const { alert, confirm } = useDialog();
  const [tab, setTab] = useState<'subs' | 'coins'>(initialTab || 'subs');
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userCoins, setUserCoins] = useState(0);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<'FREE' | 'PLUS' | 'PRO'>('FREE');
  const [currentSubscriptionExpiryMs, setCurrentSubscriptionExpiryMs] = useState(0);
  const { showToast } = useToast();

  const uid = auth.currentUser?.uid;

  const hasActiveSubscription = useMemo(() => {
    // Si on vient d'activer localement, on fait confiance à cette activation pendant 45s
    const cached = uid ? lastActivationCache.get(uid) : null;
    if (cached && Date.now() - cached.time < 45000) {
        if (cached.tier !== 'FREE') return true;
    }
    
    return currentSubscription !== 'FREE' && currentSubscriptionExpiryMs > Date.now();
  }, [currentSubscription, currentSubscriptionExpiryMs, uid]);

  const activeSubscriptionLabel = useMemo(() => {
    if (hasActiveSubscription) {
        const cached = uid ? lastActivationCache.get(uid) : null;
        const tier = (cached && Date.now() - cached.time < 45000) 
            ? cached.tier 
            : currentSubscription;
        
        return `${tier} actif jusqu'au ${dayjs(currentSubscriptionExpiryMs).format('DD/MM/YYYY')}`;
    }
    return 'Aucun abonnement actif';
  }, [hasActiveSubscription, currentSubscription, currentSubscriptionExpiryMs, uid]);

  // États de persistance des cadeaux/partages
  const [lastClaimDate, setLastClaimDate] = useState<dayjs.Dayjs | null>(null);
  const [lastProfileSharedAt, setLastProfileSharedAt] = useState<dayjs.Dayjs | null>(null);
  const [lastAppSharedAt, setLastAppSharedAt] = useState<dayjs.Dayjs | null>(null);

  // Helper pour savoir si 7 jours sont passés
  const isWeekCooldown = (date: dayjs.Dayjs | null) => {
    if (!date) return false;
    const now = dayjs();
    const diff = now.diff(date, 'day');
    return diff < 7;
  };

  // Helper pour savoir si 1 jour est passé
  const isDayCooldown = (date: dayjs.Dayjs | null) => {
    if (!date) return false;
    const now = dayjs();
    const diff = now.diff(date, 'day');
    return diff < 1;
  };

  const isDailyRewardClaimed = useMemo(() => {
    if (!lastClaimDate) return false;
    return dayjs().isSame(lastClaimDate, 'day');
  }, [lastClaimDate]);

  const nextPeriodLabel = (planId: string, duration: string) => {
    const t = `${planId} ${duration}`.toLowerCase();
    if (t.includes('1m') || t.includes('1 mois') || t.includes('mois')) return 'le mois prochain';
    if (t.includes('1y') || t.includes('1 an') || t.includes('an')) return "l'année prochaine";
    return 'à la prochaine période de facturation';
  };

  const handleDailyReward = () => {
    // Si le cadeau est déjà récupéré, on ne redirige pas vers la page de cadeau
    // mais on reste sur le store ou on ferme selon le besoin.
    // Ici on force la fermeture car l'utilisateur a cliqué sur "Cadeau" alors qu'il est déjà pris.
    if (isDailyRewardClaimed) {
        showToast('Déjà récupéré', 'Revenez demain pour un nouveau cadeau !', 'info');
        return;
    }

    onClose(); // Ferme la modal Store
    // ... rest of logic
    setTimeout(() => {
        router.push({ pathname: '/store', params: { openStore: undefined, tab: undefined, returnTo } });
    }, 100);
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUserCoins(0);
      setCurrentSubscription('FREE');
      setCurrentSubscriptionExpiryMs(0);
      return;
    }

    // Reset state for new user
    setUserCoins(0);
    setCurrentSubscription('FREE');
    setCurrentSubscriptionExpiryMs(0);

    // Listen to realtime updates for pins and subscription
    // Using a single object to track which fields came from private doc to avoid public overwriting
    const sourceOfTruth = {
        pins: false,
        subscription: false,
        subscriptionExpiryMs: false,
        lastProfileSharedAt: false,
        lastAppSharedAt: false
    };
    
    const unsubPrivate = onSnapshot(userPrivateRef(uid), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            
            if (typeof d.pins === 'number') {
                const val = d.pins;
                setUserCoins(val);
                if (onBalanceUpdate) onBalanceUpdate(val);
                sourceOfTruth.pins = true;
            }
            
            if (['FREE', 'PLUS', 'PRO'].includes(d.subscription)) {
                // Prevent overwriting if we just activated a subscription locally
                const cached = lastActivationCache.get(uid);
                const isRecentlyActivated = cached && (Date.now() - cached.time < 30000);
                
                if (!isRecentlyActivated || d.subscription !== 'FREE') {
                    setCurrentSubscription(d.subscription);
                    sourceOfTruth.subscription = true;
                }
            }
            
            if (typeof d.subscriptionExpiryMs === 'number') {
                const cached = lastActivationCache.get(uid);
                const isRecentlyActivated = cached && (Date.now() - cached.time < 30000);
                if (!isRecentlyActivated || d.subscriptionExpiryMs > 0) {
                    setCurrentSubscriptionExpiryMs(d.subscriptionExpiryMs);
                    sourceOfTruth.subscriptionExpiryMs = true;
                }
            }
            
            // Shared timestamps
            if (d.lastProfileSharedAt) {
                setLastProfileSharedAt(d.lastProfileSharedAt?.toMillis ? dayjs(d.lastProfileSharedAt.toMillis()) : dayjs(d.lastProfileSharedAt));
                sourceOfTruth.lastProfileSharedAt = true;
            }
            if (d.lastAppSharedAt) {
                setLastAppSharedAt(d.lastAppSharedAt?.toMillis ? dayjs(d.lastAppSharedAt.toMillis()) : dayjs(d.lastAppSharedAt));
                sourceOfTruth.lastAppSharedAt = true;
            }
        }
    });

    const unsubPublic = onSnapshot(userDocRef(uid), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            
            // Only use public data if private hasn't provided it yet (fallback/migration case)
            if (!sourceOfTruth.pins && typeof d.pins === 'number') {
                const val = d.pins;
                setUserCoins(val);
                if (onBalanceUpdate) onBalanceUpdate(val);
            }
            
            if (!sourceOfTruth.subscription && ['FREE', 'PLUS', 'PRO'].includes(d.subscription)) {
                const cached = lastActivationCache.get(uid);
                const isRecentlyActivated = cached && (Date.now() - cached.time < 30000);
                if (!isRecentlyActivated || d.subscription !== 'FREE') {
                    setCurrentSubscription(d.subscription);
                }
            }
            
            if (!sourceOfTruth.subscriptionExpiryMs && typeof d.subscriptionExpiryMs === 'number') {
                const cached = lastActivationCache.get(uid);
                const isRecentlyActivated = cached && (Date.now() - cached.time < 30000);
                if (!isRecentlyActivated || d.subscriptionExpiryMs > 0) {
                    setCurrentSubscriptionExpiryMs(d.subscriptionExpiryMs);
                }
            }

            // Daily Reward status is always in public doc
            const rawLastClaim = (d as any).lastDailyRewardClaimedAt;
            if (rawLastClaim) {
                if (typeof rawLastClaim === 'number') setLastClaimDate(dayjs(rawLastClaim));
                else if (typeof (rawLastClaim as any).toMillis === 'function') setLastClaimDate(dayjs(rawLastClaim.toMillis()));
                else if (rawLastClaim instanceof Date) setLastClaimDate(dayjs(rawLastClaim));
            }
        }
    });

    initStore();

    return () => {
        unsubPublic();
        unsubPrivate();
    };
  }, [auth.currentUser?.uid, onBalanceUpdate]);

  const initStore = async () => {
    const uid = auth.currentUser?.uid;
    await initRevenueCat(uid || undefined);
    void syncRevenueCatPurchases({ maxAttempts: 1, baseDelayMs: 0 }).catch(() => null);
    const offerings = await getOfferings();
    if (!offerings || !offerings.availablePackages) {
      const msg =
        getRevenueCatConfigError() ||
        (isRevenueCatConfigured()
          ? "Impossible de charger les offres d'abonnement pour le moment."
          : "Achats indisponibles: RevenueCat n'est pas configuré dans cette build.");
      showToast('Achats indisponibles', msg, 'error');
      return;
    }
    setPackages(offerings.availablePackages);
  };

  const findPackage = (identifier: string) => {
    const wanted = String(identifier || '').trim().toLowerCase();
    if (!wanted) return undefined;
    return packages.find((p) => {
      const packId = String(p.identifier || '').trim().toLowerCase();
      const productId = String(p.product?.identifier || '').trim().toLowerCase();
      return (
        packId === wanted ||
        productId === wanted ||
        packId.endsWith(`.${wanted}`) ||
        productId.endsWith(`.${wanted}`) ||
        packId.endsWith(wanted) ||
        productId.endsWith(wanted)
      );
    });
  };

  const handlePurchaseSub = async (tier: 'PLUS' | 'PRO', planId: string, duration: string) => {
    if (loading) return;

    if (hasActiveSubscription && currentSubscription === tier) {
      alert('Abonnement déjà actif', `Votre abonnement ${tier} est déjà actif.`);
      return;
    }

    const executePurchase = async () => {
      setLoading(true);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const pack = findPackage(planId);
        if (!pack) {
          alert('Produit introuvable', "Impossible de charger ce produit. Vérifie les produits App Store Connect et RevenueCat (identifiants).");
          return;
        }

        const result = await purchasePackage(pack);
        if (!result) return;

        setLoading(false);

        // Activation immédiate basée sur le retour de RevenueCat
        const entitlements = result.customerInfo.entitlements.active;
        let detectedTier: SubscriptionTier = 'FREE';
        let detectedExpiry = 0;

        // Détection plus robuste des entitlements (insensible à la casse et partielle)
        for (const [entId, e] of Object.entries(entitlements)) {
            const normalizedId = entId.toLowerCase();
            const exp = e.expirationDate ? new Date(e.expirationDate).getTime() : 0;
            
            // Un entitlement est valide s'il n'a pas de date d'expiration (lifetime) ou si elle est dans le futur
            const isActive = !e.expirationDate || exp > Date.now();
            if (!isActive) continue;

            if (normalizedId.includes('pro') || normalizedId.includes('premium')) {
                detectedTier = 'PRO';
                detectedExpiry = exp;
                break; // PRO est le plus haut niveau
            } else if (normalizedId.includes('plus')) {
                if (detectedTier !== 'PRO') {
                    detectedTier = 'PLUS';
                    detectedExpiry = exp;
                }
            }
        }

        const isMatched = (detectedTier === tier);
        const isUpgraded = (tier === 'PLUS' && detectedTier === 'PRO');

        if (isMatched || isUpgraded) {
          if (uid) lastActivationCache.set(uid, { tier: detectedTier, time: Date.now() });
          setCurrentSubscription(detectedTier);
          if (detectedExpiry) setCurrentSubscriptionExpiryMs(detectedExpiry);
          alert('Succès', `Félicitations ! Votre abonnement ${detectedTier} est maintenant actif.`);
          
          // On lance la synchro en arrière-plan sans bloquer
          void syncRevenueCatPurchases({ 
            maxAttempts: 5, 
            baseDelayMs: 2000,
            waitForTier: tier 
          }).catch(() => null);
          return;
        }

        // Si RevenueCat ne l'affiche pas encore dans customerInfo, on tente une synchro forcée mais plus longue
        showToast('Achat confirmé', "Activation de votre abonnement…", 'info');
        
        const r: any = await syncRevenueCatPurchases({ 
          maxAttempts: 6, // Un peu plus de tentatives pour être sûr
          baseDelayMs: 2000,
          waitForTier: tier 
        }).catch(() => null);

        const nextTier = r?.data?.subscription?.tier;
        const nextExpiry = r?.data?.subscription?.expiryMs;
        
        if (nextTier === 'PLUS' || nextTier === 'PRO') {
          if (uid) lastActivationCache.set(uid, { tier: nextTier, time: Date.now() });
          setCurrentSubscription(nextTier);
        } else if (nextTier === 'FREE') {
          // NE PAS écraser par FREE si on vient d'acheter (cache de 60s)
          const cached = uid ? lastActivationCache.get(uid) : null;
          const isRecentlyActivated = cached && (Date.now() - cached.time < 60000);
          if (!isRecentlyActivated) {
            setCurrentSubscription(nextTier);
          }
        }
        if (typeof nextExpiry === 'number') {
          setCurrentSubscriptionExpiryMs(nextExpiry);
        }

        if (nextTier === tier || (tier === 'PLUS' && nextTier === 'PRO')) {
          alert('Succès', `Félicitations ! Votre abonnement ${nextTier} est maintenant actif.`);
          return;
        }

        // Si après les tentatives c'est toujours pas à jour, on informe mais sans bloquer l'usage
        showToast('Activation différée', "Votre achat est confirmé. L'activation peut prendre quelques minutes.", 'warning');
      } catch (e: any) {
        alert('Erreur', e.message || "L'achat a échoué.");
      } finally {
        setLoading(false);
      }
    };

    if (hasActiveSubscription && currentSubscriptionExpiryMs > Date.now()) {
      const when = nextPeriodLabel(planId, duration);
      confirm(
        'Changer d’abonnement',
        `Votre abonnement ${currentSubscription} est actif jusqu'au ${dayjs(currentSubscriptionExpiryMs).format('DD/MM/YYYY')}.\n\nVoulez-vous passer à ${tier} ${when} ?`,
        () => { void executePurchase(); }
      );
      return;
    }

    await executePurchase();
  };

  const handlePurchasePins = async (amount: number, packId: string, price: string) => {
    if (loading) return;
    setLoading(true);
    try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const pack = findPackage(packId);
        if (!pack) {
            showToast('Produit introuvable', "Impossible de charger ce produit. Vérifie les produits App Store Connect et RevenueCat (identifiants).", 'error');
            return;
        }

        const success = await purchasePackage(pack);
        if (!success) return;

        setLoading(false);

        const r: any = await syncRevenueCatPurchases({ maxAttempts: 1, baseDelayMs: 0 }).catch(() => null);
        const granted = typeof r?.data?.grantedPins === 'number' ? r.data.grantedPins : null;
        if (typeof granted === 'number') {
          showToast('Succès', `${granted} pins ajoutés !`, 'success');
          return;
        }

        showToast('Achat confirmé', 'Ajout des pins en cours…', 'info');
        void syncRevenueCatPurchases({ maxAttempts: 3, baseDelayMs: 800 }).catch(() => null);
    } catch (e: any) {
        showToast('Erreur', e.message || "L'achat a échoué.", 'error');
    } finally {
        setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const info = await restorePurchases();
      setLoading(false);

      if (info) {
        const entitlements = info.entitlements.active;
        let detectedTier: SubscriptionTier = 'FREE';
        let detectedExpiry = 0;

        for (const [entId, e] of Object.entries(entitlements)) {
            const normalizedId = entId.toLowerCase();
            const exp = e.expirationDate ? new Date(e.expirationDate).getTime() : 0;
            
            // Un entitlement est valide s'il n'a pas de date d'expiration (lifetime) ou si elle est dans le futur
            const isActive = !e.expirationDate || exp > Date.now();
            if (!isActive) continue;

            if (normalizedId.includes('pro') || normalizedId.includes('premium')) {
                detectedTier = 'PRO';
                detectedExpiry = exp;
                break;
            } else if (normalizedId.includes('plus')) {
                if (detectedTier !== 'PRO') {
                    detectedTier = 'PLUS';
                    detectedExpiry = exp;
                }
            }
        }

        if (detectedTier !== 'FREE') {
            if (uid) lastActivationCache.set(uid, { tier: detectedTier, time: Date.now() });
            setCurrentSubscription(detectedTier);
            if (detectedExpiry) setCurrentSubscriptionExpiryMs(detectedExpiry);
            alert('Succès', `Vos achats ont été restaurés. Abonnement ${detectedTier} actif.`);
            // Synchro backend en arrière-plan
            void syncRevenueCatPurchases({ maxAttempts: 5, baseDelayMs: 2000 }).catch(() => null);
            return;
        }
      }

      const r: any = await syncRevenueCatPurchases({ maxAttempts: 5, baseDelayMs: 2000 }).catch(() => null);
      const hasActive = !!info?.entitlements?.active && Object.keys(info.entitlements.active || {}).length > 0;
      const tier = r?.data?.subscription?.tier;
      if (tier === 'PLUS' || tier === 'PRO') {
        if (uid) lastActivationCache.set(uid, { tier, time: Date.now() });
        setCurrentSubscription(tier);
        alert('Succès', `Vos achats ont été restaurés. Abonnement ${tier} actif.`);
        return;
      }
      if (hasActive) {
        alert('Restauré', "Achats restaurés. Synchronisation en cours…");
      } else {
        alert('Info', 'Aucun achat actif trouvé à restaurer.');
      }
      void syncRevenueCatPurchases({ maxAttempts: 5, baseDelayMs: 1500 }).catch(() => null);
    } catch (e: any) {
      alert('Erreur', e.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmPurchase = async (itemType: string, cost: number) => {
      if (loading) return;
      if (userCoins < cost) {
          alert('Pins insuffisants', 'Vous n\'avez pas assez de pins. Rechargez votre compte !');
          return;
      }
      
      alert(
          'Confirmer l\'achat',
          `Voulez-vous dépenser ${cost} Pins pour cet article ?`,
          [
              { text: 'Annuler', style: 'cancel' },
              { 
                  text: 'Confirmer', 
                  onPress: async () => {
                      setLoading(true);
                      try {
                          const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                          const buyItemFn = httpsCallable(functions, 'buyItemWithPins');
                          await buyItemFn({ itemType, requestId });
                          
                          showToast('Succès', 'Article acheté !', 'success');
                      } catch (e: any) {
                          showToast('Erreur', e.message || "Achat impossible.", 'error');
                      } finally {
                          setLoading(false);
                      }
                  }
              }
          ]
      );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 }}>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: C.text }}>Boutique</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 5 }}>
                <Ionicons name="close" size={28} color={C.text} />
            </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.panelBorder }}>
            <TouchableOpacity 
                onPress={() => setTab('subs')} 
                style={{ flex: 1, padding: 15, alignItems: 'center', borderBottomWidth: tab === 'subs' ? 2 : 0, borderBottomColor: C.warning }}
            >
                <Text style={{ color: tab === 'subs' ? C.text : C.subtleText, fontWeight: 'bold' }}>💎 PREMIUM</Text>
            </TouchableOpacity>
            <TouchableOpacity 
                onPress={() => setTab('coins')} 
                style={{ flex: 1, padding: 15, alignItems: 'center', borderBottomWidth: tab === 'coins' ? 2 : 0, borderBottomColor: C.warning }}
            >
                <Text style={{ color: tab === 'coins' ? C.text : C.subtleText, fontWeight: 'bold' }}>🪙 BOUTIQUE</Text>
            </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          {tab === 'subs' ? (
            <View style={{ gap: 20 }}>
              <View style={{ backgroundColor: C.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: hasActiveSubscription ? GOLD : C.panelBorder }}>
                <Text style={{ color: C.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Etat actuel</Text>
                <Text style={{ color: hasActiveSubscription ? GOLD : C.text, fontSize: 16, fontWeight: '800' }}>{activeSubscriptionLabel}</Text>
                <Text style={{ color: C.subtleText, fontSize: 13, marginTop: 6 }}>
                  {hasActiveSubscription
                    ? "Vous pouvez changer d'abonnement: le nouveau plan s'appliquera à la prochaine période de facturation."
                    : 'Choisissez un abonnement premium à activer.'}
                </Text>
              </View>
              
              {/* Frensy Plus */}
              <View style={{ backgroundColor: C.card, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.panelBorder }}>
                 <LinearGradient colors={[C.card, '#1a1a1a']} style={{ padding: 25 }}>
                    <View style={{ alignItems: 'center', marginBottom: 15 }}>
                        <Text style={{ color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: 1 }}>FRENSY</Text>
                        <LinearGradient colors={[C.tint, C.tintAlt]} start={{x:0,y:0}} end={{x:1,y:0}} style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginTop: 5 }}>
                           <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13, letterSpacing: 1 }}>PLUS</Text>
                        </LinearGradient>
                    </View>
                    
                    <View style={{ height: 1, backgroundColor: C.panelBorder, width: '100%', marginBottom: 20 }} />

                    <View style={{ gap: 12, marginBottom: 25 }}>
                        <FeatureRow text="3 Invitations / jour" />
                        <FeatureRow text="Filtres âge & intérêts précis" />
                        <FeatureRow text="Créer 1 groupe Discover / mois pour discuter" />
                        <FeatureRow text="1 Boost / semaine" />
                        <FeatureRow text="3 Undo / jour" />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 5 }}>
                            <View style={{ 
                                width: 32, height: 32, 
                                borderRadius: 16, 
                                backgroundColor: 'rgba(255, 255, 255, 0.1)', 
                                alignItems: 'center', justifyContent: 'center' 
                            }}>
                                <Text style={{ fontSize: 18 }}>🚫</Text>
                            </View>
                            <Text style={{ color: C.subtleText, fontSize: 15, fontWeight: 'bold' }}>Pas de Pub</Text>
                        </View>
                    </View>

                    <View style={{ gap: 12 }}>
                        {SUBSCRIPTION_PLANS.PLUS.map((p) => (
                            <TouchableOpacity 
                                key={p.id}
                                onPress={() => handlePurchaseSub('PLUS', p.id, p.label)}
                                activeOpacity={0.8}
                                disabled={loading}
                                style={{ 
                                    flexDirection: 'row', 
                                    justifyContent: 'space-between', 
                                    backgroundColor: 'rgba(255,255,255,0.05)', 
                                    padding: 14, 
                                    borderRadius: 14, 
                                    alignItems: 'center',
                                    borderWidth: 1,
                                    borderColor: hasActiveSubscription && currentSubscription === 'PLUS' ? C.tint : 'rgba(255,255,255,0.05)',
                                    opacity: loading ? 0.55 : 1
                                }}
                            >
                                <View>
                                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{p.label}</Text>
                                    {p.savings && <Text style={{ color: C.success, fontSize: 11, fontWeight: '600', marginTop: 1 }}>Eco {p.savings}</Text>}
                                    {hasActiveSubscription && currentSubscription === 'PLUS' && (
                                      <Text style={{ color: C.tint, fontSize: 11, fontWeight: '700', marginTop: 3 }}>Abonnement actif</Text>
                                    )}
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ color: C.text, fontSize: 16, fontWeight: 'bold' }}>{p.price} € / {p.durationMonths === 1 ? 'mois' : 'an'}</Text>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </View>
                 </LinearGradient>
              </View>

              {/* Frensy Pro */}
              <View style={{ backgroundColor: C.card, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: GOLD, marginTop: 10 }}>
                 <LinearGradient colors={['#2a220a', '#000']} style={{ padding: 25 }}>
                    <View style={{ alignItems: 'center', marginBottom: 15 }}>
                         <Text style={{ color: GOLD, fontSize: 32, fontWeight: '900', letterSpacing: 2, textShadowColor: 'rgba(255, 215, 0, 0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 }}>PRO</Text>
                         <Text style={{ color: C.muted, fontSize: 14, fontWeight: '600', letterSpacing: 2, marginTop: 5 }}>ULTIMATE STATUS</Text>
                    </View>

                    <View style={{ height: 1, backgroundColor: 'rgba(255, 215, 0, 0.3)', width: '100%', marginBottom: 20 }} />
                    
                    <View style={{ gap: 12, marginBottom: 25 }}>
                        <FeatureRow text="Invitations illimitées" gold />
                        <FeatureRow text="Filtres âge & intérêts précis" gold />
                        <FeatureRow text="Créer des groupes Discover illimités pour discuter" gold />
                        <FeatureRow text="Voir les profils interesses (photos)" gold />
                        <FeatureRow text="Undo illimité" gold />
                        <FeatureRow text="3 Boosts / semaine" />
                        <FeatureRow text="3 Super Invites / semaine" />
                        <FeatureRow text="Badge Pro Gold" gold />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 5 }}>
                            <View style={{ 
                                width: 32, height: 32, 
                                borderRadius: 16, 
                                backgroundColor: 'rgba(255, 255, 255, 0.1)', 
                                alignItems: 'center', justifyContent: 'center' 
                            }}>
                                <Text style={{ fontSize: 18 }}>🚫</Text>
                            </View>
                            <Text style={{ color: C.subtleText, fontSize: 15, fontWeight: 'bold' }}>Pas de Pub</Text>
                        </View>
                    </View>

                    <View style={{ gap: 12 }}>
                        {SUBSCRIPTION_PLANS.PRO.map((p) => (
                            <TouchableOpacity 
                                key={p.id}
                                onPress={() => handlePurchaseSub('PRO', p.id, p.label)}
                                activeOpacity={0.8}
                                disabled={loading}
                                style={{ 
                                    flexDirection: 'row', 
                                    justifyContent: 'space-between', 
                                    backgroundColor: GOLD, 
                                    padding: 14, 
                                    borderRadius: 14, 
                                    alignItems: 'center',
                                    shadowColor: GOLD,
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.2,
                                    shadowRadius: 8,
                                    elevation: 4,
                                    opacity: loading ? 0.55 : 1
                                }}
                            >
                                <View>
                                    <Text style={{ color: '#000', fontWeight: '800', fontSize: 15 }}>{p.label}</Text>
                                    {p.savings && <Text style={{ color: '#000', fontSize: 11, fontWeight: '700', marginTop: 1 }}>Eco {p.savings}</Text>}
                                    {hasActiveSubscription && currentSubscription === 'PRO' && (
                                      <Text style={{ color: '#000', fontSize: 11, fontWeight: '800', marginTop: 3 }}>Abonnement actif</Text>
                                    )}
                                </View>
                                <Text style={{ color: '#000', fontSize: 18, fontWeight: '900' }}>{p.price} € / {p.durationMonths === 1 ? 'mois' : 'an'}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                 </LinearGradient>
              </View>

              <View style={{ backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.panelBorder, gap: 10 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Abonnements automatiques</Text>
                <Text style={{ color: C.subtleText, fontSize: 13, lineHeight: 20 }}>
                  Frensy PLUS et Frensy PRO sont des abonnements à renouvellement automatique pour la durée affichée sur chaque offre (1 mois ou 1 an). Le prix facturé est celui indiqué sur le bouton. Le renouvellement peut être géré ou résilié dans les réglages du compte Apple (abonnements).
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => { void Linking.openURL(TERMS_URL); }}>
                    <Text style={{ color: C.tint, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' }}>Conditions d&apos;utilisation (EULA)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { void Linking.openURL(privacyPolicyUrl()); }}>
                    <Text style={{ color: C.tint, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' }}>Politique de confidentialité</Text>
                  </TouchableOpacity>
                </View>
              </View>

            </View>
          ) : (
            <View style={{ gap: 30 }}>
                {/* Solde */}
                <View style={{ alignItems: 'center', marginVertical: 10 }}>
                    <Text style={{ color: C.muted, fontSize: 14, marginBottom: 5 }}>MON SOLDE</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Image source={PINS_IMG} style={{ width: 32, height: 32, marginRight: 8 }} resizeMode="contain" />
                        <Text style={{ color: C.text, fontSize: 36, fontWeight: 'bold' }}>{userCoins}</Text>
                    </View>
                </View>

                {/* Section 0: Gagner des Pins (Nouveau) */}
                <View>
                    <Text style={{ color: C.text, fontSize: 18, fontWeight: 'bold', marginBottom: 15 }}>Gagner des Pins gratuitement</Text>
                    <View style={{ backgroundColor: C.card, borderRadius: 12, overflow: 'hidden' }}>
                        <EarnRow 
                            label="Partager mon profil" 
                            sub="Invitez vos amis à vous rejoindre"
                            reward="10"
                            icon="👤"
                            completed={isWeekCooldown(lastProfileSharedAt)}
                            completedLabel="Fait"
                            onPress={async () => {
                                if (isWeekCooldown(lastProfileSharedAt)) {
                                    showToast('Déjà fait', 'Revenez la semaine prochaine !', 'info');
                                    return;
                                }
                                const uid = auth.currentUser?.uid;
                                if (!uid) return;
                                try {
                                    await Share.share({
                                        message: `Rejoins-moi sur Frensy ! Voici mon profil : https://frensy.app/user/${uid}`,
                                    });
                                    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                                    const claimFn = httpsCallable(functions, 'claimEarnPins');
                                    const r: any = await claimFn({ type: 'share_profile', requestId });
                                    const granted = typeof r?.data?.grantedPins === 'number' ? r.data.grantedPins : 10;
                                    showToast('Succès', `${granted} Pins ajoutés !`, 'success');
                                } catch (error) {
                                    console.error(error);
                                }
                            }}
                        />
                         <EarnRow 
                            label="Partager l'application" 
                            sub="Faites connaître Frensy"
                            reward="5"
                            icon="📱"
                            completed={isDayCooldown(lastAppSharedAt)}
                            completedLabel="Fait"
                            onPress={async () => {
                                if (isDayCooldown(lastAppSharedAt)) {
                                    showToast('Déjà fait', 'Revenez demain !', 'info');
                                    return;
                                }
                                const uid = auth.currentUser?.uid;
                                if (!uid) return;
                                try {
                                    await Share.share({
                                        message: `Découvre Frensy, l'app pour se faire des potes ! https://frensy.app`,
                                    });
                                    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                                    const claimFn = httpsCallable(functions, 'claimEarnPins');
                                    const r: any = await claimFn({ type: 'share_app', requestId });
                                    const granted = typeof r?.data?.grantedPins === 'number' ? r.data.grantedPins : 5;
                                    showToast('Succès', `${granted} Pins ajoutés !`, 'success');
                                } catch (error) {
                                    console.error(error);
                                }
                            }}
                        />
                         <EarnRow 
                            label="Créer une vidéo TikTok/Reels" 
                            sub="Gagnez jusqu'à 500 Pins !"
                            reward="500+"
                            icon="🎥"
                            onPress={() => {
                                alert(
                                    'Créateur de contenu',
                                    'Fais une vidéo sur Frensy (TikTok, Insta, YouTube) et envoie-nous le lien pour recevoir tes Pins !',
                                    [
                                        { text: 'Annuler', style: 'cancel' },
                                        { text: 'Envoyer le lien', onPress: () => Linking.openURL('mailto:support@frensy.app?subject=Ma vidéo Frensy&body=Voici le lien de ma vidéo : ') }
                                    ]
                                );
                            }}
                        />
                    </View>
                </View>

                {/* Section 1: Acheter des Pins */}
                <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                        <Text style={{ color: C.text, fontSize: 18, fontWeight: 'bold' }}>Recharger mes Pins</Text>
                        <TouchableOpacity 
                            onPress={handleDailyReward}
                            disabled={isDailyRewardClaimed}
                            style={{ 
                                backgroundColor: isDailyRewardClaimed ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 215, 0, 0.1)', 
                                paddingHorizontal: 12, 
                                paddingVertical: 6, 
                                borderRadius: 20, 
                                borderWidth: 1, 
                                borderColor: isDailyRewardClaimed ? 'rgba(255, 255, 255, 0.2)' : GOLD,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6
                            }}
                        >
                            <Text style={{ fontSize: 12 }}>{isDailyRewardClaimed ? '✅' : '🎁'}</Text>
                            <Text style={{ color: isDailyRewardClaimed ? C.subtleText : GOLD, fontSize: 12, fontWeight: 'bold' }}>
                                {isDailyRewardClaimed ? 'Cadeau récupéré' : 'Cadeau'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        {COIN_PACKS.map((pack, index) => {
                            const isLast = index === COIN_PACKS.length - 1;
                            const isOdd = COIN_PACKS.length % 2 !== 0;
                            const isFullWidth = isLast && isOdd;

                            return (
                            <TouchableOpacity 
                                key={pack.id}
                                onPress={() => handlePurchasePins(pack.amount, pack.id, pack.price.toString())}
                                style={{ 
                                    width: isFullWidth ? '100%' : '48%', 
                                    backgroundColor: C.card, 
                                    padding: 15, 
                                    borderRadius: 12, 
                                    borderWidth: pack.popular || pack.bestValue ? 1 : 0,
                                    borderColor: pack.popular ? ACCENT : (pack.bestValue ? GOLD : 'transparent'),
                                    alignItems: 'center',
                                    flexDirection: isFullWidth ? 'row' : 'column',
                                    justifyContent: isFullWidth ? 'space-between' : 'center',
                                    paddingHorizontal: isFullWidth ? 24 : 15
                                }}
                            >
                                {isFullWidth ? (
                                    <>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                            <Image source={PINS_IMG} style={{ width: 48, height: 48 }} resizeMode="contain" />
                                            <View>
                                                <Text style={{ color: C.text, fontSize: 20, fontWeight: 'bold' }}>{pack.amount} Pins</Text>
                                                {pack.popular && <Text style={{ color: ACCENT, fontSize: 12, fontWeight: 'bold' }}>POPULAIRE</Text>}
                                                {pack.bestValue && <Text style={{ color: GOLD, fontSize: 12, fontWeight: 'bold' }}>MEILLEURE OFFRE</Text>}
                                            </View>
                                        </View>
                                        <View style={{ backgroundColor: C.panel, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}>
                                            <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 16 }}>{pack.price} €</Text>
                                        </View>
                                    </>
                                ) : (
                                    <>
                                        {pack.popular && <Text style={{ color: ACCENT, fontSize: 10, fontWeight: 'bold', marginBottom: 5 }}>POPULAIRE</Text>}
                                        {pack.bestValue && <Text style={{ color: GOLD, fontSize: 10, fontWeight: 'bold', marginBottom: 5 }}>MEILLEURE OFFRE</Text>}
                                        
                                        <Image source={PINS_IMG} style={{ width: 40, height: 40, marginBottom: 10 }} resizeMode="contain" />
                                        <Text style={{ color: C.text, fontSize: 18, fontWeight: 'bold' }}>{pack.amount}</Text>
                                        <Text style={{ color: C.muted, fontSize: 12, marginBottom: 10 }}>Pins</Text>
                                        
                                        <View style={{ backgroundColor: C.panel, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}>
                                            <Text style={{ color: C.text, fontWeight: 'bold' }}>{pack.price} €</Text>
                                        </View>
                                    </>
                                )}
                            </TouchableOpacity>
                        )})}
                    </View>
                </View>

                {/* Utiliser mes Pins */}
                <View style={{ marginTop: 30 }}>
                     <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
                         <Text style={{ fontSize: 18, fontWeight: 'bold', color: C.text, flex: 1 }}>Utiliser mes Pins</Text>
                     </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20, gap: 12 }}>
                        <PriceCard 
                            label="Booster mon profil" 
                            cost={FEATURE_COSTS.BOOST} 
                            icon="🚀" 
                            onPress={() => setSelectedFeature('BOOST')}
                        />
                        <PriceCard 
                            label="Super Invite" 
                            cost={FEATURE_COSTS.SUPER_INVITE} 
                            icon="💌" 
                            onPress={() => setSelectedFeature('SUPER_INVITE')}
                        />
                        <PriceCard 
                            label="Reveler un interet" 
                            cost={FEATURE_COSTS.UNLOCK_LIKE} 
                            icon="👁️" 
                            onPress={() => setSelectedFeature('UNLOCK_LIKE')}
                        />
                        <PriceCard 
                            label="Invitation"
                            cost={FEATURE_COSTS.INVITE}
                            icon="✉️"
                            onPress={() => setSelectedFeature('INVITE')}
                        />
                        <PriceCard 
                            label="Envoi de photo" 
                            cost={FEATURE_COSTS.SEND_PHOTO} 
                            icon="📸" 
                            onPress={() => alert('Envoi de photo', 'Permet d\'envoyer une photo dans une conversation.')}
                        />
                        <PriceCard 
                            label="Annuler un swipe" 
                            cost={FEATURE_COSTS.UNDO} 
                            icon="↩️" 
                            onPress={() => setSelectedFeature('UNDO')}
                        />
                    </ScrollView>
                </View>


            </View>
          )}

          {/* Footer Legal & Restore */}
            <View style={{ marginTop: 40, alignItems: 'center', gap: 15, paddingBottom: 40 }}>
             <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 16 }}>
                Les abonnements se renouvellent automatiquement sauf annulation au moins 24h avant la fin de la période en cours. La gestion et l’annulation se font dans les réglages de votre App Store.
             </Text>
             <TouchableOpacity onPress={handleRestore} style={{ padding: 10 }}>
                <Text style={{ color: C.muted, textDecorationLine: 'underline' }}>Restaurer les achats</Text>
             </TouchableOpacity>
             
             <View style={{ flexDirection: 'row', gap: 20 }}>
                <TouchableOpacity onPress={() => Linking.openURL('https://frensyapp-dev.github.io/frensy/terms.html')}>
                    <Text style={{ color: C.subtleText, fontSize: 12 }}>Conditions Générales</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL('https://frensyapp-dev.github.io/frensy/privacy.html')}>
                    <Text style={{ color: C.subtleText, fontSize: 12 }}>Politique de Confidentialité</Text>
                </TouchableOpacity>
             </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal 
        visible={!!selectedFeature} 
        transparent 
        animationType="fade"
        onRequestClose={() => setSelectedFeature(null)}
      >
        <Pressable 
            style={StyleSheet.absoluteFill} 
            onPress={() => setSelectedFeature(null)}
        >
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, backgroundColor: C.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: C.panelBorder }}>
                    {selectedFeature && FEATURES_CONFIG[selectedFeature] && (
                        <>
                            <View style={{ alignItems: 'center', marginBottom: 20 }}>
                                <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }}>
                                    <Text style={{ fontSize: 30 }}>{FEATURES_CONFIG[selectedFeature].icon}</Text>
                                </View>
                                <Text style={{ color: C.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center' }}>
                                    {FEATURES_CONFIG[selectedFeature].title}
                                </Text>
                                <Text style={{ color: C.subtleText, textAlign: 'center', marginTop: 8, fontSize: 14 }}>
                                    {FEATURES_CONFIG[selectedFeature].description}
                                </Text>
                            </View>

                            <View style={{ gap: 12 }}>
                                {FEATURES_CONFIG[selectedFeature].packs.map((pack: any) => (
                                    <TouchableOpacity
                                        key={pack.id}
                                        onPress={() => {
                                            setSelectedFeature(null);
                                            confirmPurchase(pack.id, pack.price);
                                        }}
                                        style={{ 
                                            flexDirection: 'row', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            backgroundColor: C.panel,
                                            padding: 16,
                                            borderRadius: 16,
                                            borderWidth: 1,
                                            borderColor: pack.tag ? ACCENT : 'transparent'
                                        }}
                                    >
                                        <View>
                                            {pack.tag && (
                                                <Text style={{ color: ACCENT, fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>
                                                    {pack.tag} {pack.savings && `- ECO ${pack.savings}`}
                                                </Text>
                                            )}
                                            <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 16 }}>{pack.label}</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}>
                                            <Text style={{ color: C.text, fontWeight: 'bold' }}>{pack.price}</Text>
                                            <Image source={PINS_IMG} style={{ width: 14, height: 14 }} resizeMode="contain" />
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <TouchableOpacity 
                                onPress={() => setSelectedFeature(null)}
                                style={{ marginTop: 20, alignItems: 'center', padding: 10 }}
                            >
                                <Text style={{ color: C.subtleText, fontWeight: '600' }}>Annuler</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </Pressable>
            </View>
        </Pressable>
      </Modal>

      {loading && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={ACCENT} />
        </View>
      )}
    </View>
  );
}

function FeatureRow({ text, gold }: { text: string, gold?: boolean }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ 
                width: 24, height: 24, 
                borderRadius: 12, 
                backgroundColor: gold ? 'rgba(255, 215, 0, 0.2)' : 'rgba(249, 115, 22, 0.2)', 
                alignItems: 'center', justifyContent: 'center' 
            }}>
                <Ionicons name="checkmark" size={14} color={gold ? GOLD : ACCENT} style={{ fontWeight: 'bold' }} />
            </View>
            <Text style={{ color: C.subtleText, fontSize: 15, fontWeight: '500' }}>{text}</Text>
        </View>
    );
}

function EarnRow({ label, sub, reward, icon, onPress, completed, completedLabel = 'Fait' }: { label: string, sub: string, reward: string, icon: string, onPress: () => void, completed?: boolean, completedLabel?: string }) {
    return (
        <TouchableOpacity 
            onPress={onPress}
            activeOpacity={0.7}
            disabled={completed}
            style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                padding: 15, 
                borderBottomWidth: 1, 
                borderBottomColor: 'rgba(255,255,255,0.05)',
                opacity: completed ? 0.6 : 1
            }}
        >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(249, 115, 22, 0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 15 }}>
                <Text style={{ fontSize: 20 }}>{icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 16 }}>{label}</Text>
                <Text style={{ color: C.subtleText, fontSize: 12 }}>{completed ? completedLabel : sub}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
                {completed ? (
                    <View style={{ backgroundColor: 'rgba(22, 163, 74, 0.2)', padding: 6, borderRadius: 20 }}>
                        <Ionicons name="checkmark-circle" size={24} color={C.success} />
                    </View>
                ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 215, 0, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
                        <Text style={{ color: GOLD, fontWeight: 'bold', fontSize: 14 }}>+{reward}</Text>
                        <Image source={PINS_IMG} style={{ width: 14, height: 14, marginLeft: 4 }} resizeMode="contain" />
                    </View>
                )}
            </View>
        </TouchableOpacity>
    );
}

function PriceCard({ label, cost, icon, onPress }: { label: string, cost: number, icon: string, onPress?: () => void }) {
    return (
        <TouchableOpacity 
            onPress={onPress}
            activeOpacity={0.7}
            style={{ 
                width: 130,
                height: 150,
                backgroundColor: C.card, 
                borderRadius: 16, 
                padding: 12, 
                justifyContent: 'space-between',
                borderWidth: 1, 
                borderColor: C.panelBorder,
            }}
        >
             <View style={{ alignItems: 'flex-start' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                    <Text style={{ fontSize: 18 }}>{icon}</Text>
                </View>
                <Text style={{ color: C.text, fontSize: 13, fontWeight: 'bold', lineHeight: 18 }} numberOfLines={2}>{label}</Text>
            </View>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.panel, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 }}>
                <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 13 }}>{cost}</Text>
                <Image source={PINS_IMG} style={{ width: 12, height: 12 }} resizeMode="contain" />
            </View>
        </TouchableOpacity>
    );
}

function PriceRow({ label, cost, icon, onPress }: { label: string, cost: number, icon: string, onPress?: () => void }) {
    const Container = onPress ? TouchableOpacity : View;
    return (
        <Container 
            onPress={onPress}
            activeOpacity={onPress ? 0.7 : 1}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.panelBorder }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 16 }}>{icon}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: C.subtleText, fontSize: 14, fontWeight: '500' }}>{label}</Text>
                    {onPress && <Ionicons name="information-circle-outline" size={16} color={C.subtleText} />}
                </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 16 }}>{cost}</Text>
                <Image source={PINS_IMG} style={{ width: 16, height: 16 }} resizeMode="contain" />
            </View>
        </Container>
    );
}
