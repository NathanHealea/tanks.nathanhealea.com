import { describe, expect, it } from 'vitest';
import { AI_CHARS, LEVEL_COUNT, enemyCount, getLevel, parseLevel } from './levels';

const levels = Array.from({ length: LEVEL_COUNT }, (_, index) => ({ index, level: index + 1 }));

function countChars(rows: string[], chars: string[]): number {
  return [...rows.join('')].filter((ch) => chars.includes(ch)).length;
}

describe('campaign levels are unchanged', () => {
  it('there are 50 levels', () => {
    expect(LEVEL_COUNT).toBe(50);
  });

  it.each(levels)('level $level', ({ index }) => {
    expect(getLevel(index).join('\n')).toMatchSnapshot();
  });
});

describe('every campaign level is fair', () => {
  it.each(levels)('level $level', ({ index }) => {
    const rows = getLevel(index);
    expect(countChars(rows, ['P'])).toBe(1);
    expect(countChars(rows, ['2'])).toBe(1);
    expect(countChars(rows, Object.keys(AI_CHARS))).toBe(enemyCount(index));
    expect(() => parseLevel(rows)).not.toThrow();
  });
});
