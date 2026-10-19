import { cellCenter, lineOfSight } from './grid';
import { mulberry32, reachable } from './layout';
import { ROSTER } from './tanks';
import { CORK, EMPTY, SOLID, type AiType, type Cell, type Grid } from './types';

// Legend: '.' floor, '#' block, 'o' cork (mines break it), 'P' player 1, '2' player 2, then one letter per enemy type.
export const AI_CHARS: Record<string, AiType> = { t: 'turret', r: 'roamer', h: 'hunter', k: 'rocket', a: 'ace' };
const CHAR_OF = Object.fromEntries(Object.entries(AI_CHARS).map(([ch, kind]) => [kind, ch])) as Record<AiType, string>;

export const LEVEL_COUNT = 50;
export const LEVELS_PER_TIER = 10;
const COLS = 20;
const ROWS = 14;

/** Enemy skill from 0 to 1: 1 − (10 − x)² / 100, where x = level / 5 (level counted from 1). */
export function levelDifficulty(index: number): number {
  const x = ((index + 1) * 10) / LEVEL_COUNT;
  return 1 - (10 - x) ** 2 / 100;
}

/** The enemy type that first appears on this level, if any. */
export function newTankAt(index: number): AiType | null {
  return index % LEVELS_PER_TIER === 0 ? (ROSTER[index / LEVELS_PER_TIER] ?? null) : null;
}

export function enemyCount(index: number): number {
  return Math.min(8, 1 + Math.floor((index + 1) / 7));
}

export interface Spawn {
  ch: string;
  col: number;
  row: number;
}

export function parseLevel(rows: string[]): { grid: Grid; spawns: Spawn[] } {
  const cols = rows[0].length;
  const cells: Cell[] = [];
  const spawns: Spawn[] = [];
  rows.forEach((line, row) => {
    if (line.length !== cols) throw new Error(`Level row ${row} is ${line.length} wide, expected ${cols}`);
    for (let col = 0; col < cols; col++) {
      const ch = line[col];
      cells.push(ch === '#' ? SOLID : ch === 'o' ? CORK : EMPTY);
      if (ch === 'P' || ch === '2' || AI_CHARS[ch]) spawns.push({ ch, col, row });
    }
  });
  return { grid: { cols, rows: rows.length, cells }, spawns };
}

/** Every enemy must be reachable by driving, and none may see a player spawn at the start. */
function isFair(rows: string[]): boolean {
  const { grid, spawns } = parseLevel(rows);
  const players = spawns.filter((s) => s.ch === 'P' || s.ch === '2');
  const enemies = spawns.filter((s) => AI_CHARS[s.ch]);
  const reach = reachable(grid, players[0]);
  for (const s of [...players, ...enemies]) if (!reach.has(s.row * grid.cols + s.col)) return false;
  for (const p of players) {
    for (const e of enemies) {
      if (lineOfSight(grid, cellCenter(grid, p.col, p.row), cellCenter(grid, e.col, e.row))) return false;
    }
  }
  return true;
}

function tryBuild(index: number, rnd: () => number): string[] | null {
  const g: string[][] = Array.from({ length: ROWS }, () => Array<string>(COLS).fill('.'));
  const tier = Math.floor(index / LEVELS_PER_TIER);
  const pick = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const pr = pick(2, ROWS - 3);
  const p2r = pr < ROWS / 2 ? pr + 1 : pr - 1;
  g[pr][1] = 'P';
  g[p2r][1] = '2';
  // A short wall in front of the spawn so nobody starts in the open.
  for (let r = Math.min(pr, p2r) - 1; r <= Math.max(pr, p2r) + 1; r++) g[r][3] = rnd() < 0.3 ? 'o' : '#';

  const segments = pick(5, 8) + tier;
  for (let i = 0; i < segments; i++) {
    const horizontal = rnd() < 0.5;
    const len = pick(2, 5);
    const c0 = pick(5, COLS - 2);
    const r0 = pick(0, ROWS - 1);
    const mat = rnd() < 0.2 + tier * 0.05 ? 'o' : '#';
    for (let k = 0; k < len; k++) {
      const c = horizontal ? c0 + k : c0;
      const r = horizontal ? r0 : r0 + k;
      if (c < COLS && r < ROWS && g[r][c] === '.') g[r][c] = mat;
    }
  }

  const roster = ROSTER.slice(0, tier + 1);
  const kinds: AiType[] = [ROSTER[Math.min(tier, ROSTER.length - 1)]];
  while (kinds.length < enemyCount(index)) kinds.push(roster[Math.floor(rnd() * roster.length)]);
  const placed: [number, number][] = [];
  for (const kind of kinds) {
    let ok = false;
    for (let attempt = 0; attempt < 60 && !ok; attempt++) {
      const c = pick(9, COLS - 2);
      const r = pick(1, ROWS - 2);
      if (g[r][c] !== '.' || placed.some(([pc, prow]) => Math.abs(pc - c) + Math.abs(prow - r) < 3)) continue;
      g[r][c] = CHAR_OF[kind];
      placed.push([c, r]);
      ok = true;
    }
    if (!ok) return null;
  }

  const rows = g.map((line) => line.join(''));
  return isFair(rows) ? rows : null;
}

const cache = new Map<number, string[]>();

/** Levels come from a fixed seed per index, so every player (and every networked peer) gets the same maps. */
export function getLevel(index: number): string[] {
  if (index < 0 || index >= LEVEL_COUNT) throw new Error(`No level ${index}`);
  const hit = cache.get(index);
  if (hit) return hit;
  const rnd = mulberry32(0x7a4b5 + index * 7919);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const rows = tryBuild(index, rnd);
    if (rows) {
      cache.set(index, rows);
      return rows;
    }
  }
  throw new Error(`Could not generate a fair layout for level ${index + 1}`);
}
