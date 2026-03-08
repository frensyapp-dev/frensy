import { Stack, router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Linking, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/Colors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { deleteEntireUserAccount } from '../lib/deleteAccount';
import { getConsent, setConsent } from '../lib/consents';
import { ensurePushPermissionAndSave } from '../lib/notifications';
import { exportMyData } from '../lib/exportData';

export default function PrivacyScreen() {
  const C = Colors['dark'];
  const insets = useSafeAreaInsets();
  const [deleting, setDeleting] = useState(false);
  const [locConsent, setLocConsent] = useState(false);
  const [notifConsent, setNotifConsent] = useState(false);

  useEffect(() => {
    (async () => {
      setLocConsent(await getConsent('location'));
      setNotifConsent(await getConsent('notifications'));
    })();
  }, []);

  const confirmAndDelete = () => {
    if (deleting) return;
    Alert.alert(
      'Supprimer mon compte',
      'Cette action est définitive et supprime toutes tes données (profil, photos, positions, likes, matchs, messages et invitations). Confirmer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Oui, supprimer', style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await deleteEntireUserAccount();
              setDeleting(false);
              Alert.alert('Compte supprimé', 'Ton compte et tes données ont été supprimés.');
              try { router.replace('/'); } catch {}
            } catch (e: any) {
              setDeleting(false);
              const msg = e?.message || String(e);
              if (msg && msg.includes('requires-recent-login')) {
                Alert.alert('Reconnexion requise', "Pour supprimer ton compte, reconnecte-toi (sécurité) puis réessaie.");
              } else {
                Alert.alert('Erreur', msg);
              }
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 6 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <FontAwesome name="chevron-left" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '900', color: C.text }}>Vie privée</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 16 }}>
        {/* Consentements RGPD */}
        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 12 }}>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>Consentements</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: C.text, fontWeight: '700' }}>Localisation</Text>
              <Text style={{ color: C.muted }}>Utilisée pour proximité et partage ponctuel dans le chat.</Text>
            </View>
            <Switch value={locConsent} onValueChange={async (v) => {
              if (v) {
                Alert.alert('Consentement localisation', "Tu autorises l'utilisation de ta position dans Frensy.", [
                  { text: 'OK', onPress: async () => { await setConsent('location', true); setLocConsent(true); } }
                ]);
              } else {
                await setConsent('location', false); setLocConsent(false);
              }
            }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: C.text, fontWeight: '700' }}>Notifications</Text>
              <Text style={{ color: C.muted }}>Recevoir alertes de messages, invitations et matchs.</Text>
            </View>
            <Switch value={notifConsent} onValueChange={async (v) => {
              if (v) {
                const ok = await ensurePushPermissionAndSave();
                if (ok) { await setConsent('notifications', true); setNotifConsent(true); }
                else { Alert.alert('Refusées', 'Les notifications n’ont pas été autorisées.'); }
              } else {
                await setConsent('notifications', false); setNotifConsent(false);
              }
            }} />
          </View>
        </View>

        {/* Export des données */}
        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>Export des données</Text>
          <Text style={{ color: C.muted }}>Télécharge un JSON de tes données (profil, positions, interactions, messages récents).</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Exporter mes données"
            onPress={async () => {
              try {
                const res = await exportMyData();
                if (res.fileUri) {
                  Alert.alert('Export prêt', 'Fichier JSON généré dans le cache de l’app.');
                } else if (res.content) {
                  Alert.alert('Export (web)', 'Contenu JSON préparé. Copie effectuée si autorisée.');
                }
              } catch (e: any) {
                Alert.alert('Erreur', e?.message || 'Export impossible');
              }
            }}
            style={{ marginTop: 6, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: C.tint, borderWidth: 1, borderColor: C.border }}
          >
            <Text style={{ color: '#fff', fontWeight: '900' }}>Exporter mes données (JSON)</Text>
          </TouchableOpacity>
        </View>

        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>Politique de confidentialité</Text>
          <Text style={{ color: C.text }}>
            Frensy privilégie ta vie privée: positions filtrées par précision et récence, anonymisation des coordonnées sur la carte web, et contrôle de ton profil. Les informations sensibles ne sont jamais partagées publiquement.
          </Text>
          <Text style={{ color: C.muted }}>
            Plus d’infos: les coordonnées exactes ne sont utilisées que pour calculer la proximité et ne sont pas exposées aux autres utilisateurs. Tu peux supprimer ton compte ci-dessous.
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://frensyapp-dev.github.io/frensy/privacy.html')}>
            <Text style={{ color: C.tint, fontWeight: 'bold' }}>Lire le document complet</Text>
          </TouchableOpacity>
        </View>

        {/* Mentions légales */}
        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>Mentions légales</Text>
          <Text style={{ color: C.muted }}>
            Éditeur: Frensy. Hébergeur: Firebase/Google Cloud. Contact: frensy.app@gmail.com
          </Text>
          <Text style={{ color: C.muted }}>
            Conditions d’utilisation et politique de confidentialité mises à jour. Consulte les paramètres pour gérer tes consentements et notifications.
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://frensyapp-dev.github.io/frensy/terms.html')}>
            <Text style={{ color: C.tint, fontWeight: 'bold' }}>Lire les CGU</Text>
          </TouchableOpacity>
        </View>

        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>Suppression du compte</Text>
          <Text style={{ color: C.muted }}>
            Cette action supprime définitivement tes données. Une confirmation t’est demandée.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Supprimer mon compte"
            onPress={confirmAndDelete}
            disabled={deleting}
            style={{ marginTop: 6, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: deleting ? '#ef444488' : '#ef4444', borderWidth: 1, borderColor: '#ef444466', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
          >
            {deleting && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: '900' }}>{deleting ? 'Suppression…' : 'Supprimer mon compte'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
