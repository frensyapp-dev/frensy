import { View, Text, Image, StyleSheet, Dimensions, PanResponder, Animated, Alert, TouchableOpacity } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useToast } from '../components/ui/Toast';

const SCREEN_W = Dimensions.get('window').width;
const FRAME = Math.min(SCREEN_W - 24, 340);

export default function PhotosEditScreen() {
  const C = Colors['dark'];
  const { showToast } = useToast();
  const { photoIndex } = useLocalSearchParams();
  const uid = getAuth().currentUser?.uid;
  const db = getFirestore();
  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [rot, setRot] = useState<number>(0);
  const scale = useRef(new Animated.Value(1)).current;
  const [scaleVal, setScaleVal] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    (async () => {
      if (!uid) return;
      const snap = await getDoc(doc(db, 'users', uid));
      const p = snap.data() as any;
      const primary = p?.primaryPhotoPath;
      const url0 = (p?.photos || []).find((ph: any) => ph.path === primary)?.url || (p?.photos?.[0]?.url ?? null);
      if (url0) setUrl(url0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    const sub = pan.addListener(({ x, y }) => { setOffset({ x, y }); });
    return () => { pan.removeListener(sub); };
  }, [pan]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => { Animated.spring(pan, { toValue: { x: offset.x, y: offset.y }, useNativeDriver: false, bounciness: 0 }).start(); },
  }), [pan, offset]);

  const onZoom = (to: number) => {
    const z = Math.max(1, Math.min(4, to));
    setScaleVal(z);
    Animated.spring(scale, { toValue: z, useNativeDriver: true, bounciness: 0 }).start();
  };

  const onRotate = () => setRot(prev => (prev + 90) % 360);

  const onSave = async () => {
    try {
      if (!url || !uid || !nat) return;
      const fw = FRAME; const fh = FRAME;
      const imgW = rot % 180 === 0 ? nat.w : nat.h;
      const imgH = rot % 180 === 0 ? nat.h : nat.w;
      const viewW = fw * scaleVal; const viewH = fh * scaleVal;
      const offsetX = (viewW - fw) / 2 - offset.x;
      const offsetY = (viewH - fh) / 2 - offset.y;
      const cropW = Math.round(imgW / scaleVal);
      const cropH = Math.round(imgH / scaleVal);
      const originX = Math.max(0, Math.min(imgW - cropW, Math.round((offsetX / viewW) * imgW)));
      const originY = Math.max(0, Math.min(imgH - cropH, Math.round((offsetY / viewH) * imgH)));

      const rotated = rot ? await ImageManipulator.manipulateAsync(url, [{ rotate: rot }], { compress: 1, format: ImageManipulator.SaveFormat.JPEG }) : { uri: url };
      const cropped = await ImageManipulator.manipulateAsync(rotated.uri, [{ crop: { originX, originY, width: cropW, height: cropH } }, { resize: { width: 1080, height: 1080 } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      const storage = (await import('firebase/storage')).getStorage();
      const ref = (await import('firebase/storage')).ref;
      const uploadBytes = (await import('firebase/storage')).uploadBytes;
      const getDownloadURL = (await import('firebase/storage')).getDownloadURL;
      const path = `users/${uid}/photos/${Date.now()}_crop.jpg`;
      const r = ref(storage, path);
      const blob = await (await fetch(cropped.uri)).blob();
      await uploadBytes(r, blob, { contentType: 'image/jpeg' });
      const dl = await getDownloadURL(r);
      await updateDoc(doc(db, 'users', uid), { primaryPhotoPath: path, photos: (await import('firebase/firestore')).arrayUnion({ path, url: dl, createdAt: Date.now() }), updatedAt: serverTimestamp() });
      showToast('Succès', 'Photo recadrée et profil mis à jour', 'success');
    } catch (e: any) {
      showToast('Erreur', e?.message || 'Impossible de recadrer', 'error');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background, padding: 16 }}>
      <Text style={{ color: C.text, fontWeight: '900', fontSize: 18, marginBottom: 12 }}>Recadrer la photo (1:1)</Text>
      <View style={{ width: FRAME, height: FRAME, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
        {url && (
          <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }], width: FRAME, height: FRAME }}>
            <Image source={{ uri: url }} style={{ width: '100%', height: '100%', transform: [{ rotate: `${rot}deg` }] }} onLoad={(e: any) => {
              try { const w = e?.nativeEvent?.source?.width; const h = e?.nativeEvent?.source?.height; if (typeof w === 'number' && typeof h === 'number') setNat({ w, h }); } catch {}
            }} />
          </Animated.View>
        )}
        {!url && (<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.muted }}>Aucune photo</Text></View>)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <TouchableOpacity onPress={() => onZoom(scaleVal - 0.2)} style={s.btn}><Text style={s.btnTxt}>−</Text></TouchableOpacity>
        <Text style={{ color: C.text }}>Zoom {scaleVal.toFixed(1)}×</Text>
        <TouchableOpacity onPress={() => onZoom(scaleVal + 0.2)} style={s.btn}><Text style={s.btnTxt}>+</Text></TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onRotate} style={s.btn}><Text style={s.btnTxt}>⤾</Text></TouchableOpacity>
        <TouchableOpacity onPress={onSave} style={[s.btn, { backgroundColor: C.tint }]}><Text style={{ color: '#fff', fontWeight: '800' }}>Enregistrer</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  btnTxt: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
