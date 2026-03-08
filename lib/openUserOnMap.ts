import { router } from 'expo-router';

export function openUserOnMap(uid: string) {
  // Navigate to home tab with focusUid param to center map on user
  router.push({ pathname: '/(tabs)/home', params: { focusUid: uid } });
}
