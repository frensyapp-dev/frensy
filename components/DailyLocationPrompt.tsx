import { Colors } from '@/constants/Colors';
import { getApproxPosition } from '@/lib/location';
import { setDailyLocation } from '@/lib/positions';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import { BlurView } from 'expo-blur';
import { getBackgroundPermissionsAsync } from 'expo-location';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const STORAGE_KEY = 'lastDailyLocPrompt';

export default function DailyLocationPrompt() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const C = Colors['dark']; // Assuming dark mode for now or match parent

  useEffect(() => {
    checkPrompt();
  }, []);

  const checkPrompt = async () => {
    try {
      // Si l'utilisateur a déjà la localisation en arrière-plan ("Toujours"), 
      // pas besoin de demander "où es-tu", car on le sait déjà en permanence.
      const { status: bgStatus } = await getBackgroundPermissionsAsync();
      if (bgStatus === 'granted') {
        return; 
      }

      const last = await AsyncStorage.getItem(STORAGE_KEY);
      const today = dayjs().format('YYYY-MM-DD');
      if (last !== today) {
        // Delay slightly to not block startup animations
        setTimeout(() => setVisible(true), 1500);
      }
    } catch (e) {
      console.warn(e);
    }
  };

  const handleSetLocation = async () => {
    setLoading(true);
    try {
      // 1. Get location
      const pos = await getApproxPosition();
      // 2. Set daily base
      await setDailyLocation(pos.lat, pos.lng);
      // 3. Save state
      await AsyncStorage.setItem(STORAGE_KEY, dayjs().format('YYYY-MM-DD'));
      setVisible(false);
    } catch (e) {
      console.warn(e);
      // Fallback: close anyway? Or show error?
      // Just close for UX smoothness
      setVisible(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, dayjs().format('YYYY-MM-DD'));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleSkip}>
      <View style={s.backdrop}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        
        <View style={[s.card, { backgroundColor: '#1c1c1e', borderColor: '#333' }]}>
          <Text style={[s.title, { color: '#fff' }]}>📍 Où es-tu aujourd&apos;hui ?</Text>
          <Text style={[s.desc, { color: '#ccc' }]}>
            Définis ta zone pour la journée pour rester visible sur la carte même si tu n&apos;es pas en ligne.
          </Text>

          <View style={s.actions}>
            <Pressable 
              style={({ pressed }) => [s.btnMain, { opacity: pressed ? 0.8 : 1, backgroundColor: C.tint }]}
              onPress={handleSetLocation}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="location" size={18} color="#fff" />
                  <Text style={s.btnTxtMain}>Ici, dans cette zone</Text>
                </>
              )}
            </Pressable>

            <Pressable 
              style={({ pressed }) => [s.btnSec, { opacity: pressed ? 0.6 : 1 }]}
              onPress={handleSkip}
              disabled={loading}
            >
              <Text style={[s.btnTxtSec, { color: '#888' }]}>Pas aujourd&apos;hui</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center'
  },
  desc: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22
  },
  actions: {
    width: '100%',
    gap: 12,
    marginTop: 8
  },
  btnMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8
  },
  btnTxtMain: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16
  },
  btnSec: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  btnTxtSec: {
    fontWeight: '600',
    fontSize: 15
  }
});
