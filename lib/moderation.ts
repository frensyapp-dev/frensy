// lib/moderation.ts

// Basic list of banned words (French & English) - Expand as needed
const BANNED_WORDS = [
  // Sexual / Explicit
  'sexe', 'sex', 'porn', 'porno', 'nude', 'nue', 'nu', 'bite', 'chatte', 'salope', 'pute', 'enculé', 'pd', 'faggot', 'dick', 'cock', 'pussy', 'whore', 'bitch', 'fuck', 'merde', 'putain', 'cul', 'ass', 'tits', 'boobs', 'seins', 'fesse', 'fesses', 'anus', 'vaginal', 'anal', 'oral', 'pipe', 'blowjob', 'handjob', 'branlette', 'baise', 'baiser', 'baiseur', 'baisable', 'fuckable', 'escort', 'massages', 'massage', 'plan cul', 'rencontre sexe', 'sex friend', 'sexfriend', 'fwb', 'sugar daddy', 'sugar baby', 'sodomie', 'sodomy', 'gangbang', 'bukake', 'bukkake', 'ejaculation', 'sperm', 'sperme', 'cyprine', 'gorge profonde', 'deepthroat', 'gode', 'dildo', 'vibrator', 'vibromasseur', 'camgirl', 'onlyfans', 'mym',
  // Hate speech / Offensive / Threats / Harassment
  'nigger', 'negro', 'nègre', 'bougnoule', 'chintok', 'youpin', 'sale juif', 'sale arabe', 'sale noir', 'sale blanc', 'hitler', 'nazi', 'kkk', 
  'suicide', 'kill yourself', 'tue toi', 'mourir', 'mort', 'crève', 'creve',
  'tuer', 'frapper', 'violer', 'défoncer', 'defoncer', 'menace', 'harcèlement', 'harcelement', 'égorger', 'egorger', 'massacrer', 'buter', 'flinguer', 'tabasser', 'casser la gueule',
  'salaud', 'idiot', 'imbécile', 'imbecile', 'stupide', 'débile', 'debile', 'garce', 'nique', 'niquer', 'batard', 'bouffon', 'clochard', 'casse toi', 'dégage', 'degage', 'ta gueule', 'fdp', 'fils de pute', 'abruti', 'mongol', 'triso', 'handicapé', 'gogol',
];

export function containsProfanity(text: string): boolean {
  if (!text) return false;
  // Normalize: lowercase, remove accents
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Replace non-alphanumeric characters (except spaces) with spaces to handle punctuation
  const cleanText = normalized.replace(/[^a-z0-9\s]/g, " ");
  
  // Split into words
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);
  
  return words.some(word => {
    // Check exact match against banned words
    // This avoids false positives like "dispute" (containing "pute") or "assassin" (containing "ass")
    return BANNED_WORDS.includes(word);
  });
}

export function validateName(name: string): { valid: boolean; error?: string } {
  if (!name) return { valid: false, error: 'Le prénom est requis.' };
  
  const trimmed = name.trim();
  
  if (trimmed.length < 2) return { valid: false, error: 'Le prénom est trop court.' };
  if (trimmed.length > 20) return { valid: false, error: 'Le prénom est trop long.' };

  // Regex: Allow letters, accents, hyphens. No numbers, no special symbols.
  const nameRegex = /^[a-zA-ZÀ-ÿ\s-]+$/;
  if (!nameRegex.test(trimmed)) {
    return { valid: false, error: 'Le prénom ne doit contenir que des lettres.' };
  }

  if (containsProfanity(trimmed)) {
    return { valid: false, error: 'Nom inapproprié.' };
  }

  return { valid: true };
}

export function validateMessage(text: string): { valid: boolean; error?: string } {
  if (!text) return { valid: false, error: 'Message vide' };
  if (containsProfanity(text)) {
    return { valid: false, error: 'Votre message contient des termes inappropriés.' };
  }
  return { valid: true };
}

const GOOGLE_VISION_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_VISION_API_KEY || '';

/**
 * Simule ou effectue une modération d'image.
 * Dans un vrai projet, appelez ici une API comme Google Cloud Vision, AWS Rekognition ou Sightengine.
 * @param imageUri URI de l'image locale ou URL distante
 */
export const REJECTION_MSG = "Cette photo ne respecte pas nos règles de communauté (nudité, violence ou contenu explicite).";
export const NO_FACE_MSG = "Cette photo ne semble pas contenir de visage humain visible. Une photo de profil doit montrer votre visage.";

export async function checkPhotoSafety(imageUri: string, requireFace: boolean = false): Promise<'approved' | 'rejected' | 'rejected_no_face' | 'pending'> {
  try {
    const features: any[] = [
      { type: "SAFE_SEARCH_DETECTION" }
    ];

    if (requireFace) {
      features.push({ type: "FACE_DETECTION" });
    }

    // Construction du body pour Google Cloud Vision API
    const body = {
      requests: [
        {
          image: {
            source: {
              imageUri: imageUri
            }
          },
          features: features
        }
      ]
    };

    // Timeout de 5 secondes pour ne pas bloquer l'utilisateur
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal as any // Cast pour éviter les erreurs de type TS
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
        console.warn('Moderation API error:', response.status);
        return 'approved';
    }

    const result = await response.json();
    
    // Vérification de la réponse
    const res0 = result.responses?.[0];
    const annotations = res0?.safeSearchAnnotation;
    
    if (!annotations) {
      console.warn('Moderation: Pas d\'annotation reçue', result);
      // Par sécurité, si l'API échoue ou ne comprend pas l'image, on peut approuver ou mettre en attente.
      // Ici on approuve pour ne pas bloquer l'utilisateur en cas d'erreur technique simple.
      return 'approved';
    }

    // Niveaux de risque renvoyés par l'API : "UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"
    const isUnsafe = (likelihood: string) => {
      return likelihood === 'LIKELY' || likelihood === 'VERY_LIKELY';
    };

    // On rejette si Adulte ou Violence ou Racy (suggestif) est PROBABLE ou TRÈS PROBABLE
    if (
      isUnsafe(annotations.adult) ||
      isUnsafe(annotations.violence) ||
      isUnsafe(annotations.racy)
    ) {
      return 'rejected';
    }

    // Vérification visage si requis
    if (requireFace) {
      const faces = res0?.faceAnnotations;
      // On considère qu'il faut au moins un visage avec une certaine confiance
      const hasFace = faces && faces.length > 0 && faces.some((f: any) => (f.detectionConfidence ?? 0) > 0.5);
      
      if (!hasFace) {
        return 'rejected_no_face'; // Nouveau statut
      }
    }

    return 'approved';

  } catch (error) {
    console.error('Erreur lors de la modération d\'image:', error);
    // En cas d'erreur réseau ou autre, on laisse passer (fail open) ou on bloque (fail closed).
    // Pour l'UX, on laisse souvent passer ou on met en 'pending'.
    return 'approved'; 
  }
}
