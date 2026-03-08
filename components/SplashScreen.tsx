import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
    withSequence,
    withRepeat
} from 'react-native-reanimated';
import Logo from '../assets/images/frensylogo.png';

const { width } = Dimensions.get('window');

const Letter = ({ char, index, total }: { char: string, index: number, total: number }) => {
    const opacity = useSharedValue(0);
    const translateY = useSharedValue(20);

    useEffect(() => {
        const delay = 400 + (index * 100); // Staggered delay
        opacity.value = withDelay(delay, withTiming(1, { duration: 600 }));
        translateY.value = withDelay(delay, withSpring(0, { damping: 12, stiffness: 100 }));
    }, []);

    const style = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateY: translateY.value }]
    }));

    return (
        <Animated.Text style={[styles.letter, style]}>
            {char}
        </Animated.Text>
    );
};

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);

  useEffect(() => {
    // Logo animation (Pulse + Fade In)
    scale.value = withSpring(1, { damping: 10, stiffness: 100 });
    opacity.value = withTiming(1, { duration: 800 });

    // Tagline animation
    taglineOpacity.value = withDelay(1200, withTiming(1, { duration: 800 }));

    // Finish after 2.5 seconds
    const timer = setTimeout(() => {
      onFinish();
    }, 2800);

    return () => clearTimeout(timer);
  }, [onFinish, opacity, scale, taglineOpacity]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
  }));

  const appName = "FRENSY";

  return (
    <View style={styles.container}>
      {/* Consistent background with Login/Welcome */}
      <LinearGradient
        colors={['#000000', '#111827']}
        style={StyleSheet.absoluteFill}
      />
      
      <Animated.View style={[styles.logoContainer, logoStyle]}>
        <Image 
            source={Logo} 
            style={styles.logo} 
            contentFit="contain"
        />
      </Animated.View>
      
      <View style={styles.titleRow}>
        {appName.split('').map((char, index) => (
            <Letter key={index} char={char} index={index} total={appName.length} />
        ))}
      </View>

      <Animated.Text style={[styles.tagline, taglineStyle]}>
        Rencontre. Partage. Vis.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  logoContainer: {
    width: width * 0.4,
    height: width * 0.4,
    marginBottom: 30,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 10,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 2
  },
  letter: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(249, 115, 22, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  tagline: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    letterSpacing: 3,
    fontWeight: '400',
    textTransform: 'uppercase',
  },
});
