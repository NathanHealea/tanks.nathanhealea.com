import type { GameState, Vec2 } from './types';

// mulberry32, with its state kept in GameState so a replayed or networked game draws the same numbers.
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function forward(angle: number): Vec2 {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}
