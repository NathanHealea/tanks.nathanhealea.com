import { describe, expect, it, vi } from 'vitest';
import { buildJoinUrl, formatCode, normalizeCode, readJoinParam } from './share';

const ORIGIN = 'https://tanks.example.test';

function fakeHistory() {
  return { replaceState: vi.fn<(data: unknown, unused: string, url?: string | URL | null) => void>() };
}

describe('share', () => {
  it('normalizeCode and formatCode', () => {
    expect(normalizeCode(' hk7-q2m ')).toBe('HK7Q2M');
    expect(normalizeCode('HK7Q2O')).toBeNull();
    expect(normalizeCode('HK7Q2!')).toBeNull();
    expect(normalizeCode('<script>')).toBeNull();
    expect(formatCode('HK7Q2M')).toBe('HK7-Q2M');
  });

  it('join url round-trips', () => {
    const url = buildJoinUrl('HK7Q2M', ORIGIN);
    expect(url).toBe(`${ORIGIN}/?join=HK7Q2M`);

    const history = fakeHistory();
    expect(readJoinParam({ href: url }, history)).toBe('HK7Q2M');
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    const [data, unused, cleaned] = history.replaceState.mock.calls[0];
    expect(data).toBeNull();
    expect(unused).toBe('');
    expect(cleaned).toBe('/');
    expect(String(cleaned)).not.toContain('join');
  });

  it('join param keeps other params and the hash', () => {
    const history = fakeHistory();
    const code = readJoinParam({ href: `${ORIGIN}/play?mode=duel&join=HK7Q2M&debug=1#lobby` }, history);
    expect(code).toBe('HK7Q2M');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/play?mode=duel&debug=1#lobby');
  });

  it('lowercase join value is normalized', () => {
    const history = fakeHistory();
    expect(readJoinParam({ href: `${ORIGIN}/?join=hk7-q2m` }, history)).toBe('HK7Q2M');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('invalid join param is ignored', () => {
    const history = fakeHistory();
    const href = `${ORIGIN}/?join=${encodeURIComponent('<script>')}`;
    expect(readJoinParam({ href }, history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('no join param returns null and leaves history alone', () => {
    const history = fakeHistory();
    expect(readJoinParam({ href: `${ORIGIN}/?mode=duel#lobby` }, history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
