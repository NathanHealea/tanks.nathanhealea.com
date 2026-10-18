import { afterEach, describe, expect, it, vi } from 'vitest';

// Same shape convex/lib/ids.ts accepts; the root tsconfig covers only src, so it is inlined.
const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function stubStorage() {
  return {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  };
}

describe('playerId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('playerId is stable within a load', async () => {
    vi.resetModules();
    const { playerId } = await import('./identity');

    const first = playerId();
    const second = playerId();

    expect(first).toMatch(V4_UUID);
    expect(second).toBe(first);
  });

  it('a fresh module gets a fresh id', async () => {
    vi.resetModules();
    const before = (await import('./identity')).playerId();

    vi.resetModules();
    const after = (await import('./identity')).playerId();

    expect(after).toMatch(V4_UUID);
    expect(after).not.toBe(before);
  });

  it('identity touches no storage', async () => {
    const local = stubStorage();
    const session = stubStorage();
    const cookieWrites = vi.fn();
    const document = {};
    Object.defineProperty(document, 'cookie', { get: () => '', set: cookieWrites });
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('document', document);

    vi.resetModules();
    const { playerId } = await import('./identity');
    playerId();
    playerId();

    for (const storage of [local, session]) {
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(storage.clear).not.toHaveBeenCalled();
    }
    expect(cookieWrites).not.toHaveBeenCalled();
  });
});
