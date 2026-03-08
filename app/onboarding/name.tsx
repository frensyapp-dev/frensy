import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Image, BackHandler, Alert, Dimensions } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { auth } from '../../firebaseconfig';
import { savePartialProfile } from '../../lib/profile';
import { router, Stack } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { GradientButton } from '../../components/ui/GradientButton';
import { validateName } from '../../lib/moderation';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

export default function NameStep() {
  const [firstName, setFirstName] = useState('');
  const C = Colors['dark'];

  // 🔒 Bloque le bouton back Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
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
                <GradientButton label="Continuer" onPress={next} disabled={!firstName.trim()} />
            </View>

        </KeyboardAvoidingView>
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 20 },
  glow: { position: 'absolute', top: -150, right: -100, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(249, 115, 22, 0.1)' },
  content: { flex: 1, marginTop: 40 },
  stepIndicator: { color: '#F97316', fontWeight: '700', fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 40, fontWeight: '900', color: '#fff', marginBottom: 12, lineHeight: 44 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: 40, lineHeight: 24 },
  input: { fontSize: 40, fontWeight: '800', color: '#fff', borderBottomWidth: 2, borderBottomColor: '#333', paddingVertical: 12, textAlign: 'left' },
  footer: { width: '100%' },
});
