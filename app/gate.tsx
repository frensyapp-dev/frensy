import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseconfig';
import { getUserProfile } from '../lib/profile';
import { router } from 'expo-router';

export default function IndexGate() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return router.replace('/' as any);

      const prof = await getUserProfile(u.uid);

      if (!prof?.accountType) return router.replace('/onboarding/account-type' as any);
      if (!prof?.firstName) return router.replace('/onboarding/name' as any);
      if (typeof prof?.age !== 'number') return router.replace('/onboarding/age' as any);
      // We check for interests or genders to know if preferences step was done
      if (!prof?.interests || !prof?.genders) return router.replace('/onboarding/preferences' as any);
      
      if (!prof?.primaryPhotoPath) return router.replace('/onboarding/add-photo' as any);
      if (!prof?.completed) return router.replace('/onboarding/add-photo' as any); // fallback to last step

      return router.replace('/(tabs)/discover' as any);
    });
    return unsub;
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}