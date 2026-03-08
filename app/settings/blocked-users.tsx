import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, router } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { auth, db } from '../../firebaseconfig';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { unblockUser } from '../../lib/block';
import { Image } from 'expo-image';
import { FontAwesome } from '@expo/vector-icons';
import { getUserProfile, UserProfile } from '../../lib/profile';

type BlockedUser = {
  uid: string;
  profile?: UserProfile;
};

export default function BlockedUsersScreen() {
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const C = Colors['dark'];

  useEffect(() => {
    loadBlockedUsers();
  }, []);

  async function loadBlockedUsers(isRefresh = false) {
    if (!isRefresh) setLoading(true);
    else setRefreshing(true);
    
    try {
      const me = auth.currentUser?.uid;
      if (!me) {
          setUsers([]);
          return;
      }
      const snap = await getDocs(collection(db, 'blocks', me, 'users'));
      
      // Load profiles in parallel and handle errors individually
      const promises = snap.docs.map(async (d) => {
        const uid = d.id; 
        try {
            const p = await getUserProfile(uid);
            return { uid, profile: p || undefined };
        } catch (e) {
            console.warn(`Could not load profile for blocked user ${uid}`, e);
            return { uid, profile: undefined };
        }
      });

      const items = await Promise.all(promises);
      setUsers(items);
    } catch (e) {
      console.error(e);
      Alert.alert('Erreur', 'Impossible de charger les utilisateurs bloqués.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const onRefresh = () => loadBlockedUsers(true);

  async function handleUnblock(uid: string, name?: string) {
    Alert.alert(
      'Débloquer',
      `Voulez-vous débloquer ${name || 'cet utilisateur'} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { 
          text: 'Débloquer', 
          onPress: async () => {
            try {
              await unblockUser(uid);
              setUsers(prev => prev.filter(u => u.uid !== uid));
            } catch (e) {
              Alert.alert('Erreur', "Impossible de débloquer l'utilisateur");
            }
          } 
        }
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Header */}
      <View style={{ paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: '#000' }}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
            <FontAwesome name="arrow-left" size={18} color="#fff" />
        </TouchableOpacity>
        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900' }}>Bloqués</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={u => u.uid}
          contentContainerStyle={{ padding: 20, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                 <FontAwesome name="check" size={32} color="#4ade80" />
              </View>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>C&apos;est tout bon !</Text>
              <Text style={{ color: '#888', fontSize: 16, textAlign: 'center' }}>Aucun utilisateur bloqué pour le moment.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const photoUrl = item.profile?.photos?.find(p => p.path === item.profile?.primaryPhotoPath)?.url 
              || item.profile?.photos?.[0]?.url;

            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c1c1e', padding: 12, borderRadius: 20, marginBottom: 12 }}>
                <Image 
                  source={{ uri: photoUrl }}
                  style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#333' }}
                  contentFit="cover"
                />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 2 }}>
                    {item.profile?.firstName || 'Utilisateur inconnu'}
                  </Text>
                  <Text style={{ color: '#666', fontSize: 13, fontWeight: '500' }}>
                     Bloqué
                  </Text>
                </View>
                <TouchableOpacity 
                  onPress={() => handleUnblock(item.uid, item.profile?.firstName)}
                  style={{ backgroundColor: '#2c2c2e', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Débloquer</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
