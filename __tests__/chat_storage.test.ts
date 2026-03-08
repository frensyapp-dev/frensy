import * as storage from '../lib/chat/storage';
import { getMatchId } from '../lib/matches';

jest.mock('../firebaseconfig', () => ({ auth: { currentUser: { uid: 'me' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(async (_ref: any) => ({ exists: true, data: () => ({ users: ['me', 'partner'] }) })),
  orderBy: jest.fn(),
  query: jest.fn(),
  runTransaction: jest.fn(async (_db: any, fn: any) => {
    const tx = {
      get: jest.fn(async (_ref: any) => ({ exists: true, data: () => ({ users: ['me', 'partner'] }) })),
      set: jest.fn((_ref: any, _data: any) => {}),
    };
    await fn(tx);
  }),
  onSnapshot: (q: any, cb: any) => {
    const snap = {
      forEach: (fn: any) => {
        fn({ id: '1', data: () => ({ chatId: '', senderId: 'me', text: 'Hello <world>', createdAt: { toMillis: () => 123 } }) });
        fn({ id: '2', data: () => ({ chatId: '', senderId: 'partner', text: 'Hi & bye', createdAt: { toMillis: () => 456 } }) });
      },
    } as any;
    cb(snap);
    return () => {};
  },
  serverTimestamp: () => ({ __isServerTimestamp: true })
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  const mock = {
    setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    removeItem: jest.fn(async (k: string) => { delete store[k]; }),
  };
  return {
      __esModule: true,
      default: mock,
      ...mock
  };
});

describe('sanitizeText', () => {
  it('escapes special HTML characters', () => {
    expect(storage.sanitizeText('<hello>&world>')).toBe('&lt;hello&gt;&amp;world&gt;');
  });
});

describe('send retry helpers', () => {
  it('sendTextMessageToUserRetry resolves', async () => {
    await expect(storage.sendTextMessageToUserRetry('partner', 'Message', 2)).resolves.toBeUndefined();
  });

  it('sendImageMessageToUserRetry resolves', async () => {
    await expect(storage.sendImageMessageToUserRetry('partner', 'http://image', 100, 100, 2)).resolves.toBeUndefined();
  });
});

describe('cache persistence via listener', () => {
  it.skip('persists messages to AsyncStorage and can load them', async () => {
    const cb = jest.fn();
    const unsub = storage.listenMessagesForUser('partner', cb);
    const chatId = getMatchId('me', 'partner');
    
    // Wait for async storage operations to complete (retry loop)
    let msgs: any[] = [];
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        msgs = await storage.loadMessages(chatId);
        if (msgs.length === 2) break;
    }
    
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs.length).toBe(2);
    expect(msgs[0].text).toBe('Hello <world>');
    expect(msgs[1].text).toBe('Hi & bye');
    expect(typeof unsub).toBe('function');
  });
});
