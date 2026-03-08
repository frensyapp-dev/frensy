import FontAwesome from '@expo/vector-icons/FontAwesome';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import relativeTime from 'dayjs/plugin/relativeTime';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';

import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, limit, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Image, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, PanResponder, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChatsScreen from '../(tabs)/chats';
import { ChatTabIcon, ProfileTabIcon } from '../../components/navigation/TabBarIcons';
import { useToast } from '../../components/ui/Toast';
import { Colors } from '../../constants/Colors';
import { auth, db } from '../../firebaseconfig';
import { blockUser } from '../../lib/block';
import { ChatMessage, ChatRequest, deleteChatRequest, listenMessagesForUser, listenMyChatInvitations, loadMessages, loadMoreMessages, markConversationRead, removeConversation, respondToChatRequest, sendRichMessageToUserRetry, setTyping, upsertConversation } from '../../lib/chat/storage';
import { getShareActivePref, hasShareConfirmShown, markShareConfirmShown, setShareActivePref } from '../../lib/locationConfirm';
import { getMatchId } from '../../lib/matches';
import { canPerformAction, FEATURE_COSTS, performActionUpdates } from '../../lib/monetization';
import { dismissChatNotification } from '../../lib/notifications';
import { openUserOnMap } from '../../lib/openUserOnMap';
import { applyUserUpdates, getUserProfile, userPrivateRef, UserProfile } from '../../lib/profile';
import { reportMessage, reportUser } from '../../lib/report';
import { pickAndUploadChatImage } from '../../lib/uploadImages';

import { checkPhotoSafety, REJECTION_MSG, validateMessage } from '../../lib/moderation';
// import { updateDoc } from 'firebase/firestore';
import { useTutorial } from '@/components/TutorialProvider';

// type Scheme = 'light' | 'dark';

// Configure dayjs
dayjs.extend(relativeTime);
dayjs.locale('fr');

