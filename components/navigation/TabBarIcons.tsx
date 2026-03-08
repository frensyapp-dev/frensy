import FontAwesome from '@expo/vector-icons/FontAwesome';
import { onSnapshot, doc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Avatar from '../ui/Avatar';
import { auth, db } from '../../firebaseconfig';
import { Colors } from '../../constants/Colors';
import { ChatRequest, listenMyChatInvitations, loadConversations, getReadAt } from '../../lib/chat/storage';
import { getUserProfile, UserProfile } from '../../lib/profile';

export const ProfileTabIcon = ({ color }: { color: string }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;
    
    // Initial fetch
    getUserProfile(u.uid).then(setProfile);

    // Real-time listener for updates (focus, zoom, etc.)
    const ref = doc(db, 'users', u.uid);
    const off = onSnapshot(ref, (snap) => {
      try {
        if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
        }
      } catch {}
    });
    return () => { try { off(); } catch {} };
  }, []);

  const photos = (profile?.photos ?? []) as { path: string; url: string; createdAt: number }[];
  const primaryPath = profile?.primaryPhotoPath ?? null;
  const primaryUrl = primaryPath ? photos.find((p) => p.path === primaryPath)?.url ?? null : null;
  const initials = (profile?.firstName ?? 'U').trim()[0]?.toUpperCase() || 'U';

  return (
    <Avatar
      uri={primaryUrl ?? undefined}
      initials={initials}
      size={28}
      ring
      ringColor={color}
      ringWidth={1}
      focusX={profile?.avatarFocusX ?? 0.5}
      focusY={profile?.avatarFocusY ?? 0.5}
      zoom={typeof (profile as any)?.avatarZoom === 'number' ? (profile as any).avatarZoom : 1}
    />
  );
};

export const ChatTabIcon = ({ color, scheme }: { color: string, scheme?: 'light' | 'dark' | null }) => {
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  
  // We need colors for the badge background. 
  // We can pass scheme or hardcode/import Colors.
  // Let's import Colors.
  const tint = Colors[scheme ?? 'light'].tint;

  useEffect(() => {
    const off = listenMyChatInvitations((reqs: ChatRequest[]) => {
      const n = reqs.filter(r => r.status === 'pending').length;
      setPendingCount(n);
    });
    return off;
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const convos = await loadConversations();
        const me = auth.currentUser?.uid;
        let n = 0;
        for (const c of convos) {
          const lastAt = c.lastMessageAt || 0;
          const read = (await getReadAt(c.id)) || 0;
          // If I am the last sender, it's not unread for me
          if (c.lastSenderId && c.lastSenderId === me) continue;
          if (lastAt > read) n++;
        }
        if (alive) setUnreadCount(n);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <FontAwesome name="comments" size={28} color={color} />
      {(pendingCount + unreadCount) > 0 && (
        <View style={{ position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: tint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{pendingCount + unreadCount}</Text>
        </View>
      )}
    </View>
  );
};
