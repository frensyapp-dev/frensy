import { nextRouteForProfile } from '../lib/authGate'

test('routes to welcome when no profile', () => {
  expect(nextRouteForProfile(null)).toBe('/onboarding/welcome')
})

test('routes to name when firstName missing', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student' } as any)).toBe('/onboarding/name')
})

test('routes to age when missing', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A' } as any)).toBe('/onboarding/age')
})

test('routes to age when age value is missing even if adult lock exists', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', ageLock: 'adult' } as any)).toBe('/onboarding/age')
})

test('routes to preferences when interests missing', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', age: 24, ageLock: 'adult' } as any)).toBe('/onboarding/preferences')
})

test('routes to add-photo when primary photo missing', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', age: 24, ageLock: 'adult', interests: ['music'] } as any)).toBe('/onboarding/add-photo')
})

test('completed flag does not bypass missing required fields', () => {
  expect(nextRouteForProfile({ uid: 'u', completed: true } as any)).toBe('/onboarding/account-type')
})

test('routes to tabs when all fields present', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', age: 24, ageLock: 'adult', interests: ['music'], primaryPhotoPath: 'p' } as any)).toBe('/(tabs)/home')
})