export default function ChatDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = (id || '').toString();
  const { showToast } = useToast();
  const [partner, setPartner] = useState<{ name: string; uri?: string }>(() => ({ name: 'Chat' }));
  const [partnerDeleted, setPartnerDeleted] = useState(false);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (me && chatId) {
      const matchId = getMatchId(me, chatId);
      markConversationRead(matchId).catch(() => {});
    }
  }, [chatId]);

  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (me) getUserProfile(me).then(setMyProfile);
  }, []);
  
  // Tutorial
  const { triggerStep } = useTutorial();
  useEffect(() => {
    // Only trigger tutorial if we are in a valid chat
    if (chatId) {
       triggerStep('first_chat_open');
    }
  }, [chatId]);

  // Theme enforcement: Dark as per request
  const C = Colors['dark']; 
  const ACCENT = C.tint;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Helper to merge and sort messages (newest first)
  const mergeMessages = (current: ChatMessage[], newMsgs: ChatMessage[]) => {
    const map = new Map<string, ChatMessage>();
    current.forEach(m => map.set(m.id, m));
    newMsgs.forEach(m => map.set(m.id, m));
    return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  };
  
  const [draft, setDraft] = useState('');
  const [draftPhoto, setDraftPhoto] = useState<string | null>(null);
  const [draftMediaType, setDraftMediaType] = useState<'image' | 'video'>('image');
  const [draftDims, setDraftDims] = useState<{ width: number; height: number } | undefined>(undefined);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  
  const [ghostMode, setGhostMode] = useState<boolean>(false);
  const [shareActive, setShareActive] = useState<boolean>(false);
  const [partnerSharesToMe, setPartnerSharesToMe] = useState<boolean>(false);
  const compScale = useRef(new Animated.Value(1)).current;
  const shareStickyUntilRef = useRef<number>(0);
  const [confirmOnce, setConfirmOnce] = useState<boolean>(false);
  
  const [pendingInvite, setPendingInvite] = useState<ChatRequest | null>(null);
  const [sentInvite, setSentInvite] = useState<ChatRequest | null>(null);
  
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [partnerReadAt, setPartnerReadAt] = useState<number>(0);
  const typingTimeoutRef = useRef<any>(null);
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList>(null);
  const swipeX = useRef(new Animated.Value(0)).current;
  const startXRef = useRef(0);
  const SCREEN_W = Dimensions.get('window').width;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        startXRef.current = (evt.nativeEvent as any)?.pageX || 0;
        return false;
      },
      onMoveShouldSetPanResponder: (_evt, g) => {
        return g.dx > 10 && Math.abs(g.dy) < Math.abs(g.dx);
      },
      onPanResponderMove: (_evt, g) => {
        const dx = Math.max(0, g.dx);
        swipeX.setValue(Math.min(dx, SCREEN_W));
      },
      onPanResponderRelease: (_evt, g) => {
        const dx = Math.max(0, g.dx);
        if (dx > 60 || g.vx > 0.6) {
          Animated.timing(swipeX, { toValue: SCREEN_W, duration: 180, useNativeDriver: true }).start(({ finished }) => {
            if (finished) router.back();
          });
        } else {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  useEffect(() => {
    (async () => {
      try {
        const prof: UserProfile | null = await getUserProfile(chatId);
        if (prof) {
          const name = prof.firstName || 'Chat';
          const uri = prof.photos?.find(ph => ph.path === prof.primaryPhotoPath)?.url || prof.photos?.[0]?.url;
          setPartner({ name, uri });
          setPartnerDeleted(false);
        } else {
          setPartnerDeleted(true);
          setPartner({ name: 'Compte supprimé', uri: undefined });
        }
      } catch {}
    })();
  }, [chatId]);

  useEffect(() => {
    const off = listenMyChatInvitations((reqs) => {
      const match = reqs.find(r => r.status === 'pending' && r.from === chatId);
      setPendingInvite(match || null);
    });
    return off;
  }, [chatId]);

  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const q = (async () => {
        const { collection, query, where, onSnapshot } = await import('firebase/firestore');
        const qSent = query(collection(db, 'chatRequests'), where('from', '==', me), where('to', '==', chatId), where('status', '==', 'pending'));
        return onSnapshot(qSent, (snap) => {
            if (!snap.empty) {
                setSentInvite({ ...snap.docs[0].data(), id: snap.docs[0].id } as ChatRequest);
            } else {
                setSentInvite(null);
            }
        });
    })();
    return () => { q.then(unsub => unsub()); };
  }, [chatId]);

  // Removed blocked-state listener (unused in UI)

  // Age Check
  useEffect(() => {}, [chatId]);


  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const matchId = getMatchId(me, chatId);
    const unsub = onSnapshot(doc(db, 'matches', matchId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPartnerTyping(!!d[`typing_${chatId}`]);
        const readAt = d[`readAt_${chatId}`];
        if (readAt?.toMillis) setPartnerReadAt(readAt.toMillis());
        else if (typeof readAt === 'number') setPartnerReadAt(readAt);
      }
    });
    return () => unsub();
  }, [chatId]);

  useEffect(() => {
    let isMounted = true;
    const cleaners: (() => void)[] = [];
    const msgUnsubRef = { current: null as (() => void) | null };

    (async () => {
      try {
        // Load cached messages first
        const cached = await loadMessages(chatId);
        if (isMounted && cached && cached.length > 0) {
          setMessages(cached.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        }
      } catch {}

      if (!isMounted) return;

      // Check if match exists before listening to avoid permission errors
      try {
        const me = auth.currentUser?.uid;
        if (me) {
          const matchId = getMatchId(me, chatId);
          const matchRef = doc(db, 'matches', matchId);
          const matchSnap = await (await import('firebase/firestore')).getDoc(matchRef);
          
          if (isMounted && matchSnap.exists()) {
             // Only listen if match exists (valid conversation or match)
             const unsub = listenMessagesForUser(chatId, (msgs) => {
              if (isMounted) {
                setMessages(prev => mergeMessages(prev, msgs));
                LayoutAnimation.easeInEaseOut();
                markConversationRead(chatId).catch(() => {});
              }
            }, (_err) => {});
            msgUnsubRef.current = unsub;
          }
        }
      } catch {
        // ignore
      }
      
      if (!isMounted) return;

      try { await markConversationRead(chatId); } catch {}
      try { await dismissChatNotification(chatId); } catch {}
      
      if (!isMounted) return;

      // User & Share listeners
      try {
        const meUid = auth.currentUser?.uid;
        if (meUid) {
          const uref = userPrivateRef(meUid);
          const unsubUser = onSnapshot(uref, (snap) => {
            if (isMounted) {
              const data = snap.data() as any;
              setGhostMode(!!data?.ghostMode);
            }
          });
          cleaners.push(() => unsubUser());

          // Use queries for location shares to avoid Permission Denied on missing docs
          const sharesCol = collection(db, 'locationShares');
          
          // My share to partner
          const myShareQuery = query(sharesCol, where('from', '==', meUid), where('to', '==', chatId), limit(1));
          
          // Initial local check
          (async () => {
             const localActive = await getShareActivePref(meUid, chatId);
             if (isMounted && localActive) setShareActive(true);
          })();

          const unsubShare = onSnapshot(myShareQuery, (snap) => {
            if (!isMounted) return;
            if (snap.empty) {
               if (Date.now() >= shareStickyUntilRef.current) setShareActive(false);
               return;
            }
            const d = snap.docs[0].data() as any;
            const now = Date.now();
            let active = !!d?.active && d?.revoked !== true;
            if (active && typeof d.expiresAtMs === 'number' && d.expiresAtMs < now) {
              active = false;
            }
            if (!active && Date.now() < shareStickyUntilRef.current) return;
            setShareActive(active);
          }, (err) => {});
          cleaners.push(() => unsubShare());

          // Partner share to me
          const otherShareQuery = query(sharesCol, where('from', '==', chatId), where('to', '==', meUid), limit(1));
          const unsubOther = onSnapshot(otherShareQuery, (snap) => {
            if (!isMounted) return;
            if (snap.empty) {
               setPartnerSharesToMe(false);
               return;
            }
            const d = snap.docs[0].data() as any;
            const now = Date.now();
            let active = !!d?.active && d?.revoked !== true;
            if (active && typeof d.expiresAtMs === 'number' && d.expiresAtMs < now) {
               active = false;
            }
            setPartnerSharesToMe(active);
          }, (err) => {});
          cleaners.push(() => unsubOther());
        }
      } catch {}
    })();

    return () => { 
      isMounted = false;
      if (msgUnsubRef.current) msgUnsubRef.current();
      cleaners.forEach((fn) => { try { fn(); } catch {} }); 
      markConversationRead(chatId).catch(() => {});
    };
  }, [chatId]);

  const ensureAuthReady = async () => {
    if (!auth.currentUser) throw new Error('Non connecté');
  };

  const onTextChange = (txt: string) => {
    setDraft(txt);
    if (txt.length > 0) {
      setTyping(chatId, true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setTyping(chatId, false);
      }, 3000);
    } else {
      setTyping(chatId, false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  };

  const send = async () => {
    if (sending) return;
    const text = draft.trim();
    if (!text && !draftPhoto) return;

    if (text) {
      const check = validateMessage(text);
      if (!check.valid) {
        Alert.alert('Message refusé', check.error);
        return;
      }
    }

    if (ghostMode) {
      showToast('Mode fantôme', `Vous êtes en mode fantôme, vous ne pouvez pas envoyer de message pour ${partner.name}`, 'warning');
      return;
    }
    if (partnerDeleted) {
      showToast("Info", "L'utilisateur a supprimé son compte", 'info');
      return;
    }
    
    setSending(true);
    try {
      await ensureAuthReady();
      const me = auth.currentUser?.uid;

      // Monetization Check & Deduction for Photo/Video
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
                  // Photo
                  const check = performActionUpdates(profile, 'SEND_PHOTO');
                  if (!check.allowed) {
                      showToast('Erreur', 'Pas assez de Pins ou abonnement requis.', 'error');
                      setSending(false);
                      return;
                  }
                  if (check.updates && Object.keys(check.updates).length > 0) {
                      await applyUserUpdates(me, check.updates);
                  }
              }
          }
      }
      
      // Optimistic update for fluidity
      setDraft('');
      const photoToSend = draftPhoto;
      const mediaTypeToSend = draftMediaType;
      const dims = draftDims;
      setDraftPhoto(null);
      setDraftMediaType('image');
      setDraftDims(undefined);
      const textToSend = text;
      
      const replyData = replyingTo ? {
        id: replyingTo.id,
        text: replyingTo.text || null,
        senderName: replyingTo.senderId === auth.currentUser?.uid ? 'Moi' : partner.name
      } : undefined;

      await sendRichMessageToUserRetry(chatId, textToSend || null, photoToSend || null, dims?.width, dims?.height, 2, replyData, mediaTypeToSend);
      setReplyingTo(null);
      const summary = photoToSend ? (mediaTypeToSend === 'video' ? '🎥 Vidéo' : '📷 Photo') : textToSend;
      const updatePayload: any = { 
        id: chatId, 
        avatar: partner.uri, 
        lastMessageText: summary || '', 
        lastMessageAt: Date.now(),
        lastSenderId: auth.currentUser?.uid,
        partnerUid: chatId
      };
      if (partner.name && partner.name !== 'Utilisateur supprimé' && partner.name !== 'Chat') {
        updatePayload.title = partner.name;
      }
      await upsertConversation(updatePayload);
      } catch (e: any) {
      showToast('Erreur', e?.message || "Échec de l'envoi", 'error');
      // Restore draft on error if needed, but simple alert is usually enough for now
    } finally {
        setSending(false);
    }
  };

  const onSendImage = async () => {
    if (ghostMode || partnerDeleted) return;
    try {
      const me = auth.currentUser?.uid;
      if (!me) return;
      const profile = await getUserProfile(me);
      if (!profile) return;

      const check = canPerformAction(profile, 'SEND_PHOTO');
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

      const isPro = profile.subscription === 'PRO';
      const res = await pickAndUploadChatImage(chatId, isPro);
      if (res) {
        // Moderation
        const safety = await checkPhotoSafety(res.url);
        if (safety === 'rejected') {
          showToast('Photo refusée', REJECTION_MSG, 'error');
          return;
        }

        setDraftPhoto(res.url);
        setDraftMediaType(res.type);
        setDraftDims({ width: res.width, height: res.height });
      }
    } catch (e: any) {
      showToast('Erreur', e.message, 'error');
    }
  };

  const toggleShare = async () => {
    try {
      const me = auth.currentUser?.uid;
      if (!me) throw new Error('Utilisateur non authentifié');
      if (ghostMode) {
        showToast('Mode fantôme', `Vous êtes en mode fantôme, vous ne pouvez pas activer votre localisation pour ${partner.name}`, 'warning');
        return;
      }
      const shareId = `${me}_${chatId}`;
      if (!shareActive) {
        await setDoc(doc(db, 'locationShares', shareId), { 
          from: me, 
          to: chatId, 
          active: true, 
          revoked: false,
          createdAt: serverTimestamp(), 
          updatedAt: serverTimestamp(),
          expiresAtMs: null // No expiration
        }, { merge: true });
        shareStickyUntilRef.current = Date.now() + 10000;
        setShareActive(true);
        try { await setShareActivePref(me, chatId, true); } catch {}
      } else {
        await setDoc(doc(db, 'locationShares', shareId), { from: me, to: chatId, active: false, revoked: true, updatedAt: serverTimestamp() }, { merge: true });
        setShareActive(false);
        try { await setShareActivePref(me, chatId, false); } catch {}
      }
      LayoutAnimation.easeInEaseOut();
    } catch (e: any) {
      showToast('Erreur', e?.message || 'Action impossible', 'error');
    }
  };

  const onPressCompass = async () => {
    try {
      const me = auth.currentUser?.uid;
      if (!me) throw new Error('Utilisateur non authentifié');
      let seen = confirmOnce;
      if (!seen) {
        seen = await hasShareConfirmShown(me);
        if (seen) setConfirmOnce(true);
      }
      
      if (!shareActive && !seen) {
        Alert.alert(
          'Partage de position',
          `Voulez-vous partager votre position en temps réel (Live) ?`,
          [
            { text: 'Annuler', style: 'cancel' },
            { text: '📡 Activer le Live', onPress: async () => { try { await markShareConfirmShown(me); setConfirmOnce(true); await toggleShare(); } catch {} } },
          ]
        );
        return;
      }
      
      // Toggle directly if seen or already active
      await toggleShare();
    } catch (e: any) {
      showToast('Erreur', e?.message || 'Action impossible', 'error');
    }
  };

  const onBlock = async () => {
    if (partnerDeleted) {
      showToast("Info", "L'utilisateur a supprimé son compte", 'info');
      return;
    }
    Alert.alert('Bloquer cet utilisateur ?', "Tu ne verras plus cet utilisateur et vous ne pourrez plus discuter.", [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Bloquer', style: 'destructive', onPress: async () => {
        try { await blockUser(chatId); showToast('Bloqué', "L'utilisateur a été bloqué.", 'success'); router.back(); } catch (e: any) { showToast('Erreur', e?.message || 'Échec du blocage', 'error'); }
      }},
    ]);
  };

  const onReport = () => {
    if (partnerDeleted) {
      showToast("Info", "L'utilisateur a supprimé son compte", 'info');
      return;
    }
    Alert.alert('Signaler', 'Choisis une raison', [
      { text: 'Spam', onPress: async () => { try { await reportUser(chatId, 'spam'); showToast('Merci', 'Signalement envoyé', 'success'); } catch (e:any){ showToast('Erreur', e?.message || 'Échec du signalement', 'error'); } } },
      { text: 'Profil faux', onPress: async () => { try { await reportUser(chatId, 'fake'); showToast('Merci', 'Signalement envoyé', 'success'); } catch (e:any){ showToast('Erreur', e?.message || 'Échec du signalement', 'error'); } } },
      { text: 'Harcèlement', onPress: async () => { try { await reportUser(chatId, 'harassment'); showToast('Merci', 'Signalement envoyé', 'success'); } catch (e:any){ showToast('Erreur', e?.message || 'Échec du signalement', 'error'); } } },
      { text: 'Contenu inapproprié', onPress: async () => { try { await reportUser(chatId, 'inappropriate'); showToast('Merci', 'Signalement envoyé', 'success'); } catch (e:any){ showToast('Erreur', e?.message || 'Échec du signalement', 'error'); } } },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const openMoreActions = () => {
    if (partnerDeleted) {
      showToast("Info", "L'utilisateur a supprimé son compte", 'info');
      return;
    }
    
    const actions: any[] = [];
    
    if (partnerSharesToMe) {
      actions.push({ 
        text: '📍 Voir sur la map', 
        onPress: () => {
          try { openUserOnMap(chatId); } catch (e: any) { showToast('Erreur', e?.message || "Impossible d'ouvrir la carte", 'error'); }
        }
      });
    }
    
    actions.push({ text: '⚠️ Signaler', onPress: onReport });
    actions.push({ text: '🚫 Bloquer', style: 'destructive', onPress: onBlock });
    actions.push({ text: 'Annuler', style: 'cancel' });

    Alert.alert('Actions', 'Choisis une action', actions);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    try {
      setLoadingMore(true);
      const oldest = messages[messages.length - 1];
      const older = await loadMoreMessages(chatId, oldest.createdAt || 0);
      if (older.length === 0) {
        setHasMore(false);
      } else {
        setMessages(prev => mergeMessages(prev, older));
      }
    } catch {
    } finally {
      setLoadingMore(false);
    }
  };

  const acceptInvite = async () => {
    try {
      await respondToChatRequest(chatId, 'accepted');
      try { await (await import('../../lib/chat/storage')).unremoveConversation(chatId); } catch {}
      setPendingInvite(null);
      
      // Navigation fluide immédiate
      router.replace('/(tabs)/chats');
      showToast('Succès', 'Invitation acceptée', 'success');
      
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || "Échec de l’acceptation");
    }
  };

  const rejectInvite = async () => {
    try {
      await deleteChatRequest(chatId);
      await removeConversation(chatId);
      setPendingInvite(null);
      Alert.alert('Invitation refusée', 'La conversation a été supprimée.');
      router.back();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || "Échec du refus");
    }
  };

  const formatDay = (ts: number) => dayjs(ts).format('D MMMM');
  const formatDate = (ts: number) => dayjs(ts).format('HH:mm');

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ ...StyleSheet.absoluteFillObject }} pointerEvents="none">
        <ChatsScreen embedded />
      </View>
      <Animated.View style={{ flex: 1, backgroundColor: '#000', transform: [{ translateX: swipeX }], shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12 }} {...pan.panHandlers}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#000' }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
               <Text style={{ fontSize: 28, color: '#fff', fontWeight: '300', marginTop: -2 }}>‹</Text>
            </TouchableOpacity>
            
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
             <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => !partnerDeleted && router.push(`/user/${chatId}` as any)} disabled={partnerDeleted}>
               {partner.uri ? (
                 <Image source={{ uri: partner.uri }} style={{ width: 32, height: 32, borderRadius: 16, marginBottom: 2 }} />
               ) : (
                 <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#333', marginBottom: 2 }} />
               )}
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                 <Text style={{ color: partnerDeleted ? '#888' : '#fff', fontSize: 12, fontWeight: '700', fontStyle: partnerDeleted ? 'italic' : 'normal' }}>
                   {partnerDeleted ? 'Compte supprimé' : partner.name}
                 </Text>
                        {/* Online indicator removed */}
               </View>
             </TouchableOpacity>
          </View>
  
            <TouchableOpacity onPress={openMoreActions} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Image source={require('../../assets/images/frensylogo.png')} style={{ width: 28, height: 28, resizeMode: 'contain' }} />
            </TouchableOpacity>
          </View>

          {/* Pending Invite */}
          {pendingInvite && (
            <View style={{ marginHorizontal: 16, marginBottom: 8, borderRadius: 16, overflow: 'hidden', borderWidth: pendingInvite.isSuper ? 2 : 1, borderColor: pendingInvite.isSuper ? '#FFD700' : C.border }}>
              <View style={{ padding: 12, backgroundColor: pendingInvite.isSuper ? 'rgba(255, 215, 0, 0.1)' : '#111' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Invitation de {partner.name}</Text>
                    {pendingInvite.isSuper && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFD700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
                            <FontAwesome name="star" size={12} color="#000" />
                            <Text style={{ color: '#000', fontSize: 10, fontWeight: '900' }}>SUPER</Text>
                        </View>
                    )}
                </View>
                {pendingInvite.imageUrl && (
                  <Image source={{ uri: pendingInvite.imageUrl }} style={{ width: 100, height: 100, borderRadius: 12, marginTop: 6 }} />
                )}
                {!!pendingInvite.messageText && (<Text style={{ color: pendingInvite.isSuper ? '#FFD700' : '#aaa', marginTop: 6 }}>{pendingInvite.messageText}</Text>)}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <TouchableOpacity onPress={acceptInvite} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: pendingInvite.isSuper ? '#FFD700' : ACCENT }}>
                    <Text style={{ color: pendingInvite.isSuper ? '#000' : '#fff', fontWeight: '800' }}>Accepter</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={rejectInvite} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#333', borderWidth: 1, borderColor: C.border }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Refuser</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* Messages */}
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            inverted
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 10, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ref={listRef as any}
            initialNumToRender={14}
            windowSize={7}
            removeClippedSubviews
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            renderItem={({ item, index }) => {
              const myUid = auth.currentUser?.uid || '';
              const isMe = item.senderId === myUid;
              
              const prevMsg = messages[index + 1];
              const nextMsg = messages[index - 1]; // Newer message
              
              // Date separator
              let showDate = false;
              if (prevMsg) {
                 const day1 = dayjs(item.createdAt || 0).format('YYYY-MM-DD');
                 const day2 = dayjs(prevMsg.createdAt || 0).format('YYYY-MM-DD');
                 if (day1 !== day2) showDate = true;
              } else {
                 showDate = true; // Last message
              }

              // Status logic
              // Show only if it is the last message in a sequence from the same user
              const isLastInSequence = !nextMsg || nextMsg.senderId !== item.senderId;
              const showStatus = isLastInSequence;

              const isRead = partnerReadAt >= (item.createdAt || 0);
              let statusLabel = formatDate(item.createdAt || 0);
              if (isMe && isRead) statusLabel = 'Lu ' + statusLabel;

              // Location Message
              const isLoc = !!item.text && (item.text.startsWith('📍 Position précise') || item.text.startsWith('📍 Position approximative'));
              const locUrl = isLoc ? (item.text!.match(/https?:\/\/maps\.google\.com\/\?q=([^\s]+)/)?.[0] || null) : null;
              
              // Image Message
              const isImg = !!item.imageUrl;
              const aspectRatio = (item.imageW && item.imageH) ? (item.imageH / item.imageW) : 1;

              const renderReply = () => {
                if (!item.replyTo) return null;
                return (
                  <View style={{ 
                    backgroundColor: 'rgba(0,0,0,0.2)', 
                    borderLeftWidth: 4, 
                    borderLeftColor: isMe ? '#fff' : ACCENT, 
                    paddingHorizontal: 10, 
                    paddingVertical: 6, 
                    borderRadius: 4,
                    marginBottom: 6
                  }}>
                    <Text style={{ color: isMe ? 'rgba(255,255,255,0.9)' : ACCENT, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
                       {item.replyTo.senderName}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} numberOfLines={1}>
                       {item.replyTo.text || '📷 Photo'}
                    </Text>
                  </View>
                );
              };

              let swipeableRow: Swipeable | null = null;
              const renderSwipeAction = (progress: any, dragX: any) => {
                return (
                  <View style={{ justifyContent: 'center', alignItems: isMe ? 'flex-end' : 'flex-start', width: 80, paddingHorizontal: 20 }}>
                     <FontAwesome name="reply" size={20} color="#666" />
                  </View>
                );
              };

              return (
                <View>
                  {showDate && (
                    <View style={{ alignItems: 'center', marginVertical: 16 }}>
                       <View style={{ backgroundColor: '#2C2C2E', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}>
                          <Text style={{ color: '#aaa', fontSize: 12, fontWeight: '600' }}>{formatDay(item.createdAt || 0)}</Text>
                       </View>
                    </View>
                  )}
                  
                  <TouchableOpacity
                    onLongPress={() => {
                        Alert.alert('Répondre', 'Répondre à ce message ?', [
                            { text: 'Annuler', style: 'cancel' },
                            { text: 'Répondre', onPress: () => setReplyingTo(item) }
                        ]);
                    }}
                    delayLongPress={300}
                    activeOpacity={0.8}
                    style={{ 
                        backgroundColor: replyingTo?.id === item.id ? 'rgba(249, 115, 22, 0.15)' : 'transparent',
                        paddingVertical: 2,
                        width: '100%'
                    }}
                  >
                  <View style={{ flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
                    {isMe ? (
                      isImg ? (
                         <View style={{ alignItems: 'flex-end', maxWidth: '75%' }}>
                             {item.replyTo && (
                                <View style={{ 
                                  backgroundColor: '#222', 
                                  borderLeftWidth: 4, 
                                  borderLeftColor: ACCENT, 
                                  paddingHorizontal: 10, 
                                  paddingVertical: 6, 
                                  borderRadius: 8,
                                  marginBottom: 4,
                                  alignSelf: 'stretch'
                                }}>
                                  <Text style={{ color: ACCENT, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
                                     {item.replyTo.senderName}
                                  </Text>
                                  <Text style={{ color: '#aaa', fontSize: 12 }} numberOfLines={1}>
                                     {item.replyTo.text || '📷 Photo'}
                                  </Text>
                                </View>
                             )}
                             <TouchableOpacity onPress={() => setFullScreenImage(item.imageUrl!)}>
                                <Image 
                                  source={{ uri: item.imageUrl! }} 
                                  style={{ width: 200, height: 200 * aspectRatio, borderRadius: 16, maxWidth: 240, maxHeight: 300 }} 
                                  resizeMode="cover"
                                />
                             </TouchableOpacity>
                             {!!item.text && (
                               <LinearGradient
                                  colors={[ACCENT, C.tintAlt]}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 1, y: 1 }}
                                  style={{ 
                                    marginTop: 4,
                                    paddingHorizontal: 16, 
                                    paddingVertical: 12, 
                                    borderRadius: 16,
                                    borderBottomRightRadius: 4,
                                    borderBottomLeftRadius: 16,
                                  }}
                               >
                                  <Text style={{ color: '#fff', fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
                               </LinearGradient>
                             )}
                         </View>
                      ) : (
                      <LinearGradient
                        colors={[ACCENT, C.tintAlt]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ 
                          maxWidth: '75%', 
                          paddingHorizontal: 16, 
                          paddingVertical: 12, 
                          borderRadius: 24,
                          borderBottomRightRadius: 4,
                          borderBottomLeftRadius: 24,
                        }}
                      >
                         {renderReply()}
                         {isLoc ? (
                        <TouchableOpacity onPress={() => {
                          if (locUrl) {
                             Linking.openURL(locUrl);
                          } else {
                             openUserOnMap(chatId);
                          }
                        }} style={{ alignItems: 'center', justifyContent: 'center' }}>
                          <Image
                            source={require('../../assets/images/location-dark.png')}
                            style={{ width: 110, height: 24, resizeMode: 'contain' }}
                          />
                          {locUrl && (
                            <TouchableOpacity onPress={() => Linking.openURL(locUrl)} style={{ marginTop: 6 }}>
                              <Text style={{ color: '#fff', opacity: 0.9 }}>Ouvrir dans Google Maps</Text>
                            </TouchableOpacity>
                          )}
                        </TouchableOpacity>
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
                      )}
                      </LinearGradient>
                      )
                    ) : (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onLongPress={() => {
                            Alert.alert('Signaler ce message ?', '', [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Signaler', style: 'destructive', onPress: () => {
                                    Alert.alert('Raison', '', [
                                        { text: 'Spam', onPress: () => reportMessage(item.id, chatId, 'spam', undefined, false).then(() => showToast('Signalé', 'Message signalé', 'success')) },
                                        { text: 'Harcèlement', onPress: () => reportMessage(item.id, chatId, 'harassment', undefined, false).then(() => showToast('Signalé', 'Message signalé', 'success')) },
                                        { text: 'Inapproprié', onPress: () => reportMessage(item.id, chatId, 'inappropriate', undefined, false).then(() => showToast('Signalé', 'Message signalé', 'success')) },
                                        { text: 'Annuler', style: 'cancel' }
                                    ]);
                                }}
                            ]);
                        }}
                      >
                      <View style={{ 
                        maxWidth: '75%', 
                        paddingHorizontal: 16, 
                        paddingVertical: 12, 
                        borderRadius: 24,
                        backgroundColor: '#2C2C2E',
                        borderBottomRightRadius: 24,
                        borderBottomLeftRadius: 4,
                      }}>
                        {renderReply()}
                        {isLoc ? (
                        <TouchableOpacity onPress={() => {
                          if (locUrl) {
                             Linking.openURL(locUrl);
                          } else {
                             openUserOnMap(chatId);
                          }
                        }} style={{ alignItems: 'center', justifyContent: 'center' }}>
                          <Image
                            source={require('../../assets/images/location-dark.png')}
                            style={{ width: 110, height: 24, resizeMode: 'contain' }}
                          />
                          {locUrl && (
                            <TouchableOpacity onPress={() => Linking.openURL(locUrl)} style={{ marginTop: 6 }}>
                              <Text style={{ color: '#fff', opacity: 0.9 }}>Ouvrir dans Google Maps</Text>
                            </TouchableOpacity>
                          )}
                        </TouchableOpacity>
                      ) : isImg ? (
                        <View>
                          <TouchableOpacity onPress={() => setFullScreenImage(item.imageUrl!)}>
                          <Image 
                            source={{ uri: item.imageUrl! }} 
                            style={{ width: 200, height: 200 * aspectRatio, borderRadius: 12, maxWidth: 240, maxHeight: 300 }} 
                            resizeMode="cover"
                          />
                          </TouchableOpacity>
                          {!!item.text && (
                            <Text style={{ color: '#fff', fontSize: 16, lineHeight: 22, marginTop: 8 }}>{item.text}</Text>
                          )}
                        </View>
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
                      )}
                      </View>
                      </TouchableOpacity>
                    )}
                    {showStatus && (
                        <Text style={{ color: '#666', fontSize: 11, marginTop: 4, marginHorizontal: 4 }}>
                        {statusLabel}
                        </Text>
                    )}
                  </View>
                  </TouchableOpacity>
                </View>
              );
            }}
          />

          {/* Typing Indicator */}
          {partnerTyping && (
             <View style={{ paddingHorizontal: 20, paddingBottom: 4, backgroundColor: '#000' }}>
                <Text style={{ color: '#aaa', fontSize: 12, fontStyle: 'italic' }}>{partner.name} est en train d’écrire...</Text>
             </View>
          )}

          {/* Input Area */}
          {replyingTo && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#333' }}>
              <View style={{ width: 4, height: '100%', backgroundColor: ACCENT, marginRight: 12, borderRadius: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>
                  Réponse à {replyingTo.senderId === auth.currentUser?.uid ? 'Moi' : partner.name}
                </Text>
                <Text style={{ color: '#aaa', fontSize: 13 }} numberOfLines={1}>
                  {replyingTo.text || (replyingTo.imageUrl ? '📷 Photo' : 'Message')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 4 }}>
                 <FontAwesome name="times" size={16} color="#aaa" />
              </TouchableOpacity>
            </View>
          )}

          {draftPhoto && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#333' }}>
              <Image source={{ uri: draftPhoto }} style={{ width: 48, height: 48, borderRadius: 8, marginRight: 12, backgroundColor: '#333' }} resizeMode="cover" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>
                  Photo jointe
                </Text>
                <Text style={{ color: '#aaa', fontSize: 12 }}>
                  Appuyez sur envoyer pour partager
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDraftPhoto(null)} style={{ padding: 4 }}>
                 <FontAwesome name="times" size={16} color="#aaa" />
              </TouchableOpacity>
            </View>
          )}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
             {/* Compass / Share Location Button */}
             <Animated.View style={{ transform: [{ scale: compScale }] }}>
               <TouchableOpacity
                  onPress={onPressCompass}
                  onPressIn={() => Animated.spring(compScale, { toValue: 0.96, useNativeDriver: true }).start()}
                  onPressOut={() => Animated.spring(compScale, { toValue: 1, useNativeDriver: true }).start()}
                  disabled={ghostMode || !!pendingInvite || !!sentInvite}
                  style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: shareActive ? ACCENT : '#1A1A1A', borderWidth: 1, borderColor: '#333', opacity: (pendingInvite || sentInvite) ? 0.5 : 1 }}
                >
                  <Text style={{ fontSize: 20 }}>🧭</Text>
                </TouchableOpacity>
             </Animated.View>

             <View style={{ flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 }}>
               <View style={{ alignItems: 'center', marginRight: 10 }}>
                 <TouchableOpacity onPress={onSendImage}>
                   <FontAwesome name="camera" size={20} color="#fff" />
                 </TouchableOpacity>
                 {myProfile?.subscription !== 'PRO' && myProfile?.subscription !== 'PLUS' && (
                    <Text style={{ fontSize: 9, color: '#FFD700', marginTop: 2, fontWeight: '700' }}>{FEATURE_COSTS.SEND_PHOTO} P</Text>
                 )}
               </View>
               <TextInput 
                  value={draft} 
                  onChangeText={onTextChange} 
                  placeholder={pendingInvite ? "Acceptez l’invitation pour répondre" : (sentInvite ? "Invitation envoyée" : "Envoyer un message...")}
                  placeholderTextColor="#888" 
                  multiline
                  editable={!pendingInvite && !sentInvite}
                  style={{ flex: 1, color: '#fff', fontSize: 16, paddingTop: 12, paddingBottom: 12 }} 
               />
             </View>
  
             <TouchableOpacity 
               onPress={((draft.trim().length > 0 || !!draftPhoto) && !pendingInvite && !sentInvite && !sending) ? send : undefined}
               disabled={!!pendingInvite || !!sentInvite || sending}
               style={{ 
                 width: 40, height: 40, borderRadius: 20, 
                 backgroundColor: ((draft.trim().length > 0 || !!draftPhoto) && !pendingInvite && !sentInvite && !sending) ? ACCENT : '#333', 
                 alignItems: 'center', justifyContent: 'center',
                 opacity: sending ? 0.7 : 1
               }}
             >
               {sending ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="arrow-up" size={18} color="#fff" />}
             </TouchableOpacity>
          </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      <View style={{ flexDirection: 'row', height: 90, backgroundColor: C.card, borderTopWidth: 0.5, borderTopColor: C.border, justifyContent: 'space-around', alignItems: 'center', paddingBottom: 20 }}>
         <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/home' as any)}>
            <FontAwesome name="home" size={28} color={C.muted} />
         </TouchableOpacity>
         <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/discover' as any)}>
            <FontAwesome name="search" size={28} color={C.muted} />
         </TouchableOpacity>
         <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/chats' as any)}>
            <ChatTabIcon color={ACCENT} scheme="dark" />
         </TouchableOpacity>
         <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => router.push('/(tabs)/profile' as any)}>
            <ProfileTabIcon color={C.muted} />
         </TouchableOpacity>
      </View>
      </Animated.View>
      <Modal visible={!!fullScreenImage} transparent={true} onRequestClose={() => setFullScreenImage(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 }} onPress={() => setFullScreenImage(null)}>
            <FontAwesome name="times" size={30} color="#fff" />
          </TouchableOpacity>
          {fullScreenImage && (
            <Image source={{ uri: fullScreenImage }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </View>
  );
}
