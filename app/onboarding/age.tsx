import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Dimensions, FlatList, NativeScrollEvent, NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';
import { GradientButton } from '../../components/ui/GradientButton';
import { Colors } from '../../constants/Colors';
import { auth } from '../../firebaseconfig';
import { getUserProfile, savePartialProfile } from '../../lib/profile';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const isSmallDevice = SCREEN_H < 750;
const ITEM_HEIGHT = 60;
const AGES = Array.from({ length: 82 }, (_, i) => i + 18); // 18 to 99

export default function AgeStep() {
  const [accountType, setAccountType] = useState<'individual' | 'group'>('individual');
  const [sending, setSending] = useState(false);
  const [age, setAge] = useState(18);
  const C = Colors['dark'];
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    const loadProfile = async () => {
        const uid = auth.currentUser?.uid;
        if (uid) {
            const profile = await getUserProfile(uid);
            if (profile?.accountType) {
                setAccountType(profile.accountType);
            }
            if (typeof profile?.age === 'number' && profile.age >= 18) {
                const initialAge = profile.age;
                setAge(initialAge);
                setTimeout(() => {
                  flatListRef.current?.scrollToOffset({
                    offset: (initialAge - 18) * ITEM_HEIGHT,
                    animated: false
                  });
                }, 100);
            }
        }
    }
    loadProfile();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const newAge = AGES[index];
    if (newAge && newAge !== age) {
      setAge(newAge);
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch {}
    }
  };

  const next = async () => {
    if (age < 18 || age > 99) {
      Alert.alert('Age invalide', 'Renseigne un age valide entre 18 et 99 ans.');
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      setSending(true);
      const prof = await getUserProfile(uid).catch(() => null);
      const patch: any = {
        age: age,
        ageLock: 'adult',
        birthDate: null,
        birthday: null,
      };
      if (typeof prof?.desiredMinAge !== 'number') patch.desiredMinAge = Math.max(18, age - 1);
      if (typeof prof?.desiredMaxAge !== 'number') patch.desiredMaxAge = age + 1;
      await savePartialProfile(uid, patch);
      router.replace('/onboarding/preferences'); 
    } catch (e: any) {
      const msg = e?.message || String(e);
      const isPerm = /permission/i.test(msg) || /PERMISSION_DENIED/i.test(msg);
      Alert.alert(
        'Erreur',
        isPerm
          ? "Impossible d'enregistrer l'age pour le moment. Verifie les autorisations et reessaie."
          : 'Une erreur est survenue. Réessaie dans un instant.'
      );
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: number }) => {
    const isSelected = item === age;
    return (
      <View style={[s.ageItem, { height: ITEM_HEIGHT }]}>
        <Text style={[s.ageText, { 
          color: isSelected ? C.tint : 'rgba(255,255,255,0.3)',
          fontSize: isSelected ? 32 : 24,
          fontWeight: isSelected ? '900' : '600'
        }]}>
          {item}
        </Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <LinearGradient colors={['#000000', '#111827']} style={{ flex: 1 }}>
        <View style={s.container}>
          <View style={s.glow} />

          <View style={s.content}>
            <Text style={s.stepIndicator}>Étape 3 sur 5</Text>
            <Text style={s.title}>
              {accountType === 'group' ? "Age du createur" : "Ton age"}
            </Text>
            <Text style={s.subtitle}>
              {accountType === 'group'
                ? "Le createur du groupe doit etre majeur."
                : "Frensy est reserve aux personnes majeures (18+)."}
            </Text>
            
            <View style={s.pickerContainer}>
              <View style={s.selectionFrame} />
              <FlatList
                ref={flatListRef}
                data={AGES}
                keyExtractor={(i) => String(i)}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_HEIGHT}
                decelerationRate="fast"
                onScroll={onScroll}
                scrollEventThrottle={16}
                contentContainerStyle={{
                  paddingVertical: ITEM_HEIGHT * 2
                }}
              />
            </View>

            <View style={s.helperCard}>
              <Text style={s.helperText}>
                L&apos;age est définitif et ne pourra plus être modifié par la suite pour des raisons de sécurité.
              </Text>
            </View>
          </View>

          <View style={s.footer}>
            <GradientButton label={sending ? "Enregistrement..." : "Continuer"} onPress={next} disabled={sending} />
          </View>
        </View>
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  container: { 
    flex: 1, 
    paddingHorizontal: 24, 
    paddingTop: isSmallDevice ? 40 : 60, 
    paddingBottom: 40,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  glow: { position: 'absolute', top: 100, left: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(249, 115, 22, 0.1)' },
  content: { flex: 1, justifyContent: 'center' },
  stepIndicator: { color: '#F97316', fontWeight: '700', fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: isSmallDevice ? 32 : 40, fontWeight: '900', color: '#fff', marginBottom: 12, lineHeight: isSmallDevice ? 36 : 44 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: isSmallDevice ? 20 : 40, lineHeight: 24 },
  
  pickerContainer: {
    height: ITEM_HEIGHT * 5,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: isSmallDevice ? 20 : 40,
  },
  selectionFrame: {
    position: 'absolute',
    height: ITEM_HEIGHT,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  ageItem: {
    width: SCREEN_W - 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ageText: { textAlign: 'center' },
  helperCard: {
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  helperText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  footer: { width: '100%' },
});
