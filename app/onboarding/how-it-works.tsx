import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, {
    FadeInRight,
    FadeOutLeft,
    Layout,
    SlideInDown
} from 'react-native-reanimated';
import { GradientButton } from '../../components/ui/GradientButton';
import { Colors } from '../../constants/Colors';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'La Carte Frensy',
    description: 'Découvre les personnes et les groupes autour de toi en temps réel. La carte s’anime selon l’activité de la communauté.',
    icon: 'map-marker',
    color: '#F97316'
  },
  {
    title: 'Vie Privée par défaut',
    description: 'Ta position est toujours floutée (~1km) pour les inconnus. Personne ne peut savoir exactement où tu habites.',
    icon: 'shield',
    color: '#3BA55D'
  },
  {
    title: 'Partage en direct (Live)',
    description: 'Tu ne partages ta position précise (📡) que si tu le décides, et uniquement avec tes matchs via le bouton boussole.',
    icon: 'compass',
    color: '#3B82F6'
  },
  {
    title: 'Mode Fantôme',
    description: 'À tout moment, active le mode 👻 pour devenir instantanément invisible. Tu gardes le contrôle total.',
    icon: 'ghost',
    color: '#A855F7'
  }
];

export default function HowItWorks() {
  const C = Colors['dark'];
  const [activeSlide, setActiveSlide] = useState(0);

  const goNext = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch {}
    if (activeSlide < SLIDES.length - 1) {
      setActiveSlide(activeSlide + 1);
    } else {
      router.push('/onboarding/account-type' as any);
    }
  };

  const current = SLIDES[activeSlide];

  return (
    <View style={[s.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={[C.background, C.card, C.background]}
        style={StyleSheet.absoluteFill}
      />

      <View style={s.header}>
        <Reanimated.Text entering={SlideInDown.duration(600)} style={s.headerTitle}>Comment ça marche ?</Reanimated.Text>
        <View style={s.pagination}>
          {SLIDES.map((_, i) => (
            <View 
              key={i} 
              style={[
                s.dot, 
                { backgroundColor: i === activeSlide ? C.tint : 'rgba(255,255,255,0.1)' }
              ]} 
            />
          ))}
        </View>
      </View>

      <View style={s.content}>
        <Reanimated.View 
          key={activeSlide}
          entering={FadeInRight.duration(400)}
          exiting={FadeOutLeft.duration(400)}
          style={s.slide}
        >
          <View style={[s.iconContainer, { backgroundColor: current.color + '15', borderColor: current.color + '30', borderWidth: 2 }]}>
            <FontAwesome name={current.icon as any} size={64} color={current.color} />
          </View>
          <Text style={s.slideTitle}>{current.title}</Text>
          <Text style={s.slideDescription}>{current.description}</Text>
        </Reanimated.View>
      </View>

      <Reanimated.View layout={Layout.springify()} style={s.footer}>
        <GradientButton 
          label={activeSlide === SLIDES.length - 1 ? "J'ai compris" : "Suivant"} 
          onPress={goNext} 
        />
        {activeSlide < SLIDES.length - 1 && (
          <TouchableOpacity onPress={() => router.push('/onboarding/account-type' as any)} style={s.skipBtn}>
            <Text style={{ color: C.muted, fontWeight: '600' }}>Passer l'introduction</Text>
          </TouchableOpacity>
        )}
      </Reanimated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    marginTop: 70,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 24,
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.6
  },
  pagination: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 24,
    height: 4,
    borderRadius: 2,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  slide: {
    alignItems: 'center',
    width: '100%',
  },
  iconContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 15,
  },
  slideTitle: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  slideDescription: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 26,
  },
  footer: {
    paddingHorizontal: 30,
    paddingBottom: 60,
  },
  skipBtn: {
    alignItems: 'center',
    marginTop: 24,
  }
});
