import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image as ExpoImage } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getFirestore, limit, onSnapshot, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../../components/ui/Avatar';
import { useToast } from '../../components/ui/Toast';
import { Colors } from '../../constants/Colors';
import { auth } from '../../firebaseconfig';
import { blockUser } from '../../lib/block';
import { sendInvitation as sendInvitationApi } from '../../lib/invitations';
import { getMatchId } from '../../lib/matches';
import { FEATURE_COSTS, performActionUpdates } from '../../lib/monetization';
import { openUserOnMap } from '../../lib/openUserOnMap';
import { getUserProfile, UserProfile } from '../../lib/profile';
import { reportUser } from '../../lib/report';

import { useOutgoingInvites } from '../../hooks/useOutgoingInvites';
import { ACTIVITY_LABELS } from '../../constants/Activities';

/* ---------- Helpers ---------- */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const C = Colors['dark'];
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[s.label, { color: C.muted }]}>{label}</Text>
      {children}
    </View>
  );
};
const Pills: React.FC<{ items: string[] }> = ({ items }) => (
  <View style={s.pills}>
    {items.map((t) => {
       let label = ACTIVITY_LABELS[t] || t.charAt(0).toUpperCase() + t.slice(1);
       return (
         <View key={t} style={s.pill}>
           <Text style={s.pillTxt}>{label}</Text>
         </View>
       );
    })}
  </View>
);
const Empty: React.FC<{ muted: string }> = ({ muted }) => <Text style={{ color: muted }}>—</Text>;

