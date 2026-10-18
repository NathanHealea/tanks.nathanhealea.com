import { describe, expect, it } from 'vitest';
import { isPlayerId } from './ids';

describe('isPlayerId', () => {
  it('isPlayerId accepts v4 uuids only', () => {
    for (let i = 0; i < 5; i++) {
      expect(isPlayerId(crypto.randomUUID())).toBe(true);
    }
    expect(isPlayerId('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(false);

    expect(isPlayerId('')).toBe(false);
    expect(isPlayerId('3f2504e0-4f89-41d3-9a0c-0305e82c33011')).toBe(false);
    expect(isPlayerId('3f2504e0-4f89-41d3-9a0c-0305e82c330g')).toBe(false);
    expect(isPlayerId('c232ab00-9414-11ec-b3c8-9f6bdeced846')).toBe(false);
    expect(isPlayerId('3f2504e0-4f89-41d3-ca0c-0305e82c3301')).toBe(false);
    expect(isPlayerId('3f2504e04f8941d39a0c0305e82c3301')).toBe(false);
    expect(isPlayerId(' 3f2504e0-4f89-41d3-9a0c-0305e82c3301 ')).toBe(false);
  });
});
