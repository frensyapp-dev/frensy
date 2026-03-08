import React, { useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/Colors';

type Item = { key: string; uri: string };

type Props = {
  items: Item[];
  initialIndex?: number;
  onIndexChange?: (i: number) => void;
  onClose?: () => void;
  bottomContent?: React.ReactNode;
};

export default function StoryPager({ items, initialIndex = 0, onIndexChange, onClose, bottomContent }: Props) {
  const C = Colors['dark'];
  const [index, setIndex] = useState(initialIndex);
  const screenW = Dimensions.get('window').width;
  const screenH = Dimensions.get('window').height;

  const handleMomentumEnd = (e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width);
    setIndex(i);
    onIndexChange?.(i);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.35)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 200 }} />

      <View style={{ flexDirection: 'row', gap: 6, padding: 10 }}>
        {items.map((_, i) => (
          <View key={i} style={{ flex: 1, height: 4, backgroundColor: i <= index ? C.tint : '#555', borderRadius: 3 }} />
        ))}
      </View>

      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={handleMomentumEnd} style={{ flex: 1 }}>
        {items.map((ph) => (
          <View key={ph.key} style={{ width: screenW, height: screenH, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: ph.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        {bottomContent}
        <TouchableOpacity onPress={onClose} style={{ alignSelf: 'flex-end', marginTop: 10, padding: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Fermer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 },
});