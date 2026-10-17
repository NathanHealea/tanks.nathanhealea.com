// Everything in GameState is plain JSON so it can be snapshotted and sent over a socket as-is.

export interface Vec2 {
  x: number;
  z: number;
}

export type AiType = 'turret' | 'roamer' | 'hunter' | 'rocket' | 'ace';

export interface AiMemory {
  sweep: number;
  sweepDir: 1 | -1;
  fireDelay: number;
  path: Vec2[];
  retarget: number;
  lastPos: Vec2;
  stuck: number;
}

export interface TankState {
  id: string;
  team: number;
  control: 'local' | 'ai';
  kind: 'player' | AiType;
  ai?: AiMemory;
  color: string;
  pos: Vec2;
  body: number;
  turret: number;
  alive: boolean;
  shots: number;
  mines: number;
  shotReload: number;
  mineReload: number;
  fireCooldown: number;
}

export interface BulletState {
  id: number;
  owner: string;
  pos: Vec2;
  vel: Vec2;
  bounces: number;
  life: number;
}

export interface MineState {
  id: number;
  owner: string;
  team: number;
  pos: Vec2;
  age: number;
}

export const EMPTY = 0;
export const SOLID = 1;
export const CORK = 2;
export type Cell = typeof EMPTY | typeof SOLID | typeof CORK;

export interface Grid {
  cols: number;
  rows: number;
  cells: Cell[];
}

export interface GameState {
  tick: number;
  time: number;
  rng: number;
  nextId: number;
  /** 0 on the first level, 1 on the last; scales enemy skill. */
  difficulty: number;
  grid: Grid;
  tanks: TankState[];
  bullets: BulletState[];
  mines: MineState[];
  outcome: 'won' | 'lost' | null;
  outcomeTime: number;
}

// Angles are radians around +y; 0 faces +z. `aim` is an absolute turret angle so it serializes cleanly.
export interface PlayerInput {
  move: Vec2;
  aim: number | null;
  fire: boolean;
  mine: boolean;
}

export type GameEvent =
  | { type: 'fire'; pos: Vec2; angle: number; owner: string }
  | { type: 'fizzle'; pos: Vec2 }
  | { type: 'bounce'; pos: Vec2 }
  | { type: 'bulletEnd'; pos: Vec2 }
  | { type: 'clash'; pos: Vec2 }
  | { type: 'pop'; pos: Vec2; color: string; tankId: string }
  | { type: 'mineDrop'; pos: Vec2 }
  | { type: 'explode'; pos: Vec2 }
  | { type: 'wallBreak'; pos: Vec2; col: number; row: number };
