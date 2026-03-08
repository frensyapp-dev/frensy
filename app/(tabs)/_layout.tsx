// app/(tabs)/_layout.tsx
import { ChatTabIcon, ProfileTabIcon } from '@/components/navigation/TabBarIcons';
import { Colors } from '@/constants/Colors';
import { auth, db } from '@/firebaseconfig';
import { listenMyMatches, markConversationRead } from '@/lib/chat/storage';
import { dismissChatNotification, registerNotificationCategories, showMessageNotification } from '@/lib/notifications';
import { startRealtimePositionTracking } from '@/lib/positions';
import { getUserProfile, UserProfile } from '@/lib/profile';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMaterialTopTabNavigator, MaterialTopTabNavigationEventMap, MaterialTopTabNavigationOptions } from '@react-navigation/material-top-tabs';
import { ParamListBase, TabNavigationState } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as Notifications from 'expo-notifications';
import { router, usePathname, withLayoutContext } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { deleteDoc, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const { Navigator } = createMaterialTopTabNavigator();

const MaterialTopTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(Navigator);

export default function TabsLayout() {
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const C = Colors['dark'];
  const CDark = Colors['dark'];
  const stopTrackingRef = useRef<(() => void) | null>(null);
  const pathname = usePathname();

  // Notification logic
  const knownMessages = useRef<Map<string, number>>(new Map());
  const firstLoad = useRef(true);

  useEffect(() => {
    // Listen for new messages globally
    const unsub = listenMyMatches((matches) => {
      const me = auth.currentUser?.uid;
      if (!me) return;

      matches.forEach(m => {
        const lastMsgAt = m.lastMessageAt && typeof m.lastMessageAt === 'object' && 'toMillis' in m.lastMessageAt 
          ? (m.lastMessageAt as any).toMillis() 
          : (typeof m.lastMessageAt === 'number' ? m.lastMessageAt : 0);
        
        const prevAt = knownMessages.current.get(m.id) || 0;

        if (!firstLoad.current) {
           if (lastMsgAt > prevAt && m.lastSenderId && m.lastSenderId !== me) {
              // Check if we are already in this chat
              const partnerUid = m.users.find(u => u !== me);
              const isOnChat = pathname === `/chat/${partnerUid}` || pathname === `/chat/${m.id}`; // id can be matchId or partnerUid depending on implementation, usually matchId for group or partnerUid for direct
              
              if (!isOnChat && partnerUid) {
                 showMessageNotification(partnerUid, m.lastMessageText || 'Nouveau message', m.id);
              }
           }
        }
        knownMessages.current.set(m.id, lastMsgAt);
      });
      firstLoad.current = false;
    });
    return () => unsub();
  }, [pathname]);

  // ... (existing effects remain the same) ...
  useEffect(() => {
    let mounted = true;
    const unsub = onAuthStateChanged(auth, (u) => {
      (async () => {
        if (!u) {
          router.replace('/');
          if (mounted) setChecking(false);
          return;
        }
        const prof = await getUserProfile(u.uid);
        if (mounted) {
          setProfile(prof);
        }
        if (!prof?.completed) {
          router.replace('/onboarding/welcome');
        }
        if (mounted) setChecking(false);
      })();
    });
    return () => { mounted = false; unsub(); };
  }, []);

  useEffect(() => {
    registerNotificationCategories();
  }, []);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    let publicData: any = {};
    let privateData: any = {};

    const updateState = () => {
       setProfile({ ...publicData, ...privateData });
    };

    const ref = doc(db, 'users', u.uid);
    const off = onSnapshot(ref, (snap) => {
      try {
        if (snap.exists()) {
           publicData = snap.data();
           updateState();
        }
      } catch {}
    });

    // Listen to private settings for ghostMode
    const refPrivate = doc(db, 'users', u.uid, 'private', 'settings');
    const offPrivate = onSnapshot(refPrivate, (snap) => {
       try {
          if (snap.exists()) {
             privateData = snap.data();
             updateState();
          }
       } catch {}
    });

    return () => { 
        try { off(); } catch {} 
        try { offPrivate(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentUser?.uid]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;
    if (profile?.ghostMode) {
      if (stopTrackingRef.current) {
        try { stopTrackingRef.current(); } catch {}
        stopTrackingRef.current = null;
      }
      deleteDoc(doc(db, 'positions', u.uid)).catch(() => {});
      return;
    }
    if (profile && !stopTrackingRef.current) {
      startRealtimePositionTracking().then(stop => {
        stopTrackingRef.current = stop;
      }).catch(e => {
        // Tracking start failed
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.ghostMode, auth.currentUser?.uid, profile]);

  useEffect(() => {
    return () => {
      if (stopTrackingRef.current) {
        try { stopTrackingRef.current(); } catch {}
        stopTrackingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      const u = auth.currentUser;
      if (!u) return;
      try {
        const kLastActive = `app:lastActive:${u.uid}`;
        const raw = await AsyncStorage.getItem(kLastActive);
        const now = Date.now();
        if (raw) {
          const last = Number(raw);
          if (now - last > 7 * 24 * 3600 * 1000) {
            const { collection, query, where, getDocs, writeBatch } = await import('firebase/firestore');
            const q = query(collection(db, 'locationShares'), where('from', '==', u.uid), where('active', '==', true));
            const snap = await getDocs(q);
            if (!snap.empty) {
              const batch = writeBatch(db);
              snap.forEach(d => {
                batch.update(d.ref, { active: false, revoked: true, updatedAt: serverTimestamp() });
              });
              await batch.commit();
              Alert.alert('Partage de position', 'Vos partages de position ont été désactivés car vous avez été inactif pendant plus d\'une semaine.');
            }
          }
        }
        await AsyncStorage.setItem(kLastActive, String(now));
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentUser?.uid]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data: any = response?.notification?.request?.content?.data || {};
        const action = response?.actionIdentifier;
        if (data?.type === 'chat') {
          const senderId = typeof data?.senderId === 'string' ? data.senderId : '';
          const chatId = typeof data?.chatId === 'string' ? data.chatId : '';
          if (action === 'MARK_READ') {
            if (senderId) { markConversationRead(senderId).catch(()=>{}); dismissChatNotification(chatId || senderId).catch(()=>{}); }
            return;
          }
          if (senderId) {
            router.push(`/chat/${senderId}` as any);
            return;
          }
          if (chatId && chatId.includes('_')) {
            const me = auth.currentUser?.uid;
            if (me) {
              const [a, b] = chatId.split('_');
              const partner = a === me ? b : a;
              router.push(`/chat/${partner}` as any);
            }
          }
        } else if (data?.type === 'match') {
          const partnerUid = typeof data?.partnerUid === 'string' ? data.partnerUid : '';
          if (partnerUid) router.push(`/chat/${partnerUid}` as any);
          else router.push('/(tabs)/chats' as any);
        } else if (data?.type === 'invitation') {
          router.push('/(tabs)/chats' as any);
        } else if (data?.type === 'nearby') {
          router.push('/(tabs)/discover' as any);
        }
      } catch {}
    });
    return () => { try { sub.remove(); } catch {} };
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
        <MaterialTopTabs
          initialRouteName="home"
          tabBarPosition="bottom"
          screenOptions={{
            tabBarActiveTintColor: CDark.tint,
            tabBarInactiveTintColor: '#666',
            tabBarStyle: { 
              backgroundColor: '#080808', 
              borderTopWidth: 0,
              height: 90,
              paddingBottom: 20,
              paddingTop: 10,
              elevation: 0,
              shadowOpacity: 0,
            },
            tabBarShowLabel: false,
            tabBarIndicatorStyle: { display: 'none' }, // Hide the top line indicator
            swipeEnabled: true,
            animationEnabled: true,
            tabBarPressColor: 'transparent',
          }}
        >
          <MaterialTopTabs.Screen
            name="home"
            options={{ 
              title: 'Home',
              swipeEnabled: false,
              tabBarIcon: ({ color }) => (
                <View style={{ width: 28, height: 28 }}>
                  <Image 
                    source={require('../../assets/images/frensylogo.png')} 
                    style={{ width: 28, height: 28, tintColor: color }} 
                    contentFit="contain" 
                  />
                  <View style={{ position: 'absolute', top: 9, left: 8.5, width: 5, height: 5, borderRadius: 3, backgroundColor: CDark.card }} />
                  <View style={{ position: 'absolute', top: 9.5, right: 9, width: 4, height: 4, borderRadius: 2, backgroundColor: CDark.card }} />
                </View>
              )
            }}
          />
          <MaterialTopTabs.Screen
            name="discover"
            options={{ 
              title: 'Discover',
              tabBarIcon: ({ color }) => <FontAwesome name="search" size={28} color={color} />,
              swipeEnabled: false,
            }}
          />
          <MaterialTopTabs.Screen
            name="chats"
            options={{ 
              title: 'Chats',
              tabBarIcon: ({ color }) => <ChatTabIcon color={color} scheme="dark" /> 
            }}
          />
          <MaterialTopTabs.Screen
            name="profile"
            options={{ 
              title: 'Profile',
              tabBarIcon: ({ color }) => <ProfileTabIcon color={color} /> 
            }}
          />
        </MaterialTopTabs>
    </GestureHandlerRootView>
  );
}

