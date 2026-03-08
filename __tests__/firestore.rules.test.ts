import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
let testEnv: RulesTestEnvironment;

const suite = useEmulator ? describe : describe.skip;

suite('Firestore security rules', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'frensy-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });
  test('users: owner can update, non-owner cannot', async () => {
    const owner = testEnv.authenticatedContext('alice').firestore();
    const other = testEnv.authenticatedContext('bob').firestore();
    const ref = doc(owner, 'users/alice');
    await assertSucceeds(setDoc(ref, { firstName: 'Alice', updatedAt: new Date(), photos: [], interests: [], genders: [] }));
    const otherRef = doc(other, 'users/alice');
    await assertFails(setDoc(otherRef, { firstName: 'Bob' }, { merge: true }));
  });

  test('matches: member can read, non-member denied', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const charlie = testEnv.authenticatedContext('charlie').firestore();
    const matchId = ['alice','bob'].sort().join('_');
    const matchRefAlice = doc(alice, `matches/${matchId}`);
    await assertSucceeds(setDoc(matchRefAlice, { users: ['alice','bob'], createdAt: new Date() }));
    await assertSucceeds(getDoc(doc(alice, `matches/${matchId}`)));
    await assertSucceeds(getDoc(doc(bob, `matches/${matchId}`)));
    await assertFails(getDoc(doc(charlie, `matches/${matchId}`)));
  });

  test('messages: create allowed for member with proper fields', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const matchId = ['alice','bob'].sort().join('_');
    await assertSucceeds(setDoc(doc(alice, `matches/${matchId}`), { users: ['alice','bob'], createdAt: new Date() }));
    const msgRef = doc(alice, `matches/${matchId}/messages/m1`);
    await assertSucceeds(setDoc(msgRef, { chatId: matchId, senderId: 'alice', text: 'Hello', createdAt: new Date() }));
    const badSenderRef = doc(bob, `matches/${matchId}/messages/m2`);
    await assertFails(setDoc(badSenderRef, { chatId: matchId, senderId: 'alice', text: 'Hijack', createdAt: new Date() }));
  });

  test('positions: owner writes valid coordinates, invalid lat rejected', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    const okRef = doc(alice, 'positions/alice');
    await assertSucceeds(setDoc(okRef, { uid: 'alice', lat: 48.86, lng: 2.35, updatedAt: new Date(), updatedAtMs: Date.now(), precisionKm: 1, accuracy: 10 }));
    const badRef = doc(alice, 'positions/alice');
    await assertFails(setDoc(badRef, { uid: 'alice', lat: 190, lng: 2.35 }));
  });
});
