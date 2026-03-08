import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment | null = null;

const shouldRun = !!process.env.FIRESTORE_EMULATOR;

beforeAll(async () => {
  if (!shouldRun) return;
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

(shouldRun ? test : test.skip)('create match then send text message allowed', async () => {
  const alice = testEnv.authenticatedContext('alice');
  const bob = testEnv.authenticatedContext('bob');
  const dbA = alice.firestore();
  const chatId = ['alice', 'bob'].sort().join('_');

  // Alice creates match with both users
  await setDoc(doc(dbA, 'matches', chatId), { users: ['alice', 'bob'], createdAt: serverTimestamp(), lastMessageAt: serverTimestamp() }, { merge: true });
  const snap = await getDoc(doc(dbA, 'matches', chatId));
  expect(snap.exists()).toBe(true);

  // Alice sends a text message
  await addDoc(collection(dbA, 'matches', chatId, 'messages'), {
    chatId,
    senderId: 'alice',
    text: 'salut !',
    createdAt: serverTimestamp(),
  });

  // Bob writes status (readAt) in the same match
  const dbB = bob.firestore();
  await setDoc(doc(dbB, 'matches', chatId, 'status', 'bob'), { readAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
});

(shouldRun ? test : test.skip)('update match allowed when request contains both users with author included', async () => {
  const alice = testEnv.authenticatedContext('alice');
  const dbA = alice.firestore();
  const chatId = ['alice', 'bob'].sort().join('_');

  // Bad match missing bob
  await setDoc(doc(dbA, 'matches', chatId), { users: ['alice'], createdAt: serverTimestamp() }, { merge: true });

  // Update to include both users (rule should allow)
  await setDoc(doc(dbA, 'matches', chatId), { users: ['alice', 'bob'], lastMessageAt: serverTimestamp() }, { merge: true });
});
