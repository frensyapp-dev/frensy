import { createChatRequest } from '../lib/chat/storage';
import * as profileLib from '../lib/profile';

// Mock dependencies
jest.mock('../firebaseconfig', () => ({
  auth: { currentUser: { uid: 'me' } },
  db: {}
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: () => 'timestamp',
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

// Mock getUserProfile
jest.mock('../lib/profile', () => ({
  getUserProfile: jest.fn(),
}));

describe('createChatRequest Security', () => {
  const mockGetUserProfile = profileLib.getUserProfile as jest.Mock;
  const { getDoc } = require('firebase/firestore');

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: chat request doesn't exist
    getDoc.mockResolvedValue({ exists: () => false });
  });

  it('allows Adult to Adult interaction', async () => {
    mockGetUserProfile.mockImplementation((uid) => {
      if (uid === 'me') return Promise.resolve({ age: 25, ageLock: 'adult' });
      return Promise.resolve({ age: 24, ageLock: 'adult' });
    });

    await expect(createChatRequest('other')).resolves.not.toThrow();
  });
});
