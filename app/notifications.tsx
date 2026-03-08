// app/notifications.tsx
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Alert, Switch, Text, View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Colors } from '../constants/Colors';
import { auth } from '../firebaseconfig';
import { getUserProfile, savePartialProfile } from '../lib/profile';
import { router } from 'expo-router';
import { useToast } from '../components/ui/Toast';

export default function NotificationSettings() {
  const C = Colors['dark'];
  const { showToast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [nearby, setNearby] = useState(true);
  const [messages, setMessages] = useState(true);
  const [invitations, setInvitations] = useState(true);
  const [matches, setMatches] = useState(true);
  const [updates, setUpdates] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [vibrateOn, setVibrateOn] = useState(true);

  useEffect(() => {
    (async () => {
      const u = auth.currentUser;
      if (!u) return;
      const prof = await getUserProfile(u.uid);

      // état switches si déjà sauvegardé
      const n = prof as any;
      setNearby(n?.notifications?.peopleNearby ?? true);
      setMessages(n?.notifications?.newMessage ?? true);
      setInvitations(n?.notifications?.invitations ?? true);
      setMatches(n?.notifications?.matches ?? true);
      setUpdates(n?.notifications?.appUpdates ?? false);
      setSoundOn(n?.notifications?.newMessageSound !== false);
      setVibrateOn(n?.notifications?.vibration !== false);

      const perms = await Notifications.getPermissionsAsync();
      setEnabled(perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
    })();
  }, []);

  const requestPermission = async () => {
    const perms = await Notifications.requestPermissionsAsync();
    const granted = perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    setEnabled(granted);

    // enregistre le token Expo si accordé
    if (granted) {
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      const uid = auth.currentUser?.uid;
      if (uid) await savePartialProfile(uid, { /* @ts-ignore */ expoPushToken: token } as any);
    } else {
      showToast('Notifications', "Tu pourras activer les notifications plus tard dans les réglages.", 'info');
    }
  };

  const save = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await savePartialProfile(uid, {
      /* @ts-ignore */
      notifications: {
        peopleNearby: nearby,
        newMessage: messages,
        invitations,
        matches,
        appUpdates: updates,
        newMessageSound: soundOn,
        vibration: vibrateOn,
      },
    } as any);
    router.back();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background }}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <FontAwesome name="chevron-left" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: C.text }]}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 }}>
        <Text style={{ color: C.muted, marginBottom: 20, fontSize: 14 }}>
          Choisissez les notifications que vous souhaitez recevoir pour rester informé.
        </Text>

        <View style={{ gap: 24 }}>
          {/* Section Générale */}
          <View>
            <Text style={[s.sectionTitle, { color: C.tint }]}>Général</Text>
            <Card>
              <Row label="Autoriser les notifications" icon="bell">
                <Switch 
                  value={enabled} 
                  onValueChange={() => requestPermission()} 
                  trackColor={{ false: '#767577', true: C.tint }}
                  thumbColor={'#f4f3f4'}
                />
              </Row>
            </Card>
          </View>

          {/* Section Social */}
          <View>
            <Text style={[s.sectionTitle, { color: C.tint }]}>Social</Text>
            <Card>
              <Row label="Nouvelles personnes autour" icon="map-marker" border>
                <Switch value={nearby} onValueChange={setNearby} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
              <Row label="Nouveaux messages" icon="comments" border>
                <Switch value={messages} onValueChange={setMessages} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
              <Row label="Invitations de chat" icon="envelope" border>
                <Switch value={invitations} onValueChange={setInvitations} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
              <Row label="Nouveaux matchs/likes" icon="heart" border={false}>
                <Switch value={matches} onValueChange={setMatches} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
            </Card>
          </View>

          {/* Section Préférences */}
          <View>
            <Text style={[s.sectionTitle, { color: C.tint }]}>Préférences</Text>
            <Card>
              <Row label="Mises à jour de l’app" icon="info-circle" border>
                <Switch value={updates} onValueChange={setUpdates} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
              <Row label="Son des messages" icon="volume-up" border>
                <Switch value={soundOn} onValueChange={setSoundOn} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
              <Row label="Vibration" icon="mobile" border={false}>
                <Switch value={vibrateOn} onValueChange={setVibrateOn} disabled={!enabled} trackColor={{ false: '#767577', true: C.tint }} thumbColor={'#f4f3f4'} />
              </Row>
            </Card>
          </View>
        </View>

        <TouchableOpacity onPress={save} style={[s.saveBtn, { backgroundColor: C.tint }]} disabled={!enabled}>
          <Text style={s.saveTxt}>Enregistrer les préférences</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, icon, children, border = false }: { label: string; icon: string; children: React.ReactNode; border?: boolean }) {
  const C = Colors['dark'];
  return (
    <View style={[s.row, border && { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 32, alignItems: 'center' }}>
          <FontAwesome name={icon as any} size={20} color={C.text} style={{ opacity: 0.7 }} />
        </View>
        <Text style={[s.rowLabel, { color: C.text }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  const C = Colors['dark'];
  return <View style={[s.card, { backgroundColor: C.card, borderColor: 'rgba(255,255,255,0.1)' }]}>{children}</View>;
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56 },
  title: { fontSize: 20, fontWeight: '800' },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontWeight: '600', fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 18, overflow: 'hidden', marginBottom: 4 },
  saveBtn: { marginTop: 32, paddingVertical: 16, borderRadius: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  saveTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
