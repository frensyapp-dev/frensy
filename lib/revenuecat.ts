import Constants, { ExecutionEnvironment } from 'expo-constants';
import { httpsCallable } from 'firebase/functions';
import { Alert, Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { functions } from '../firebaseconfig';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let configured = false;
let configuredAppUserId: string | null = null;
let lastConfigError: string | null = null;
let missingKeyAlerted = false;

function readExtraValue(key: string): string {
  const extra =
    (Constants.expoConfig as any)?.extra ||
    (Constants as any)?.manifest?.extra ||
    (Constants as any)?.manifest2?.extra ||
    {};
  const v = (extra as any)?.[key];
  return typeof v === 'string' ? v : '';
}

function getApiKeyForPlatform(platform: 'ios' | 'android'): string {
  const fromEnv =
    platform === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_APPLE
      : process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE;
  const fromExtra =
    platform === 'ios' ? readExtraValue('revenuecatAppleApiKey') : readExtraValue('revenuecatGoogleApiKey');
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) return fromExtra.trim();
  return '';
}

export const isRevenueCatConfigured = () => configured;
export const getRevenueCatConfigError = () => lastConfigError;

export const initRevenueCat = async (appUserId?: string): Promise<boolean> => {
  if (isExpoGo) {
    lastConfigError = "RevenueCat n'est pas disponible dans Expo Go. Utilisez un Development Build pour les achats.";
    return false;
  }

  const apiKey = Platform.OS === 'ios' ? getApiKeyForPlatform('ios') : getApiKeyForPlatform('android');
  if (!apiKey || apiKey.includes('REPLACE_WITH')) {
    lastConfigError =
      "RevenueCat n'est pas configuré (clé API manquante). Vérifie EXPO_PUBLIC_REVENUECAT_APPLE / EXPO_PUBLIC_REVENUECAT_GOOGLE dans EAS, puis rebuild.";
    if (!missingKeyAlerted) {
      missingKeyAlerted = true;
      Alert.alert('Achats indisponibles', lastConfigError);
    }
    return false;
  }
  lastConfigError = null;

  if (!configured) {
    Purchases.configure(appUserId ? { apiKey, appUserID: appUserId } : { apiKey });
    configured = true;
    configuredAppUserId = appUserId ?? null;
    return true;
  }

  if (appUserId) {
    if (appUserId !== configuredAppUserId) {
      await Purchases.logIn(appUserId);
      configuredAppUserId = appUserId;
    }
  } else if (configuredAppUserId !== null) {
    // User logged out
    await Purchases.logOut();
    configuredAppUserId = null;
  }

  return true;
};

export const getOfferings = async (): Promise<PurchasesOffering | null> => {
  try {
    if (!configured) {
      lastConfigError = lastConfigError || "RevenueCat n'est pas configuré.";
      return null;
    }
    const offerings = await Purchases.getOfferings();
    if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
      return offerings.current;
    }
    return null; 
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : "Impossible de charger les offres d'achat.";
    lastConfigError = msg;
    return null;
  }
};

export const purchasePackage = async (pack: PurchasesPackage): Promise<{ customerInfo: CustomerInfo; productIdentifier: string } | null> => {
  try {
    if (!configured) {
      const msg = lastConfigError || "RevenueCat n'est pas configuré.";
      Alert.alert('Achats indisponibles', msg);
      return null;
    }
    const { customerInfo, productIdentifier } = await Purchases.purchasePackage(pack);
    await Purchases.syncPurchases().catch(() => {});
    const refreshedCustomerInfo = await Purchases.getCustomerInfo().catch(() => customerInfo);
    return { customerInfo: refreshedCustomerInfo, productIdentifier };
  } catch (e: any) {
    // Error code 6 is ProductAlreadyPurchasedError in RevenueCat
    if (e.code === 6 || e.code === '6' || (e.message && e.message.includes('already purchased'))) {
      try {
        await Purchases.syncPurchases().catch(() => {});
        const customerInfo = await Purchases.getCustomerInfo();
        return { customerInfo, productIdentifier: pack.product.identifier };
      } catch {
        // Fallback to null if even getting info fails
      }
    }
    
    if (!e.userCancelled) {
      Alert.alert('Erreur', e.message);
    }
    return null;
  }
};

export const restorePurchases = async (): Promise<CustomerInfo | null> => {
  try {
    const customerInfo = await Purchases.restorePurchases();
    await Purchases.syncPurchases().catch(() => {});
    return await Purchases.getCustomerInfo().catch(() => customerInfo);
  } catch (e: any) {
    Alert.alert('Erreur', e.message);
    return null;
  }
};

export const syncRevenueCatPurchases = async (options?: { 
  maxAttempts?: number; 
  baseDelayMs?: number;
  waitForTier?: 'PLUS' | 'PRO';
}): Promise<any> => {
  const syncFn = httpsCallable(functions, 'syncRevenueCatPurchases');
  const maxAttempts = Math.max(1, Math.min(10, options?.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 1500);
  const waitForTier = options?.waitForTier;

  let lastResult: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      lastResult = await syncFn();
      const currentTier = lastResult?.data?.subscription?.tier;
      
      // If we are waiting for a specific tier and we got it, or if we aren't waiting for a specific tier
      if (lastResult?.data?.success) {
        if (!waitForTier || currentTier === waitForTier || (waitForTier === 'PLUS' && currentTier === 'PRO')) {
          return lastResult;
        }
      }
    } catch (e) {
      console.warn(`Sync attempt ${attempt + 1} failed:`, e);
    }

    const delay = baseDelayMs * (attempt + 1);
    if (delay > 0 && attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return lastResult;
};

export const checkSubscriptionStatus = async (): Promise<CustomerInfo | null> => {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch {
    return null;
  }
};
