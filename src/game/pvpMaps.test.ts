import { beforeAll, describe, expect, it } from 'vitest';
import { cellCenter, lineOfSight } from './grid';
import { reachable } from './layout';
import { parseLevel } from './levels';
import { FALLBACK_ARENA, PVP_COLS, PVP_ROWS, generatePvpMap, roundSeed } from './pvpMaps';
import { createPvpGame } from './sim';

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);
const LEGAL = new Set(['.', '#', 'o', 'P', '2']);

function findChar(rows: readonly string[], ch: string): { col: number; row: number } | null {
  for (let row = 0; row < rows.length; row++) {
    const col = rows[row].indexOf(ch);
    if (col >= 0) return { col, row };
  }
  return null;
}

function checkShape(rows: readonly string[]): string | null {
  if (rows.length !== PVP_ROWS) return `has ${rows.length} rows, expected ${PVP_ROWS}`;
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].length !== PVP_COLS) return `row ${r} is ${rows[r].length} wide, expected ${PVP_COLS}`;
    for (const ch of rows[r]) if (!LEGAL.has(ch)) return `row ${r} has illegal character '${ch}'`;
  }
  const all = rows.join('');
  const ps = [...all].filter((ch) => ch === 'P').length;
  const twos = [...all].filter((ch) => ch === '2').length;
  if (ps !== 1 || twos !== 1) return `has ${ps} P and ${twos} '2', expected one of each`;
  return null;
}

function checkSymmetry(rows: readonly string[]): string | null {
  const swap: Record<string, string> = { P: '2', '2': 'P' };
  for (let r = 0; r < PVP_ROWS; r++) {
    for (let c = 0; c < PVP_COLS; c++) {
      const here = rows[r][c];
      const mirror = rows[PVP_ROWS - 1 - r][PVP_COLS - 1 - c];
      const expected = swap[here] ?? here;
      if (mirror !== expected) return `cell (${c}, ${r}) is '${here}' but its mirror is '${mirror}'`;
    }
  }
  return null;
}

function checkConnected(rows: readonly string[]): string | null {
  const p = findChar(rows, 'P');
  const two = findChar(rows, '2');
  if (!p || !two) return 'is missing a spawn';
  if (p.col !== 1) return `has P in column ${p.col}, expected 1`;
  if (two.col !== PVP_COLS - 2) return `has 2 in column ${two.col}, expected ${PVP_COLS - 2}`;
  const { grid } = parseLevel([...rows]);
  if (!reachable(grid, p).has(two.row * grid.cols + two.col)) return '2 is not reachable from P';
  return null;
}

function checkHiddenAndCovered(rows: readonly string[]): string | null {
  const p = findChar(rows, 'P');
  const two = findChar(rows, '2');
  if (!p || !two) return 'is missing a spawn';
  const { grid } = parseLevel([...rows]);
  if (lineOfSight(grid, cellCenter(grid, p.col, p.row), cellCenter(grid, two.col, two.row))) {
    return 'spawns can see each other';
  }
  for (const [name, s] of [['P', p], ['2', two]] as const) {
    let covered = false;
    for (let dr = -2; dr <= 2 && !covered; dr++) {
      for (let dc = -2; dc <= 2 && !covered; dc++) {
        const ch = rows[s.row + dr]?.[s.col + dc];
        if (ch === '#' || ch === 'o') covered = true;
      }
    }
    if (!covered) return `spawn ${name} has no cover within 2 cells`;
  }
  return null;
}

function checkDensity(rows: readonly string[]): string | null {
  const walls = [...rows.join('')].filter((ch) => ch === '#' || ch === 'o').length;
  const share = walls / (PVP_COLS * PVP_ROWS - 2);
  if (share < 0.12 || share > 0.3) return `wall share ${share.toFixed(3)} is outside [0.12, 0.30]`;
  return null;
}

function firstFailure(arenas: string[][], check: (rows: readonly string[]) => string | null): string | null {
  for (let i = 0; i < arenas.length; i++) {
    const problem = check(arenas[i]);
    if (problem) return `seed ${SEEDS[i]} ${problem}\n${arenas[i].join('\n')}`;
  }
  return null;
}

describe('pvp arena generator', () => {
  let arenas: string[][];

  beforeAll(() => {
    arenas = SEEDS.map((seed) => generatePvpMap(seed));
  });

  it('arena has the right shape and spawns', () => {
    expect(firstFailure(arenas, checkShape)).toBeNull();
  });

  it('arena is point-symmetric', () => {
    expect(firstFailure(arenas, checkSymmetry)).toBeNull();
  });

  it('spawns are connected', () => {
    expect(firstFailure(arenas, checkConnected)).toBeNull();
  });

  it('spawns are hidden and covered', () => {
    expect(firstFailure(arenas, checkHiddenAndCovered)).toBeNull();
  });

  it('wall density is in range', () => {
    expect(firstFailure(arenas, checkDensity)).toBeNull();
  });

  it('seed is deterministic and varied', () => {
    expect(generatePvpMap(42)).toEqual(generatePvpMap(42));

    const distinct = new Set(Array.from({ length: 100 }, (_, i) => generatePvpMap(i + 1).join('\n')));
    expect(distinct.size).toBe(100);

    const rounds = [1, 2, 3, 4, 5].map((round) => roundSeed(12345, round));
    expect(new Set(rounds).size).toBe(rounds.length);
    for (const s of rounds) expect((s | 0) === s || s >>> 0 === s, `roundSeed ${s} is not a 32-bit integer`).toBe(true);
    expect(roundSeed(12345, 1)).toBe(roundSeed(12345, 1));
    expect(roundSeed(12345, 1)).not.toBe(roundSeed(54321, 1));
  });

  it('fallback arena is valid', () => {
    const fallback = generatePvpMap(7, 0);
    expect(fallback).toEqual([...FALLBACK_ARENA]);
    for (const check of [checkShape, checkSymmetry, checkConnected, checkHiddenAndCovered, checkDensity]) {
      expect(check(fallback)).toBeNull();
    }
  });

  it('generation is fast', () => {
    const start = performance.now();
    for (let seed = 5001; seed <= 5200; seed++) generatePvpMap(seed);
    expect(performance.now() - start).toBeLessThan(4000);
  });

  it('createPvpGame accepts every arena', () => {
    for (let seed = 1; seed <= 100; seed++) {
      expect(() => createPvpGame(generatePvpMap(seed), seed), `seed ${seed}`).not.toThrow();
    }
  });

  it('roundSeed rejects seeds that would lose their randomness', () => {
    for (const bad of [0.37, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 33, -(2 ** 31) - 1]) {
      expect(() => roundSeed(bad, 1), String(bad)).toThrow('32-bit integer');
    }
    expect(() => roundSeed(2 ** 32 - 1, 1)).not.toThrow();
    expect(() => roundSeed(-(2 ** 31), 1)).not.toThrow();
  });
});
