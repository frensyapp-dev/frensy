import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { GradientButton } from '../../components/ui/GradientButton';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const { width } = Dimensions.get('window');

export default function AddPhotoScreen() {
  const [url, setUrl] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [accountType, setAccountType] = useState<'individual' | 'group'>('individual');
  
  // Focus logic (simplifié pour la stabilité)
  const [focusX, setFocusX] = useState(0.5);
  const [focusY, setFocusY] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [editMode, setEditMode] = useState(false);

  // Shared values for gestures
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const transX = useSharedValue(0);
  const savedTransX = useSharedValue(0);
  const transY = useSharedValue(0);
  const savedTransY = useSharedValue(0);

  const db = getFirestore();
  const uid = getAuth().currentUser?.uid;

  // Sync state to shared values when entering edit mode
  useEffect(() => {
    scale.value = withSpring(zoom);
    savedScale.value = zoom;
    if (zoom > 1) {
        const tx = (0.5 - focusX) * 200 * (zoom - 1);
        const ty = (0.5 - focusY) * 200 * (zoom - 1);
        transX.value = withSpring(tx);
        transY.value = withSpring(ty);
        savedTransX.value = tx;
        savedTransY.value = ty;
    } else {
        transX.value = withSpring(0);
        transY.value = withSpring(0);
        savedTransX.value = 0;
        savedTransY.value = 0;
    }
  }, [editMode, url]);

  // Update React state from gestures
  const updateFocusState = (s: number, tx: number, ty: number) => {
    setZoom(s);
    if (s > 1) {
      const size = 200;
      // Reverse calculation: tx = (0.5 - fx) * size * (s - 1)
      // fx = 0.5 - tx / (size * (s - 1))
      const fx = 0.5 - (tx / (size * (s - 1)));
      const fy = 0.5 - (ty / (size * (s - 1)));
      setFocusX(Math.max(0, Math.min(1, fx)));
      setFocusY(Math.max(0, Math.min(1, fy)));
    } else {
      setFocusX(0.5);
      setFocusY(0.5);
    }
  };

  const pan = Gesture.Pan()
    .enabled(editMode)
    .onUpdate((e) => {
      let nextX = savedTransX.value + e.translationX;
      let nextY = savedTransY.value + e.translationY;
      
      // Clamp translation to keep image filling the circle
      // Max translation allowed in one direction = (scaledSize - size) / 2
      // scaledSize = size * scale
      // max = size * (scale - 1) / 2
      const max = Math.max(0, 100 * (scale.value - 1));
      
      transX.value = Math.min(Math.max(nextX, -max), max);
      transY.value = Math.min(Math.max(nextY, -max), max);
    })
    .onEnd(() => {
      savedTransX.value = transX.value;
      savedTransY.value = transY.value;
      runOnJS(updateFocusState)(scale.value, transX.value, transY.value);
    });

  const pinch = Gesture.Pinch()
    .enabled(editMode)
    .onUpdate((e) => {
      let nextScale = savedScale.value * e.scale;
      // Clamp scale between 1 and 3
      scale.value = Math.min(Math.max(nextScale, 1), 3);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Re-clamp translation if we zoomed out
      const max = Math.max(0, 100 * (scale.value - 1));
      if (Math.abs(transX.value) > max) {
         transX.value = withSpring(Math.sign(transX.value) * max);
         savedTransX.value = Math.sign(transX.value) * max;
      }
      if (Math.abs(transY.value) > max) {
         transY.value = withSpring(Math.sign(transY.value) * max);
         savedTransY.value = Math.sign(transY.value) * max;
      }
      runOnJS(updateFocusState)(scale.value, transX.value, transY.value);
    });
    
  const composed = Gesture.Simultaneous(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: transX.value },
      { translateY: transY.value },
      { scale: scale.value },
    ]
  }));

  useEffect(() => {
    if (!uid) return;
    let isMounted = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!isMounted) return;
        
        const u = snap.data() as any;
        if (u?.primaryPhotoPath) setPath(u.primaryPhotoPath);
        if (u?.accountType) setAccountType(u.accountType);
        
        // Load focus settings
        if (typeof u?.avatarFocusX === 'number') setFocusX(u.avatarFocusX);
        if (typeof u?.avatarFocusY === 'number') setFocusY(u.avatarFocusY);
        if (typeof u?.avatarZoom === 'number') setZoom(u.avatarZoom);

        const p = u?.primaryPhotoPath || (u?.photos?.[0]?.path ?? null);
        if (p && !url) {
          const storage = getStorage();
          const dl = await getDownloadURL(ref(storage, p));
          if (isMounted) setUrl(dl);
        }
      } catch {}
    })();
    return () => { isMounted = false; };
  }, [uid]);

  const onPick = async () => {
    try {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        if (!canAskAgain) {
           Alert.alert(
             'Permission requise', 
             'Veuillez activer l\'accès aux photos dans les paramètres pour continuer.',
             [
               { text: 'Annuler', style: 'cancel' },
               { text: 'Ouvrir les paramètres', onPress: () => Linking.openSettings() }
             ]
           );
        } else {
           Alert.alert('Permission requise', 'Nous avons besoin de la permission pour accéder à vos photos.');
        }
        return;
      }

      // 1. Choisir la photo directement (plus rapide)
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8, // Bon compromis qualité/mémoire
        // legacy: true retiré car inutile sur iOS et potentiellement problématique
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];

      // 2. Afficher immédiatement la preview locale
      setUrl(asset.uri);
      setUploading(true);
      setAnalyzing(true);

      // 3. Importer la logique d'upload et traiter
      const { processAndUploadProfilePhoto } = await import('../../lib/uploadImages');
      
      // Note: On active la validation visage ici si c'est la première photo
      const requireFace = !path; 
      const res = await processAndUploadProfilePhoto(asset, requireFace);
      
      // 4. Mettre à jour avec l'URL distante
      setUrl(res.url);
      setPath(res.path);

      if (uid) {
        await setDoc(
          doc(db, 'users', uid),
          {
            photos: [{ path: res.path, url: res.url, createdAt: Date.now() }],
            primaryPhotoPath: res.path,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (e: any) {
      console.error("Upload error:", e);
      Alert.alert('Erreur', e.message ?? "Une erreur est survenue");
      // En cas d'erreur, on remet l'URL à null si c'était juste une preview locale et qu'on n'avait pas d'ancienne photo
      if (!path) setUrl(null);
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  };

  const onContinue = async () => {
    if (!path || !uid) {
      Alert.alert('Ajoute une photo', 'Tu dois ajouter au moins une photo pour continuer.');
      return;
    }
    
    try {
      setUploading(true);
      // Save avatar settings
      await updateDoc(doc(db, 'users', uid), { 
        completed: true, 
        updatedAt: serverTimestamp(),
        avatarFocusX: focusX,
        avatarFocusY: focusY,
        avatarZoom: zoom,
      });
      router.replace('/(tabs)/profile');
    } catch (e: any) {
      Alert.alert('Erreur', "Impossible de sauvegarder le profil.");
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LinearGradient colors={['#0f172a', '#1e293b', '#000000']} style={{ flex: 1 }}>
        <View style={s.container}>
            
            <View style={s.content}>
                <View style={s.stepContainer}>
                  <Text style={s.stepText}>ÉTAPE 5 sur 5</Text>
                </View>
                
                <Text style={s.title}>Ta meilleure photo</Text>
                <Text style={s.subtitle}>
                   {accountType === 'group' 
                     ? "Choisis une photo qui représente bien ton groupe." 
                     : "Une photo claire de toi augmente tes chances de match."}
                </Text>

                <View style={s.photoSection}>
                  {url ? (
                    <GestureDetector gesture={composed}>
                      <View style={[
                        s.photoWrapper, 
                        { borderColor: editMode ? '#F97316' : 'rgba(255,255,255,0.2)' }
                      ]}>
                           <AnimatedImage 
                             source={{ uri: url }} 
                             style={[{ 
                               width: '100%', 
                               height: '100%', 
                               backgroundColor: '#1e293b'
                             }, animatedStyle]} 
                             contentFit="cover"
                             cachePolicy="memory-disk" 
                           />
                           {uploading && (
                             <View style={s.loadingOverlay}>
                               <ActivityIndicator color="#F97316" size="large" />
                             </View>
                           )}
                      </View>
                    </GestureDetector>
                  ) : (
                    <Pressable onPress={onPick} style={[
                      s.photoWrapper, 
                      s.emptyPhotoWrapper
                    ]}>
                        <View style={s.emptyPhotoContent}>
                          {uploading ? (
                             <ActivityIndicator color="#F97316" size="large" />
                          ) : (
                             <>
                               <View style={s.iconContainer}>
                                 <Ionicons name="camera" size={32} color="#F97316" />
                               </View>
                               <Text style={s.addPhotoText}>Ajouter une photo</Text>
                             </>
                          )}
                        </View>
                    </Pressable>
                  )}
                  
                  {url && !uploading && (
                    <View style={s.actionsContainer}>
                       <Pressable onPress={() => setEditMode(!editMode)} style={[s.actionButton, editMode && s.actionButtonActive]}>
                          <Ionicons name="crop" size={18} color={editMode ? "#fff" : "#ccc"} />
                          <Text style={[s.actionText, editMode && { color: '#fff' }]}>{editMode ? 'Terminé' : 'Ajuster'}</Text>
                       </Pressable>
                       <Pressable onPress={onPick} style={s.actionButton}>
                          <Ionicons name="refresh" size={18} color="#ccc" />
                          <Text style={s.actionText}>Changer</Text>
                       </Pressable>
                    </View>
                  )}
                  
                  {editMode && !uploading && (
                    <View style={s.instructionsContainer}>
                       <Text style={s.instructionsText}>
                         Pincez pour zoomer et glissez pour déplacer
                       </Text>
                    </View>
                  )}
                </View>
            </View>

            <View style={s.footer}>
                 <GradientButton label={uploading ? "Envoi..." : "Terminer"} onPress={onContinue} disabled={uploading || !url} />
            </View>

            <Modal visible={analyzing} transparent animationType="fade">
                <View style={s.modalContainer}>
                    <View style={s.modalContent}>
                        <ActivityIndicator size="large" color="#F97316" style={{ marginBottom: 20 }} />
                        <Text style={s.modalTitle}>Analyse en cours</Text>
                        <Text style={s.modalText}>
                            Nous vérifions que votre photo respecte nos règles de communauté...
                        </Text>
                    </View>
                </View>
            </Modal>
        </View>
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingVertical: 60, justifyContent: 'space-between' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  stepContainer: {
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  stepText: { 
    color: '#F97316', 
    fontWeight: '700', 
    fontSize: 12, 
    letterSpacing: 1, 
    textTransform: 'uppercase' 
  },
  
  title: { 
    fontSize: 32, 
    fontWeight: '800', 
    color: '#fff', 
    marginBottom: 12, 
    textAlign: 'center' 
  },
  subtitle: { 
    color: '#94a3b8', 
    fontSize: 16, 
    marginBottom: 40, 
    lineHeight: 24, 
    textAlign: 'center',
    maxWidth: '85%'
  },
  
  photoSection: {
    alignItems: 'center',
    width: '100%',
  },
  
  photoWrapper: { 
      width: 220, 
      height: 220, 
      borderRadius: 110, 
      backgroundColor: '#1e293b', 
      borderWidth: 3, 
      borderStyle: 'solid',
      justifyContent: 'center', 
      alignItems: 'center', 
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.5,
      shadowRadius: 20,
      elevation: 10
  },
  
  emptyPhotoWrapper: {
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  
  emptyPhotoContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%'
  },
  
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16
  },
  
  addPhotoText: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '600'
  },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  
  actionsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 32
  },
  
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  
  actionButtonActive: {
    backgroundColor: '#F97316',
    borderColor: '#F97316'
  },
  
  actionText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '600'
  },
  
  instructionsContainer: {
    marginTop: 20,
    paddingHorizontal: 20
  },
  
  instructionsText: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic'
  },

  footer: { width: '100%', gap: 16 },
  
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  
  modalContent: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center'
  },
  
  modalText: {
    color: '#94a3b8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22
  }
});