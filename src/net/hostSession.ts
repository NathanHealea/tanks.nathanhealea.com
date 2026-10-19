import { FixedClock, type GameSession } from '../game/session';
import { createPvpGame, IDLE_INPUT, step } from '../game/sim';
import type { GameEvent, GameState, PlayerInput } from '../game/types';
import type { Link } from './link';
import { encode, parseGuestMessage } from './protocol';

/** 30 snapshots a second at the 60 Hz tick. */
export const SNAPSHOT_EVERY_TICKS = 2;
/** Caps how many shots or mines can be queued, per message and in total, so a doctored counter cannot fire a burst. */
export const MAX_ACTIONS_PER_MESSAGE = 3;

/**
 * Runs the real simulation on the host's machine: its own input as p1, the guest's latest valid input as p2, and a
 * snapshot to the guest every SNAPSHOT_EVERY_TICKS ticks.
 */
export class HostSession implements GameSession {
  state: GameState;
  ticksLastAdvance = 0;
  readonly localPlayerId = 'p1';
  private clock = new FixedClock();
  private guest: PlayerInput = IDLE_INPUT;
  private lastSeq = -1;
  private firesSeen = 0;
  private minesSeen = 0;
  private pendingFires = 0;
  private pendingMines = 0;
  private sinceSnapshot = 0;
  private events: GameEvent[] = [];
  private broken = new Set<number>();
  private stopListening: () => void;

  constructor(
    private readonly link: Link,
    rows: string[],
    seed: number,
  ) {
    this.state = createPvpGame(rows, seed);
    this.stopListening = link.onMessage((channel, raw) => {
      if (channel === 'state') this.onGuestInput(raw);
    });
  }

  advance(elapsed: number, localInput: PlayerInput): GameEvent[] {
    const events: GameEvent[] = [];
    let local = localInput;
    this.ticksLastAdvance = this.clock.ticks(elapsed);
    for (let i = 0; i < this.ticksLastAdvance; i++) {
      const guest = { ...this.guest, fire: this.pendingFires > 0, mine: this.pendingMines > 0 };
      if (guest.fire) this.pendingFires--;
      if (guest.mine) this.pendingMines--;
      const tickEvents = step(this.state, { p1: local, p2: guest });
      local = { ...local, fire: false, mine: false };
      events.push(...tickEvents);
      this.recordForSnapshot(tickEvents);
    }
    return events;
  }

  dispose(): void {
    this.stopListening();
  }

  private onGuestInput(raw: string): void {
    const message = parseGuestMessage(raw);
    if (!message || message.seq <= this.lastSeq) return;
    this.lastSeq = message.seq;
    this.guest = { move: message.move, aim: message.aim, fire: false, mine: false };
    if (message.fire > this.firesSeen) {
      this.pendingFires = Math.min(MAX_ACTIONS_PER_MESSAGE, this.pendingFires + message.fire - this.firesSeen);
      this.firesSeen = message.fire;
    }
    if (message.mine > this.minesSeen) {
      this.pendingMines = Math.min(MAX_ACTIONS_PER_MESSAGE, this.pendingMines + message.mine - this.minesSeen);
      this.minesSeen = message.mine;
    }
  }

  private recordForSnapshot(tickEvents: GameEvent[]): void {
    this.events.push(...tickEvents);
    for (const e of tickEvents) {
      if (e.type === 'wallBreak') this.broken.add(e.row * this.state.grid.cols + e.col);
    }
    if (++this.sinceSnapshot < SNAPSHOT_EVERY_TICKS) return;
    this.sinceSnapshot = 0;
    const s = this.state;
    this.link.send(
      'state',
      encode({
        t: 'snap',
        tick: s.tick,
        time: s.time,
        tanks: s.tanks,
        bullets: s.bullets,
        mines: s.mines,
        events: this.events,
        broken: [...this.broken],
        outcome: s.outcome,
        winner: s.winner,
      }),
    );
    this.events = [];
  }
}
