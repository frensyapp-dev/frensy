import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withRepeat, 
  withSequence, 
  withTiming,
  FadeIn,
  FadeInDown,
  FadeInUp
} from 'react-native-reanimated';
import { Colors } from '../../constants/Colors';
import { GradientButton } from '../../components/ui/GradientButton';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { userPrivateRef } from '../../lib/profile';

const { width, height } = Dimensions.get('window');

export default function GhostSetupScreen() {
  const C = Colors['dark'];
  const [loading, setLoading] = useState(false);
  
  // Animation values
  const ghostY = useSharedValue(0);
  const ghostScale = useSharedValue(1);

  useEffect(() => {
    // Floating ghost animation
    ghostY.value = withRepeat(
      withSequence(
        withTiming(-20, { duration: 2000 }),
        withTiming(0, { duration: 2000 })
      ),
      -1,
      true
    );
    
    ghostScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500 }),
        withTiming(1, { duration: 1500 })
      ),
      -1,
      true
    );
  }, []);

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: ghostY.value },
      { scale: ghostScale.value }
    ]
  }));

  const finishSetup = async (isGhost: boolean) => {
    setLoading(true);
    try {
      const auth = getAuth();
      const db = getFirestore();
      const uid = auth.currentUser?.uid;
      
      if (!uid) throw new Error('Non connecté');

      // Update private settings
      await setDoc(userPrivateRef(uid), { 
        ghostMode: isGhost,
        updatedAt: serverTimestamp() 
      }, { merge: true });

      // Update public profile
      await updateDoc(doc(db, 'users', uid), {
        ghostMode: isGhost,
        completed: true,
        updatedAt: serverTimestamp()
      });

      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch {}
      router.replace('/(tabs)/home');
    } catch (e: any) {
      Alert.alert('Erreur', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[s.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={[C.background, C.card, C.background]}
        style={StyleSheet.absoluteFill}
      />

      <View style={s.content}>
        <Animated.View style={[s.ghostContainer, ghostStyle]} entering={FadeInUp.delay(200).duration(800)}>
          <View style={s.ghostCircle}>
            <Text style={s.ghostEmoji}>👻</Text>
          </View>
        </Animated.View>

        <Animated.View style={s.textContainer} entering={FadeInDown.delay(400).duration(800)}>
          <Text style={s.title}>Prêt à sauter le pas ?</Text>
          <Text style={s.subtitle}>
            Par défaut, tu es en <Text style={{ color: C.tint, fontWeight: 'bold' }}>Mode Fantôme</Text>. Tu es invisible sur la carte pour tout le monde.
          </Text>
          <Text style={s.description}>
            Veux-tu désactiver le mode fantôme pour apparaître sur la carte et rencontrer de vraies personnes autour de toi dès maintenant ?
          </Text>
        </Animated.View>

        <Animated.View style={s.actions} entering={FadeIn.delay(800).duration(1000)}>
          <GradientButton 
            label="Oui, je veux être visible ! 🚀" 
            onPress={() => finishSetup(false)}
            disabled={loading}
          />
          
          <TouchableOpacity 
            style={s.secondaryBtn} 
            onPress={() => finishSetup(true)}
            disabled={loading}
          >
            <Text style={[s.secondaryText, { color: C.muted }]}>
              Non, je reste invisible pour l'instant
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <View style={s.footer}>
        <View style={s.infoBox}>
          <FontAwesome name="shield" size={16} color={C.tint} />
          <Text style={s.infoText}>Tu peux changer d'avis à tout moment.</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  ghostContainer: {
    marginBottom: 40,
  },
  ghostCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  ghostEmoji: {
    fontSize: 70,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 50,
  },
  title: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 16,
  },
  description: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    width: '100%',
    gap: 16,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footer: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  infoText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  }
});
