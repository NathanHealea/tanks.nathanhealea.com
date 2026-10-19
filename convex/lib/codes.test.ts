import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, normalizeCode } from './codes';

describe('codes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the alphabet has no look-alike characters', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(CODE_LENGTH).toBe(6);
  });

  it.each([
    ['lowest', () => 0],
    ['highest', () => 0.999_999],
    ['Math.random', () => Math.random()],
  ])('generateCode with the %s random value uses only alphabet characters', (_label, random) => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode(random);
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('normalizeCode uppercases and strips spaces and dashes', () => {
    expect(normalizeCode(' hk7-q2m ')).toBe('HK7Q2M');
    expect(normalizeCode('hk7 q2m')).toBe('HK7Q2M');
    expect(normalizeCode('HK7Q2M')).toBe('HK7Q2M');
  });

  it.each(['HK7Q20', 'HK7Q2O', 'HK7Q21', 'HK7Q2I', 'HK7Q2L', 'hk7q2l'])('normalizeCode rejects look-alike characters in %s', (input) => {
    expect(normalizeCode(input)).toBeNull();
  });

  it.each(['', '   ', '---', 'HK7Q2', 'HK7Q2MA', '<script>', 'HK7_Q2M'])('normalizeCode rejects %j', (input) => {
    expect(normalizeCode(input)).toBeNull();
  });

  it('formatCode splits the code in half with a dash', () => {
    expect(formatCode('HK7Q2M')).toBe('HK7-Q2M');
  });
});
