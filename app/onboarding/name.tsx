import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, BackHandler, Alert, Dimensions } from 'react-native';
import { useEffect, useState } from 'react';
import { auth } from '../../firebaseconfig';
import { getUserProfile, savePartialProfile } from '../../lib/profile';
import { router, Stack } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { GradientButton } from '../../components/ui/GradientButton';
import { validateName } from '../../lib/moderation';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const isSmallDevice = SCREEN_H < 750;

export default function NameStep() {
  const [firstName, setFirstName] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const C = Colors['dark'];

  // 🔒 Bloque le bouton back Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        if (active) setLoadingProfile(false);
        return;
      }

      try {
        const profile = await getUserProfile(uid).catch(() => null);
        const existingName =
          profile?.firstName?.trim() ||
          auth.currentUser?.displayName?.trim().split(/\s+/)[0] ||
          '';

        if (!active) return;

        if (existingName) {
          const formattedName = existingName.charAt(0).toUpperCase() + existingName.slice(1).toLowerCase();
          setFirstName(formattedName);
          await savePartialProfile(uid, { firstName: formattedName });
          router.replace('/onboarding/age');
          return;
        }
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const next = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const check = validateName(firstName);
    if (!check.valid) {
      Alert.alert('Prénom invalide', check.error);
      return;
    }

    // Format
    const formattedName = firstName.trim().charAt(0).toUpperCase() + firstName.trim().slice(1).toLowerCase();

    await savePartialProfile(uid, { firstName: formattedName });
    router.replace('/onboarding/age');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LinearGradient colors={['#000000', '#111827']} style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.container}>
            
            {/* Background Glow */}
            <View style={s.glow} />

            <View style={s.content}>
                <Text style={s.stepIndicator}>Étape 2 sur 5</Text>
                <Text style={s.title}>Comment t&apos;appelles-tu ?</Text>
                <Text style={s.subtitle}>C&apos;est le nom que les autres verront sur ton profil.</Text>
                
                <TextInput
                    style={s.input}
                    placeholder="Ton prénom"
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    value={firstName}
                    onChangeText={setFirstName}
                    autoFocus
                    maxLength={20}
                />
            </View>

            <View style={s.footer}>
                <GradientButton label={loadingProfile ? "Chargement..." : "Continuer"} onPress={next} disabled={loadingProfile || !firstName.trim()} />
            </View>

        </KeyboardAvoidingView>
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  container: { 
    flex: 1, 
    paddingHorizontal: 24, 
    paddingTop: isSmallDevice ? 40 : 60, 
    paddingBottom: 20,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  glow: { position: 'absolute', top: -150, right: -100, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(249, 115, 22, 0.1)' },
  content: { flex: 1, marginTop: isSmallDevice ? 20 : 40 },
  stepIndicator: { color: '#F97316', fontWeight: '700', fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: isSmallDevice ? 32 : 40, fontWeight: '900', color: '#fff', marginBottom: 12, lineHeight: isSmallDevice ? 36 : 44 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: isSmallDevice ? 20 : 40, lineHeight: 24 },
  input: { fontSize: isSmallDevice ? 32 : 40, fontWeight: '800', color: '#fff', borderBottomWidth: 2, borderBottomColor: '#333', paddingVertical: 12, textAlign: 'left' },
  footer: { width: '100%' },
});

