import '@/lib/backgroundLocation'; // Register background task
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { ErrorBoundary, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { TutorialProvider } from '../components/TutorialProvider';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { ToastProvider } from '../components/ui/Toast';
import { DialogProvider } from '../components/ui/Dialog';
import { auth } from '../firebaseconfig';
import { initRevenueCat } from '../lib/revenuecat';

// Configure notifications to show even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export { ErrorBoundary };

export default function RootLayout() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      initRevenueCat(user?.uid || undefined).catch(() => {});
    });
    return unsub;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ToastProvider>
        <DialogProvider>
          <TutorialProvider>
            <ThemeProvider value={DarkTheme}>
              <StatusBar style="light" />
              <OfflineBanner />
              <Stack
                screenOptions={{
                  headerShown: false,
                  gestureEnabled: false,
                  presentation: 'card',
                  animation: 'fade',
                }}
              />
            </ThemeProvider>
          </TutorialProvider>
        </DialogProvider>
      </ToastProvider>
    </GestureHandlerRootView>
  );
}
