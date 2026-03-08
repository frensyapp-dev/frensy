import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [isConnected, setIsConnected] = useState<boolean | null>(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      // On iOS, isInternetReachable can be null initially, assume true if connected to network
      // But if explicitly false, show banner
      const connected = state.isConnected;
      const reachable = state.isInternetReachable;
      
      if (connected === false) {
        setIsConnected(false);
      } else if (connected === true && reachable === false) {
        setIsConnected(false);
      } else {
        setIsConnected(true);
      }
    });

    return () => unsubscribe();
  }, []);

  if (isConnected !== false) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <Text style={styles.text}>Pas de connexion Internet</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ef4444',
    width: '100%',
    alignItems: 'center',
    paddingBottom: 8,
    position: 'absolute',
    top: 0,
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
