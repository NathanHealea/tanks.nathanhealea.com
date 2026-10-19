import { DT } from '../game/config';
import { cellCenter } from '../game/grid';
import { wrapAngle } from '../game/math';
import { FixedClock, type GameSession } from '../game/session';
import { createPvpGame } from '../game/sim';
import { EMPTY, type BulletState, type GameEvent, type GameState, type PlayerInput, type TankState } from '../game/types';
import { SNAPSHOT_EVERY_TICKS } from './hostSession';
import type { Link } from './link';
import { encode, parseHostMessage, type SnapshotMessage } from './protocol';

/** Two snapshot intervals behind the newest, so one late or lost snapshot still leaves a pair to blend between. */
export const INTERPOLATION_DELAY = 2 * SNAPSHOT_EVERY_TICKS * DT;
/** 30 input messages a second, matching the snapshot rate. */
export const INPUT_EVERY_TICKS = 2;
/** Past this much lag the guest jumps forward rather than replaying the backlog slowly. */
const MAX_RENDER_LAG = 0.25;
const KEEP_SNAPSHOTS = 16;

/**
 * The guest's view of a match the host simulates: it sends its own input and draws the host's snapshots a little in
 * the past, blended between the two that straddle the render time.
 */
export class GuestSession implements GameSession {
  state: GameState;
  ticksLastAdvance = 0;
  readonly localPlayerId = 'p2';
  private clock = new FixedClock();
  private snapshots: SnapshotMessage[] = [];
  private seenTicks = new Set<number>();
  private fresh: SnapshotMessage[] = [];
  private renderTime: number | null = null;
  private seq = 0;
  private fires = 0;
  private mines = 0;
  private ticksSinceInput = 0;
  private appliedBroken = new Set<number>();
  private announcedBroken = new Set<number>();
  countdownLeft: number;
  private stopListening: () => void;

  constructor(
    private readonly link: Link,
    rows: string[],
    seed: number,
    private readonly round = 1,
    countdownSeconds = 0,
  ) {
    this.countdownLeft = countdownSeconds;
    this.state = createPvpGame(rows, seed);
    this.stopListening = link.onMessage((channel, raw) => {
      if (channel !== 'state') return;
      const message = parseHostMessage(raw);
      // Round before tick: tick numbers restart each round, so checking the tick first would drop the new round's.
      if (message?.t !== 'snap' || message.round !== this.round || this.seenTicks.has(message.tick)) return;
      this.seenTicks.add(message.tick);
      this.fresh.push(message);
      this.snapshots.push(message);
      this.snapshots.sort((a, b) => a.time - b.time);
      if (this.snapshots.length > KEEP_SNAPSHOTS) this.snapshots.shift();
    });
  }

  advance(elapsed: number, localInput: PlayerInput): GameEvent[] {
    this.sendInput(elapsed, localInput);
    // Counted locally from the round start: the host's countdown snapshots are all identical, so they carry no clock.
    this.countdownLeft = Math.max(0, this.countdownLeft - elapsed);
    const events = this.fresh.flatMap((snapshot) => snapshot.events);
    for (const e of events) if (e.type === 'wallBreak') this.announcedBroken.add(e.row * this.state.grid.cols + e.col);
    const firstSnapshot = this.renderTime === null && this.fresh.length > 0;
    this.fresh = [];
    const newest = this.snapshots[this.snapshots.length - 1];
    if (!newest) return events;

    const target = newest.time - INTERPOLATION_DELAY;
    if (firstSnapshot || this.renderTime === null) this.renderTime = target;
    else this.renderTime = Math.min(this.renderTime + elapsed, target);
    if (this.renderTime < target - MAX_RENDER_LAG) this.renderTime = target;

    this.render(this.renderTime, newest);
    events.push(...this.applyBroken(newest.broken));
    const me = this.state.tanks.find((t) => t.id === this.localPlayerId);
    if (me && localInput.aim !== null) me.turret = localInput.aim;
    return events;
  }

  dispose(): void {
    this.stopListening();
  }

  private sendInput(elapsed: number, input: PlayerInput): void {
    this.ticksLastAdvance = this.clock.ticks(elapsed);
    if (this.ticksLastAdvance === 0) return;
    if (input.fire) this.fires++;
    if (input.mine) this.mines++;
    this.ticksSinceInput += this.ticksLastAdvance;
    if (this.ticksSinceInput < INPUT_EVERY_TICKS) return;
    this.ticksSinceInput = 0;
    this.link.send(
      'state',
      encode({ t: 'input', round: this.round, seq: ++this.seq, move: input.move, aim: input.aim, fire: this.fires, mine: this.mines }),
    );
  }

  private render(time: number, newest: SnapshotMessage): void {
    let a: SnapshotMessage | undefined;
    let b: SnapshotMessage | undefined;
    for (const snapshot of this.snapshots) {
      if (snapshot.time <= time) a = snapshot;
      else if (!b) b = snapshot;
    }
    const from = a ?? b!;
    const to = b ?? a!;
    const f = from === to ? 0 : (time - from.time) / (to.time - from.time);

    for (const tank of this.state.tanks) {
      const ta = from.tanks.find((t) => t.id === tank.id);
      const tb = to.tanks.find((t) => t.id === tank.id);
      if (!ta || !tb) continue;
      Object.assign(tank, tb, {
        pos: { x: lerp(ta.pos.x, tb.pos.x, f), z: lerp(ta.pos.z, tb.pos.z, f) },
        body: lerpAngle(ta.body, tb.body, f),
        turret: lerpAngle(ta.turret, tb.turret, f),
      } satisfies Partial<TankState>);
    }

    const earlier = new Map(from.bullets.map((bullet) => [bullet.id, bullet]));
    this.state.bullets = to.bullets.map((bullet): BulletState => {
      const before = earlier.get(bullet.id);
      if (!before) return bullet;
      return { ...bullet, pos: { x: lerp(before.pos.x, bullet.pos.x, f), z: lerp(before.pos.z, bullet.pos.z, f) } };
    });
    for (const bullet of from.bullets) {
      if (!to.bullets.some((other) => other.id === bullet.id)) this.state.bullets.push(bullet);
    }

    this.state.mines = newest.mines;
    this.state.outcome = newest.outcome;
    this.state.winner = newest.winner;
  }

  /**
   * Clears every newly broken cork cell. A cell whose wallBreak event was lost with a dropped snapshot gets a stand-in
   * event, since the renderer redraws walls only on wallBreak.
   */
  private applyBroken(broken: number[]): GameEvent[] {
    const grid = this.state.grid;
    const standIns: GameEvent[] = [];
    for (const cell of broken) {
      if (cell >= grid.cells.length || this.appliedBroken.has(cell)) continue;
      this.appliedBroken.add(cell);
      grid.cells[cell] = EMPTY;
      if (this.announcedBroken.has(cell)) continue;
      const col = cell % grid.cols;
      const row = Math.floor(cell / grid.cols);
      standIns.push({ type: 'wallBreak', pos: cellCenter(grid, col, row), col, row });
    }
    return standIns;
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lerpAngle(a: number, b: number, f: number): number {
  return wrapAngle(a + wrapAngle(b - a) * f);
}
