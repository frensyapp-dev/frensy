import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseconfig';
import { nextRouteForProfile } from '../lib/authGate';
import { getUserProfile } from '../lib/profile';
import { router } from 'expo-router';

export default function IndexGate() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return router.replace('/' as any);

      const prof = await getUserProfile(u.uid);
      return router.replace(nextRouteForProfile(prof) as any);
    });
    return unsub;
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
