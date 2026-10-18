import { describe, expect, it } from 'vitest';
import { cellAt, cellCenter, lineOfSight } from './grid';
import { AI_CHARS, LEVEL_COUNT, enemyCount, getLevel, levelDifficulty, newTankAt, parseLevel, type Spawn } from './levels';
import { EMPTY, type Grid } from './types';

const levels = Array.from({ length: LEVEL_COUNT }, (_, index) => ({ index, level: index + 1 }));

function countChars(rows: string[], chars: string[]): number {
  return [...rows.join('')].filter((ch) => chars.includes(ch)).length;
}

function drivableFrom(grid: Grid, from: Spawn): Set<string> {
  const seen = new Set([`${from.col},${from.row}`]);
  const queue: [number, number][] = [[from.col, from.row]];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${c + dc},${r + dr}`;
      if (cellAt(grid, c + dc, r + dr) !== EMPTY || seen.has(key)) continue;
      seen.add(key);
      queue.push([c + dc, r + dr]);
    }
  }
  return seen;
}

describe('campaign levels are unchanged', () => {
  it('there are 50 levels', () => {
    expect(LEVEL_COUNT).toBe(50);
  });

  it('asking past the last level throws', () => {
    expect(() => getLevel(LEVEL_COUNT)).toThrow();
    expect(() => getLevel(-1)).toThrow();
  });

  it.each(levels)('level $level', ({ index }) => {
    expect(getLevel(index).join('\n')).toMatchSnapshot();
  });

  it('difficulty and new-tank levels are unchanged', () => {
    expect(levels.map(({ index }) => [levelDifficulty(index).toFixed(9), newTankAt(index)])).toMatchSnapshot();
  });
});

describe('every campaign level is fair', () => {
  it.each(levels)('level $level', ({ index }) => {
    const rows = getLevel(index);
    expect(countChars(rows, ['P'])).toBe(1);
    expect(countChars(rows, ['2'])).toBe(1);
    expect(countChars(rows, Object.keys(AI_CHARS))).toBe(enemyCount(index));

    const { grid, spawns } = parseLevel(rows);
    const players = spawns.filter((s) => s.ch === 'P' || s.ch === '2');
    const enemies = spawns.filter((s) => AI_CHARS[s.ch]);
    const drivable = drivableFrom(grid, players[0]);
    for (const s of spawns) expect(drivable.has(`${s.col},${s.row}`)).toBe(true);
    for (const p of players) {
      for (const e of enemies) {
        expect(lineOfSight(grid, cellCenter(grid, p.col, p.row), cellCenter(grid, e.col, e.row))).toBe(false);
      }
    }
  });
});
