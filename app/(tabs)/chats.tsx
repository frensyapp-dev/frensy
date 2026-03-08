import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, FlatList, Image, LayoutAnimation, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import Avatar from '../../components/ui/Avatar';
import { GradientButton } from '../../components/ui/GradientButton';
import { Colors } from '../../constants/Colors';
import { auth } from '../../firebaseconfig';
import { ChatRequest, ensureChatDataMigrated, getRemovedConversationIds, listenMyChatInvitations, listenMyMatches, markConversationRead, MatchSummary, removeConversation } from '../../lib/chat/storage';
import { getUserProfile, UserProfile } from '../../lib/profile';

type TabKey = 'principal' | 'invitations' | 'matchs';
type FilterKey = 'all' | 'nonlu' | 'remis';

export default function ChatsScreen({ embedded }: { embedded?: boolean } = {}) {
  // Force dark theme for consistency
  const scheme = 'dark';
  const C = Colors['dark'];
  const accent = C.tint;

  const [query, setQuery] = useState('');
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const [tab, setTab] = useState<TabKey>('principal');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showFilter, setShowFilter] = useState(false);
  const [invitations, setInvitations] = useState<ChatRequest[]>([]);
  // Profils pour les invitations (affichage nom+photo)
  const [invProfiles, setInvProfiles] = useState<Record<string, UserProfile | null>>({});
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [matchProfiles, setMatchProfiles] = useState<Record<string, UserProfile | null>>({});
  // États pour le profil utilisateur
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Toast/snackbar pour feedback rapide
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const toastAnim = React.useRef(new Animated.Value(0)).current;
  const showToast = (msg: string) => {
    setToast(msg);
    Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start(() => {
      setTimeout(() => {
        Animated.timing(toastAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => { if (finished) setToast(null); });
      }, 1600);
    });
  };

  const loadData = async () => {
    try {
      await ensureChatDataMigrated();
      // Only load removed IDs, we rely on listenMyMatches for conversations now
      const removed = await getRemovedConversationIds();
      setRemovedIds(new Set(removed));
    } catch (e) {
      console.error(e);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const loadedInvProfiles = React.useRef(new Set<string>());
  const loadedMatchProfiles = React.useRef(new Set<string>());

  // Persistent listeners that stay active even when navigating to ChatDetail
  useEffect(() => {
    let alive = true;

    // Listen to real-time invitations
    const unsubInv = listenMyChatInvitations((reqs) => {
      if (!alive) return;
      setInvitations(reqs);
      
      // Load profiles for invitations
      const uids = new Set(reqs.map(r => r.from));
      uids.forEach(uid => {
        if (!loadedInvProfiles.current.has(uid)) {
          loadedInvProfiles.current.add(uid);
          getUserProfile(uid).then(p => {
             if (alive) {
                if (p) setInvProfiles(prev => ({ ...prev, [uid]: p }));
                else setInvProfiles(prev => ({ ...prev, [uid]: { uid, firstName: 'Compte supprimé', deleted: true } as UserProfile }));
             }
          });
        }
      });
    });

    // Listen to matches (for new matches badge)
    const unsubMatch = listenMyMatches((ms) => {
      if (!alive) return;
      setMatches(ms);
      
      // Load profiles
      const myUid = auth.currentUser?.uid;
      const partnerUids = new Set<string>();
      ms.forEach(m => {
        const pid = m.users.find(u => u !== myUid);
        if (pid) partnerUids.add(pid);
      });
      
      partnerUids.forEach(uid => {
        if (!loadedMatchProfiles.current.has(uid)) {
           loadedMatchProfiles.current.add(uid);
           getUserProfile(uid).then(p => {
              if (alive) {
                 if (p) setMatchProfiles(prev => ({ ...prev, [uid]: p }));
                 else setMatchProfiles(prev => ({ ...prev, [uid]: { uid, firstName: 'Compte supprimé', deleted: true } as UserProfile }));
              }
           });
        }
      });
    });

    return () => {
      alive = false;
      unsubInv();
      unsubMatch();
    };
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    
    // Charger le profil utilisateur
    const me = auth.currentUser?.uid;
    if (me) {
      getUserProfile(me).then(p => {
        if (alive && p) {
           setProfile(p);
        }
      });
    }

    // Refresh removed IDs (in case a conversation was deleted in detail screen)
    loadData();
    
    // Polling for removed IDs every 5s
    const interval = setInterval(loadData, 5000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []));

  const openChat = (uid: string) => {
    // Mark as read immediately to update UI faster
    const me = auth.currentUser?.uid;
    if (me) {
       const matchId = [me, uid].sort().join('_');
       markConversationRead(matchId).catch(() => {});
    }
    router.push(`/chat/${uid}` as any);
  };

  const deleteConvo = async (chatId: string) => {
    Alert.alert(
      'Supprimer la conversation',
      'Êtes-vous sûr ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { 
          text: 'Supprimer', 
          style: 'destructive', 
          onPress: async () => {
            await removeConversation(chatId);
            await loadData(); // Reload removed IDs
            showToast('Conversation supprimée');
          } 
        }
      ]
    );
  };

  // Helper for timestamp
  const getTs = (t: any) => t?.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0);

  // Helper to transform MatchSummary to Conversation-like
  const getConversationFromMatch = (m: MatchSummary) => {
      const me = auth.currentUser?.uid;
      const partnerUid = m.users.find(u => u !== me) || '';
      const prof = matchProfiles[partnerUid];
      
      const isDeleted = prof?.deleted === true || !prof;
      const partnerName = isDeleted ? 'Compte supprimé' : (prof?.firstName || 'Utilisateur');

      return {
          id: m.id,
          title: partnerName,
          partnerUid,
          partnerName,
          partnerAvatar: isDeleted ? undefined : (prof?.photos?.find(ph => ph.path === prof?.primaryPhotoPath)?.url || prof?.photos?.[0]?.url),
          lastMessageText: m.lastMessageText,
          lastMessageAt: getTs(m.lastMessageAt),
          lastSenderId: m.lastSenderId,
          readStatus: m.readStatus,
          hasMessages: !!(m.lastMessageText && m.lastMessageText.length > 0),
          isDeleted
      };
  };

  const isCompatible = (_uid?: string, _profiles?: Record<string, any>) => true;

  const unifiedConversations = matches
      .filter(m => !removedIds.has(m.id))
      .filter(m => {
          const me = auth.currentUser?.uid;
          const partnerUid = m.users.find(u => u !== me) || '';
          return isCompatible(partnerUid, matchProfiles);
      })
      .map(getConversationFromMatch);

  const activeConversations = unifiedConversations
      .filter(c => c.hasMessages)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  const newMatchesList = unifiedConversations
      .filter(c => !c.hasMessages);

  // Filtrage
  const filtered = activeConversations.filter(c => {
    // Search
    if (query.length > 0) {
      const q = query.toLowerCase();
      const name = c.partnerName?.toLowerCase() || '';
      const last = c.lastMessageText?.toLowerCase() || '';
      if (!name.includes(q) && !last.includes(q)) return false;
    }
    
    // Tabs logic handled by parent render
    
    // Sub-filters
    if (filter === 'nonlu') {
       const myUid = auth.currentUser?.uid;
       const lastTs = c.lastMessageAt || 0;
       const myReadTs = (myUid && c.readStatus) ? getTs(c.readStatus[myUid]) : 0;
       return lastTs > myReadTs && c.lastSenderId !== auth.currentUser?.uid;
    }
    if (filter === 'remis') {
       return c.lastSenderId === auth.currentUser?.uid;
    }

    return true;
  });

  // Matchs à afficher (ceux qui n'ont pas encore de conversation active)
  const matchesForDisplay = newMatchesList;

  const renderItem = ({ item }: { item: ReturnType<typeof getConversationFromMatch> }) => {
    const myUid = auth.currentUser?.uid;
    const myReadTs = (myUid && item.readStatus) ? getTs(item.readStatus[myUid]) : 0;
    const isUnread = (item.lastMessageAt || 0) > myReadTs && item.lastSenderId !== auth.currentUser?.uid;
    const isDeleted = (item as any).isDeleted;
    
    const renderRightActions = () => (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Supprimer la conversation"
          onPress={() => deleteConvo(item.id)}
          style={{ backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 80, height: '100%' }}
        >
          <FontAwesome name="trash" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    );

    return (
      <Swipeable renderRightActions={renderRightActions}>
        <TouchableOpacity 
          onPress={() => openChat(item.partnerUid)} 
          activeOpacity={0.7}
          style={[styles.item, { borderBottomColor: C.border }]}
        >
          <View>
             <Avatar uri={item.partnerAvatar} initials={isDeleted ? '?' : item.partnerName?.[0]} size={56} ring={isUnread} ringColor={accent} />
             {isUnread && <View style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: accent, borderWidth: 2, borderColor: '#000' }} />}
          </View>
          
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
               <Text style={[styles.name, { color: isDeleted ? C.muted : C.text, fontSize: 16, fontStyle: isDeleted ? 'italic' : 'normal' }]}>{item.partnerName || 'Utilisateur'}</Text>
               <Text style={{ color: C.muted, fontSize: 12 }}>
                 {item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
               </Text>
            </View>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
               <Text numberOfLines={1} style={{ color: isUnread ? C.text : C.muted, fontWeight: isUnread ? '700' : '400', flex: 1, fontSize: 14 }}>
                 {item.lastSenderId === auth.currentUser?.uid ? 'Vous: ' : ''}
                 {item.lastMessageText || 'Image'}
               </Text>
               {isUnread && (
                 <View style={{ backgroundColor: accent, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>1</Text>
                 </View>
               )}
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Logo Fixed at Bottom Right */}
      {!embedded && (
        <View style={{ position: 'absolute', bottom: 10, right: -20 }} pointerEvents="none">
          <Image 
             source={require('../../assets/images/frensylogo.png')} 
             style={{ width: 100, height: 30 }} 
             resizeMode="contain" 
          />
        </View>
      )}

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
         {/* Header Custom */}
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 16 }}>
          <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
             <Text style={[styles.title, { color: C.text, fontSize: 28 }]}>Discussions</Text>
             <TouchableOpacity
               accessibilityRole="button"
               accessibilityLabel="Mon profil"
               onPress={() => router.push('/(tabs)/profile' as any)}
             >
               <Avatar uri={profile?.primaryPhotoPath ? profile?.photos?.find(p => p.path === profile?.primaryPhotoPath)?.url : undefined} initials={profile?.firstName?.[0]} size={36} />
             </TouchableOpacity>
          </View>

          {/* Barre de recherche */}
          <View style={[styles.search, { 
            borderColor: 'transparent', 
            backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.08)' : '#f2f2f2', 
            shadowOpacity: 0,
            elevation: 0,
            height: 44,
            borderRadius: 14
          }]}> 
            <FontAwesome name="search" size={16} color={C.muted} style={{ opacity: 0.7 }} />
            <TextInput 
              value={query} 
              onChangeText={setQuery} 
              placeholder="Rechercher..." 
              placeholderTextColor={C.muted} 
              style={{ flex: 1, color: C.text, fontSize: 16, height: '100%', marginLeft: 4 }} 
            />
            {query.length > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Effacer la recherche"
                onPress={() => { setQuery(''); LayoutAnimation.easeInEaseOut(); }}
              >
                 <FontAwesome name="times-circle" size={16} color={C.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Onglets + bouton Filtres */}
        <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pill label="Principal" active={tab === 'principal'} onPress={() => setTab('principal')} />
          {(() => { const n = invitations.filter(r => r.status === 'pending').length; const lbl = n > 0 ? `Invitations (${n})` : 'Invitations'; return <Pill label={lbl} active={tab === 'invitations'} onPress={() => setTab('invitations')} />; })()}
          {(() => { const cnt = matchesForDisplay.length; const lbl = cnt > 0 ? `Match (${cnt})` : 'Match'; return <Pill label={lbl} active={tab === 'matchs'} onPress={() => setTab('matchs')} />; })()}
          <View style={{ flex: 1 }} />
          <Pill label="Filtres" active={showFilter} onPress={() => setShowFilter(v => !v)} />
        </View>

        {/* En-tête profil retiré pour une page épurée */}
        {/* Afficher seulement la bulle et la photo plus bas */}


        {/* Sous-menu Filtres (Non lu / Remis / Tous) */}
        {showFilter && (
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            <View style={{ borderWidth: 1, borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.12)' : C.border, backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
              <Pill label="Non lu" active={filter === 'nonlu'} onPress={() => setFilter('nonlu')} />
              <Pill label="Envoyé" active={filter === 'remis'} onPress={() => setFilter('remis')} />
              <Pill label="Tous" active={filter === 'all'} onPress={() => setFilter('all')} />
            </View>
          </View>
        )}

        {/* En-tête supprimé pour une interface de chat épurée */}


        {/* Avatars en haut de page (uniquement avec photo) */}
        <View style={{ display: 'none' }}>
          {/* supprimé au profit de la bande de notes */}
        </View>

        {/* List & états vides */}
        {tab === 'invitations' ? (
          (() => {
            const pendings = invitations
              .filter(r => r.status === 'pending')
              .filter(r => isCompatible(r.from, invProfiles))
              .sort((a, b) => (b.isSuper ? 1 : 0) - (a.isSuper ? 1 : 0));

            if (pendings.length === 0) {
              return (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                  <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>Aucune invitation</Text>
                  <Text style={{ color: C.muted, marginTop: 6, textAlign: 'center' }}>Quand quelqu’un vous invite, cela apparaîtra ici.</Text>
                </View>
              );
            }
            return (
              <FlatList
                data={pendings}
                keyExtractor={(r) => r.id}
                renderItem={({ item }) => {
                  const prof = invProfiles[item.from];
                  const title = prof?.firstName || item.from;
                  const url = prof?.photos?.find(ph => ph.path === prof?.primaryPhotoPath)?.url || prof?.photos?.[0]?.url;
                  const preview = item.messageText || 'Invitation reçue';
                  const isSuper = item.isSuper;

                  return (
                    <TouchableOpacity onPress={() => {
                        openChat(item.from);
                    }} style={[
                      styles.itemCard,
                      {
                        backgroundColor: isSuper ? 'rgba(255, 215, 0, 0.15)' : (scheme === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff'),
                        borderColor: isSuper ? Colors.dark.gold : (scheme === 'dark' ? 'rgba(255,255,255,0.12)' : C.border),
                        borderWidth: isSuper ? 1.5 : 1,
                        shadowColor: isSuper ? Colors.dark.gold : '#000',
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: isSuper ? 0.6 : 0,
                        shadowRadius: isSuper ? 8 : 0,
                        elevation: isSuper ? 6 : 0,
                      },
                    ]}> 
                      <Avatar uri={url} size={48} ring ringColor={isSuper ? Colors.dark.gold : undefined} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                             <Text style={[styles.name, { color: C.text }]}>{title}</Text>
                             {isSuper && <FontAwesome name="star" size={14} color={Colors.dark.gold} />}
                          </View>
                          {isSuper ? (
                            <View style={{ backgroundColor: Colors.dark.gold, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                               <Text style={{ color: Colors.light.text, fontSize: 10, fontWeight: '800' }}>SUPER</Text>
                             </View>
                          ) : (
                             <View style={{ backgroundColor: accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                               <Text style={{ color: Colors.dark.text, fontSize: 12 }}>Nouveau</Text>
                             </View>
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text numberOfLines={1} style={{ color: C.muted }}>{preview}</Text>
                          <Text style={{ color: isSuper ? Colors.dark.gold : C.muted, fontSize: 12, fontWeight: isSuper ? '700' : '400' }}>{isSuper ? 'Super Invitation' : 'Invitation'}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ paddingVertical: 8 }}
              />
            );
          })()
        ) : tab === 'matchs' ? (
          matchesForDisplay.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>Aucun match pour l’instant</Text>
              <Text style={{ color: C.muted, marginTop: 6, textAlign: 'center' }}>Faites des likes dans Découvrir pour créer des matchs.</Text>
              <GradientButton 
                label="Aller à Découvrir" 
                onPress={() => router.push('/(tabs)/discover' as any)}
                style={{ marginTop: 12, minWidth: 220 }}
              />
            </View>
          ) : (
            <FlatList
              data={matchesForDisplay}
              keyExtractor={(m) => m.id}
              renderItem={({ item }) => {
                return (
                  <TouchableOpacity onPress={async () => {
                    try {
                      openChat(item.partnerUid);
                    } catch {}
                  }} style={[styles.item, { borderBottomColor: C.border }]}> 
                    <Avatar uri={item.partnerAvatar} size={48} ring />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[styles.name, { color: C.text }]}>{item.partnerName || 'Utilisateur'}</Text>
                        <Text style={{ color: C.muted, fontSize: 12 }}>Match</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text numberOfLines={1} style={{ color: C.muted }}>Appuyez pour démarrer le chat</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={{ paddingVertical: 8 }}
            />
          )
        ) : (
          filtered.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>Aucune conversation</Text>
              <Text style={{ color: C.muted, marginTop: 6, textAlign: 'center' }}>Vos chats apparaîtront ici. Allez dans Découvrir pour rencontrer des profils.</Text>
              <GradientButton 
                label="Aller à Découvrir" 
                onPress={() => router.push('/(tabs)/discover' as any)}
                style={{ marginTop: 12, minWidth: 220 }}
              />
            </View>
          ) : (
            <FlatList
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text} />}
              data={filtered}
              keyExtractor={u => u.id}
              renderItem={renderItem}
              contentContainerStyle={{ paddingVertical: 8 }}
            />
          )
        )}

        {/* Modal de détail d'invitation */}
        {/* Modal supprimé: les invitations s’ouvrent directement en conversation */}
        {/* Toast overlay */}
        {toast && (
          <Animated.View style={{ position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center', opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0,1], outputRange: [10,0] }) }] }}>
            <View style={{ backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.85)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.18)', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, maxWidth: 420 }}>
              <Text style={{ color: Colors.dark.text, fontWeight: '700' }}>{toast}</Text>
            </View>
          </Animated.View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1 },
  headerBtn: { width: 34, height: 34, borderRadius: 17, alignItems:'center', justifyContent:'center', borderWidth: 1 },
  ctaBtn: { borderRadius: 20, alignItems:'center', justifyContent:'center', borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, minWidth: 220, maxWidth: 340 },
  title: { fontSize: 20, fontWeight: '900' },
  search: { flexDirection: 'row', alignItems:'center', gap: 8, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, height: 40 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderRadius: 22, marginHorizontal: 16, marginVertical: 6, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  name: { fontWeight: '800' },
});

// Helper component
const Pill = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => {
  const C = Colors['dark'];
  return (
    <TouchableOpacity 
      onPress={onPress} 
      style={{ 
        paddingHorizontal: 14, 
        paddingVertical: 6, 
        borderRadius: 20, 
        backgroundColor: active ? C.tint : 'transparent', 
        borderWidth: 1, 
        borderColor: active ? C.tint : C.border 
      }}
    >
      <Text style={{ color: active ? C.text : C.text, fontWeight: active ? '700' : '400', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
};
