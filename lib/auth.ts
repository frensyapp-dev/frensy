import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { AuthCredential } from 'firebase/auth';
import {
    fetchSignInMethodsForEmail,
    GoogleAuthProvider,
    linkWithCredential,
    OAuthProvider,
    signInWithCredential,
    updateProfile,
    UserCredential
} from 'firebase/auth';
import { Platform } from 'react-native';
import { auth } from '../firebaseconfig';
import { GoogleSignin, statusCodes } from './googleSignin';
import { getUserProfile, savePartialProfile } from './profile';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

let pendingLinkCredential: AuthCredential | null = null;

async function tryLinkPendingCredential(): Promise<void> {
  const user = auth.currentUser;
  if (!user || !pendingLinkCredential) return;

  try {
    await linkWithCredential(user, pendingLinkCredential);
  } catch (e: any) {
    const code = typeof e?.code === 'string' ? e.code : '';
    if (code === 'auth/provider-already-linked' || code === 'auth/credential-already-in-use') {
    } else {
      console.warn('Link credential failed', e);
    }
  } finally {
    pendingLinkCredential = null;
  }
}

function buildLinkRequiredError(params: {
  original: any;
  fromProviderLabel: 'Google' | 'Apple';
  methods: string[];
}): Error & { code?: string } {
  const { fromProviderLabel, methods, original } = params;

  const suggestedProvider =
    methods.includes('apple.com') ? 'Apple' :
    methods.includes('google.com') ? 'Google' :
    null;

  const msgParts: string[] = [];
  msgParts.push('Ce compte existe déjà avec un autre mode de connexion.');
  if (suggestedProvider) {
    msgParts.push(`Connecte-toi avec ${suggestedProvider} pour associer ${fromProviderLabel}.`);
  } else {
    msgParts.push(`Connecte-toi avec le bon fournisseur pour associer ${fromProviderLabel}.`);
  }

  const err: any = new Error(msgParts.join(' '));
  err.code = 'auth/link-required';
  err.original = original;
  return err;
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle(): Promise<UserCredential | null> {
  let googleCredential: AuthCredential | null = null;
  try {
    const configOptions: any = {
      scopes: ['profile', 'email'],
      iosClientId: '591347173909-9v9tif71p1j4f594mevtjd7msdivfc22.apps.googleusercontent.com',
      offlineAccess: true,
    };
    if (googleWebClientId) {
      configOptions.webClientId = googleWebClientId;
    }
    GoogleSignin.configure(configOptions);

    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    
    const signInResult = await GoogleSignin.signIn();
    let idToken = signInResult.data?.idToken;
    
    if (!idToken && (signInResult as any).idToken) {
       idToken = (signInResult as any).idToken;
    }

    if (!idToken) {
      throw new Error(
        "Impossible de récupérer le token Google. Vérifiez la configuration (webClientId) et testez via un Development Build."
      );
    }

    googleCredential = GoogleAuthProvider.credential(idToken);
    const res = await signInWithCredential(auth, googleCredential);
    try {
      const uid = res.user.uid;
      const prof = await getUserProfile(uid).catch(() => null);
      const displayName = res.user.displayName || '';
      const firstNameFromDisplay =
        displayName.trim().length > 0 ? displayName.trim().split(/\s+/)[0] : '';
      if (!prof?.firstName && firstNameFromDisplay) {
        await savePartialProfile(uid, { firstName: firstNameFromDisplay });
      }
    } catch {}
    await tryLinkPendingCredential();
    return res;
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      console.log('Google Sign-In cancelled');
      return null;
    } else if (error.code === statusCodes.IN_PROGRESS) {
      console.log('Google Sign-In in progress');
      return null;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      const email = (error?.customData?.email as string | undefined) ?? null;
      pendingLinkCredential = googleCredential;
      const methods = email ? await fetchSignInMethodsForEmail(auth, email).catch(() => []) : [];
      throw buildLinkRequiredError({ original: error, fromProviderLabel: 'Google', methods });
    } else {
      console.error('Google Sign-In Error:', error);
      throw error;
    }
  }
}

/**
 * Sign in with Apple
 */
export async function signInWithApple(): Promise<UserCredential | null> {
  let appleFirebaseCredential: AuthCredential | null = null;
  try {
    if (Platform.OS !== 'ios') return null;
    const available = await AppleAuthentication.isAvailableAsync().catch(() => false);
    if (!available) return null;

    const csrf = Math.random().toString(36).substring(2, 15);
    const nonce = Math.random().toString(36).substring(2, 10);
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      nonce
    );

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      state: csrf,
      nonce: hashedNonce,
    });

    const { identityToken } = appleCredential;

    if (!identityToken) {
      throw new Error('No identity token provided by Apple');
    }

    const provider = new OAuthProvider('apple.com');
    appleFirebaseCredential = provider.credential({
      idToken: identityToken,
      rawNonce: nonce,
    });

    const res = await signInWithCredential(auth, appleFirebaseCredential);
    try {
      const uid = res.user.uid;
      const prof = await getUserProfile(uid).catch(() => null);

      const givenName =
        (appleCredential.fullName?.givenName ?? '').trim() ||
        (res.user.displayName ?? '').trim().split(/\s+/)[0] ||
        '';

      if (givenName && !res.user.displayName) {
        await updateProfile(res.user, { displayName: givenName });
      }

      if (!prof?.firstName && givenName) {
        await savePartialProfile(uid, { firstName: givenName });
      }
    } catch {}
    await tryLinkPendingCredential();
    return res;
  } catch (error: any) {
    if (error.code === 'ERR_REQUEST_CANCELED') {
        console.log("Apple Sign-In cancelled");
        return null;
    }
    if (error.code === 'auth/account-exists-with-different-credential') {
      const email = (error?.customData?.email as string | undefined) ?? null;
      pendingLinkCredential = appleFirebaseCredential;
      const methods = email ? await fetchSignInMethodsForEmail(auth, email).catch(() => []) : [];
      throw buildLinkRequiredError({ original: error, fromProviderLabel: 'Apple', methods });
    }
    console.error('Apple Sign-In Error:', error);
    throw error;
  }
}
