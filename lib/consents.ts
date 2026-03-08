// lib/consents.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { savePartialProfile } from './profile';
import { auth } from '../firebaseconfig';

type ConsentKey = 'location' | 'notifications';
const kConsent = (key: ConsentKey) => `consent:${key}`;

export async function getConsent(key: ConsentKey): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(kConsent(key));
    return v === 'true';
  } catch {
    return false;
  }
}

export async function setConsent(key: ConsentKey, value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(kConsent(key), value ? 'true' : 'false');
  } catch {}
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      // Persiste côté profil pour conformité RGPD (cast pour champs libres)
      await savePartialProfile(uid, ({ consents: { [key]: value } } as any));
    }
  } catch {}
}
