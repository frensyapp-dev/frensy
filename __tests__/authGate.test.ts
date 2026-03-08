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

test('routes to preferences when genders missing', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', age: 20 } as any)).toBe('/onboarding/preferences')
})

test('routes to add-photo when primary photo missing', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', age: 20, genders: ['f'] } as any)).toBe('/onboarding/add-photo')
})

test('routes to tabs when completed flag present', () => {
  expect(nextRouteForProfile({ uid: 'u', completed: true } as any)).toBe('/(tabs)/home')
})

test('routes to tabs when all fields present', () => {
  expect(nextRouteForProfile({ uid: 'u', accountType: 'student', firstName: 'A', age: 20, genders: ['f'], primaryPhotoPath: 'p' } as any)).toBe('/(tabs)/home')
})

