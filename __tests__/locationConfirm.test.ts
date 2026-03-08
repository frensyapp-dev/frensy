import { hasShareConfirmShown, markShareConfirmShown } from '../lib/locationConfirm';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string | null> = {};
  return {
    __esModule: true,
    default: {
      getItem: async (key: string) => (key in store ? store[key] ?? null : null),
      setItem: async (key: string, value: string) => { store[key] = value; },
      removeItem: async (key: string) => { delete store[key]; },
      clear: async () => { Object.keys(store).forEach(k => delete store[k]); },
    },
  };
});

describe('locationConfirm persistence', () => {
  const uid = 'alice';

  it('returns false before marking', async () => {
    const seen = await hasShareConfirmShown(uid);
    expect(seen).toBe(false);
  });

  it('returns true after marking', async () => {
    await markShareConfirmShown(uid);
    const seen = await hasShareConfirmShown(uid);
    expect(seen).toBe(true);
  });
});

