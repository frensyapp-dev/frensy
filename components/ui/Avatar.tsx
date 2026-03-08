import { Image as ExpoImage } from 'expo-image';
import React from 'react';
import { Image as RNImage, StyleSheet, Text, View, ViewStyle } from 'react-native';

type Props = {
  uri?: string;
  size?: number;
  initials?: string;
  style?: ViewStyle | ViewStyle[];
  ring?: boolean;
  ringColor?: string;
  ringWidth?: number;
  // Nouveaux props
  focusX?: number; // 0 (gauche) -> 1 (droite), par défaut 0.5
  focusY?: number; // 0 (haut) -> 1 (bas), par défaut 0.5
  note?: string;   // texte à afficher en bulle capsule
  zoom?: number;   // facteur de zoom (>=1), par défaut 1.0
  useRNImage?: boolean; // utilise l'Image RN (utile dans les markers de map)
  blurRadius?: number; // flou
};

export default function Avatar({ uri, initials, size = 40, style, ring = false, ringColor = '#F97316', ringWidth = 2, focusX = 0.5, focusY = 0.5, note, zoom = 1, useRNImage = false, blurRadius }: Props) {
  const [error, setError] = React.useState(false);
  // Reset error if uri changes
  React.useEffect(() => { setError(false); }, [uri]);

  // Utilise expo-image pour un crop "cover" et une position de contenu ajustable
  // contentPosition accepte des pourcentages X Y (ex: '50% 30%')
  // const pos = `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`; // Unused
  const clampZoom = (z: number) => Math.max(1, Math.min(3, z)); // Max zoom 3 comme dans l'éditeur
  const z = clampZoom(zoom);
  
  // Convertit focus (0..1) en transform Translate
  // Si zoom > 1, on peut décaler l'image pour centrer le focus
  
  const shiftX = (0.5 - focusX) * size * (z - 1); 
  const shiftY = (0.5 - focusY) * size * (z - 1);

  return (
    <View style={[
      styles.wrap,
      { width: size, height: size, borderRadius: size/2 },
      ring && { borderWidth: ringWidth, borderColor: ringColor },
      style
    ]}>
      {uri && !error ? (
        useRNImage ? (
          <RNImage
            source={{ uri }}
            style={{ 
              width: '100%', 
              height: '100%', 
              borderRadius: size/2, 
              transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale: z }] 
            }}
            resizeMode="cover"
            blurRadius={blurRadius}
            onError={() => setError(true)}
          />
        ) : (
          <ExpoImage
            source={{ uri }}
            style={{ 
              width: '100%', 
              height: '100%', 
              borderRadius: size/2, 
              transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale: z }] 
            }}
            contentFit="cover"
            blurRadius={blurRadius}
            onError={() => setError(true)}
          />
        )
      ) : (
        <View style={[styles.initialWrap, { width: '100%', height: '100%', borderRadius: size/2 }]}> 
          <Text style={styles.initials}>{(initials || '?').slice(0,2).toUpperCase()}</Text>
        </View>
      )}

      {!!note && (
        <View style={styles.noteCapsule}>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems:'center', justifyContent:'center', overflow:'hidden' },
  initialWrap: { alignItems:'center', justifyContent:'center', backgroundColor: 'rgba(0,0,0,0.2)' },
  initials: { color: '#fff', fontWeight:'800' },
  noteCapsule: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  noteText: { color: '#111827', fontWeight: '800', fontSize: 12 }
});
