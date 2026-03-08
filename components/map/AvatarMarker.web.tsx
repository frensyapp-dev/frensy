import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Avatar from '../ui/Avatar';

type Props = {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  initials?: string;
  onPress?: () => void;
  name?: string;
  distance?: number;
  isApproximate?: boolean;
  showDistance?: boolean;
  focusX?: number;
  focusY?: number;
  zoom?: number;
  ringColor?: string;
};

function AvatarMarker({ uri, initials, focusX, focusY, zoom, ringColor }: Props) {
  return (
    <View style={styles.container}>
      <Avatar uri={uri} initials={initials} size={38} ring ringColor={ringColor} focusX={focusX} focusY={focusY} zoom={zoom} />
      
    </View>
  );
}

export default memo(AvatarMarker);

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
});
