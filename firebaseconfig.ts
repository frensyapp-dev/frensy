import { getApp, getApps, initializeApp } from 'firebase/app';
// @ts-ignore
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import * as firebaseAuth from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// 1) App (éviter double init en dev)
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// 2) Auth with Persistence
type Auth = firebaseAuth.Auth;
let authInstance: Auth;
try {
  const { initializeAuth, getReactNativePersistence } = firebaseAuth as any;
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = firebaseAuth.getAuth(app);
}
export const auth = authInstance;

// 3) Firestore / Storage / Functions
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1'); // Region default

// Helper
export const STORAGE_ENABLED =
  !!firebaseConfig.storageBucket && firebaseConfig.storageBucket.length > 0;

try {
  const key = process.env.EXPO_PUBLIC_RECAPTCHA_V3_KEY;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && key && key.length > 0) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(key),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch {
}
