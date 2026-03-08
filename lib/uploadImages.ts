import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { getAuth } from 'firebase/auth';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { checkPhotoSafety, NO_FACE_MSG, REJECTION_MSG } from './moderation';

/**
 * Permet de choisir une photo depuis la galerie.
 * Retourne { asset } si succès, sinon null.
 */
export async function pickProfilePhotoOnly(validate: boolean = false) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permission refusée');

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.8,
    selectionLimit: 1,
    exif: false,
  });
  if (res.canceled) return null;

  const asset = res.assets[0];

  // La validation EXIF stricte est supprimée car elle génère trop de faux positifs (photos sauvegardées, captures légitimes, etc.)
  // Nous utilisons checkPhotoSafety (Cloud Vision) pour la modération du contenu (nudité, violence) et la détection de visage si requis.
  
  return asset;
}

/**
 * Traite et upload une photo déjà choisie.
 */
export async function processAndUploadProfilePhoto(asset: ImagePicker.ImagePickerAsset, validate: boolean = false) {
  // On simplifie le traitement pour éviter les crashs mémoire (OOM) sur Android avec les images haute résolution.
  // Au lieu de cropper l'image physiquement ici, on la redimensionne simplement pour le stockage.
  // Le cadrage (focus point / zoom) est géré dynamiquement par l'UI (AddPhotoScreen / Avatar).
  
  let manipulated;
  try {
      // Redimensionnement pour un bon compromis qualité/poids (HD)
      manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1080 } }], 
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
  } catch (e) {
      console.warn("Image manipulation failed, falling back to original", e);
      // Fallback: si la manipulation plante, on tente d'uploader l'original (compressé par le picker si possible)
      manipulated = { uri: asset.uri, width: asset.width, height: asset.height };
  }

  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('Pas connecté');
  try { await getAuth().currentUser?.getIdToken(true); } catch {}

  const storage = getStorage();
  const path = `users/${uid}/photos/${Date.now()}.jpg`;
  const r = ref(storage, path);

  const blob = await (await fetch(manipulated.uri)).blob();
  try {
    await uploadBytes(r, blob, { contentType: 'image/jpeg' });
  } catch (e: any) {
    const code = e?.code || e?.message || '';
    if (String(code).includes('storage/unauthorized')) throw new Error('Autorisation manquante pour envoyer la photo. Vérifie ta connexion.');
    if (String(code).includes('storage/quota-exceeded')) throw new Error('Stockage temporairement indisponible (quota). Réessaie plus tard.');
    if (String(code).includes('storage/canceled')) throw new Error("Envoi annulé");
    throw e;
  }

  const url = await getDownloadURL(r);
  
  // Modération automatique (nudité, violence, etc.) + Détection visage si requis
  try {
    const safety = await checkPhotoSafety(url, validate);
    
    if (safety === 'rejected') {
      await deleteObject(r).catch(() => {});
      throw new Error(REJECTION_MSG);
    }
    
    if (safety === 'rejected_no_face') {
      await deleteObject(r).catch(() => {});
      throw new Error(NO_FACE_MSG);
    }

  } catch (e: any) {
    // Si c'est notre erreur de rejet, on la propage
    if (e.message === REJECTION_MSG || e.message === NO_FACE_MSG) throw e;
    // Sinon (erreur API ou autre), on laisse passer ou on log (fail open vs fail closed)
    console.warn('Moderation check failed, allowing image:', e);
  }

  return { path, url };
}

/**
 * Wrapper pour compatibilité ascendante (ancien code)
 */
export async function pickAndUploadProfilePhoto(validate: boolean = false) {
  const asset = await pickProfilePhotoOnly(validate);
  if (!asset) return null;
  return processAndUploadProfilePhoto(asset, validate);
}

/**
 * Permet de choisir une image pour le chat ou le groupe, la redimensionner (largeur max 1080)
 * puis l’upload dans Firebase Storage sous `chats/{id}/...` ou `groups/{id}/...`.
 * Retourne { path, url, width, height } si succès, sinon null.
 */
export async function pickAndUploadMessageImage(contextId: string, type: 'chat' | 'group' = 'chat', allowVideo: boolean = false) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permission refusée');

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: allowVideo ? ImagePicker.MediaTypeOptions.All : ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,
    selectionLimit: 1,
  });
  if (res.canceled) return null;

  const asset = res.assets[0];
  const isVideo = asset.type === 'video';

  const storage = getStorage();
  const folder = type === 'group' ? 'groups' : 'chats';
  const ext = isVideo ? 'mp4' : 'jpg';
  const path = `${folder}/${contextId}/${Date.now()}.${ext}`;
  const r = ref(storage, path);
  
  let finalUri = asset.uri;
  let width = asset.width;
  let height = asset.height;

  // Redimensionne à une largeur raisonnable tout en conservant le ratio
  if (!isVideo) {
    const manipulated = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 1080 } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
    );
    finalUri = manipulated.uri;
    width = manipulated.width;
    height = manipulated.height;
  }

  const blob = await (await fetch(finalUri)).blob();
  const contentType = isVideo ? 'video/mp4' : 'image/jpeg';
  
  await uploadBytes(r, blob, { contentType, customMetadata: { senderUid: (await import('firebase/auth')).getAuth().currentUser?.uid || '' } });
  const url = await getDownloadURL(r);

  return { path, url, width, height, type: isVideo ? 'video' : 'image' } as const;
}

export const pickAndUploadChatImage = async (chatId: string, allowVideo: boolean = false) => {
  const { getAuth } = await import('firebase/auth');
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  
  // Use matchId (conversation ID) for storage path to ensure write permission and consistency
  const matchId = [uid, chatId].sort().join('_');
  return pickAndUploadMessageImage(matchId, 'chat', allowVideo);
};

export async function pickPhotoForPreview() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permission refusée');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,
    selectionLimit: 1,
  });
  if (res.canceled) return null;
  const asset = res.assets[0];
  return { localUri: asset.uri };
}