export default function UserDetailScreen() {
  const { id } = useLocalSearchParams();
  const uid = Array.isArray(id) ? id[0] : id;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSharedWithMe, setIsSharedWithMe] = useState(false);
  const [hasMatch, setHasMatch] = useState(false);
  // inviteStatus replaced by hook
  const { hasPendingInvite } = useOutgoingInvites();
  const isInvitePending = hasPendingInvite(uid as string);
  
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const { showToast } = useToast();

  // Firestore listener for location sharing status
  const db = getFirestore();
  useEffect(() => {
    if (!auth.currentUser || !uid) return;
    const me = auth.currentUser.uid;
    
    // Load my profile for age check
    getUserProfile(me).then(setMyProfile);

    const q = query(
      collection(db, 'locationShares'), 
      where('from', '==', uid), 
      where('to', '==', me), 
      limit(1)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setIsSharedWithMe(false);
        return;
      }
      const d = snap.docs[0].data();
      // Check active and not revoked and not expired (if expiry exists)
      const now = Date.now();
      const isActive = d.active && !d.revoked && (!d.expiresAtMs || d.expiresAtMs > now);
      setIsSharedWithMe(isActive);
    }, (error) => {
      // Location share check failed
      setIsSharedWithMe(false);
    });
    
    return () => unsub();
  }, [uid]);

  // Viewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  
  // Menu Dropdown
  const [menuOpen, setMenuOpen] = useState(false);

  const insets = useSafeAreaInsets();

  // Tous les comptes sont 18+, aucune compatibilité d'âge à vérifier

  const load = useCallback(async () => {
    try {
      const p = await getUserProfile(uid);
      setProfile(p);

      const me = auth.currentUser?.uid;
      if (me) {
        // Check for match
        let isMatch = false;
        try {
          const matchId = getMatchId(me, uid);
          const matchSnap = await getDoc(doc(db, 'matches', matchId));
          isMatch = matchSnap.exists();
        } catch (err) {
          // Ignore permission errors (implies no match if rules require membership to read)
          isMatch = false;
        }
        setHasMatch(isMatch);

        if (!isMatch) {
          // Hook handles pending check
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const initials = useMemo(() => {
    const n = (profile?.firstName ?? 'U').trim();
    return n ? n[0].toUpperCase() : 'U';
  }, [profile?.firstName]);

  // Photos
  const photos = useMemo(() => (profile?.photos ?? []) as { path: string; url: string; createdAt: number }[], [profile]);
  const primaryPath = profile?.primaryPhotoPath ?? null;
  const primaryUrl = primaryPath ? photos.find((p) => p.path === primaryPath)?.url ?? null : null;
  
  // Ordre viewer
  const photosOrdered = useMemo(() => primaryPath
    ? [photos.find((p) => p.path === primaryPath)!, ...photos.filter((p) => p.path !== primaryPath).sort((a, b) => a.createdAt - b.createdAt)]
    : [...photos].sort((a, b) => a.createdAt - b.createdAt), [photos, primaryPath]);

  const onViewerTap = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    const w = Dimensions.get('window').width;
    const isRight = x > w / 2;
    if (photosOrdered.length === 0) return;

    if (isRight) {
       if (viewerIndex < photosOrdered.length - 1) setViewerIndex(viewerIndex + 1);
       else setViewerOpen(false);
    } else {
       if (viewerIndex > 0) setViewerIndex(viewerIndex - 1);
    }
  };

  // Check if location is enabled (Must be shared via compass)
  const isLocationEnabled = isSharedWithMe;

  const onMapPress = () => {
     if (isLocationEnabled) {
        openUserOnMap(uid);
     } else {
        // Alert is actually not needed if disabled, but kept for logic
        showToast('Localisation', `${profile?.firstName || 'Cet utilisateur'} n'a pas partagé sa localisation avec vous.`, 'info');
     }
  };

  const onBlock = () => {
      setMenuOpen(false);
      Alert.alert('Bloquer', 'Voulez-vous vraiment bloquer cet utilisateur ?', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Bloquer', style: 'destructive', onPress: async () => {
              await blockUser(uid);
              router.back();
          }}
      ]);
  };

  const onReport = () => {
      setMenuOpen(false);
      Alert.alert('Signaler', 'Raison du signalement :', [
          { text: 'Spam', onPress: () => { reportUser(uid, 'spam'); showToast('Merci', 'Signalement envoyé.', 'success'); } },
          { text: 'Faux profil', onPress: () => { reportUser(uid, 'fake'); showToast('Merci', 'Signalement envoyé.', 'success'); } },
          { text: 'Contenu inapproprié', onPress: () => { reportUser(uid, 'inappropriate'); showToast('Merci', 'Signalement envoyé.', 'success'); } },
          { text: 'Annuler', style: 'cancel' }
      ]);
  };

  const sendInvitation = async (isGold: boolean = false) => {
    if (!uid) return;

    // Pre-check permissions locally to give better feedback and avoid API calls if denied
    if (myProfile) {
        const action = isGold ? 'SUPER_INVITE' : 'INVITE';
        const check = performActionUpdates(myProfile, action);
        
        if (!check.allowed) {
            if (check.reason === 'insufficient_coins') {
                Alert.alert(
                    'Pins insuffisants',
                    'Vous n&apos;avez pas assez de pins pour débloquer ce profil.',
                    [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Acheter des pins', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                    ]
                );
            } else if (check.reason === 'subscription_required') {
                Alert.alert(
                    'Abonnement recommandé', 
                    'Passez à Frensy PLUS pour des invitations quotidiennes, ou utilisez des pins.',
                    [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                    ]
                );
            } else {
                showToast('Limite atteinte', 'Vous avez atteint votre limite d\'invitations pour aujourd\'hui.', 'warning');
            }
            return;
        }
    }

    setSendingInvite(true);
    try {
      await sendInvitationApi(uid as string, inviteMessage, isGold);
      setInviteModalVisible(false);
      showToast('Succès', 'Invitation envoyée avec succès.', 'success');
    } catch (error: any) {
      const msg = error.message || "";
      if (msg.startsWith('ACTION_DENIED')) {
          const reason = msg.split(':')[1];
          setInviteModalVisible(false);
          
          if (reason === 'insufficient_coins') {
               Alert.alert(
                  'Pins insuffisants', 
                  'Vous n\'avez pas assez de pins pour envoyer une invitation. Achetez des pins ou abonnez-vous !',
                  [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                  ]
               );
          } else if (reason === 'subscription_required') {
              Alert.alert(
                  'Abonnement recommandé', 
                  'Passez à Frensy PLUS pour des invitations quotidiennes, ou utilisez des pins.',
                  [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
                  ]
              );
          } else {
              showToast('Limite atteinte', 'Vous avez atteint votre limite d\'invitations pour aujourd\'hui.', 'warning');
          }
      } else {
          showToast('Erreur', msg || "Impossible d'envoyer l'invitation.", 'error');
      }
    } finally {
      setSendingInvite(false);
    }
  };

  if (loading) {
      return (
          <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#F97316" />
          </View>
      );
  }

  // Plus de barrière d'accès par tranche d'âge

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Background Header Blur */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400, opacity: 0.6 }}>
        {primaryUrl ? (
          <ExpoImage source={{ uri: primaryUrl }} style={{ flex: 1 }} contentFit="cover" blurRadius={40} />
        ) : (
          <View style={{ flex: 1, backgroundColor: '#111' }} />
        )}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, backgroundColor: '#000', opacity: 1, transform: [{ scaleY: 1.5 }, { translateY: 50 }] }} />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, backgroundColor: 'transparent' }} /> 
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            progressViewOffset={insets.top + 50}
          />
        }
      >
        {/* Header Content */}
        <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16 }}>
          {/* Top Bar */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, zIndex: 50 }}>
            <TouchableOpacity onPress={() => router.back()} style={s.iconBtnGlass}>
              <FontAwesome name="arrow-left" size={18} color="#fff" />
            </TouchableOpacity>
            
            <View>
              <TouchableOpacity onPress={() => setMenuOpen(!menuOpen)} style={s.iconBtnGlass}>
                <FontAwesome name="ellipsis-h" size={20} color="#fff" />
              </TouchableOpacity>
              
              {/* Dropdown Menu */}
              {menuOpen && (
                <View style={{ 
                  position: 'absolute', 
                  top: 50, 
                  right: 0, 
                  backgroundColor: '#222', 
                  borderRadius: 12, 
                  padding: 8, 
                  width: 150,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: 5,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.1)'
                }}>
                  <TouchableOpacity onPress={onReport} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }}>
                    <Text style={{ color: '#fff', fontSize: 16 }}>Signaler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onBlock} style={{ padding: 12 }}>
                    <Text style={{ color: '#EF4444', fontSize: 16 }}>Bloquer</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Profile Main */}
          <View style={{ alignItems: 'center', gap: 12 }}>
            <TouchableOpacity
              onPress={() => photosOrdered.length && setViewerOpen(true)}
              activeOpacity={0.9}
              style={s.avatarContainer}
            >
               <Avatar 
                  uri={primaryUrl ?? undefined} 
                  initials={initials} 
                  size={128} 
                  ring 
                  ringColor="#F97316" 
                  ringWidth={3} 
                  focusX={profile?.avatarFocusX ?? 0.5} 
                  focusY={profile?.avatarFocusY ?? 0.5} 
                  zoom={typeof (profile as any)?.avatarZoom === 'number' ? (profile as any).avatarZoom : 1} 
                  note={profile?.noteText ?? undefined} 
                />
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={s.nameLarge}>
                     {(profile?.firstName ?? 'Utilisateur')}{profile?.age ? `, ${profile.age}` : ''}
                  </Text>
               </View>
               {profile?.accountType && (
                 <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: profile.accountType === 'group' ? '#F97316' : '#333', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginTop: 8 }}>
                   <FontAwesome name={profile.accountType === 'group' ? 'users' : 'user'} size={12} color="#fff" style={{ marginRight: 6 }} />
                   <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{profile.accountType === 'group' ? 'Groupe' : 'Solo'}</Text>
                 </View>
               )}
               {profile?.accountType === 'group' && (
                 <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {typeof profile.groupMembers === 'number' && (
                        <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                           <Text style={{ color: '#ccc', fontSize: 12 }}>{profile.groupMembers} membres</Text>
                        </View>
                    )}
                    {profile.groupComposition && (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                            {profile.groupComposition.males > 0 && <Text style={{ color: '#90CAF9', fontSize: 12 }}>{profile.groupComposition.males} H</Text>}
                            {profile.groupComposition.females > 0 && <Text style={{ color: '#F48FB1', fontSize: 12 }}>{profile.groupComposition.females} F</Text>}
                            {profile.groupComposition.others > 0 && <Text style={{ color: '#A5D6A7', fontSize: 12 }}>{profile.groupComposition.others} A</Text>}
                        </View>
                    )}
                 </View>
               )}
            </View>

            {/* Stats Row Removed */}
          </View>
        </View>

        {/* Actions & Content */}
        <View style={{ marginTop: 24, paddingHorizontal: 16, gap: 24 }}>
           
           {/* Main Actions */}
           <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity 
                onPress={() => {
                   if (hasMatch) {
                      router.push(`/chat/${uid}` as any);
                   } else if (isInvitePending) {
                      showToast("Info", "Une invitation est déjà en attente.", 'info');
                   } else {
                      setInviteModalVisible(true);
                   }
                }} 
                style={[s.actionBtn, { backgroundColor: hasMatch ? '#F97316' : (isInvitePending ? '#444' : '#fff') }]}
                disabled={isInvitePending && !hasMatch}
              >
                 <Text style={[s.actionBtnTxt, { color: hasMatch ? '#000' : (isInvitePending ? '#aaa' : '#000') }]}>
                    {hasMatch ? 'Envoyer un message' : (isInvitePending ? 'Invitation envoyée' : 'Envoyer une invitation')}
                 </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={onMapPress} 
                style={[
                   s.actionBtn, 
                   { backgroundColor: '#222', opacity: isLocationEnabled ? 1 : 0.5 }
                ]}
                disabled={!isLocationEnabled}
              >
                 <Text 
                   style={s.actionBtnTxt} 
                   numberOfLines={1} 
                   adjustsFontSizeToFit 
                   minimumFontScale={0.85} 
                   ellipsizeMode="tail"
                 >
                    {isLocationEnabled ? 'Voir sur la carte' : 'Localisation non partagée'}
                 </Text>
              </TouchableOpacity>
           </View>

           {/* Photos */}
           {photosOrdered.length > 0 && (
             <View>
                <Text style={s.sectionTitle}>Photos</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                   {photosOrdered.map((p, i) => (
                      <TouchableOpacity key={p.path} onPress={() => { setViewerIndex(i); setViewerOpen(true); }} style={{ width: '31%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#222' }}>
                         <ExpoImage source={{ uri: p.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      </TouchableOpacity>
                   ))}
                </View>
             </View>
           )}

           {/* Informations de profil */}
           <View>
            <Text style={s.sectionTitle}>Informations</Text>
            <View style={[s.infoCard, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' }]}> 
              <Row label="Identité">{profile?.genderIdentity ? <Pills items={[profile.genderIdentity]} /> : <Empty muted="#666" />}</Row>
              <Row label="Taille">{profile?.heightCm ? <Text style={{ color: '#fff' }}>{profile.heightCm} cm</Text> : <Empty muted="#666" />}</Row>
              <Row label="Relations">{(profile?.interests ?? []).length ? <Pills items={(profile?.interests ?? []).map(i => i.toString())} /> : <Empty muted="#666" />}</Row>
              <Row label="Intéressé(e)">{(profile?.genders ?? []).length ? <Pills items={(profile?.genders ?? []).map(g => g.toString())} /> : <Empty muted="#666" />}</Row>
            </View>
           </View>
        </View>
      </ScrollView>

      {/* Modal Viewer */}
      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' }}>
           <Pressable onPress={() => setViewerOpen(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
           
           <View style={{ width: Dimensions.get('window').width - 40, height: Dimensions.get('window').height * 0.65, backgroundColor: '#000', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#333', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 }}>
               {photosOrdered.length > 0 ? (
               <Pressable onPress={onViewerTap} style={{ flex: 1 }}>
                  {photosOrdered[viewerIndex] && (
                    <ExpoImage 
                        source={{ uri: photosOrdered[viewerIndex].url }} 
                        style={{ flex: 1, width: '100%' }} 
                        contentFit="cover" 
                    />
                  )}
                  
                  {/* Progress Bars */}
                  <View style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 4 }}>
                     {photosOrdered.map((_: any, i: number) => (
                        <View key={i} style={{ flex: 1, height: 3, backgroundColor: i === viewerIndex ? '#fff' : 'rgba(255,255,255,0.3)', borderRadius: 2 }} />
                     ))}
                  </View>

                  {/* Header */}
                  <View style={{ position: 'absolute', top: 24, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                     <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Avatar size={32} ring initials={initials} uri={primaryUrl ?? undefined} />
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 }}>
                            {profile?.firstName ?? 'Utilisateur'}{profile?.age ? `, ${profile.age}` : ''}
                        </Text>
                     </View>
                  </View>

                  {/* Info Overlay */}
                   <View style={{ position: 'absolute', bottom: 16, left: 16, right: 16, gap: 8 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                         {profile?.genderIdentity && (
                           <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                             <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{profile.genderIdentity.charAt(0).toUpperCase() + profile.genderIdentity.slice(1)}</Text>
                           </View>
                         )}
                         {profile?.heightCm && (
                           <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                             <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{profile.heightCm} cm</Text>
                           </View>
                         )}
                      </View>

                      {(profile?.interests ?? []).length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {(profile?.interests ?? []).map((i: string) => {
                           let label = i.toString().charAt(0).toUpperCase() + i.toString().slice(1);
                           if (i.toString().toLowerCase() === 'amoureux') label = 'Relation sérieuse';
                           return (
                             <View key={i} style={{ backgroundColor: '#F97316', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                               <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{label}</Text>
                             </View>
                           );
                        })}
                        </View>
                      )}
                   </View>
               </Pressable>
               ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                     <ActivityIndicator color="#F97316" />
                     <TouchableOpacity onPress={() => setViewerOpen(false)} style={{ marginTop: 20 }}>
                        <Text style={{ color: '#fff' }}>Fermer</Text>
                     </TouchableOpacity>
                  </View>
               )}
           </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent={true}
        visible={menuOpen}
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable onPress={() => setMenuOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: 300, backgroundColor: '#222', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#333' }}>
            <TouchableOpacity 
              onPress={() => {
                setMenuOpen(false);
                Alert.alert('Signaler', 'Pourquoi souhaitez-vous signaler cet utilisateur ?', [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Spam / Faux profil', onPress: () => reportUser(uid as string, 'spam').then(() => showToast('Signalé', 'Merci pour votre signalement.', 'success')) },
                  { text: 'Harcèlement', onPress: () => reportUser(uid as string, 'harassment').then(() => showToast('Signalé', 'Merci pour votre signalement.', 'success')) },
                  { text: 'Contenu inapproprié', onPress: () => reportUser(uid as string, 'inappropriate').then(() => showToast('Signalé', 'Merci pour votre signalement.', 'success')) },
                ]);
              }}
              style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#333' }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>Signaler l'utilisateur</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={() => {
                setMenuOpen(false);
                Alert.alert('Bloquer', 'Voulez-vous vraiment bloquer cet utilisateur ? Vous ne pourrez plus vous voir ni vous contacter.', [
                  { text: 'Annuler', style: 'cancel' },
                  { 
                    text: 'Bloquer', 
                    style: 'destructive', 
                    onPress: async () => {
                      try {
                        await blockUser(uid as string);
                        showToast('Bloqué', 'Utilisateur bloqué.', 'info');
                        router.replace('/(tabs)/home');
                      } catch (e) {
                        showToast('Erreur', "Impossible de bloquer.", 'error');
                      }
                    } 
                  },
                ]);
              }}
              style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#333' }}
            >
              <Text style={{ color: '#EF4444', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>Bloquer</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMenuOpen(false)} style={{ padding: 16, backgroundColor: '#333' }}>
              <Text style={{ color: '#ccc', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Invitation Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={inviteModalVisible}
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
        >
          <View style={{ width: '100%', backgroundColor: '#222', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#333' }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>Envoyer une invitation</Text>
            <Text style={{ color: '#aaa', marginBottom: 16 }}>Vous n&apos;êtes pas encore en relation. Envoyez une invitation pour discuter.</Text>
            
            <TextInput
              value={inviteMessage}
              onChangeText={setInviteMessage}
              placeholder="Message (optionnel)..."
              placeholderTextColor="#666"
              style={{ 
                backgroundColor: '#111', 
                color: '#fff', 
                padding: 12, 
                borderRadius: 12, 
                minHeight: 80, 
                textAlignVertical: 'top',
                marginBottom: 20,
                borderWidth: 1,
                borderColor: '#333'
              }}
              multiline
              maxLength={200}
            />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setInviteModalVisible(false)} style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#333', alignItems: 'center' }}>
                 <Text style={{ color: '#fff', fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => sendInvitation(false)} disabled={sendingInvite} style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F97316', alignItems: 'center', opacity: sendingInvite ? 0.7 : 1 }}>
                 {sendingInvite ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: 'bold' }}>Envoyer</Text>}
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
                onPress={() => sendInvitation(true)} 
                disabled={sendingInvite} 
                style={{ 
                    marginTop: 12, 
                    padding: 14, 
                    borderRadius: 12, 
                    backgroundColor: '#FFD700', 
                    alignItems: 'center', 
                    opacity: sendingInvite ? 0.7 : 1, 
                    borderWidth: 1, 
                    borderColor: '#FFA500',
                    shadowColor: '#FFD700',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                }}
            >
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <FontAwesome name="star" size={16} color="#000" />
                    <Text style={{ color: '#000', fontWeight: '900' }}>Super Invitation ({FEATURE_COSTS.SUPER_INVITE} pins)</Text>
                 </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,20,20,0.6)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    width: '100%',
  },
  statItem: { alignItems: 'center', flex: 1 },
  statDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.1)' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginTop: 4 },
  
  iconBtnGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  avatarContainer: {
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  nameLarge: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  actionBtnTxt: {
    fontWeight: '700',
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  infoCard: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    color: 'rgba(255,255,255,0.5)',
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pillTxt: {
    color: '#e5e5e5',
    fontSize: 14,
    fontWeight: '600',
  },
});
