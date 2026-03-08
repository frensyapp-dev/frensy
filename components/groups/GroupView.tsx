import { FontAwesome } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { DocumentSnapshot, collection, getDocs, limit, query } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Easing,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { Colors } from '../../constants/Colors';
import { db } from '../../firebaseconfig';
import { Group, createGroup, getGroupsByIds, joinGroup, listGroups } from '../../lib/groups/repo';
import { performActionUpdates } from '../../lib/monetization';
import { applyUserUpdates, getUserProfile } from '../../lib/profile';

type Tab = 'find' | 'mine';

export function GroupView({
  joinedGroups = new Set(),
  pinnedGroups = new Set(),
  onTogglePin,
  onJoinGroup,
  isVisible = true,
}: {
  joinedGroups: Set<string>;
  pinnedGroups: Set<string>;
  onTogglePin: (id: string) => void;
  onJoinGroup: (id: string) => void;
  isVisible?: boolean;
}) {
  const colors = Colors['dark'];
  const [activeTab, setActiveTab] = useState<Tab>('find');
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Stabiliser la dépendance joinedGroups pour éviter les re-renders infinis
  const joinedGroupsHash = useMemo(() => Array.from(joinedGroups).sort().join(','), [joinedGroups]);

  const sortedGroups = useMemo(() => {
    if (!Array.isArray(groups)) return [];
    
    const pinnedSet = pinnedGroups instanceof Set ? pinnedGroups : new Set();

    return [...groups].sort((a, b) => {
      const aPinned = pinnedSet.has(a.id);
      const bPinned = pinnedSet.has(b.id);
      
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      
      // Secondary sort: Member count desc
      const countA = a.memberCount || 0;
      const countB = b.memberCount || 0;
      if (countA !== countB) return countB - countA;

      return 0;
    });
  }, [groups, pinnedGroups]);

  // Cities for filter
  const CITIES = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Lille', 'Toulouse'];

  const loadGroups = useCallback(
    async (reset = false, silent = false) => {
      if (loadingRef.current && !reset) return;
      
      if (!silent) {
        setLoading(true);
        loadingRef.current = true;
      }
      
      try {
        if (reset) {
          setGroups([]);
          setLastDoc(null);
          setHasMore(true);
        }

        if (activeTab === ('mine' as Tab)) {
          // Utiliser le Set actuel (joinedGroups est stable dans le contexte du rendu, mais on utilise le hash pour la dépendance)
          const ids = Array.from(joinedGroups);
          if (ids.length === 0) {
            setGroups([]);
            setHasMore(false);
          } else {
            const myGroups = await getGroupsByIds(ids);
            setGroups(myGroups);
            setHasMore(false);
          }
          return;
        }

        const effectiveSearch = searchText || selectedCity || undefined;

        const result = await listGroups({
          limit: 10,
          lastDoc: reset ? undefined : lastDoc || undefined,
          search: effectiveSearch,
          sortBy: 'popular',
        });

        const newGroups = result.groups;

        if (activeTab === ('mine' as Tab)) {
          // Fallback au cas où
          const myGroups = newGroups.filter(g => joinedGroups.has(g.id));
          setGroups(prev => (reset ? myGroups : [...prev, ...myGroups]));
        } else {
          setGroups(prev => (reset ? newGroups : [...prev, ...newGroups]));
        }

        setLastDoc(result.lastDoc);
        const count = result.fetchedCount ?? newGroups.length;
        setHasMore(count >= 10);
      } catch {
      } finally {
        setLoading(false);
        loadingRef.current = false;
        setIsRefreshing(false);
      }
    },
    // On utilise joinedGroupsHash au lieu de joinedGroups pour éviter que la fonction ne change à chaque render du parent
    // On retire loading des dépendances car on utilise loadingRef
    [activeTab, joinedGroupsHash, lastDoc, searchText, selectedCity]
  );

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadGroups(true);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, activeTab, selectedCity, joinedGroupsHash]); // hash instead of Set

  // Refresh "My Groups" when screen is focused to ensure member counts are up to date
  useFocusEffect(
    useCallback(() => {
      // Uniquement si on est sur l'onglet 'mine' ET que le composant est visible
      if (isVisible && activeTab === 'mine') {
        loadGroups(true, true);
      }
    }, [activeTab, loadGroups, isVisible])
  );

  async function handleJoin(id: string) {
    Alert.alert('Rejoindre', 'Voulez-vous rejoindre ce groupe ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Rejoindre',
        onPress: async () => {
          try {
            const uid = getAuth().currentUser?.uid;
            if (uid) {
              await joinGroup(uid, id);
              onJoinGroup(id);
              
              // Update local state for immediate feedback
              setGroups(prev => prev.map(g => 
                g.id === id ? { ...g, memberCount: (g.memberCount || 0) + 1 } : g
              ));

              // Navigate to group or refresh
              router.push(`/group/${id}` as any);
            }
          } catch {
            Alert.alert('Erreur', 'Impossible de rejoindre le groupe');
          }
        }
      }
    ]);
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header Area */}
      <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', marginBottom: 16 }}>Groupes</Text>
        
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <View style={{ 
            flex: 1, 
            borderColor: 'transparent', 
            backgroundColor: 'rgba(255,255,255,0.08)', 
            borderRadius: 14, 
            flexDirection: 'row', 
            alignItems: 'center', 
            paddingHorizontal: 12, 
            height: 44 
          }}>
            <FontAwesome name="search" size={16} color={colors.muted} style={{ opacity: 0.7, marginRight: 8 }} />
            <TextInput
              placeholder="Rechercher..."
              placeholderTextColor={colors.muted}
              style={{ flex: 1, color: colors.text, fontSize: 16 }}
              value={searchText}
              onChangeText={setSearchText}
            />
          </View>
          <TouchableOpacity
            onPress={() => setModalVisible(true)}
            style={{ backgroundColor: colors.tint, borderRadius: 14, justifyContent: 'center', paddingHorizontal: 16, height: 44 }}
          >
            <Text style={{ color: colors.text, fontWeight: '700' }}>Créer</Text>
          </TouchableOpacity>
        </View>

        {/* City Filter - Only for "Find" tab */}
        {activeTab === 'find' && (
          <View style={{ marginBottom: 16 }}>
            <FlatList
              horizontal
              data={['Tous', ...CITIES]}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
              keyExtractor={item => item}
              renderItem={({ item }) => {
                const isActive = item === 'Tous' ? selectedCity === null : selectedCity === item;
                return (
                  <TouchableOpacity
                    onPress={() => setSelectedCity(item === 'Tous' ? null : item)}
                    style={{
                      backgroundColor: isActive ? colors.tint : colors.panel,
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: isActive ? colors.tint : colors.panelBorder
                    }}
                  >
                    <Text style={{ color: isActive ? colors.text : colors.subtleText, fontWeight: isActive ? '700' : '500' }}>{item}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}

        {/* Tabs */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <TabButton title="Trouver un groupe" active={activeTab === 'find'} onPress={() => setActiveTab('find')} color={colors.text} activeColor={colors.tint} />
          <TabButton title="Mes groupes" active={activeTab === 'mine'} onPress={() => setActiveTab('mine')} color={colors.text} activeColor={colors.tint} />
        </View>
      </View>

      {/* List */}
      <FlatList
        data={sortedGroups}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
        refreshing={isRefreshing}
        onRefresh={() => { setIsRefreshing(true); loadGroups(true); }}
        onEndReached={() => { if (hasMore) loadGroups(); }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          <View style={{ marginVertical: 20, alignItems: 'center' }}>
            {loading && !isRefreshing ? (
              <ActivityIndicator color={colors.tint} />
            ) : hasMore && groups.length > 0 ? (
              <TouchableOpacity
                onPress={() => loadGroups()}
                style={{ paddingVertical: 10, paddingHorizontal: 20, backgroundColor: colors.panel, borderRadius: 20 }}
              >
                <Text style={{ color: colors.subtleText }}>Voir plus</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <GroupCard
            item={item}
            joined={joinedGroups.has(item.id)}
            pinned={pinnedGroups.has(item.id)}
            onJoin={() => handleJoin(item.id)}
            onOpen={() => router.push(`/group/${item.id}` as any)}
            onTogglePin={() => onTogglePin(item.id)}
          />
        )}
      />

      {/* Create Modal */}
      <CreateGroupModal visible={modalVisible} onClose={() => setModalVisible(false)} onJoinGroup={onJoinGroup} />
    </View>
  );
}

function TabButton({ title, active, onPress, color, activeColor }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={{ marginRight: 20, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: active ? activeColor : 'transparent' }}>
      <Text style={{ color: active ? activeColor : color, fontWeight: active ? '700' : '500', fontSize: 16 }}>{title}</Text>
    </TouchableOpacity>
  );
}

const GroupCard = React.memo(function GroupCard({ item, joined, pinned, onJoin, onOpen, onTogglePin }: any) {
  const [avatars, setAvatars] = useState<string[]>([]);
  const C = Colors['dark'];

  useEffect(() => {
    let active = true;
    (async () => {
      if (item.memberCount === 0) return;
      // Optimisation: ne pas charger les avatars si on est déjà en train de scroller vite ou si déjà chargés ?
      // Pour l'instant, on laisse tel quel mais le React.memo aidera à éviter les re-renders inutiles
      
      try {
        // Fetch more members to pick random ones
        const q = query(collection(db, 'groups', item.id, 'members'), limit(10));
        const snap = await getDocs(q);
        if (snap.empty) return;
        
        const allDocs = snap.docs;
        const selectedDocs: DocumentSnapshot[] = [];
        // Pick 3 random members if we have enough
        if (allDocs.length <= 3) {
          selectedDocs.push(...allDocs);
        } else {
          const indices = new Set<number>();
          while (indices.size < 3) {
            indices.add(Math.floor(Math.random() * allDocs.length));
          }
          indices.forEach(i => selectedDocs.push(allDocs[i]));
        }
        
        const urls: string[] = [];
        for (const doc of selectedDocs) {
          if (!active) return;
          const uid = (doc.data() as any).userId || doc.id;
          const profile = await getUserProfile(uid);
          if (profile?.primaryPhotoPath) {
             const url = profile.photos?.find(p => p.path === profile.primaryPhotoPath)?.url;
             if (url) urls.push(url);
          }
        }
        if (active) setAvatars(urls);
      } catch {
        // ignore
      }
    })();
    return () => { active = false; };
  }, [item.id]); // On retire memberCount des dépendances pour éviter de recharger les avatars à chaque join/leave mineur

  return (
    <View style={{ backgroundColor: C.card, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: C.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>{item.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
             <Text style={{ color: C.success, fontSize: 14, fontWeight: '600' }}>{item.memberCount} membres</Text>
          </View>
          {item.city && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <FontAwesome name="map-marker" size={14} color={C.subtleText} style={{ marginRight: 4 }} />
              <Text style={{ color: C.subtleText, fontSize: 13 }}>{item.city}</Text>
            </View>
          )}
        </View>

        {/* Avatars positioned top right */}
        {avatars.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 12, paddingRight: 4 }}>
            {avatars.map((url, i) => (
              <View key={i} style={{ 
                width: 32, height: 32, borderRadius: 16, 
                backgroundColor: C.panelBorder, 
                marginLeft: -12, 
                borderWidth: 2, borderColor: C.tint, 
                overflow: 'hidden',
                justifyContent: 'center', alignItems: 'center'
              }}>
                <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </View>
            ))}
          </View>
        )}
      </View>
      
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
        {joined ? (
          <TouchableOpacity onPress={onOpen} style={{ backgroundColor: C.panel, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}>
            <Text style={{ color: C.text, fontWeight: '600' }}>Ouvrir</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onJoin} style={{ backgroundColor: C.tint, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}>
            <Text style={{ color: C.text, fontWeight: '700' }}>Rejoindre</Text>
          </TouchableOpacity>
        )}
        
        {joined && (
          <TouchableOpacity onPress={onTogglePin} style={{ padding: 4 }}>
             <FontAwesome name="thumb-tack" size={18} color={pinned ? C.tint : C.muted} style={{ transform: [{ rotate: '45deg' }] }} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

function CreateGroupModal({ visible, onClose, onJoinGroup }: { visible: boolean; onClose: () => void; onJoinGroup: (id: string) => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(Dimensions.get('window').height);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        })
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  const closeAnimate = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: Dimensions.get('window').height,
        duration: 250,
        useNativeDriver: true,
        easing: Easing.in(Easing.cubic),
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      })
    ]).start(onClose);
  };

  async function handleCreate() {
    if (!name.trim()) return Alert.alert('Erreur', 'Le nom du groupe est requis');
    setCreating(true);
    try {
      const uid = getAuth().currentUser?.uid;
      if (!uid) throw new Error('Non connecté');

      // Check limits
      const profile = await getUserProfile(uid);
      if (!profile) throw new Error('Profil introuvable');

      const check = performActionUpdates(profile, 'CREATE_GROUP');
      if (!check.allowed) {
        if (check.reason === 'subscription_required') {
           Alert.alert('Abonnement requis', 'Il faut un abonnement pour créer des groupes.', [
             { text: 'Annuler', style: 'cancel' },
             { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'subs' } } as any) }
           ]);
        } else if (check.reason === 'limit_reached') {
           Alert.alert('Limite atteinte', 'Vous avez atteint votre limite de création de groupes pour ce mois.');
        } else {
           Alert.alert('Action non autorisée', 'Impossible de créer le groupe.');
        }
        setCreating(false);
        return;
      }

      // City is implicit in name as per user feedback
     const id = await createGroup({ name });
     
    // Apply updates (increment counter)
      if (check.updates && Object.keys(check.updates).length > 0) {
          await applyUserUpdates(uid, check.updates);
      }

      onJoinGroup(id);
      closeAnimate();
      setName('');
      Alert.alert('Succès', 'Groupe créé avec succès !');
      router.push(`/group/${id}` as any);
    } catch {
      Alert.alert('Erreur', 'Impossible de créer le groupe');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={closeAnimate}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }}>
            <Pressable onPress={closeAnimate} style={{ flex: 1 }} />
          </Animated.View>
          <Animated.View style={[{ width: '100%' }, { transform: [{ translateY: slideAnim }] }]}>
            <Pressable onPress={e => e.stopPropagation()} style={{ backgroundColor: Colors['dark'].card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: Colors['dark'].border, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 20 }}>
              {/* Handle */}
              <View style={{ width: 40, height: 4, backgroundColor: Colors['dark'].border, borderRadius: 2, alignSelf: 'center', marginBottom: 24 }} />

              <Text style={{ color: Colors['dark'].text, fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' }}>Créer un groupe</Text>
              <Text style={{ fontSize: 14, color: Colors['dark'].muted, marginBottom: 24, textAlign: 'center' }}>Rassemble des gens autour d&apos;une passion.</Text>

              <Text style={{ color: Colors['dark'].subtleText, marginBottom: 8, fontWeight: '600' }}>Nom du groupe</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Ex: Randonnée Paris"
                placeholderTextColor={Colors['dark'].subtleText}
                style={{ backgroundColor: Colors['dark'].panel, color: Colors['dark'].text, borderRadius: 16, padding: 16, fontSize: 16, marginBottom: 24, borderWidth: 1, borderColor: Colors['dark'].border }}
              />

              <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity onPress={closeAnimate} style={{ flex: 1, padding: 16, borderRadius: 16, backgroundColor: Colors['dark'].panel, alignItems: 'center' }}>
                      <Text style={{ fontWeight: '600', color: Colors['dark'].text, fontSize: 16 }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreate}
                    disabled={creating}
                    style={{ flex: 1, backgroundColor: Colors['dark'].tint, borderRadius: 16, padding: 16, alignItems: 'center' }}
                  >
                    {creating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: Colors['dark'].text, fontSize: 16, fontWeight: '700' }}>Créer</Text>}
                  </TouchableOpacity>
              </View>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
