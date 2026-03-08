import { LinearGradient } from 'expo-linear-gradient'
import { router, Stack } from 'expo-router'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Animated, Easing, Dimensions } from 'react-native'
import { Colors } from '../../constants/Colors'
import { auth } from '../../firebaseconfig'

import Logo from '../../assets/images/frensylogo.png'

const { width } = Dimensions.get('window')

export default function CreateAccountScreen() {
  const C = Colors['dark']
  
  // Use same color palette as index.tsx for consistency
  const inputBg = 'rgba(255,255,255,0.05)'
  const inputText = '#FFFFFF'
  const inputBorder = 'rgba(255,255,255,0.1)'
  const placeholder = 'rgba(255,255,255,0.4)'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailValid = useMemo(() => /.+@.+\..+/.test(email.trim()), [email])
  const pwdValid = useMemo(() => password.length >= 6, [password])
  const canSubmit = useMemo(() => emailValid && pwdValid && !loading, [emailValid, pwdValid, loading])

  // Pulse Animation for Logo
  const pulseAnim = useMemo(() => new Animated.Value(1), [])
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start()
  }, [])

  const submit = async () => {
    try {
      setLoading(true)
      setError(null)
      await createUserWithEmailAndPassword(auth, email.trim(), password)
      router.replace('/onboarding/welcome' as any)
    } catch (e: any) {
      const code = e?.code ?? ''
      if (code === 'auth/email-already-in-use') setError('Adresse e-mail déjà utilisée')
      else if (code === 'auth/invalid-email') setError('Adresse e-mail invalide')
      else if (code === 'auth/weak-password') setError('Mot de passe trop court (min. 6)')
      else setError(e?.message ?? 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
        {/* Background Gradient */}
        <LinearGradient
          colors={['#0f172a', '#1e293b', '#0f172a']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        
        {/* Ambient Glow Orb */}
        <LinearGradient
          colors={['rgba(249,115,22,0.15)', 'transparent']}
          style={{
            position: 'absolute',
            width: width * 1.5,
            height: width * 1.5,
            borderRadius: width,
            top: -width * 0.5,
            left: -width * 0.25,
          }}
        />

        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={styles.container}
        >
          {/* Logo with Pulse */}
          <Animated.View style={[styles.logoArea, { transform: [{ scale: pulseAnim }] }]}>
            <Image source={Logo} style={styles.logo} />
          </Animated.View>

          {/* Glassmorphism Card */}
          <View style={styles.glassCard}>
            <Text style={styles.title}>Créer un compte</Text>
            <Text style={styles.subtitle}>Renseigne ton e-mail et un mot de passe sécurisé.</Text>

            <View style={styles.inputGroup}>
              <View style={[styles.inputRow, { borderColor: inputBorder, backgroundColor: inputBg }]}>
                <TextInput
                  style={[styles.input, { color: inputText }]}
                  placeholder="Email"
                  placeholderTextColor={placeholder}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  testID="input-create-email"
                />
              </View>
              <View style={[styles.inputRow, { borderColor: inputBorder, backgroundColor: inputBg }]}>
                <TextInput
                  style={[styles.input, { color: inputText }]}
                  placeholder="Mot de passe (min. 6)"
                  placeholderTextColor={placeholder}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  testID="input-create-password"
                />
              </View>
              {error && (<Text style={styles.errorText}>{error}</Text>)}
            </View>

            <TouchableOpacity 
              onPress={submit} 
              disabled={!canSubmit} 
              style={[styles.primaryBtn, { 
                backgroundColor: canSubmit ? '#F97316' : 'rgba(255,255,255,0.1)',
                opacity: canSubmit ? 1 : 0.7 
              }]} 
              testID="btn-auth-create"
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.primaryTxt}>Créer mon compte</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => router.replace('/' as any)} 
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryTxt}>J&apos;ai déjà un compte</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 120,
    height: 120,
    resizeMode: 'contain',
  },
  glassCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 30,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginBottom: 24,
  },
  inputGroup: {
    gap: 16,
    marginBottom: 24,
  },
  inputRow: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
    marginTop: -8,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryTxt: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 20,
    alignItems: 'center',
    padding: 8,
  },
  secondaryTxt: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600',
  },
})
