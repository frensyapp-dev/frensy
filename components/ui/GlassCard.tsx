import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';

type Props = {
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
};

export default function GlassCard({ style, children, intensity = 50 }: Props & { intensity?: number }) {
  // Optimisation Android: Le flou est coûteux, on le réduit ou le désactive
  const isAndroid = Platform.OS === 'android';
  const finalIntensity = isAndroid ? Math.min(intensity, 20) : intensity;
  // Compensation visuelle: fond plus opaque sur Android si le flou est faible
  const bgColor = isAndroid ? 'rgba(20,20,20,0.85)' : 'rgba(20,20,20,0.4)';

  return (
    <View style={[styles.wrap, { borderColor: 'rgba(255,255,255,0.12)', backgroundColor: bgColor }, style]}>
      {!isAndroid && <BlurView intensity={finalIntensity} tint="dark" style={styles.blur} />}
      {isAndroid && finalIntensity > 0 && <BlurView intensity={finalIntensity} tint="dark" style={styles.blur} />}
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  blur: { ...StyleSheet.absoluteFillObject },
  inner: { padding: 16 },
});
