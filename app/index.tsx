// app/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Image,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming
} from 'react-native-reanimated';
import SplashScreen from '../components/SplashScreen';
import { Colors } from '../constants/Colors';
import { auth } from '../firebaseconfig';
import { getUserProfile } from '../lib/profile';

import Logo from '../assets/images/frensylogo.png';

export default function Index() {
  const [isSplashFinished, setSplashFinished] = useState(false);
  const [isAuthLoaded, setAuthLoaded] = useState(false);
  const [userSession, setUserSession] = useState<User | null>(null);
  const [targetRoute, setTargetRoute] = useState<string | null>(null);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  // Pulse Animation for Logo (Reanimated)
  const pulseScale = useSharedValue(1);
  
  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1, // Infinite
      true // Reverse (handled by sequence but safe to keep default or false, here sequence handles it so false)
    );
  }, []);

  const animatedLogoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }]
  }));

  // Auth check & Profile pre-fetching
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUserSession(u);
      if (u) {
        try {
            const prof = await getUserProfile(u.uid);
            if (!prof?.completed) setTargetRoute('/onboarding/welcome');
            else setTargetRoute('/(tabs)/home');
        } catch (e) {
            console.error("Profile fetch error", e);
            // Fallback: try home
            setTargetRoute('/(tabs)/home'); 
        }
      } else {
        setTargetRoute(null);
      }
      setAuthLoaded(true);
    });
    return unsub;
  }, []);

  // Handle Navigation when ready (Splash Finished + Auth Loaded)
  useEffect(() => {
    if (isSplashFinished && isAuthLoaded) {
        if (userSession && targetRoute) {
            // Ne vérifier le Daily Reward QUE si l'onboarding est terminé (targetRoute pointe vers home)
            if (targetRoute.includes('(tabs)')) {
                (async () => {
                   try {
                       const { doc, getDoc } = await import('firebase/firestore');
                       const { db } = await import('../firebaseconfig');
                       
                       const userDoc = await getDoc(doc(db, 'users', userSession.uid));
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
                                  // Naviguer d'abord vers home, puis ouvrir le store après un délai suffisant
                                  router.replace('/(tabs)/home');
                                  setTimeout(() => { router.push('/store'); }, 1500);
                                  return;
                               }
                           }
                       }
                   } catch(e) { console.error(e); }
                   
                   router.replace(targetRoute as any);
                })();
            } else {
                // Si on est en onboarding, on navigue juste vers la route cible sans daily reward
                router.replace(targetRoute as any);
            }
        }
    }
  }, [isSplashFinished, isAuthLoaded, userSession, targetRoute]);

  const onSplashFinish = () => {
    setSplashFinished(true);
  };

  const canSubmit = useMemo(() => {
    const validEmail = /.+@.+\..+/.test(email.trim());
    const validPwd = password.length >= 6;
    const match = mode === 'login' || password === confirm;
    return validEmail && validPwd && match && !loading;
  }, [email, password, confirm, mode, loading]);

  const postAuthRoute = async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
        const prof = await getUserProfile(u.uid);
        if (!prof?.completed) router.replace('/onboarding/welcome');
        else router.replace('/(tabs)/home');
    } catch (e) {
        console.error(e);
        router.replace('/(tabs)/home');
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      await postAuthRoute();
    } catch (e: any) {
      const code = e?.code ?? '';
      if (mode === 'signup' && code === 'auth/email-already-in-use') {
        setMode('login');
        setError('Cette adresse e-mail est déjà utilisée. Veuillez vous connecter.');
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setError('Identifiants invalides. Vérifie ton e-mail et ton mot de passe.');
      } else if (code === 'auth/user-not-found') {
        setError("Aucun compte n'est associé à cet e-mail.");
      } else if (code === 'auth/invalid-email') {
        setError('Adresse e-mail invalide.');
      } else if (code === 'auth/weak-password') {
        setError('Mot de passe trop court (min. 6 caractères).');
      } else {
        setError(e?.message ?? 'Erreur inconnue');
      }
    } finally {
      setLoading(false);
    }
  };

  // 1. Show Splash Screen while waiting for animation OR auth loading
  //    (We keep splash visible if auth is taking longer than 2.5s)
  if (!isSplashFinished || !isAuthLoaded) {
     return <SplashScreen onFinish={onSplashFinish} />;
  }

  // 2. If logged in (and route is ready), we show splash until redirect happens
  //    This prevents flickering the login screen for a split second.
  //    Added a timeout safety to force rendering if redirect fails.
  if (userSession && targetRoute) {
      // Safety: if for some reason we are stuck here, render splash
      return <SplashScreen onFinish={() => {}} />;
  }
  // If userSession exists but no targetRoute yet, also wait
  if (userSession && !targetRoute) {
     return <SplashScreen onFinish={() => {}} />;
  }

  // 3. Otherwise (not logged in), show Login Form
  const { width } = Dimensions.get('window');


  return (
    <LinearGradient
      colors={['#000000', '#111827']}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        {/* Background Glow */}
        <LinearGradient
          colors={['rgba(249, 115, 22, 0.15)', 'transparent']}
          style={{
            position: 'absolute',
            top: -100,
            left: -100,
            width: width * 1.2,
            height: width * 1.2,
            borderRadius: (width * 1.2) / 2,
          }}
        />

        <Animated.View style={[styles.logoArea, animatedLogoStyle]}>
          <Image source={Logo} style={styles.logo} />
        </Animated.View>

        <View style={styles.glassCard}>
          <Text style={styles.title}>
            {mode === 'login' ? 'Connexion' : 'Créer un compte'}
          </Text>
          <Text style={styles.subtitle}>
            {mode === 'login' ? 'Ravi de te revoir.' : 'Rejoins-nous en quelques secondes.'}
          </Text>

          <View style={styles.inputGroup}>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Mot de passe (min. 6)"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPwd}
                textContentType="password"
                returnKeyType="done"
              />
              <TouchableOpacity onPress={() => setShowPwd((s) => !s)}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{showPwd ? 'MASQUER' : 'AFFICHER'}</Text>
              </TouchableOpacity>
            </View>

            {mode === 'signup' && (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Confirme le mot de passe"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry={!showPwd}
                  textContentType="password"
                />
              </View>
            )}
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={[styles.primaryBtn, { opacity: canSubmit ? 1 : 0.6 }]}
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.primaryTxt}>{mode === 'login' ? 'Se connecter' : "S'inscrire"}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.switchRow}>
            <Text style={{ color: 'rgba(255,255,255,0.6)' }}>{mode === 'login' ? 'Pas de compte ?' : 'Déjà inscrit ?'}</Text>
            <TouchableOpacity
              onPress={() => {
                setMode((m) => (m === 'login' ? 'signup' : 'login'));
                setError(null);
              }}
            >
              <Text style={styles.link}>
                {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  glowOrb: {
      position: 'absolute',
      top: -100,
      left: -100,
      backgroundColor: 'rgba(249, 115, 22, 0.15)',
  },
  logoArea: { alignItems: 'center', justifyContent: 'center', marginBottom: 40 },
  logo: { width: 140, height: 140, resizeMode: 'contain' },
  
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
  title: { fontSize: 32, fontWeight: '900', color: Colors.dark.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 32, fontSize: 16 },
  
  inputGroup: { gap: 16, marginBottom: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    borderRadius: 16,
    height: 56,
  },
  input: { flex: 1, fontSize: 16, color: Colors.dark.text, fontWeight: '600' },
  
  error: { color: Colors.dark.danger, textAlign: 'center', marginBottom: 16, fontWeight: '600' },
  
  primaryBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.tint,
    shadowColor: Colors.dark.tint,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 24,
  },
  primaryTxt: { color: Colors.dark.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  
  switchRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center' },
  link: { fontWeight: '700', color: Colors.dark.tint },
});
