import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import React, { useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import GlassCard from '../../components/ui/GlassCard';
import { GradientButton } from '../../components/ui/GradientButton';
import { pickPhotoForPreview } from '../../lib/uploadImages';
import { db } from '../../firebaseconfig';
import { useToast } from '@/components/ui/Toast';

export default function NewStoryScreen() {
  const uid = getAuth().currentUser?.uid || null;
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const { showToast } = useToast();
  const C = Colors['dark'];

  const onPick = async () => {
    try {
      const res = await pickPhotoForPreview();
      if (!res) return;
      setPreviewUri(res.localUri);
    } catch (e: any) {
      showToast('Erreur', e?.message || String(e), 'error');
    }
  };

  const onConfirm = async () => {
    try {
      if (!uid || !previewUri) { showToast('Info', 'Sélectionne une photo', 'info'); return; }
      const expires = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      // Create story in root 'stories' collection
      await addDoc(collection(db, 'stories'), { 
        uid, 
        uri: previewUri, 
        createdAt: serverTimestamp(), 
        expiresAt: expires 
      });
      showToast('Succès', 'Story publiée ✅', 'success');
      router.back();
    } catch (e: any) {
      showToast('Erreur', e?.message || String(e), 'error');
    }
  };

  return (
    <LinearGradient colors={[ '#0b0b0b', '#0f172a', '#1f2937' ]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16, gap: 20, alignItems: 'center', justifyContent: 'center' }}>
        <GlassCard style={{ width: '100%', maxWidth: 420, borderRadius: 24, padding: 16, gap: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: '900', textAlign: 'center', color: C.text }}>Nouvelle story</Text>
          <View style={{ height: 280, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <TouchableOpacity onPress={onPick} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: C.tint }} testID="btn-story-pick-photo">
                <Text style={{ color: '#fff', fontWeight: '800' }}>Choisir une image</Text>
              </TouchableOpacity>
            )}
          </View>
          <GradientButton label="Publier" onPress={onConfirm} disabled={!previewUri} style={{ marginTop: 12 }} />
        </GlassCard>
      </View>
    </LinearGradient>
  );
}
