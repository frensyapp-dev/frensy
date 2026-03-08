import React from 'react';
import { Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../../constants/Colors';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
};

export function Chip({ label, selected, onPress, style }: Props) {
  const C = Colors['dark'];
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)' },
        selected && [{ backgroundColor: C.tint, borderColor: C.tint, shadowColor: C.tint, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: {width:0,height:2}, elevation: 4 }],
        style,
      ]}
    >
      <Text style={[styles.txt, selected && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txt: { color: 'rgba(255,255,255,0.7)', fontWeight:'600', fontSize: 14 },
});
