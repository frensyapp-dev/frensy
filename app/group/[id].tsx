import FontAwesome from '@expo/vector-icons/FontAwesome';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Image as ExpoImage } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, Easing, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChatTabIcon, ProfileTabIcon } from '../../components/navigation/TabBarIcons';
import Avatar from '../../components/ui/Avatar';
import { useToast } from '../../components/ui/Toast';
import { Colors } from '../../constants/Colors';
import { auth, db } from '../../firebaseconfig';
import { upsertConversation } from '../../lib/chat/storage';
import { castPollVote, postMessage, quitGroup } from '../../lib/groups/repo';
import { FEATURE_COSTS, performActionUpdates } from '../../lib/monetization';
import { applyUserUpdates, getUserProfile, type UserProfile } from '../../lib/profile';
import { reportGroup, reportMessage } from '../../lib/report';
import { pickAndUploadMessageImage } from '../../lib/uploadImages';

import { checkPhotoSafety, REJECTION_MSG, validateMessage } from '../../lib/moderation';

// Configure dayjs
dayjs.extend(relativeTime);
dayjs.locale('fr');

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // const insets = useSafeAreaInsets(); // Unused
  const C = Colors['dark']; // Enforce dark theme style as per request
  const appear = useRef(new Animated.Value(0)).current;
  
  const [input, setInput] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const { showToast } = useToast();
  const [draftPhoto, setDraftPhoto] = useState<string | null>(null);
  const [draftMediaType, setDraftMediaType] = useState<'image' | 'video'>('image');
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (me) getUserProfile(me).then(setMyProfile);
  }, []);
  
  // States for Gold Invite / Profile View (if applicable)
  const [isGoldInvite, setIsGoldInvite] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [storyMessage, setStoryMessage] = useState('');
  const [storyUser, setStoryUser] = useState<any>(null);
  const [storyVisible, setStoryVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
   }, []);
  const [messages, setMessages] = useState<{ id: string; user: string; text: string; imageUrl?: string; createdAtMs: number; replyTo?: any; type?: string; pollTarget?: any; votes?: any; pollStatus?: string; pollResult?: string }[]>([]);
  const listRef = useRef<FlatList<any>>(null);
  
  // const [memberAction, setMemberAction] = useState<{ id: string; name: string } | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string; photoUrl?: string | null }[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore] = useState(true);
  const [groupName, setGroupName] = useState<string>('');
  const [memberCount, setMemberCount] = useState<number>(0);
  const profileSubsRef = useRef<{ id: string; unsub: () => void }[]>([]);
  // const [actionsOpen, setActionsOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; user: string; text: string; imageUrl?: string } | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const viewerMessageId = useRef<string | null>(null); // Changed to ref to avoid re-renders or unused state warnings if not used in UI directly
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const swipeableRefs = useRef(new Map<string, Swipeable>());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (showMembers) {
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
        })
      ]).start();
    }
  }, [showMembers]);

  const closeMembers = () => {
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
    ]).start(() => setShowMembers(false));
  };

  const [onlineMemberIds, setOnlineMemberIds] = useState<string[]>([]);
  
  const [storyIndex, setStoryIndex] = useState(0);

  const formatDay = (ts: number) => dayjs(ts).format('D MMMM');
  const formatDate = (ts: number) => dayjs(ts).format('HH:mm');

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    if (!id) return;

    // Listen to Group Doc (Name, MemberCount)
    const unsubGroup = onSnapshot(doc(db, 'groups', id), (d) => {
        if (d.exists()) {
            const data = d.data();
            setGroupName(data.name || 'Groupe');
            setMemberCount(data.memberCount || 0);
        }
    });

    // Listen to Members (Real-time join/leave)
    const unsubMembers = onSnapshot(collection(db, 'groups', id, 'members'), (snap) => {
       const currentIds = snap.docs.map(d => d.id);
       const trackedIds = profileSubsRef.current.map(s => s.id);
       
       // Identify new and left members
       const newIds = currentIds.filter(id => !trackedIds.includes(id));
       const leftIds = trackedIds.filter(id => !currentIds.includes(id));

       // Handle Left Members
       if (leftIds.length > 0) {
           leftIds.forEach(lid => {
               const idx = profileSubsRef.current.findIndex(s => s.id === lid);
               if (idx !== -1) {
                   profileSubsRef.current[idx].unsub();
                   profileSubsRef.current.splice(idx, 1);
               }
           });
           setMembers(prev => prev.filter(m => !leftIds.includes(m.id)));
           setOnlineMemberIds(prev => prev.filter(id => !leftIds.includes(id)));
       }

       // Handle New Members
       newIds.forEach(nid => {
           // Add placeholder
           setMembers(prev => [...prev, { id: nid, name: '...', photoUrl: null }]);
           
           // Listen to User Profile
           const unsubUser = onSnapshot(doc(db, 'users', nid), (ds) => {
               if (!ds.exists()) {
                   // User deleted? Remove from local state
                   setMembers(prev => prev.filter(x => x.id !== nid));
                   return;
               }
               const d = ds.data();
               if (d) {
                   let primaryUrl = d.photos?.[0]?.url;
                   if (d.primaryPhotoPath) {
                       const found = d.photos?.find((p: any) => p.path === d.primaryPhotoPath);
                       if (found) primaryUrl = found.url;
                   }
                   setMembers(prev => prev.map(x => x.id === nid ? { 
                       ...x, 
                       name: d.firstName || d.displayName || x.name || '?', 
                       photoUrl: primaryUrl || x.photoUrl 
                   } : x));
               }
           });

           // Listen to Position
           const unsubPos = onSnapshot(doc(db, 'positions', nid), (ds) => {
               const d = ds.data();
               const now = Date.now();
               const last = d?.updatedAtMs;
               const isOnline = typeof last === 'number' && (now - last) < 5 * 60 * 1000;
               if (isOnline) {
                   setOnlineMemberIds(prev => Array.from(new Set([...prev, nid])));
               } else {
                   setOnlineMemberIds(prev => prev.filter(x => x !== nid));
               }
           });

           profileSubsRef.current.push({ id: nid, unsub: () => { unsubUser(); unsubPos(); } });
       });

    });
 
    // Listen messages
    const q = query(collection(db, 'groups', id, 'messages'), orderBy('createdAt', 'desc'), limit(50));
    const unsubMsg = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          user: data.senderId || data.userUid || data.userId,
          text: data.text,
          imageUrl: data.imageUrl,
          createdAtMs: data.createdAt?.toMillis?.() || data.createdAt || Date.now(),
          replyTo: data.replyTo,
          type: data.type || 'text',
          pollTarget: data.pollTarget,
          votes: data.votes,
          pollStatus: data.pollStatus,
          pollResult: data.pollResult
        };
      });
      setMessages(msgs);
    }, (error) => {
       if (error.code === 'permission-denied') {
          // User was kicked or group deleted
          Alert.alert('Accès refusé', 'Vous ne faites plus partie de ce groupe.', [
             { text: 'OK', onPress: () => router.back() }
          ]);
       }
    });



    return () => {
      unsubGroup();
      unsubMsg();
      unsubMembers();
      profileSubsRef.current.forEach(s => s.unsub());
      profileSubsRef.current = [];
    };
  }, [id, appear]);

  const send = async () => {
    if (sending) return;
    const txt = input.trim();
    if ((!txt && !draftPhoto) || !id) return;

    if (txt) {
      const check = validateMessage(txt);
      if (!check.valid) {
        Alert.alert('Message refusé', check.error);
        return;
      }
    }

    setSending(true);
    try {
      const me = auth.currentUser?.uid;
      if (draftPhoto && me) {
          const profile = await getUserProfile(me);
          if (profile) {
              if (draftMediaType === 'video') {
                  if (profile.subscription !== 'PRO') {
                       showToast('Erreur', 'Seuls les membres PRO peuvent envoyer des vidéos.', 'error');
                       setSending(false);
                       return;
                  }
              } else {
                  const result = performActionUpdates(profile, 'SEND_PHOTO');
                  if (!result.allowed) {
                      showToast('Erreur', 'Pas assez de Pins ou abonnement requis.', 'error');
                      setSending(false);
                      return;
                  }
                  if (result.updates) {
                      await applyUserUpdates(me, result.updates);
                  }
              }
          }
      }

      setInput('');
      const photoToSend = draftPhoto;
      const mediaTypeToSend = draftMediaType;
      setDraftPhoto(null);
      setDraftMediaType('image');
      const reply = replyingTo;
      setReplyingTo(null);

      const replyData = reply ? {
        id: reply.id,
        user: reply.user,
        text: reply.text,
        ...(reply.imageUrl ? { imageUrl: reply.imageUrl } : {})
      } : undefined;

      await postMessage(id, txt || null, photoToSend || undefined, {
        replyTo: replyData,
        type: mediaTypeToSend === 'video' ? 'video' : undefined
      });
      
      const summary = photoToSend ? (mediaTypeToSend === 'video' ? '🎥 Vidéo' : '📷 Photo') : txt;

      // Update last message in local storage for list view
      upsertConversation({
         id: 'group_' + id,
         title: groupName || 'Groupe',
         avatar: undefined, // Group avatar if any
         lastMessageText: summary || '',
         lastMessageAt: Date.now(),
         lastSenderId: auth.currentUser?.uid,
         partnerUid: id!
      }).catch(()=>{});
    } catch {
      showToast('Erreur', "Impossible d'envoyer le message", 'error');
    } finally {
        setSending(false);
    }
  };

  const onSendImage = async () => {
    if (!id) return;
    try {
      const me = auth.currentUser?.uid;
      if (!me) return;
      const profile = await getUserProfile(me);
      if (!profile) return;

      const check = performActionUpdates(profile, 'SEND_PHOTO');
      if (!check.allowed) {
        Alert.alert(
          'Abonnement requis',
          'Il faut un abonnement ou des Pins pour envoyer des photos.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Obtenir des Pins', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
          ]
        );
        return;
      }

      if (check.updates) {
          await applyUserUpdates(me, check.updates);
      }

      const isPro = profile.subscription === 'PRO';
      const res = await pickAndUploadMessageImage(id, 'group', isPro);
      if (res) {
        // Moderation
        const safety = await checkPhotoSafety(res.url);
        if (safety === 'rejected') {
          showToast('Photo refusée', REJECTION_MSG, 'error');
          return;
        }

        setDraftPhoto(res.url);
        setDraftMediaType(res.type);
      }
    } catch (e: any) {
      showToast('Erreur', e.message, 'error');
    }
  };

  const startKickPoll = async (targetUser: { id: string; name: string }) => {
    if (!id) return;
    
    if (members.length < 3) {
      Alert.alert(
          'Vote impossible', 
          'Il faut être au moins 3 membres dans le groupe pour lancer un vote d\'exclusion. À deux, réglez ça entre vous ou quittez le groupe !'
      );
      return;
    }

    Alert.alert(
      'Exclure ' + targetUser.name,
      'Voulez-vous lancer un vote pour exclure ce membre ? Si la majorité requise vote "Oui", il sera exclu.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Lancer le vote', style: 'destructive', onPress: async () => {
          try {
             await postMessage(id, `Vote d'exclusion: ${targetUser.name}`, undefined, {
               type: 'kick_poll',
               pollTarget: targetUser
             });
             showToast('Vote lancé', 'Le sondage a été publié dans le chat.', 'success');
             setShowMembers(false);
          } catch (e) {
             showToast('Erreur', 'Impossible de lancer le vote', 'error');
          }
        }}
      ]
    );
  };

  const handleVote = async (msgId: string, vote: 'yes' | 'no') => {
    if (!id) return;
    try {
       const success = await castPollVote(id, msgId, vote);
       if (success) {
         showToast('A voté', 'Votre vote a été enregistré.', 'success');
       } else {
         showToast('Vote impossible', 'Le vote est terminé ou indisponible.', 'error');
       }
    } catch (e: any) {
       console.error(e);
       showToast('Erreur', 'Impossible de voter: ' + (e.message || 'Erreur inconnue'), 'error');
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    // Pagination logic would go here (startAfter last doc)
    // For now, simple limit increase or similar
    setLoadingMore(false);
  };

  const onGroupActions = () => {
     Alert.alert('Options du groupe', '', [
        { text: 'Quitter le groupe', style: 'destructive', onPress: () => {
           Alert.alert('Confirmation', 'Voulez-vous vraiment quitter ce groupe ?', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Quitter', style: 'destructive', onPress: async () => {
                 try {
                    if (auth.currentUser?.uid) await quitGroup(auth.currentUser.uid, id!);
                    router.back();
                 } catch {
                    showToast('Erreur', 'Impossible de quitter le groupe', 'error');
                 }
              }}
           ]);
        }},
        { text: 'Signaler', onPress: () => {
           reportGroup(id!, 'other').then(() => showToast('Signalé', 'Le groupe a été signalé.', 'success')).catch(() => showToast('Erreur', 'Impossible de signaler', 'error'));
        }},
        { text: 'Annuler', style: 'cancel' }
     ]);
  };

  const toggleMembers = () => {
     setShowMembers(!showMembers);
  };

  const handleMemberPress = async (uid: string) => {
    if (!auth.currentUser || uid === auth.currentUser.uid) return;
    // Always open profile directly as per user request (detection was flaky)
    router.push(`/user/${uid}` as any);
  };

  const onMemberPress = (m: { id: string; name: string }) => {
     setShowMembers(false);
     handleMemberPress(m.id);
  };

  // Open Story Logic (Reuse from ChatsScreen logic roughly)
  // Removed unused openStory

  const onStoryTap = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    const w = Dimensions.get('window').width;
    const isRight = x > w / 2;
    const photos = storyUser?.photos || [];
    if (photos.length === 0) return;

    if (isRight) {
       if (storyIndex < photos.length - 1) setStoryIndex(storyIndex + 1);
       else setStoryVisible(false);
    } else {
       if (storyIndex > 0) setStoryIndex(storyIndex - 1);
    }
  };

  const sortedMembers = useMemo(() => {
     return [...members].sort((a, b) => {
        const myId = auth.currentUser?.uid;
        if (a.id === myId) return -1;
        if (b.id === myId) return 1;
        return (a.name || '').localeCompare(b.name || '');
     });
  }, [members]);

  const sendInvite = async (isSuper = false) => {
    if (!storyMessage.trim() || !storyUser) return;

    // Check permissions before sending
    const me = auth.currentUser?.uid;
    if (me) {
        const profile = await getUserProfile(me);
        if (profile) {
             const action = isSuper ? 'SUPER_INVITE' : 'INVITE';
             const check = performActionUpdates(profile, action);
             
             if (!check.allowed) {
                 if (check.reason === 'insufficient_coins') {
                      Alert.alert(
                          'Pins insuffisants', 
                          'Vous n\'avez pas assez de pins pour envoyer une invitation. Achetez des pins ou abonnez-vous !',
                          [
                              { text: 'Annuler', style: 'cancel' },
                              { text: 'Boutique', onPress: () => router.push({ pathname: '/store', params: { tab: 'coins' } } as any) }
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
                      showToast('Limite atteinte', 'Vous avez atteint votre limite d\'invitations.', 'warning');
                  }
                  return;
             }
        }
    }

    setSendingInvite(true);
    try {
         const { sendInvitation } = await import('../../lib/invitations');
         await sendInvitation(storyUser.uid, storyMessage.trim() || undefined, isSuper);
         
          setStoryVisible(false);
          showToast('Envoyé', isSuper ? 'Super Invitation envoyée !' : 'Invitation envoyée avec succès !', 'success');
    } catch (e: any) {
        const msg = e.message || "";
        if (msg.startsWith('ACTION_DENIED')) {
            const reason = msg.split(':')[1];
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
                showToast('Limite atteinte', 'Vous avez atteint votre limite d\'invitations.', 'warning');
            }
        } else {
            showToast('Erreur', msg || "Impossible d'envoyer l'invitation", 'error');
        }
    } finally {
        setSendingInvite(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors['dark'].background }}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, opacity: appear }}>
        
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0, backgroundColor: Colors['dark'].background }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
             <Text style={{ fontSize: 28, color: Colors['dark'].text, fontWeight: '300', marginTop: -2 }}>‹</Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={toggleMembers} style={{ alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
               {/* Small Avatar/Icon if needed, but text requested centered */}
               <Text style={{ fontSize: 18, fontWeight: '700', color: Colors['dark'].text }}>{groupName || 'Groupe'}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Text style={{ fontSize: 13, color: Colors['dark'].success, fontWeight: '600' }}>{memberCount} membres</Text>
              <Text style={{ fontSize: 13, color: Colors['dark'].subtleText }}> • {onlineMemberIds.length} en ligne 🟢</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={onGroupActions} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={require('../../assets/images/frensylogo.png')} style={{ width: 28, height: 28, resizeMode: 'contain' }} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 20, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          ref={listRef as any}
          initialNumToRender={14}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item, index }) => {
            const isMe = item.user === auth.currentUser?.uid;
            
            const prevMsg = messages[index + 1];
            const nextMsg = messages[index - 1];
            
            // Kick Poll
            if (item.type === 'kick_poll') {
               const votes = item.votes || {};
               const yesVotes = Object.values(votes).filter(v => v === 'yes').length;
               const noVotes = Object.values(votes).filter(v => v === 'no').length;
               const hasVoted = votes[auth.currentUser?.uid || ''];
               const isFinished = item.pollStatus === 'completed';
               
               return (
                  <View style={{ marginVertical: 8, padding: 16, backgroundColor: Colors['dark'].card, borderRadius: 16, borderWidth: 1, borderColor: Colors['dark'].border }}>
                     <Text style={{ color: Colors['dark'].text, fontWeight: 'bold', marginBottom: 8 }}>🗳 {item.text}</Text>
                     
                     {isFinished ? (
                        <Text style={{ color: item.pollResult === 'kicked' ? Colors['dark'].danger : Colors['dark'].text }}>
                           {item.pollResult === 'kicked' ? 'Membre exclu.' : 'Vote terminé.'}
                        </Text>
                     ) : (
                        <View style={{ gap: 8 }}>
                           <View style={{ flexDirection: 'row', gap: 12 }}>
                              <TouchableOpacity 
                                 onPress={() => handleVote(item.id, 'yes')}
                                 disabled={!!hasVoted}
                                 style={{ flex: 1, padding: 10, backgroundColor: hasVoted === 'yes' ? Colors['dark'].danger : Colors['dark'].panel, borderRadius: 8, alignItems: 'center' }}
                              >
                                 <Text style={{ color: Colors['dark'].text, fontWeight: '600' }}>Exclure ({yesVotes})</Text>
                              </TouchableOpacity>
                              <TouchableOpacity 
                                 onPress={() => handleVote(item.id, 'no')}
                                 disabled={!!hasVoted}
                                 style={{ flex: 1, padding: 10, backgroundColor: hasVoted === 'no' ? Colors['dark'].success : Colors['dark'].panel, borderRadius: 8, alignItems: 'center' }}
                              >
                                 <Text style={{ color: Colors['dark'].text, fontWeight: '600' }}>Garder ({noVotes})</Text>
                              </TouchableOpacity>
                           </View>
                           <Text style={{ color: Colors['dark'].subtleText, fontSize: 12, textAlign: 'center' }}>
                              {hasVoted ? 'Vous avez voté.' : 'Votez pour décider.'}
                           </Text>
                        </View>
                     )}
                  </View>
               );
            }

            // Date separator
            let showDate = false;
            if (prevMsg) {
               const day1 = dayjs(item.createdAtMs).format('YYYY-MM-DD');
               const day2 = dayjs(prevMsg.createdAtMs).format('YYYY-MM-DD');
               if (day1 !== day2) showDate = true;
            } else {
               showDate = true; // Last message
            }

            const showTime = index === 0;
            const isLastInBlock = !nextMsg || nextMsg.user !== item.user;

            const onMessageLongPress = () => {
                const options: any[] = [
                    { text: 'Répondre', onPress: () => setReplyingTo({ id: item.id, user: item.user, text: item.text || (item.imageUrl ? '📷 Photo' : 'Message'), imageUrl: item.imageUrl }) },
                    { text: 'Annuler', style: 'cancel' }
                ];
                
                if (!isMe) {
                     options.splice(1, 0, { 
                        text: 'Signaler', 
                        style: 'destructive', 
                        onPress: () => {
                             Alert.alert('Raison', '', [
                                { text: 'Spam', onPress: () => reportMessage(item.id, id!, 'spam').then(() => showToast('Signalé', 'Message signalé', 'success')) },
                                { text: 'Harcèlement', onPress: () => reportMessage(item.id, id!, 'harassment').then(() => showToast('Signalé', 'Message signalé', 'success')) },
                                { text: 'Inapproprié', onPress: () => reportMessage(item.id, id!, 'inappropriate').then(() => showToast('Signalé', 'Message signalé', 'success')) },
                                { text: 'Annuler', style: 'cancel' }
                            ]);
                        } 
                    });
                }
                
                Alert.alert('Options', '', options);
            };

            const renderLeftActions = (progress: any, dragX: any) => {
               const scale = dragX.interpolate({
                  inputRange: [0, 50],
                  outputRange: [0, 1],
                  extrapolate: 'clamp'
               });
               return (
                  <View style={{ justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 20, width: 80 }}>
                     <Animated.View style={{ transform: [{ scale }] }}>
                        <FontAwesome name="reply" size={24} color={C.tint} />
                     </Animated.View>
                  </View>
               );
            };

            return (
              <Swipeable
                ref={(ref) => {
                    if (ref) swipeableRefs.current.set(item.id, ref);
                    else swipeableRefs.current.delete(item.id);
                }}
                renderLeftActions={renderLeftActions}
                onSwipeableOpen={() => {
                   setReplyingTo({ id: item.id, user: item.user, text: item.text || 'Photo', imageUrl: item.imageUrl });
                   setTimeout(() => {
                       swipeableRefs.current.get(item.id)?.close();
                   }, 50);
                }}
              >
              <View>
                {showDate && (
                  <View style={{ alignItems: 'center', marginVertical: 16 }}>
                     <View style={{ backgroundColor: '#2C2C2E', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}>
                        <Text style={{ color: '#aaa', fontSize: 12, fontWeight: '600' }}>{formatDay(item.createdAtMs)}</Text>
                     </View>
                  </View>
                )}
                
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
                  
                  {/* Avatar for others */}
                  {!isMe && (
                     <View style={{ marginRight: 8, width: 32, marginBottom: isLastInBlock ? 0 : 0 }}>
                        {isLastInBlock ? (
                           <TouchableOpacity onPress={() => handleMemberPress(item.user)}>
                              <Avatar 
                                size={32} 
                                uri={members.find(m => m.id === item.user)?.photoUrl ?? undefined}
                                initials={members.find(m => m.id === item.user)?.name?.[0]}
                              />
                           </TouchableOpacity>
                        ) : <View style={{ width: 32 }} />}
                     </View>
                  )}

                  <View style={{ flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                      
                      {/* Reply Context */}
                      {item.replyTo && (
                         <View style={{ 
                            marginBottom: 4, 
                            padding: 8, 
                            backgroundColor: '#222', 
                            borderRadius: 12, 
                            borderLeftWidth: 2, 
                            borderLeftColor: C.tint,
                            opacity: 0.8
                         }}>
                            <Text style={{ color: C.tint, fontSize: 10, fontWeight: 'bold' }}>Réponse à {members.find(m => m.id === item.replyTo.user)?.name || 'Membre'}</Text>
                            <Text numberOfLines={1} style={{ color: '#ccc', fontSize: 12 }}>{item.replyTo.text || 'Photo'}</Text>
                         </View>
                      )}

                      {item.imageUrl && (
                        <Pressable 
                            onPress={() => {
                                setViewerImage(item.imageUrl || null);
                                viewerMessageId.current = item.id;
                            }}
                            onLongPress={onMessageLongPress}
                        >
                          <ExpoImage 
                            source={{ uri: item.imageUrl }} 
                            style={{ width: 200, height: 300, borderRadius: 16, marginBottom: item.text ? 8 : 0, backgroundColor: '#2C2C2E' }} 
                            contentFit="cover"
                          />
                        </Pressable>
                      )}

                      {item.text ? (
                      <TouchableOpacity 
                        activeOpacity={0.8}
                        onLongPress={onMessageLongPress}
                      >
                      <View style={{ 
                        paddingHorizontal: 16, 
                        paddingVertical: 12, 
                        borderRadius: 24,
                        backgroundColor: '#2C2C2E',
                        borderBottomRightRadius: isMe ? 4 : 24,
                        borderBottomLeftRadius: !isMe ? 4 : 24,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
                      </View>
                      </TouchableOpacity>
                      ) : null}
                      
                      {showTime && (
                        <Text style={{ color: '#666', fontSize: 11, marginTop: 4, marginHorizontal: 4 }}>
                           {formatDate(item.createdAtMs)}
                        </Text>
                      )}
                      
                      {!isMe && isLastInBlock && (
                         <Text style={{ color: '#666', fontSize: 10, marginTop: 2, marginLeft: 4 }}>
                            {members.find(m => m.id === item.user)?.name || 'Membre'}
                         </Text>
                      )}
                  </View>
                </View>
              </View>
              </Swipeable>
            );
          }}
        />

        {/* Input */}
        <View style={{ 
           flexDirection: 'column', 
           backgroundColor: '#000', 
           borderTopWidth: 0,
        }}>
           {/* Replying To Banner */}
           {replyingTo && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1c1c1e', borderTopWidth: 1, borderColor: '#333' }}>
                 <View style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: C.tint, paddingLeft: 8 }}>
                    <Text style={{ color: C.tint, fontSize: 12, fontWeight: 'bold' }}>Réponse à {members.find(m => m.id === replyingTo.user)?.name || 'Membre'}</Text>
                    <Text numberOfLines={1} style={{ color: '#ccc', fontSize: 12 }}>{replyingTo.text}</Text>
                 </View>
                 <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 4 }}>
                    <FontAwesome name="close" size={16} color="#888" />
                 </TouchableOpacity>
              </View>
           )}

        <View style={{ 
           flexDirection: 'row', 
           alignItems: 'center', 
           paddingHorizontal: 10, 
           paddingVertical: 8, 
           gap: 10
        }}>
           
           <View style={{ 
             flex: 1, 
             flexDirection: 'column',
             backgroundColor: '#1c1c1e', 
             borderRadius: 20, 
             paddingHorizontal: 16,
             paddingVertical: 4,
             minHeight: 40
           }}>
             {draftPhoto && (
               <View style={{ marginBottom: 8, marginTop: 8 }}>
                 <ExpoImage source={{ uri: draftPhoto }} style={{ width: 100, height: 100, borderRadius: 8 }} />
                 <TouchableOpacity 
                   onPress={() => setDraftPhoto(null)}
                   style={{ position: 'absolute', top: -6, left: 90, backgroundColor: '#000', borderRadius: 10 }}
                 >
                   <FontAwesome name="times-circle" size={20} color="#fff" />
                 </TouchableOpacity>
               </View>
             )}
             <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ alignItems: 'center', marginRight: 10 }}>
                   <TouchableOpacity onPress={onSendImage}>
                       <FontAwesome name="camera" size={20} color="#888" />
                   </TouchableOpacity>
                   {myProfile?.subscription !== 'PRO' && myProfile?.subscription !== 'PLUS' && (
                      <Text style={{ fontSize: 9, color: '#FFD700', marginTop: 2, fontWeight: '700' }}>{FEATURE_COSTS.SEND_PHOTO} P</Text>
                   )}
                </View>
                <TextInput 
                    value={input}
                    onChangeText={setInput}
                    placeholder="Message..." 
                    placeholderTextColor="#666" 
                    multiline
                    style={{ flex: 1, color: '#fff', fontSize: 16, paddingTop: 8, paddingBottom: 8 }} 
                />
             </View>
           </View>

           <TouchableOpacity 
             onPress={(input.trim().length > 0 || draftPhoto) ? send : undefined}
             style={{ 
               width: 40, height: 40, borderRadius: 20, 
               backgroundColor: C.tint, 
               alignItems: 'center', justifyContent: 'center',
               opacity: (input.trim().length > 0 || draftPhoto) ? 1 : 0.5
             }}
           >
             <FontAwesome name="arrow-up" size={18} color="#fff" />
           </TouchableOpacity>
        </View>
        </View>

      </Animated.View>
      </SafeAreaView>
      </KeyboardAvoidingView>

        {/* Fake Navigation Bar (matching App Tabs) */}
        {!keyboardVisible && (
        <View style={{ flexDirection: 'row', height: 90, backgroundColor: C.card, borderTopWidth: 0.5, borderTopColor: C.border, justifyContent: 'space-around', alignItems: 'center', paddingBottom: 20 }}>
           <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/home' as any)}>
              <FontAwesome name="home" size={28} color={C.muted} />
           </TouchableOpacity>
           <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/discover' as any)}>
              <FontAwesome name="search" size={28} color={C.muted} />
           </TouchableOpacity>
           <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/chats' as any)}>
              <ChatTabIcon color={C.tint} scheme="dark" />
           </TouchableOpacity>
           <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/profile' as any)}>
              <ProfileTabIcon color={C.muted} />
           </TouchableOpacity>
        </View>
        )}

        {/* Members Modal */}
        <Modal
          animationType="none"
          transparent={true}
          visible={showMembers}
          onRequestClose={closeMembers}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
             <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }}>
                <Pressable onPress={closeMembers} style={{ flex: 1 }} />
             </Animated.View>
             <Animated.View style={[{ width: '100%' }, { transform: [{ translateY: slideAnim }] }]}>
               <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#1c1c1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%', width: '100%', borderTopWidth: 1, borderColor: '#333', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 20 }}>
                  {/* Handle */}
                  <View style={{ width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 24 }} />
                  
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8, textAlign: 'center' }}>Membres du groupe</Text>
                  <Text style={{ fontSize: 14, color: '#999', marginBottom: 24, textAlign: 'center' }}>{memberCount} membres • {onlineMemberIds.length} en ligne</Text>

                  <FlatList 
                    data={sortedMembers} 
                    style={{ flexShrink: 1 }}
                    keyExtractor={(m) => m.id} 
                    contentContainerStyle={{ gap: 12, paddingBottom: 20 }} 
                    renderItem={({ item }) => {
                      const isMe = item.id === auth.currentUser?.uid;
                      return (
                      <TouchableOpacity onPress={() => onMemberPress(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#2c2c2e', padding: 12, borderRadius: 16 }}>
                        <View style={isMe ? { padding: 2, borderRadius: 24, borderWidth: 2, borderColor: '#F97316' } : undefined}>
                           <ExpoImage source={{ uri: item.photoUrl || undefined }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#333' }} contentFit="cover" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 16, fontWeight: isMe ? '700' : '600' }}>{item.name} {isMe ? '(Moi)' : ''}</Text>
                          {onlineMemberIds.includes(item.id) && <Text style={{ color: '#4ade80', fontSize: 12 }}>En ligne</Text>}
                        </View>
                        
                        {!isMe && (
                           <TouchableOpacity 
                              onPress={(e) => { e.stopPropagation(); startKickPoll(item); }} 
                              style={{ padding: 8, backgroundColor: '#333', borderRadius: 8, marginRight: 4 }}
                           >
                              <FontAwesome name="ban" size={16} color="#ef4444" />
                           </TouchableOpacity>
                        )}

                        <FontAwesome name="chevron-right" size={14} color="#666" />
                      </TouchableOpacity>
                      );
                    }}
                  />
                  
                  <TouchableOpacity onPress={closeMembers} style={{ marginTop: 8, padding: 16, borderRadius: 16, backgroundColor: '#333', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '600', color: '#fff', fontSize: 16 }}>Fermer</Text>
                  </TouchableOpacity>
               </Pressable>
             </Animated.View>
          </View>
        </Modal>

        {/* Story Modal */}
        <Modal
          animationType="fade"
          transparent
          visible={storyVisible}
          onRequestClose={() => setStoryVisible(false)}
        >
           <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' }}>
              {storyUser && storyUser.photos && storyUser.photos.length > 0 ? (
                 <Pressable onPress={onStoryTap} style={{ flex: 1 }}>
                    <ExpoImage 
                        source={{ uri: storyUser.photos[storyIndex]?.url }} 
                        style={{ flex: 1, width: '100%' }} 
                        contentFit="contain" 
                    />
                    
                    {/* Progress Bars */}
                    <View style={{ position: 'absolute', top: 50, left: 10, right: 10, flexDirection: 'row', gap: 4 }}>
                       {storyUser.photos.map((_: any, i: number) => (
                          <View key={i} style={{ flex: 1, height: 3, backgroundColor: i === storyIndex ? '#fff' : 'rgba(255,255,255,0.3)', borderRadius: 2 }} />
                       ))}
                    </View>

                    {/* Header: Name and Close */}
                    <View style={{ position: 'absolute', top: 60, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                       <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Avatar size={32} ring initials={storyUser.firstName?.[0]} uri={storyUser.primaryPhotoPath ? storyUser.photos?.find((p:any) => p.path === storyUser.primaryPhotoPath)?.url : undefined} />
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }}>{storyUser.firstName}, {storyUser.age}</Text>
                       </View>
                       <TouchableOpacity onPress={() => setStoryVisible(false)} style={{ padding: 8 }}>
                          <FontAwesome name="close" size={24} color="#fff" style={{ opacity: 0.8 }} />
                       </TouchableOpacity>
                    </View>

                    {/* Invite Input Overlay */}
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ position: 'absolute', bottom: 40, left: 16, right: 16 }}>
                       
                       {/* User Info Overlay */}
                       <View style={{ marginBottom: 16, gap: 8 }}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                             {storyUser.genderIdentity && (
                               <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                                 <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{storyUser.genderIdentity.charAt(0).toUpperCase() + storyUser.genderIdentity.slice(1)}</Text>
                               </View>
                             )}
                             {storyUser.heightCm && (
                               <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                                 <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{storyUser.heightCm} cm</Text>
                               </View>
                             )}
                          </View>

                          {storyUser.interests && storyUser.interests.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {storyUser.interests.map((i: string) => (
                                 <View key={i} style={{ backgroundColor: Colors['dark'].tint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                                   <Text style={{ color: Colors['dark'].text, fontSize: 12, fontWeight: '600' }}>{i.charAt(0).toUpperCase() + i.slice(1)}</Text>
                                 </View>
                              ))}
                            </View>
                          )}
                          
                           {storyUser.genders && storyUser.genders.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                               <Text style={{ color: Colors['dark'].subtleText, fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 2 }}>Cherche :</Text>
                              {storyUser.genders.map((g: string) => (
                                 <View key={g} style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                                   <Text style={{ color: Colors['dark'].text, fontSize: 12, fontWeight: '600' }}>{g === 'autres' ? 'Les deux' : g.charAt(0).toUpperCase() + g.slice(1)}</Text>
                                 </View>
                              ))}
                            </View>
                          )}
                       </View>

                       <View style={{ gap: 12 }}>
                          {/* Gold Toggle */}
                          <TouchableOpacity 
                             onPress={() => setIsGoldInvite(p => !p)}
                             style={{ 
                                alignSelf: 'flex-start',
                                backgroundColor: isGoldInvite ? Colors['dark'].gold : 'rgba(0,0,0,0.5)', 
                                paddingHorizontal: 12, 
                                paddingVertical: 6, 
                                borderRadius: 12, 
                                flexDirection: 'row', 
                                alignItems: 'center', 
                                gap: 6,
                                borderWidth: 1,
                                borderColor: isGoldInvite ? Colors['dark'].gold : 'rgba(255,255,255,0.3)'
                             }}
                          >
                             <FontAwesome name="star" size={14} color={isGoldInvite ? Colors['light'].text : Colors['dark'].text} />
                             <Text style={{ color: isGoldInvite ? Colors['light'].text : Colors['dark'].text, fontWeight: 'bold', fontSize: 12 }}>
                                {isGoldInvite ? `Super Invitation (${FEATURE_COSTS.SUPER_INVITE} pins)` : 'Invitation Standard'}
                             </Text>
                          </TouchableOpacity>

                          <View style={{ flexDirection: 'row', gap: 8 }}>
                              <TextInput 
                                 value={storyMessage}
                                 onChangeText={setStoryMessage}
                                 placeholder="Envoyer un message..."
                                 placeholderTextColor={Colors['dark'].subtleText}
                                 style={{ 
                                    flex: 1, 
                                    backgroundColor: 'rgba(0,0,0,0.6)', 
                                    borderRadius: 24, 
                                    paddingHorizontal: 20, 
                                    paddingVertical: 12, 
                                    color: Colors['dark'].text, 
                                    fontSize: 16, 
                                    borderWidth: isGoldInvite ? 1.5 : 1, 
                                    borderColor: isGoldInvite ? Colors['dark'].gold : 'rgba(255,255,255,0.3)' 
                                 }}
                              />
                              <TouchableOpacity onPress={() => sendInvite(isGoldInvite)} disabled={sendingInvite} style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: C.tint, justifyContent: 'center', alignItems: 'center' }}>
                                {sendingInvite ? <ActivityIndicator color={Colors['dark'].text} /> : <FontAwesome name="send" size={20} color={Colors['dark'].text} style={{ marginLeft: -2 }} />}
                              </TouchableOpacity>
                          </View>
                       </View>
                    </KeyboardAvoidingView>
                 </Pressable>
              ) : (
                 <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator color={C.tint} />
                    <TouchableOpacity onPress={() => setStoryVisible(false)} style={{ marginTop: 20 }}>
                      <Text style={{ color: Colors['dark'].text }}>Fermer</Text>
                    </TouchableOpacity>
                 </View>
              )}
           </View>
        </Modal>

        {/* Image Viewer */}
        <Modal visible={!!viewerImage} transparent={true} onRequestClose={() => setViewerImage(null)}>
           <View style={{ flex: 1, backgroundColor: Colors['dark'].background, justifyContent: 'center' }}>
              <TouchableOpacity onPress={() => setViewerImage(null)} style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 }}>
                 <FontAwesome name="close" size={30} color={Colors['dark'].text} />
              </TouchableOpacity>
              
              {viewerImage && (
                 <ExpoImage source={{ uri: viewerImage }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
              )}

              {/* Report Button */}
              {viewerMessageId.current && (
                 <TouchableOpacity 
                    onPress={() => {
                       Alert.alert('Signaler', 'Voulez-vous signaler cette image ?', [
                          { text: 'Annuler', style: 'cancel' },
                          { text: 'Signaler', style: 'destructive', onPress: () => {
                             if (id && viewerMessageId.current) {
                                reportMessage(viewerMessageId.current, id, 'inappropriate', 'Reported via viewer').then(() => {
                                   showToast('Signalé', 'Contenu signalé.', 'success');
                                   setViewerImage(null);
                                });
                             }
                          }}
                       ]);
                    }}
                   style={{ position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'rgba(255,0,0,0.6)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 }}
                 >
                   <Text style={{ color: Colors['dark'].text, fontWeight: 'bold' }}>Signaler</Text>
                 </TouchableOpacity>
              )}
           </View>
        </Modal>
    </View>
  );
}

// Removed unused mergeMessages
