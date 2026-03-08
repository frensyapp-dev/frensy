import React, { memo, useMemo } from 'react';
import { Platform, View, StyleSheet, Text } from 'react-native';
import { Marker } from 'react-native-maps';
import Avatar from '../ui/Avatar';

type Props = {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  initials?: string;
  onPress?: () => void;
  name?: string;
  distance?: number;
  isApproximate?: boolean;
};

function AvatarMarker({ 
  coordinate, 
  uri, 
  initials, 
  onPress, 
  name, 
  distance, 
  isApproximate = true 
}: Props) {
  const distanceText = useMemo(() => {
    if (distance === undefined) return isApproximate ? 'Position approx.' : 'Position précise';
    return `${distance.toFixed(1)} km ${isApproximate ? '(approx.)' : ''}`;
  }, [distance, isApproximate]);

  if (Platform.OS === 'web') {
    return (
      <View style={{ alignItems: 'center' }}>
        <Avatar uri={uri} initials={initials} size={38} ring />
        {name && (
          <View style={styles.badge}>
            <Text style={styles.name}>{name}</Text>
            {distanceText && <Text style={styles.distance}>{distanceText}</Text>}
          </View>
        )}
      </View>
    );
  }

  return (
    <Marker coordinate={coordinate} onPress={onPress} tracksViewChanges={false}>
      <View style={styles.container}>
        <Avatar uri={uri} initials={initials} size={38} ring />
        {name && (
          <View style={styles.badge}>
            <Text style={styles.name}>{name}</Text>
            {distanceText && <Text style={styles.distance}>{distanceText}</Text>}
          </View>
        )}
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  badge: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
    alignItems: 'center',
  },
  name: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  distance: {
    color: 'white',
    fontSize: 10,
    opacity: 0.8,
  }
});

export default memo(AvatarMarker);

