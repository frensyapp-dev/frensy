import React from 'react';
import { Text, Pressable, StyleSheet, ViewStyle, ColorValue, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Colors } from '../../constants/Colors';

type Props = {
  label: string;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
  accessibilityLabel?: string;
};

export function GradientButton({ label, onPress, style, disabled, loading, variant = 'primary', accessibilityLabel }: Props) {
  const C = Colors['dark'];
  
  let colors: [ColorValue, ColorValue] = [
    (C as any).gradientStart ?? C.tint,
    (C as any).gradientEnd ?? C.tintAlt,
  ];
  
  let textColor = '#fff';
  let borderWidth = 0;
  let borderColor = 'transparent';

  if (variant === 'secondary') {
      colors = ['#333', '#111'];
  } else if (variant === 'outline') {
      colors = ['transparent', 'transparent'];
      borderWidth = 1;
      borderColor = C.tint;
      textColor = C.tint;
  }

  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      onPress={!loading ? onPress : undefined}
      onPressIn={() => { if (!loading && !disabled) scale.value = withSpring(0.96, { damping: 10 }); }}
      onPressOut={() => { if (!loading && !disabled) scale.value = withSpring(1, { damping: 10 }); }}
      style={[style, { opacity: disabled ? 0.6 : 1 }]}
      disabled={disabled || loading}
    >
      <Animated.View style={aStyle}>
        <LinearGradient 
          colors={colors} 
          start={{x:0,y:0}} 
          end={{x:1,y:1}} 
          style={[
              styles.btn, 
              variant === 'primary' && { shadowColor: C.tint },
              { borderWidth, borderColor }
          ]}
        > 
          {loading ? (
              <ActivityIndicator color={textColor} />
          ) : (
              <Text style={[styles.txt, { color: textColor }]}>{label}</Text>
          )}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    // Default border for primary to give it a pop
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    minHeight: 56,
  },
  txt: { fontWeight: '800', fontSize: 17, letterSpacing: 0.5 },
});
