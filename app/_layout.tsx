import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { ToastProvider } from '../components/ui/Toast';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { TutorialProvider } from '../components/TutorialProvider';
import '@/lib/backgroundLocation'; // Register background task

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

import { ErrorBoundary } from 'expo-router';

export { ErrorBoundary };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ToastProvider>
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
      </ToastProvider>
    </GestureHandlerRootView>
  );
}
