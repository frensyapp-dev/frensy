import React from 'react';
import { View, Text, StyleSheet, ViewStyle, ScrollView, TouchableOpacity } from 'react-native';
import AvatarMarker from './AvatarMarker.web';
import { router } from 'expo-router';

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type NearbyUser = { id: string; name: string; age: number; lat: number; lng: number; distanceKm: number; img?: string };

type Props = {
  mapRef: React.RefObject<any>;
  style?: ViewStyle;
  scheme: 'dark' | 'light' | null | undefined;
  C: { tint: string; card: string; border: string; text: string };
  region: Region;
  setRegion: (r: Region) => void;
  nearby: NearbyUser[];
  onSelect: (u: NearbyUser) => void;
  self?: { lat: number; lng: number; img?: string; focusX?: number; focusY?: number; zoom?: number } | null;
  radiusKm?: number;
};

export default function NativeMapWeb({ style, C, nearby, onSelect, self }: Props) {
  return (
    <View style={[style, { borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }]}> 
      <View style={[styles.banner, { borderColor: C.border, backgroundColor: 'rgba(0,0,0,0.04)' }]}> 
        <Text style={{ fontSize: 12, color: C.text }}>Carte simplifiée sur le web</Text>
        <Text style={{ fontSize: 12, color: C.text }}>Cliquez un avatar pour voir les détails</Text>
        {self && (
          <Text style={{ fontSize: 12, color: C.text }}>
            Votre statut: localisation active
          </Text>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.grid}>
        {self && (
          <TouchableOpacity
            onPress={() => {
              try {
                router.push('/(tabs)/profile');
              } catch {}
            }}
            style={styles.item}
          >
            <AvatarMarker
              coordinate={{ latitude: self.lat, longitude: self.lng }}
              uri={self.img}
              initials={'M'}
              name={'Moi'}
              isApproximate={false}
              showDistance={false}
              focusX={self.focusX}
              focusY={self.focusY}
              zoom={self.zoom}
              ringColor={C.tint}
            />
          </TouchableOpacity>
        )}
        {nearby.map(u => (
          <TouchableOpacity key={u.id} onPress={() => onSelect(u)} style={styles.item}> 
            <AvatarMarker
              coordinate={{ latitude: u.lat, longitude: u.lng }}
              uri={u.img}
              initials={u.name.charAt(0)}
              name={u.name}
              distance={u.distanceKm}
              isApproximate
              ringColor={C.tint}
            />
          </TouchableOpacity>
        ))}
        {nearby.length === 0 && (
          <View style={styles.empty}> 
            <Text style={{ color: C.text }}>Aucun utilisateur proche pour le moment.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 8, borderBottomWidth: 1 },
  grid: { padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  item: { width: 120, alignItems: 'center' },
  empty: { padding: 24, alignItems: 'center' },
});
