import { PVP_COLS, PVP_ROWS } from '../game/pvpMaps';
import type { BulletState, GameEvent, GameState, MineState, TankState } from '../game/types';

/** Guest to host, on `state`. fire and mine are cumulative press counts, so a dropped packet loses no shot. */
export interface InputMessage {
  t: 'input';
  seq: number;
  move: { x: number; z: number };
  aim: number | null;
  fire: number;
  mine: number;
}

/** Host to guest, on `state`. broken lists every cork cell broken this round, so a dropped snapshot cannot desync walls. */
export interface SnapshotMessage {
  t: 'snap';
  tick: number;
  time: number;
  tanks: TankState[];
  bullets: BulletState[];
  mines: MineState[];
  events: GameEvent[];
  broken: number[];
  outcome: GameState['outcome'];
  winner: GameState['winner'];
}

export interface RoundStartMessage {
  t: 'roundStart';
  round: number;
  rows: string[];
  seed: number;
}

export interface RoundEndMessage {
  t: 'roundEnd';
  round: number;
  result: 'p1' | 'p2' | null;
  wins: { p1: number; p2: number };
  winner: 'p1' | 'p2' | null;
}

export type HostMessage = SnapshotMessage | RoundStartMessage | RoundEndMessage;

export function encode(message: InputMessage | HostMessage): string {
  return JSON.stringify(message);
}

/**
 * The guest's input as the host may trust it. Everything from the other browser is untrusted: anything malformed
 * becomes null and never reaches step().
 */
export function parseGuestMessage(raw: string): InputMessage | null {
  const m = parseObject(raw);
  if (!m || m.t !== 'input') return null;
  if (!isCount(m.seq) || !isCount(m.fire) || !isCount(m.mine)) return null;
  const move = m.move;
  if (!isObject(move) || !isFiniteNumber(move.x) || !isFiniteNumber(move.z)) return null;
  if (m.aim !== null && !isFiniteNumber(m.aim)) return null;
  const length = Math.hypot(move.x, move.z);
  const scale = length > 1 ? 1 / length : 1;
  return {
    t: 'input',
    seq: m.seq,
    move: { x: move.x * scale, z: move.z * scale },
    aim: m.aim,
    fire: m.fire,
    mine: m.mine,
  };
}

/** A host message the guest can render without crashing; the layout is bounded before it reaches parseLevel. */
export function parseHostMessage(raw: string): HostMessage | null {
  const m = parseObject(raw);
  if (!m) return null;
  if (m.t === 'roundStart') {
    if (!isPositiveInteger(m.round) || !Number.isInteger(m.seed) || !isLayout(m.rows)) return null;
    return { t: 'roundStart', round: m.round, rows: m.rows, seed: m.seed as number };
  }
  if (m.t === 'roundEnd') {
    const wins = m.wins;
    if (!isPositiveInteger(m.round) || !isResult(m.result) || !isResult(m.winner)) return null;
    if (!isObject(wins) || !isCount(wins.p1) || !isCount(wins.p2)) return null;
    return { t: 'roundEnd', round: m.round, result: m.result, wins: { p1: wins.p1, p2: wins.p2 }, winner: m.winner };
  }
  if (m.t === 'snap') {
    if (!isFiniteNumber(m.tick) || !isFiniteNumber(m.time)) return null;
    if (!Array.isArray(m.tanks) || !m.tanks.every(isTank)) return null;
    if (!Array.isArray(m.bullets) || !m.bullets.every(hasPos)) return null;
    if (!Array.isArray(m.mines) || !m.mines.every(hasPos)) return null;
    if (!Array.isArray(m.events) || !Array.isArray(m.broken) || !m.broken.every(isCount)) return null;
    if (!(m.outcome === null || m.outcome === 'won' || m.outcome === 'lost' || m.outcome === 'draw')) return null;
    if (!isResult(m.winner)) return null;
    return m as unknown as SnapshotMessage;
  }
  return null;
}

type Obj = Record<string, unknown>;

function parseObject(raw: string): Obj | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isResult(value: unknown): value is 'p1' | 'p2' | null {
  return value === null || value === 'p1' || value === 'p2';
}

function isLayout(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === PVP_ROWS &&
    value.every((row) => typeof row === 'string' && row.length === PVP_COLS && /^[.#oP2]+$/.test(row))
  );
}

function hasPos(value: unknown): boolean {
  return isObject(value) && isObject(value.pos) && isFiniteNumber(value.pos.x) && isFiniteNumber(value.pos.z);
}

function isTank(value: unknown): boolean {
  return (
    hasPos(value) &&
    isObject(value) &&
    typeof value.id === 'string' &&
    isFiniteNumber(value.body) &&
    isFiniteNumber(value.turret) &&
    typeof value.alive === 'boolean'
  );
}
