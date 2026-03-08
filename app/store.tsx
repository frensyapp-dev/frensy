import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PurchasesPackage } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '../components/ui/Toast';
import { Colors } from '../constants/Colors';
import { auth, functions } from '../firebaseconfig';
import { COIN_PACKS, FEATURE_COSTS, SUBSCRIPTION_PLANS } from '../lib/monetization';
import { userDocRef, userPrivateRef } from '../lib/profile';
import { getOfferings, initRevenueCat, purchasePackage, restorePurchases } from '../lib/revenuecat';

const PINS_IMG = require('../assets/images/pins2.png');

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
  const params = useLocalSearchParams();
  const [, tarSetClaiming] = useState(false);
  const [streak, setStreak] = useState(0);
  const [lastClaimDate, setLastClaimDate] = useState<dayjs.Dayjs | null>(null);
  
  const [isDirectStoreAccess, setIsDirectStoreAccess] = useState(!!(params.tab || params.openStore));

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
    if (!uid) return;

    let hasPrivatePins = false;

    const unsubPrivate = onSnapshot(userPrivateRef(uid), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            if (typeof d.pins === 'number') {
                setUserCoins(d.pins);
                hasPrivatePins = true;
            }
        }
    });

    const unsubPublic = onSnapshot(userDocRef(uid), (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        
        // Fallback to public pins if not yet found in private
        if (!hasPrivatePins && typeof d.pins === 'number') {
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
  }, []);

  const isClaimable = () => {
    if (!lastClaimDate) return true;
    const now = dayjs();
    return !now.isSame(lastClaimDate, 'day');
  };

  const getNextDay = () => {
    return (streak % 7) + 1;
  };

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
      // Rollback si échec
      setStreak(prev.streak);
      setLastClaimDate(prev.lastClaimDate);
      setUserCoins(prev.userCoins);
      Alert.alert('Erreur', e.message || "Impossible de récupérer la récompense.");
    } finally {
      setClaiming(false);
    }
  };

  const shouldShowStoreOnly = isDirectStoreAccess || !isClaimable();

  const handleClose = () => {
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

  // If accessed directly via params (e.g. from Profile > Pins), render ONLY the store
  if (shouldShowStoreOnly) {
      return (
        <View style={{ flex: 1, backgroundColor: C.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <StoreModalContent 
                onClose={handleClose} 
                initialTab={params.tab as any}
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
               <Text style={{ color: C.subtleText, textDecorationLine: 'underline', fontWeight: '500' }}>Retour au profil</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </SafeAreaView>

      <Modal visible={showStore} animationType="slide" presentationStyle="pageSheet">
         <StoreModalContent 
            onClose={() => setShowStore(false)} 
            initialTab={params.tab as any} 
            onBalanceUpdate={setUserCoins}
         />
      </Modal>
    </View>
  );
}

function StoreModalContent({ onClose, initialTab, onBalanceUpdate }: { onClose: () => void, initialTab?: 'subs' | 'coins', onBalanceUpdate?: (val: number) => void }) {
  const [tab, setTab] = useState<'subs' | 'coins'>(initialTab || 'subs');
  const [loading, setLoading] = useState(false);
  const [userCoins, setUserCoins] = useState(0);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const { showToast } = useToast();

  const handleDailyReward = () => {
    onClose(); // Ferme la modal Store
    // Si on est déjà sur la page principale /store, pas besoin de push.
    // Mais ici StoreModalContent est souvent utilisé dans DailyRewardScreen.
    // Si on veut "revenir" à l'écran cadeau journalier (qui est le parent), il suffit de fermer la modal.
    
    // CAS 1: On est dans DailyRewardScreen et on a ouvert la modal Store
    // -> onClose() suffit pour révéler le cadeau journalier en dessous.
    
    // CAS 2: On est venu directement sur la modal Store (via un lien profond ou autre)
    // -> On veut aller sur l'écran DailyRewardScreen complet.
    
    setTimeout(() => {
        // On force la navigation vers la route principale du store (qui EST l'écran cadeau)
        // en resetant les params pour être sûr d'afficher le cadeau et pas juste le store
        router.push({ pathname: '/store', params: { openStore: undefined, tab: undefined } });
    }, 100);
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // Listen to realtime updates for pins
    let hasPrivatePins = false;
    
    const unsubPrivate = onSnapshot(userPrivateRef(uid), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            if (typeof d.pins === 'number') {
                const val = d.pins;
                setUserCoins(val);
                if (onBalanceUpdate) onBalanceUpdate(val);
                hasPrivatePins = true;
            }
        }
    });

    const unsubPublic = onSnapshot(userDocRef(uid), (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();
            if (!hasPrivatePins && typeof d.pins === 'number') {
                const val = d.pins;
                setUserCoins(val);
                if (onBalanceUpdate) onBalanceUpdate(val);
            }
        }
    });

    initStore();

    return () => {
        unsubPublic();
        unsubPrivate();
    };
  }, [onBalanceUpdate]);

  const initStore = async () => {
    await initRevenueCat();
    const offerings = await getOfferings();
    if (offerings && offerings.availablePackages) {
      setPackages(offerings.availablePackages);
    }
  };

  const findPackage = (identifier: string) => {
    return packages.find(p => p.identifier === identifier || p.product.identifier === identifier);
  };

  const handlePurchaseSub = async (tier: string, planId: string, duration: string) => {
    setLoading(true);
    try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const pack = findPackage(planId);
        // Mocking real purchase for now if pack not found
        const success = pack ? await purchasePackage(pack) : true;
        
        if (success) {
            const processPurchaseFn = httpsCallable(functions, 'processPurchase');
            await processPurchaseFn({ type: 'subscription', itemId: planId });
            
            Alert.alert('Félicitations !', `Vous êtes maintenant abonné à ${tier} (${duration}).`);
        }
    } catch (e: any) {
        Alert.alert('Erreur', e.message || "L'achat a échoué.");
    } finally {
        setLoading(false);
    }
  };

  const handlePurchasePins = async (amount: number, packId: string, price: string) => {
    setLoading(true);
    try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const pack = findPackage(packId);
        const success = pack ? !!(await purchasePackage(pack)) : true; // Fallback test/dev: traiter comme succès

        if (success) {
             const processPurchaseFn = httpsCallable(functions, 'processPurchase');
             await processPurchaseFn({ type: 'pins', itemId: packId });
             
             showToast('Succès', `${amount} pins ajoutés !`, 'success');
        } else {
             // Cancelled or failed
        }
    } catch (e: any) {
        showToast('Erreur', e.message || "L'achat a échoué.", 'error');
    } finally {
        setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      const info = await restorePurchases();
      if (info?.entitlements.active) {
         Alert.alert('Succès', 'Vos achats ont été restaurés.');
         // TODO: Sync with your backend if needed
      } else {
         Alert.alert('Info', 'Aucun achat actif trouvé à restaurer.');
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmPurchase = async (itemType: string, cost: number) => {
      if (userCoins < cost) {
          Alert.alert('Pins insuffisants', 'Vous n\'avez pas assez de pins. Rechargez votre compte !');
          return;
      }
      
      Alert.alert(
          'Confirmer l\'achat',
          `Voulez-vous dépenser ${cost} Pins pour cet article ?`,
          [
              { text: 'Annuler', style: 'cancel' },
              { 
                  text: 'Confirmer', 
                  onPress: async () => {
                      setLoading(true);
                      try {
                          const processPurchaseFn = httpsCallable(functions, 'processPurchase');
                          // On utilise un type spécial 'spend_pins' ou on adapte processPurchase pour gérer les dépenses côté serveur
                          // MAIS pour l'instant, le client gère la dépense via performActionUpdates ou similaire ?
                          // NON, processPurchase sert à créditer.
                          // Pour dépenser, on doit appeler une fonction qui décrémente et ajoute l'item.
                          
                          // TODO: Créer une fonction Cloud 'buyItemWithPins' pour sécuriser ça.
                          // Pour l'instant, on simule en local ou on appelle une fonction générique.
                          
                          // Solution rapide : on appelle une nouvelle fonction buyItem
                          const buyItemFn = httpsCallable(functions, 'buyItemWithPins');
                          await buyItemFn({ itemType, cost });
                          
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
                                style={{ 
                                    flexDirection: 'row', 
                                    justifyContent: 'space-between', 
                                    backgroundColor: 'rgba(255,255,255,0.05)', 
                                    padding: 18, 
                                    borderRadius: 16, 
                                    alignItems: 'center',
                                    borderWidth: 1,
                                    borderColor: 'rgba(255,255,255,0.05)'
                                }}
                            >
                                <View>
                                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }}>{p.label}</Text>
                                    {p.savings && <Text style={{ color: C.success, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Eco {p.savings}</Text>}
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ color: C.text, fontSize: 18, fontWeight: 'bold' }}>{p.price} €</Text>
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
                        <FeatureRow text="Voir qui t&apos;a liké (photos)" gold />
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
                                style={{ 
                                    flexDirection: 'row', 
                                    justifyContent: 'space-between', 
                                    backgroundColor: GOLD, 
                                    padding: 18, 
                                    borderRadius: 16, 
                                    alignItems: 'center',
                                    shadowColor: GOLD,
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.2,
                                    shadowRadius: 8,
                                    elevation: 4
                                }}
                            >
                                <View>
                                    <Text style={{ color: '#000', fontWeight: '800', fontSize: 16 }}>{p.label}</Text>
                                    {p.savings && <Text style={{ color: '#000', fontSize: 12, fontWeight: '700', marginTop: 2 }}>Eco {p.savings}</Text>}
                                </View>
                                <Text style={{ color: '#000', fontSize: 20, fontWeight: '900' }}>{p.price} €</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                 </LinearGradient>
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

                {/* Section 1: Acheter des Pins */}
                <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                        <Text style={{ color: C.text, fontSize: 18, fontWeight: 'bold' }}>Recharger mes Pins</Text>
                        <TouchableOpacity 
                            onPress={handleDailyReward}
                            style={{ 
                                backgroundColor: 'rgba(255, 215, 0, 0.1)', 
                                paddingHorizontal: 12, 
                                paddingVertical: 6, 
                                borderRadius: 20, 
                                borderWidth: 1, 
                                borderColor: GOLD,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6
                            }}
                        >
                            <Text style={{ fontSize: 12 }}>🎁</Text>
                            <Text style={{ color: GOLD, fontSize: 12, fontWeight: 'bold' }}>Cadeau</Text>
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
                <View style={{ backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.panelBorder, marginTop: 30 }}>
                     <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                         <Text style={{ fontSize: 18, fontWeight: 'bold', color: C.text, flex: 1 }}>Utiliser mes Pins</Text>
                         <View style={{ backgroundColor: C.panel, padding: 6, borderRadius: 8 }}>
                             <Image source={PINS_IMG} style={{ width: 16, height: 16 }} resizeMode="contain" />
                         </View>
                     </View>
                    <View style={{ gap: 12 }}>
                        <PriceRow 
                            label="Booster mon profil (10 min)" 
                            cost={FEATURE_COSTS.BOOST} 
                            icon="🚀" 
                            onPress={() => {
                                Alert.alert(
                                    'Booster mon profil', 
                                    'Choisissez un pack :',
                                    [
                                        { text: 'Annuler', style: 'cancel' },
                                        { text: `1 Boost (${FEATURE_COSTS.BOOST} Pins)`, onPress: () => confirmPurchase('BOOST', FEATURE_COSTS.BOOST) },
                                        { text: `5 Boosts (${FEATURE_COSTS.BOOST_BUNDLE_5} Pins)`, onPress: () => confirmPurchase('BOOST_BUNDLE_5', FEATURE_COSTS.BOOST_BUNDLE_5) },
                                    ]
                                );
                            }}
                        />
                        <PriceRow 
                            label="Super Invite" 
                            cost={FEATURE_COSTS.SUPER_INVITE} 
                            icon="💌" 
                            onPress={() => {
                                Alert.alert(
                                    'Super Invite', 
                                    'Choisissez un pack :',
                                    [
                                        { text: 'Annuler', style: 'cancel' },
                                        { text: `1 Super Invite (${FEATURE_COSTS.SUPER_INVITE} Pins)`, onPress: () => confirmPurchase('SUPER_INVITE', FEATURE_COSTS.SUPER_INVITE) },
                                        { text: `5 Super Invites (${FEATURE_COSTS.SUPER_INVITE_BUNDLE_5} Pins)`, onPress: () => confirmPurchase('SUPER_INVITE_BUNDLE_5', FEATURE_COSTS.SUPER_INVITE_BUNDLE_5) },
                                        { text: `15 Super Invites (${FEATURE_COSTS.SUPER_INVITE_BUNDLE_15} Pins)`, onPress: () => confirmPurchase('SUPER_INVITE_BUNDLE_15', FEATURE_COSTS.SUPER_INVITE_BUNDLE_15) },
                                    ]
                                );
                            }}
                        />
                        <PriceRow 
                            label="Révéler un like" 
                            cost={FEATURE_COSTS.UNLOCK_LIKE} 
                            icon="👁️" 
                            onPress={() => {
                                Alert.alert(
                                    'Révéler un like', 
                                    'Choisissez un pack :',
                                    [
                                        { text: 'Annuler', style: 'cancel' },
                                        { text: `1 Révélation (${FEATURE_COSTS.UNLOCK_LIKE} Pins)`, onPress: () => confirmPurchase('UNLOCK_LIKE', FEATURE_COSTS.UNLOCK_LIKE) },
                                        { text: `10 Révélations (${FEATURE_COSTS.UNLOCK_LIKE_BUNDLE_10} Pins)`, onPress: () => confirmPurchase('UNLOCK_LIKE_BUNDLE_10', FEATURE_COSTS.UNLOCK_LIKE_BUNDLE_10) },
                                    ]
                                );
                            }}
                        />
                        <PriceRow 
                            label="Envoi de photo" 
                            cost={FEATURE_COSTS.SEND_PHOTO} 
                            icon="📸" 
                            onPress={() => Alert.alert('Envoi de photo', 'Permet d\'envoyer une photo dans une conversation.')}
                        />
                        <PriceRow 
                            label="Invitation"
                            cost={FEATURE_COSTS.INVITE}
                            icon="💌"
                            onPress={() => {
                                Alert.alert(
                                    'Acheter des invitations',
                                    'Choisissez un pack :',
                                    [
                                        { text: 'Annuler', style: 'cancel' },
                                        { text: `1 Invitation (${FEATURE_COSTS.INVITE} Pins)`, onPress: () => confirmPurchase('INVITE', FEATURE_COSTS.INVITE) },
                                        { text: `5 Invitations (${FEATURE_COSTS.INVITE_BUNDLE_5} Pins)`, onPress: () => confirmPurchase('INVITE_BUNDLE_5', FEATURE_COSTS.INVITE_BUNDLE_5) },
                                        { text: `15 Invitations (${FEATURE_COSTS.INVITE_BUNDLE_15} Pins)`, onPress: () => confirmPurchase('INVITE_BUNDLE_15', FEATURE_COSTS.INVITE_BUNDLE_15) },
                                    ]
                                );
                            }}
                        />
                        <PriceRow 
                            label="Annuler un swipe (Undo)" 
                            cost={FEATURE_COSTS.UNDO} 
                            icon="↩️" 
                            onPress={() => Alert.alert('Annuler un swipe', 'Revenez en arrière sur votre dernier swipe à gauche.')}
                        />
                    </View>
                </View>


            </View>
          )}

          {/* Footer Legal & Restore */}
            <View style={{ marginTop: 40, alignItems: 'center', gap: 15, paddingBottom: 40 }}>
             <TouchableOpacity onPress={handleRestore} style={{ padding: 10 }}>
                <Text style={{ color: C.muted, textDecorationLine: 'underline' }}>Restaurer les achats</Text>
             </TouchableOpacity>
             
             <View style={{ flexDirection: 'row', gap: 20 }}>
                <TouchableOpacity onPress={() => router.push('/legal/terms')}>
                    <Text style={{ color: C.subtleText, fontSize: 12 }}>Conditions Générales</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/legal/privacy')}>
                    <Text style={{ color: C.subtleText, fontSize: 12 }}>Politique de Confidentialité</Text>
                </TouchableOpacity>
             </View>
          </View>
        </ScrollView>
      </SafeAreaView>

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
