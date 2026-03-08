import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import { auth } from '../../firebaseconfig';
import { getUserProfile, UserProfile } from '../../lib/profile';
import Avatar from './Avatar';

interface MatchNotificationProps {
  partnerUid: string;
  onClose: () => void;
}

export default function MatchNotification({ partnerUid, onClose }: MatchNotificationProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const router = useRouter();
  
  const [partnerProfile, setPartnerProfile] = useState<UserProfile | null>(null);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    // Animation d'entrée
    Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true })
    ]).start();

    // Animation de pulsation pour les avatars
    Animated.loop(
        Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true })
        ])
    ).start();

    // Charger les profils
    const load = async () => {
        try {
            const [p, me] = await Promise.all([
                getUserProfile(partnerUid),
                auth.currentUser?.uid ? getUserProfile(auth.currentUser.uid) : null
            ]);
            setPartnerProfile(p);
            setMyProfile(me);
        } catch (e) {
            console.warn('Error loading match profiles', e);
        }
    };
    load();
  }, [partnerUid, fadeAnim, scaleAnim, pulseAnim]);

  const handleChat = () => {
    onClose();
    router.push(`/chat/${partnerUid}` as any);
  };

  const handleKeepSwiping = () => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        onClose();
    });
  };

  const getUri = (p: UserProfile | null) => {
      if (!p) return undefined;
      return p.photos?.find(ph => ph.path === p.primaryPhotoPath)?.url || p.photos?.[0]?.url;
  };

  const getInitials = (p: UserProfile | null) => {
      return (p?.firstName || 'U')[0].toUpperCase();
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim, zIndex: 9999, alignItems: 'center', justifyContent: 'center' }]}>
        <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
        
        <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: 'center', width: '85%' }}>
            <Text style={styles.title}>C&apos;EST UN MATCH !</Text>
            <Text style={styles.subtitle}>Vous vous plaisez mutuellement</Text>
            
            <Animated.View style={[styles.avatarsContainer, { transform: [{ scale: pulseAnim }] }]}>
                {/* Me */}
                <View style={[styles.avatarWrap, { transform: [{ rotate: '-10deg' }, { translateX: 20 }] }]}>
                    <Avatar 
                        uri={getUri(myProfile)} 
                        initials={getInitials(myProfile)}
                        size={100} 
                        ring
                        ringColor="#fff"
                        ringWidth={4}
                    />
                </View>
                
                {/* Partner */}
                <View style={[styles.avatarWrap, { transform: [{ rotate: '10deg' }, { translateX: -20 }] }]}>
                     <Avatar 
                        uri={getUri(partnerProfile)} 
                        initials={getInitials(partnerProfile)}
                        size={100} 
                        ring
                        ringColor="#fff"
                        ringWidth={4}
                    />
                </View>
            </Animated.View>

            <Text style={styles.message}>
                Lancez la conversation avec {partnerProfile?.firstName || 'cette personne'} dès maintenant !
            </Text>

            <TouchableOpacity 
                onPress={handleChat}
                style={styles.primaryBtn}
            >
                <Text style={styles.primaryBtnTxt}>Envoyer un message</Text>
            </TouchableOpacity>

            <TouchableOpacity 
                onPress={handleKeepSwiping}
                style={styles.secondaryBtn}
            >
                <Text style={styles.secondaryBtnTxt}>Continuer à swiper</Text>
            </TouchableOpacity>
        </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
    title: {
        fontSize: 42,
        fontWeight: '900',
        fontStyle: 'italic',
        color: '#fff',
        marginBottom: 8,
        textShadowColor: Colors.dark.tint,
        textShadowRadius: 15,
        textAlign: 'center'
    },
    subtitle: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 16,
        marginBottom: 40,
        textAlign: 'center'
    },
    avatarsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 120,
        marginBottom: 40
    },
    avatarWrap: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
        elevation: 10
    },
    message: {
        color: '#fff',
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 32,
        fontWeight: '600',
        paddingHorizontal: 20
    },
    primaryBtn: {
        backgroundColor: Colors.dark.tint,
        paddingHorizontal: 32,
        paddingVertical: 18,
        borderRadius: 999,
        width: '100%',
        alignItems: 'center',
        marginBottom: 16,
        shadowColor: Colors.dark.tint,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 8
    },
    primaryBtnTxt: {
        color: '#fff',
        fontWeight: '800',
        fontSize: 18,
        textTransform: 'uppercase'
    },
    secondaryBtn: {
        paddingHorizontal: 32,
        paddingVertical: 14,
        borderRadius: 999,
        width: '100%',
        alignItems: 'center'
    },
    secondaryBtnTxt: {
        color: 'rgba(255,255,255,0.6)',
        fontWeight: '700',
        fontSize: 16
    }
});
