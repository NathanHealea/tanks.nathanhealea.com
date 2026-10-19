import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { joinErrorOf, type JoinError } from './joinErrors';

describe('joinErrorOf', () => {
  it.each<JoinError>(['CODE_NOT_FOUND', 'CODE_EXPIRED', 'MATCH_FULL', 'OWN_CODE', 'ALREADY_IN_MATCH'])(
    'maps a ConvexError carrying %s to that code',
    (code) => {
      expect(joinErrorOf(new ConvexError(code))).toBe(code);
    },
  );

  it('maps a ConvexError carrying BUSY to BUSY', () => {
    expect(joinErrorOf(new ConvexError('BUSY'))).toBe('BUSY');
  });

  it('maps an unrelated ConvexError to UNKNOWN', () => {
    expect(joinErrorOf(new ConvexError('Invalid player id'))).toBe('UNKNOWN');
  });

  it('maps a plain Error to UNKNOWN even when its message is a join code', () => {
    expect(joinErrorOf(new Error('CODE_NOT_FOUND'))).toBe('UNKNOWN');
  });

  it('maps non-error values to UNKNOWN', () => {
    expect(joinErrorOf('CODE_NOT_FOUND')).toBe('UNKNOWN');
    expect(joinErrorOf(undefined)).toBe('UNKNOWN');
    expect(joinErrorOf(null)).toBe('UNKNOWN');
    expect(joinErrorOf({ data: 'CODE_NOT_FOUND' })).toBe('UNKNOWN');
  });
});
