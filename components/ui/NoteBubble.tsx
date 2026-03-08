import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';

type Props = {
  text: string;
  width?: number; // largeur de la bulle
  style?: ViewStyle | ViewStyle[];
  dark?: boolean; // thème sombre -> bulle plus foncée
};

/**
 * Bulle capsule avec petite "pointe" vers le bas, conçue pour être posée
 * au-dessus d'un avatar rond.
 */
export default function NoteBubble({ text, width = 180, style, dark = true }: Props) {
  const bg = dark ? '#2B2E33' : '#f3f4f6';
  const fg = dark ? '#fff' : '#111827';
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[styles.bubble, { width, backgroundColor: bg }, style]}> 
        <Text numberOfLines={3} style={[styles.text, { color: fg }]}>{text}</Text>
        {/* Pointe (approximation): deux pastilles superposées au bord bas */}
        <View style={[styles.tailBase, { backgroundColor: bg }]} />
        <View style={[styles.tailDot, { backgroundColor: bg }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    position: 'relative',
  },
  text: {
    fontWeight: '800',
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  tailBase: {
    position: 'absolute',
    bottom: -8,
    left: '50%',
    marginLeft: -18,
    width: 36,
    height: 18,
    borderRadius: 18,
  },
  tailDot: {
    position: 'absolute',
    bottom: -16,
    left: '50%',
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
  },
});
