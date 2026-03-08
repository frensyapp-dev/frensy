// lib/notifications.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { auth } from '../firebaseconfig';
import { getUserProfile, savePartialProfile } from './profile';

// (optionnel) canal Android
export async function setupAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
}

/**
 * Demande l’autorisation, récupère le token Expo et le sauvegarde
 * avec des préférences par défaut si c’est la première fois.
 * Retourne true si l’autorisation est accordée.
 */
export async function ensurePushPermissionAndSave(): Promise<boolean> {
  await setupAndroidChannel();

  // Vérifie/sollicite la permission
  let perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) {
    perms = await Notifications.requestPermissionsAsync();
  }
  const granted = perms.granted === true;
  if (!granted) return false;

  // Récupère le token Expo
  const token = (await Notifications.getExpoPushTokenAsync()).data;

  // Sauvegarde côté Firestore sur le doc utilisateur
  const uid = auth.currentUser?.uid;
  if (uid) {
    await savePartialProfile(uid, {
      // @ts-ignore - structure libre côté doc
      expoPushToken: token,
      notifications: {
        peopleNearby: true,
        newMessage: true,
        invitations: true,
        matches: true,
        appUpdates: false,
      },
    });
  }

  return true;
}

export async function registerNotificationCategories() {
  try {
    await Notifications.setNotificationCategoryAsync('MESSAGE', [
      { identifier: 'REPLY', buttonTitle: 'Répondre', options: { opensAppToForeground: true } },
      { identifier: 'MARK_READ', buttonTitle: 'Marquer comme lu', options: { opensAppToForeground: true } },
    ]);
  } catch {}
}

function kLastNotif(chatId: string) {
  return `notif:last:${chatId}`;
}

export async function dismissChatNotification(chatId: string) {
  try {
    const id = await AsyncStorage.getItem(kLastNotif(chatId));
    if (id) await Notifications.dismissNotificationAsync(id);
    
    // Also try to dismiss any other notifications for this chat (remote ones)
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
       const d = n.request.content.data as any;
       if (d?.chatId === chatId || d?.senderId === chatId) {
         await Notifications.dismissNotificationAsync(n.request.identifier);
       }
    }
  } catch {}
}

export async function showMessageNotification(partnerUid: string, preview: string, chatId: string) {
  try {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const prof = await getUserProfile(partnerUid);
    const title = prof?.firstName ? `Nouveau message de ${prof.firstName}` : 'Nouveau message';
    const data: any = { type: 'chat', senderId: partnerUid, chatId };

    const u = auth.currentUser?.uid;
    let sound: any = 'default';
    let badge: number | undefined = undefined;
    try {
      const prefs = await getUserProfile(u || '');
      const n: any = (prefs as any)?.notifications || {};
      if (n?.newMessage === false) return;
      sound = n?.newMessageSound === false ? undefined : 'default';
      badge = n?.badgeCount ?? undefined;
    } catch {}

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: preview || '',
        data,
        sound,
        badge,
        categoryIdentifier: 'MESSAGE',
        subtitle: prof?.firstName || undefined,
      },
      trigger: null,
    });
    await AsyncStorage.setItem(kLastNotif(chatId), id);
  } catch {}
}
