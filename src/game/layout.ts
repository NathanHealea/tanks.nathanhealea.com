import { cellAt } from './grid';
import { EMPTY, type Grid } from './types';

// Shared by the campaign and pvp generators; changing either changes every seeded layout.
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cell indexes (row * cols + col) reachable by driving from `from` through empty cells. */
export function reachable(grid: Grid, from: { col: number; row: number }): Set<number> {
  const seen = new Set([from.row * grid.cols + from.col]);
  const queue = [...seen];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] % grid.cols;
    const r = Math.floor(queue[head] / grid.cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const idx = (r + dr) * grid.cols + c + dc;
      if (cellAt(grid, c + dc, r + dr) !== EMPTY || seen.has(idx)) continue;
      seen.add(idx);
      queue.push(idx);
    }
  }
  return seen;
}
