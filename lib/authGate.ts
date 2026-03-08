import type { UserProfile } from './profile'

export function nextRouteForProfile(p?: UserProfile | null): string {
  if (!p) return '/onboarding/welcome'
  if (p.completed) return '/(tabs)/home'
  if (!p.accountType) return '/onboarding/account-type'
  if (!p.firstName || p.firstName.trim().length === 0) return '/onboarding/name'
  if (typeof p.age !== 'number') return '/onboarding/age'
  if (!p.genders || p.genders.length === 0) return '/onboarding/preferences'
  if (!p.primaryPhotoPath) return '/onboarding/add-photo'
  return '/(tabs)/home'
}

