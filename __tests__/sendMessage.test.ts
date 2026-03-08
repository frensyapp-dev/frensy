import { sendImageMessageToUserRetry, sendTextMessageToUserRetry } from '../lib/chat/storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    removeItem: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

jest.mock('../firebaseconfig', () => ({ auth: { currentUser: { uid: 'me' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn(),
  doc: jest.fn(),
  serverTimestamp: () => ({ __isServerTimestamp: true })
}));

// Simule un envoi réussi
describe('sendMessage', () => {
  it('envoie un message texte sans lever d’erreur', async () => {
    await expect(sendTextMessageToUserRetry('testPartner', 'salut bastien')).resolves.toBeUndefined();
  });

  it('envoie une image sans lever d’erreur', async () => {
    await expect(sendImageMessageToUserRetry('testPartner', 'https://example.com/img.jpg', 100, 100)).resolves.toBeUndefined();
  });
});
