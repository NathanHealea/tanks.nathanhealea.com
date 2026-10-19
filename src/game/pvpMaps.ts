import { cellCenter, lineOfSight } from './grid';
import { mulberry32, reachable } from './layout';
import { parseLevel } from './levels';

export const PVP_COLS = 20;
export const PVP_ROWS = 14;

const MIN_WALLS = 0.12;
const MAX_WALLS = 0.3;
const CORK_SHARE = 0.2;

/** Used when rejection sampling runs out of attempts, so a round always has an arena. Generated from seed 20261018. */
export const FALLBACK_ARENA: readonly string[] = [
  '...........####.....',
  '......#..#..........',
  '...#..#..#...#......',
  '.P.o.....#...###....',
  '...#..........####..',
  '.............###....',
  '....#.........##....',
  '....##.........#....',
  '....###.............',
  '..####..........#...',
  '....###...#.....o.2.',
  '......#...#..#..#...',
  '..........#..#......',
  '.....####...........',
];

/**
 * A random arena for one pvp round. Point-symmetric, so neither spawn has the better side; P and 2 are connected,
 * covered, and hidden from each other. Every arena is valid: after `maxAttempts` rejected tries it returns
 * FALLBACK_ARENA.
 */
export function generatePvpMap(seed: number, maxAttempts = 200): string[] {
  const rnd = mulberry32(seed);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rows = tryBuild(rnd);
    if (isFair(rows)) return rows;
  }
  return [...FALLBACK_ARENA];
}

/** Each round of a match gets its own arena, derived from the match seed Convex chose. */
export function roundSeed(matchSeed: number, round: number): number {
  // The hash keeps only 32 bits, so a fractional or larger seed would quietly collapse every match onto the same arenas.
  if (!Number.isInteger(matchSeed) || matchSeed < -(2 ** 31) || matchSeed >= 2 ** 32) {
    throw new Error(`Match seed must be a 32-bit integer, got ${matchSeed}`);
  }
  return Math.floor(mulberry32((matchSeed ^ Math.imul(round + 1, 0x9e3779b9)) | 0)() * 4294967296) | 0;
}

function tryBuild(rnd: () => number): string[] {
  const g: string[][] = Array.from({ length: PVP_ROWS }, () => Array<string>(PVP_COLS).fill('.'));
  const pick = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  // Writing each cell with its 180° twin is what makes the arena symmetric.
  const set = (c: number, r: number, ch: string) => {
    if (g[r][c] !== '.' || g[PVP_ROWS - 1 - r][PVP_COLS - 1 - c] !== '.') return;
    g[r][c] = ch;
    g[PVP_ROWS - 1 - r][PVP_COLS - 1 - c] = ch;
  };

  const pr = pick(1, PVP_ROWS - 2);
  g[pr][1] = 'P';
  g[PVP_ROWS - 1 - pr][PVP_COLS - 2] = '2';
  for (let r = pr - 1; r <= pr + 1; r++) set(3, r, rnd() < 0.3 ? 'o' : '#');

  const segments = pick(6, 10);
  for (let i = 0; i < segments; i++) {
    const horizontal = rnd() < 0.5;
    const len = pick(2, 5);
    const c0 = pick(2, PVP_COLS - 3);
    const r0 = pick(0, PVP_ROWS - 1);
    const mat = rnd() < CORK_SHARE ? 'o' : '#';
    for (let k = 0; k < len; k++) {
      const c = horizontal ? c0 + k : c0;
      const r = horizontal ? r0 : r0 + k;
      if (c < PVP_COLS && r < PVP_ROWS) set(c, r, mat);
    }
  }
  return g.map((line) => line.join(''));
}

function isFair(rows: string[]): boolean {
  const { grid, spawns } = parseLevel(rows);
  const p1 = spawns.find((s) => s.ch === 'P');
  const p2 = spawns.find((s) => s.ch === '2');
  if (!p1 || !p2) return false;
  const walls = rows.join('').split('').filter((ch) => ch === '#' || ch === 'o').length / (PVP_COLS * PVP_ROWS - 2);
  if (walls < MIN_WALLS || walls > MAX_WALLS) return false;
  if (!reachable(grid, p1).has(p2.row * grid.cols + p2.col)) return false;
  if (lineOfSight(grid, cellCenter(grid, p1.col, p1.row), cellCenter(grid, p2.col, p2.row))) return false;
  return hasCover(rows, p1) && hasCover(rows, p2);
}

function hasCover(rows: string[], at: { col: number; row: number }): boolean {
  for (let r = at.row - 2; r <= at.row + 2; r++) {
    for (let c = at.col - 2; c <= at.col + 2; c++) {
      const ch = rows[r]?.[c];
      if (ch === '#' || ch === 'o') return true;
    }
  }
  return false;
}
