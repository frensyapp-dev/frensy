import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const makeKey = (uid: string) => `shareConfirmShown:${uid}`;
const makeActiveKey = (uid: string, partnerUid: string) => `shareActive:${uid}:${partnerUid}`;

export async function hasShareConfirmShown(uid: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(makeKey(uid)) === '1';
    }
    const v = await AsyncStorage.getItem(makeKey(uid));
    return v === '1';
  } catch {
    return false;
  }
}

export async function markShareConfirmShown(uid: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(makeKey(uid), '1');
      return;
    }
    await AsyncStorage.setItem(makeKey(uid), '1');
  } catch {}
}

export async function getShareActivePref(uid: string, partnerUid: string): Promise<boolean> {
  try {
    const k = makeActiveKey(uid, partnerUid);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(k) === '1';
    }
    const v = await AsyncStorage.getItem(k);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setShareActivePref(uid: string, partnerUid: string, active: boolean): Promise<void> {
  try {
    const k = makeActiveKey(uid, partnerUid);
    const val = active ? '1' : '0';
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(k, val);
      return;
    }
    await AsyncStorage.setItem(k, val);
  } catch {}
}
