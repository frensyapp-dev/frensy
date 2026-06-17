const mockedAuth = { currentUser: null as any };

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('../firebaseconfig', () => ({
  auth: mockedAuth,
}));

jest.mock('../lib/googleSignin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ data: { idToken: 'google-id-token' } })),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
  },
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(async () => ({ identityToken: 'apple-identity-token' })),
  AppleAuthenticationScope: {
    FULL_NAME: 0,
    EMAIL: 1,
  },
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async () => 'hashed-nonce'),
}));

const mockSignInWithCredential = jest.fn();
const mockLinkWithCredential = jest.fn();
const mockFetchSignInMethodsForEmail = jest.fn();

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: {
    credential: (idToken: string) => ({ providerId: 'google.com', idToken }),
  },
  OAuthProvider: class OAuthProvider {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
    credential(params: any) {
      return { providerId: this.id, ...params };
    }
  },
  signInWithCredential: (...args: any[]) => mockSignInWithCredential(...args),
  linkWithCredential: (...args: any[]) => mockLinkWithCredential(...args),
  fetchSignInMethodsForEmail: (...args: any[]) => mockFetchSignInMethodsForEmail(...args),
}));

describe('auth linking', () => {
  beforeEach(() => {
    mockedAuth.currentUser = null;
    mockSignInWithCredential.mockReset();
    mockLinkWithCredential.mockReset();
    mockFetchSignInMethodsForEmail.mockReset();
  });

  it('stores pending credential on provider conflict and links after alternate sign-in', async () => {
    mockFetchSignInMethodsForEmail.mockResolvedValueOnce(['apple.com']);

    mockSignInWithCredential.mockImplementationOnce(async () => {
      const err: any = new Error('account exists');
      err.code = 'auth/account-exists-with-different-credential';
      err.customData = { email: 'user@example.com' };
      throw err;
    });

    mockSignInWithCredential.mockImplementationOnce(async (_auth: any, _credential: any) => {
      mockedAuth.currentUser = { uid: 'uid-1' };
      return { user: mockedAuth.currentUser };
    });

    const { signInWithGoogle, signInWithApple } = require('../lib/auth');

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/link-required' });
    await expect(signInWithApple()).resolves.toBeTruthy();

    expect(mockLinkWithCredential).toHaveBeenCalledTimes(1);
    expect(mockLinkWithCredential.mock.calls[0][0]).toEqual({ uid: 'uid-1' });
    expect(mockLinkWithCredential.mock.calls[0][1]).toMatchObject({ providerId: 'google.com' });
  });
});
