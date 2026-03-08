import React from 'react';
import { View, Text, ViewStyle } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import Avatar from '../ui/Avatar';
import { router } from 'expo-router';

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type NearbyUser = { id: string; name: string; age: number; lat: number; lng: number; distanceKm: number; img?: string; isBlur?: boolean; isOnline?: boolean };
type SelfMarker = { lat: number; lng: number; img?: string; focusX?: number; focusY?: number; zoom?: number };

type Props = {
  mapRef: React.RefObject<any>;
  style?: ViewStyle;
  scheme: 'dark' | 'light' | null | undefined;
  C: { tint: string; card: string; border: string; text: string };
  region: Region;
  setRegion: (r: Region) => void;
  nearby: NearbyUser[];
  onSelect: (u: NearbyUser) => void;
  self?: SelfMarker | null;
  radiusKm?: number;
  onClusterSelect?: (users: NearbyUser[]) => void;
};

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0b0b0b' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a3a3a3' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0b0b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#111111' }] },
  { featureType: 'water', stylers: [{ color: '#0f172a' }] },
];

const lightMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'water', stylers: [{ color: '#c7d2fe' }] },
];

export default function NativeMap({ mapRef, style, scheme, C, region, setRegion, nearby, onSelect, self, radiusKm, onClusterSelect }: Props) {
  // Charger react-native-maps uniquement sur natif et à l'intérieur du rendu
  const MapBase = MapView;

  // Toujours activer le clustering pour gérer les superpositions, même zoomé
  const clusterEnabled = true;

  // Regrouper les utilisateurs par cellule de grille en fonction du zoom
  const clusters = React.useMemo(() => {
    // Cellule dynamique: environ 1/12eme de l'écran, mais avec un minimum très fin (0.0005 ~50m) pour permettre de distinguer les voisins proches quand on zoom
    const cellLat = Math.max(0.0005, region.latitudeDelta / 15);
    const cellLng = Math.max(0.0005, region.longitudeDelta / 15);
    const map = new Map<string, { center: { lat: number; lng: number }, users: NearbyUser[] }>();
    for (const u of nearby) {
      const i = Math.floor((u.lat - region.latitude) / cellLat);
      const j = Math.floor((u.lng - region.longitude) / cellLng);
      const key = `${i}:${j}`;
      const g = map.get(key);
      if (g) {
        g.users.push(u);
        // mettre à jour le centre (moyenne simple)
        g.center.lat = (g.center.lat * (g.users.length - 1) + u.lat) / g.users.length;
        g.center.lng = (g.center.lng * (g.users.length - 1) + u.lng) / g.users.length;
      } else {
        map.set(key, { center: { lat: u.lat, lng: u.lng }, users: [u] });
      }
    }
    return Array.from(map.values());
  }, [nearby, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  return (
    <MapBase
      ref={mapRef}
      style={style}
      provider={PROVIDER_GOOGLE}
      initialRegion={region}
      onRegionChangeComplete={setRegion}
      showsUserLocation={false}
      userInterfaceStyle={scheme === 'dark' ? 'dark' : 'light'}
      showsCompass={false}
      toolbarEnabled={false}
      pitchEnabled
      loadingEnabled
      loadingIndicatorColor={C.tint}
      customMapStyle={scheme === 'dark' ? darkMapStyle : lightMapStyle}
    >
      {/* Cercle de rayon de découverte autour de "Moi" */}
      {self && typeof radiusKm === 'number' && radiusKm > 0 && (
        <Circle
          center={{ latitude: self.lat, longitude: self.lng }}
          radius={radiusKm * 1000}
          strokeWidth={2}
          strokeColor={hexToRgba(C.tint, 0.35)}
          fillColor={hexToRgba(C.tint, 0.10)}
        />
      )}
      {self && (
        <Marker
          key={'__me'}
          coordinate={{ latitude: self.lat, longitude: self.lng }}
          onPress={() => {
            try {
              router.push('/(tabs)/profile');
            } catch {}
          }}
          tracksViewChanges={true}
        >
            <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              {/* Glow accent autour de Moi */}
              <View style={{ position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(C.tint, 0.20) }} />
              <Avatar uri={self.img} initials={'M'} size={40} ring ringColor={C.tint} ringWidth={3} focusX={typeof self.focusX === 'number' ? self.focusX : undefined} focusY={typeof self.focusY === 'number' ? self.focusY : undefined} zoom={typeof (self as any).zoom === 'number' ? (self as any).zoom : undefined} useRNImage />
            </View>
        </Marker>
      )}
      {clusterEnabled
        ? clusters.map((c, idx) => {
            const first = c.users[0];
            const count = c.users.length;

            if (count === 1) {
              return (
                <Marker
                  key={`single:${first.id}`}
                  coordinate={{ latitude: first.lat, longitude: first.lng }}
                  onPress={() => onSelect(first)}
                  tracksViewChanges={true}
                  opacity={first.isOnline ? 1 : 0.6} // Opacity for offline
                  zIndex={first.isOnline ? 10 : 1} // Online on top
                >
                  <View style={{ alignItems: 'center' }}>
                    <Avatar 
                      uri={first.img} 
                      initials={first.name.charAt(0)} 
                      size={38} 
                      ring 
                      ringColor={first.isOnline ? C.tint : '#888'} // Green vs Gray ring
                      useRNImage 
                      blurRadius={first.isBlur ? 8 : 0} 
                    />
                  </View>
                </Marker>
              );
            }

            return (
              <Marker
                key={`cluster:${idx}`}
                coordinate={{ latitude: c.center.lat, longitude: c.center.lng }}
                onPress={() => {
                  try {
                    if (onClusterSelect) {
                      onClusterSelect(c.users);
                    } else {
                      mapRef.current?.animateToRegion({
                        latitude: c.center.lat,
                        longitude: c.center.lng,
                        latitudeDelta: region.latitudeDelta * 0.5,
                        longitudeDelta: region.longitudeDelta * 0.5,
                      }, 350);
                    }
                  } catch {}
                }}
                tracksViewChanges={true}
              >
                <View style={{ alignItems: 'center' }}>
                  {/* Avatar principal du cluster + badge nombre */}
                  <View style={{ position: 'relative' }}>
                    <Avatar uri={first.img} initials={first.name.charAt(0)} size={42} ring useRNImage blurRadius={first.isBlur ? 8 : 0} />
                    <View style={{ position: 'absolute', right: -6, bottom: -6, minWidth: 26, height: 22, borderRadius: 11, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>
                        {/* Si cluster flouté, on met "+..." comme demandé si nombre > 9 par ex, sinon juste nombre */}
                        {count > 99 ? '99+' : count}
                      </Text>
                    </View>
                  </View>
                </View>
              </Marker>
            );
          })
        : nearby.map((u) => (
            <Marker
              key={u.id}
              coordinate={{ latitude: u.lat, longitude: u.lng }}
              onPress={() => onSelect(u)}
              tracksViewChanges={true}
              opacity={u.isOnline ? 1 : 0.6}
              zIndex={u.isOnline ? 10 : 1}
            >
              <View style={{ alignItems: 'center' }}>
                <Avatar 
                  uri={u.img} 
                  initials={u.name.charAt(0)} 
                  size={38} 
                  ring 
                  ringColor={u.isOnline ? C.tint : '#888'} 
                  useRNImage 
                  blurRadius={u.isBlur ? 8 : 0} 
                />
              </View>
            </Marker>
          ))}
    </MapBase>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
