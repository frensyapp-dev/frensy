import { useMemo } from 'react';
import { auth } from '../firebaseconfig';
import { lastActivationCache, SubscriptionTier } from '../lib/monetization';

export function useSubscription(profileSubscription: SubscriptionTier = 'FREE') {
  const uid = auth.currentUser?.uid;

  const subscription = useMemo(() => {
    if (!uid) return 'FREE';
    const cached = lastActivationCache.get(uid);
    if (cached && Date.now() - cached.time < 45000) {
      return cached.tier;
    }
    return profileSubscription || 'FREE';
  }, [profileSubscription, uid]);

  return subscription;
}
