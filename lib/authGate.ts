import type { UserProfile } from './profile'

export function nextRouteForProfile(p?: UserProfile | null): string {
  if (!p) return '/onboarding/welcome'
  if (!p.accountType) return '/onboarding/account-type'
  if (!p.firstName || p.firstName.trim().length === 0) return '/onboarding/name'
  if (p.ageLock !== 'adult' || typeof p.age !== 'number' || p.age < 18) return '/onboarding/age'
  if (!p.interests || p.interests.length === 0) return '/onboarding/preferences'
  if (!p.primaryPhotoPath) return '/onboarding/add-photo'
  if (p.ghostMode === undefined) return '/onboarding/ghost-setup'
  return '/(tabs)/home'
}
