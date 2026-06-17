// app/index.tsx
import * as AppleAuthentication from 'expo-apple-authentication';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Linking,
    Platform,
    StyleSheet,
    Text,
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
import GlassCard from '../components/ui/GlassCard';
import { Colors } from '../constants/Colors';
import { auth } from '../firebaseconfig';
import { signInWithApple, signInWithGoogle } from '../lib/auth';
import { nextRouteForProfile } from '../lib/authGate';
import { getUserProfile } from '../lib/profile';

import Logo from '../assets/images/frensylogo.png';

export default function Index() {
  const [isSplashFinished, setSplashFinished] = useState(false);
  const [isAuthLoaded, setAuthLoaded] = useState(false);
  const [userSession, setUserSession] = useState<User | null>(null);
  const [targetRoute, setTargetRoute] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAppleAuthAvailable, setIsAppleAuthAvailable] = useState(false);

  // Pulse Animation for Logo (Reanimated)
  const pulseScale = useSharedValue(1);
  
  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'ios') {
        setIsAppleAuthAvailable(false);
        return;
      }
      try {
        const avail = await AppleAuthentication.isAvailableAsync();
        setIsAppleAuthAvailable(avail);
      } catch {
        setIsAppleAuthAvailable(false);
      }
    })();

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
            setTargetRoute(nextRouteForProfile(prof));
        } catch (e) {
            console.error("Profile fetch error", e);
            setTargetRoute('/onboarding/welcome');
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
            router.replace(targetRoute as any);
        }
    }
  }, [isSplashFinished, isAuthLoaded, userSession, targetRoute]);

  const onSplashFinish = () => {
    setSplashFinished(true);
  };

  const handleGoogleSignIn = async () => {
    if (loading) return;
    try {
      setLoading(true);
      setError(null);
      await signInWithGoogle();
      // Auth state listener handles navigation
    } catch (e: any) {
      console.error(e);
      if (e?.code === 'auth/link-required' && typeof e?.message === 'string') {
        setError(e.message);
        return;
      }
      const msg = typeof e?.message === 'string' ? e.message : '';
      const msgLower = msg.toLowerCase();
      if (msg.includes('Expo Go')) {
        Alert.alert(
          "Mode Développement",
          "Le Google Sign-In ne fonctionne pas dans Expo Go. Utilisez un Development Build pour tester la connexion réelle."
        );
      } else if (Platform.OS === 'web' && msgLower.includes('web')) {
        setError("La connexion Google n’est pas disponible sur le web.");
      } else if (msgLower.includes('webclientid') || msgLower.includes('token')) {
        setError("Connexion Google indisponible. Vérifiez la configuration et réessayez.");
      } else {
        setError("Erreur de connexion Google. Vérifiez votre connexion.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (loading) return;
    try {
      setLoading(true);
      setError(null);
      await signInWithApple();
      // Auth state listener handles navigation
    } catch (e: any) {
      console.error(e);
      if (e?.code === 'auth/link-required' && typeof e?.message === 'string') {
        setError(e.message);
        return;
      }
      setError("Erreur de connexion Apple.");
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
      colors={[Colors.dark.background, Colors.dark.card, Colors.dark.background]}
      style={{ flex: 1 }}
    >
      <View
        style={styles.container}
      >
        {/* Background Glow */}
        <LinearGradient
          colors={[Colors.dark.overlay, 'transparent']}
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

        <GlassCard style={styles.glassCard} intensity={20}>
          <Text style={styles.title}>
            Connexion
          </Text>
          <Text style={styles.subtitle}>
            Connexion / inscription en 1 clic.
          </Text>

          <View style={styles.buttonContainer}>
            {isAppleAuthAvailable ? (
                <View style={styles.appleButtonContainer}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                    cornerRadius={26}
                    style={[styles.appleButton, loading && styles.disabledButton]}
                    onPress={() => { void handleAppleSignIn(); }}
                  />
                </View>
              ) : null}

            <TouchableOpacity
              style={[styles.customGoogleButton, loading && styles.disabledButton]}
              onPress={() => { void handleGoogleSignIn(); }}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Image 
                source={{ uri: 'https://developers.google.com/static/identity/images/g-logo.png' }} 
                style={styles.googleIcon} 
              />
              <View style={styles.googleTextContainer}>
                  <Text style={styles.customGoogleButtonText}>Google</Text>
              </View>
            </TouchableOpacity>
          </View>

          {loading && <ActivityIndicator style={{ marginTop: 20, alignSelf: 'center' }} color="#fff" />}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.terms}>
            En continuant, tu acceptes nos{' '}
            <Text
              style={styles.termsLink}
              onPress={() => Linking.openURL('https://frensyapp-dev.github.io/frensy/terms.html')}
            >
              CGU
            </Text>{' '}
            et{' '}
            <Text
              style={styles.termsLink}
              onPress={() => Linking.openURL('https://frensyapp-dev.github.io/frensy/privacy.html')}
            >
              Confidentialité
            </Text>
            .
          </Text>
        </GlassCard>
      </View>
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
    borderRadius: 30,
    padding: 20,
    alignItems: 'stretch', // S'assure que les enfants prennent toute la largeur
  },
  title: { fontSize: 32, fontWeight: '900', color: Colors.dark.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 32, fontSize: 16 },
  
  buttonContainer: {
    width: '100%',
    gap: 16,
    alignItems: 'stretch', // Aligne les boutons sur toute la largeur
  },
  appleButtonContainer: {
    width: '100%',
    height: 52,
    // On ajoute un wrapper shadow invisible qui correspond à ce que fait Google
  },
  appleButton: {
    width: '100%',
    height: 52,
  },
  customGoogleButton: {
    width: '100%',
    height: 52,
    backgroundColor: 'white',
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    position: 'relative', // Ajout important pour le positionnement absolu du logo
  },
  googleIcon: {
    width: 20, // Légèrement réduit pour matcher la largeur visuelle de la pomme
    height: 20,
    position: 'absolute',
    left: 20, // Remis à 20 pour correspondre exactement au placement du logo Apple
  },
  googleTextContainer: { flex: 1, alignItems: 'center' },
  customGoogleButtonText: { color: '#000', fontSize: 18, fontWeight: '700' },
  googleIcon: { width: 24, height: 24, position: 'absolute', left: 20 },

  disabledButton: { opacity: 0.5 },
  
  error: { color: Colors.dark.danger, textAlign: 'center', marginTop: 16, fontWeight: '600' },
  terms: { color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 18, fontSize: 12, lineHeight: 16 },
  termsLink: { textDecorationLine: 'underline', color: 'rgba(255,255,255,0.6)' },
});
