// app/onboarding/_layout.tsx
import { router } from 'expo-router';
import { Stack } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect } from 'react';
import { auth } from '../../firebaseconfig';

export default function OnboardingLayout() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.replace('/' as any);
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false, // ← pas de swipe back
        presentation: 'card',
      }}
    />
  );
}
