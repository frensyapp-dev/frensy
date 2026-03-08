import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { router, Stack } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Dimensions, Easing, Image, StyleSheet, Text, View } from 'react-native'
import { GradientButton } from '../../components/ui/GradientButton'
import { Colors } from '../../constants/Colors'

const { width } = Dimensions.get('window');

export default function OnboardingWelcome() {
  const C = Colors['dark']
  
  const letters = useMemo(() => Array.from('FRENSY'), [])
  const glow = useRef(new Animated.Value(0)).current
  const fadeAnim = useRef(new Animated.Value(0)).current
  
  // Staggered animation values for letters
  const letterAnims = useRef(letters.map(() => new Animated.Value(0))).current

  useEffect(() => {
    // Reveal letters with a smooth stagger
    const letterAnimations = letters.map((_, i) => 
      Animated.timing(letterAnims[i], {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
        delay: i * 50 // Fast stagger
      })
    )

    Animated.parallel([
      Animated.stagger(50, letterAnimations),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        delay: 200
      })
    ]).start()

    // Pulse Logo
    Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    ])).start()
    
  }, [letters, glow, fadeAnim])

  const goNext = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch {}
    router.replace('/onboarding/account-type' as any)
  }

  const scale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] })
  const shadowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] })

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LinearGradient
        colors={[C.background, C.card, C.background]}
        style={{ flex: 1 }}
      >
        <View style={s.container}>
            
            {/* Background decorative elements */}
            <Animated.View style={[s.glowOrb, { opacity: fadeAnim }]} />

            <View style={s.centerContent}>
                <Animated.View style={[s.logoContainer, { transform: [{ scale }], shadowOpacity }]}>
                    <Image source={require('../../assets/images/frensylogo.png')} style={s.logo} />
                </Animated.View>

                <View style={s.titleRow}>
                    {letters.map((ch, idx) => (
                    <Animated.Text key={idx} style={[s.title, { opacity: letterAnims[idx], transform: [{ translateY: letterAnims[idx].interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
                        {ch}
                    </Animated.Text>
                    ))}
                </View>

                <Animated.Text style={[s.subtitle, { opacity: fadeAnim }]}>
                    Rencontre. Discute. Vibre.
                </Animated.Text>
            </View>

            <Animated.View style={[s.footer, { opacity: fadeAnim }]}>
                <GradientButton label="C'est parti" onPress={goNext} />
                <Text style={s.terms}>En continuant, tu acceptes nos CGU.</Text>
            </Animated.View>
        </View>
      </LinearGradient>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 60, paddingHorizontal: 24 },
  glowOrb: {
      position: 'absolute',
      top: -100,
      left: -100,
      width: width,
      height: width,
      borderRadius: width / 2,
      backgroundColor: Colors.dark.overlay,
  },
  centerContent: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  logoContainer: { 
      width: 120, 
      height: 120, 
      borderRadius: 60, 
      backgroundColor: Colors.dark.background, 
      borderWidth: 1, 
      borderColor: Colors.dark.border, 
      alignItems: 'center', 
      justifyContent: 'center', 
      shadowColor: Colors.dark.tint, 
      shadowRadius: 30, 
      shadowOffset: { width: 0, height: 0 },
      marginBottom: 40
  },
  logo: { width: 140, height: 40, resizeMode: 'contain' },
  titleRow: { flexDirection: 'row', gap: 2 },
  title: { fontSize: 36, fontWeight: '900', color: Colors.dark.text, letterSpacing: 4 },
  subtitle: { marginTop: 16, fontSize: 16, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 },
  footer: { width: '100%', alignItems: 'center', gap: 16 },
  terms: { color: 'rgba(255,255,255,0.3)', fontSize: 12 }
})
