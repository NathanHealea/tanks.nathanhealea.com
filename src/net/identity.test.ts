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
    const urlWrites = vi.fn();
    const location = {};
    for (const part of ['href', 'hash', 'search', 'pathname']) {
      Object.defineProperty(location, part, { get: () => '', set: urlWrites });
    }
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    const indexedDB = { open: vi.fn(), deleteDatabase: vi.fn() };
    vi.stubGlobal('location', location);
    vi.stubGlobal('history', history);
    vi.stubGlobal('indexedDB', indexedDB);

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
    expect(urlWrites).not.toHaveBeenCalled();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(indexedDB.open).not.toHaveBeenCalled();
  });
});

describe('playerId outside a secure context', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('works where crypto.randomUUID does not exist', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    vi.resetModules();
    const { playerId } = await import('./identity');

    expect(playerId()).toMatch(V4_UUID);
  });

  it('many ids are all valid and distinct', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      vi.resetModules();
      const { playerId } = await import('./identity');
      expect(playerId()).toMatch(V4_UUID);
      ids.add(playerId());
    }
    expect(ids.size).toBe(200);
  });
});
