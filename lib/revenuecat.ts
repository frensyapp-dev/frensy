import { Alert, Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

const API_KEYS = {
  apple: process.env.EXPO_PUBLIC_REVENUECAT_APPLE || 'appl_REPLACE_WITH_YOUR_KEY',
  google: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE || 'goog_REPLACE_WITH_YOUR_KEY',
};

export const initRevenueCat = async () => {
  if (Platform.OS === 'ios') {
    if (!API_KEYS.apple || API_KEYS.apple.includes('REPLACE_WITH')) {
      return;
    }
    Purchases.configure({ apiKey: API_KEYS.apple });
  } else if (Platform.OS === 'android') {
    if (!API_KEYS.google || API_KEYS.google.includes('REPLACE_WITH')) {
      return;
    }
    Purchases.configure({ apiKey: API_KEYS.google });
  }
};

export const getOfferings = async (): Promise<PurchasesOffering | null> => {
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
      return offerings.current;
    }
    return null; 
  } catch {
    return null;
  }
};

export const purchasePackage = async (pack: PurchasesPackage): Promise<{ customerInfo: CustomerInfo; productIdentifier: string } | null> => {
  try {
    const { customerInfo, productIdentifier } = await Purchases.purchasePackage(pack);
    return { customerInfo, productIdentifier };
  } catch (e: any) {
    if (!e.userCancelled) {
      Alert.alert('Erreur', e.message);
    }
    return null;
  }
};

export const restorePurchases = async (): Promise<CustomerInfo | null> => {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return customerInfo;
  } catch (e: any) {
    Alert.alert('Erreur', e.message);
    return null;
  }
};

export const checkSubscriptionStatus = async (): Promise<CustomerInfo | null> => {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch {
    return null;
  }
};
