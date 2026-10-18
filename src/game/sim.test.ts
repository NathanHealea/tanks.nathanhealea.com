import { describe, expect, it } from 'vitest';
import { BULLET, DT, MINE } from './config';
import { worldToCell } from './grid';
import { IDLE_INPUT, createGame, step } from './sim';
import { CORK, EMPTY, type GameEvent, type GameState, type PlayerInput, type TankState } from './types';

// Drives a square, sweeps the turret, fires every 90 ticks and drops one mine, so physics, bullets and mines all run.
function scriptedInput(tick: number): PlayerInput {
  const leg = Math.floor(tick / 75) % 4;
  const move = [
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: -1, z: 0 },
    { x: 0, z: -1 },
  ][leg];
  return {
    move,
    aim: (tick / 60) % (2 * Math.PI),
    fire: tick % 90 === 45,
    mine: tick === 120,
  };
}

// Level 1 with every wall cleared and the enemy taking scripted input instead of thinking, so each case isolates one rule.
function arena() {
  const s = createGame(0, ['p1'], 1);
  s.grid.cells.fill(EMPTY);
  const p1 = s.tanks.find((t) => t.id === 'p1')!;
  const enemy = s.tanks.find((t) => t.team === 1)!;
  enemy.control = 'local';
  return { s, p1, enemy };
}

function place(t: TankState, x: number, z: number): void {
  t.pos = { x, z };
}

function run(s: GameState, ticks: number, inputs: (tick: number) => Record<string, PlayerInput> = () => ({})): GameEvent[] {
  const events: GameEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) events.push(...step(s, inputs(tick)));
  return events;
}

function firstTickOf(s: GameState, type: GameEvent['type'], limit: number): number | null {
  for (let tick = 1; tick <= limit; tick++) {
    if (step(s, {}).some((e) => e.type === type)) return tick;
  }
  return null;
}

const count = (events: GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type).length;
const fireAt = (aim: number): PlayerInput => ({ ...IDLE_INPUT, aim, fire: true });
const onFirstTick =
  (id: string, input: PlayerInput) =>
  (tick: number): Record<string, PlayerInput> =>
    tick === 0 ? { [id]: input } : {};

describe('sim', () => {
  it('level 1 replays identically', () => {
    const state = createGame(0, ['p1'], 12345);
    for (let tick = 0; tick < 600; tick++) {
      step(state, { p1: scriptedInput(tick) });
    }
    expect({
      tanks: state.tanks,
      bullets: state.bullets,
      mines: state.mines,
      outcome: state.outcome,
      grid: state.grid.cells,
    }).toMatchSnapshot();
  });

  it('a shell that hits the last enemy wins the level', () => {
    const { s, p1, enemy } = arena();
    place(p1, -3, 0);
    place(enemy, 3, 0);
    const events = run(s, 120, onFirstTick(p1.id, fireAt(Math.PI / 2)));
    expect(enemy.alive).toBe(false);
    expect(p1.alive).toBe(true);
    expect(events.some((e) => e.type === 'pop' && e.tankId === enemy.id)).toBe(true);
    expect(s.outcome).toBe('won');
  });

  it('losing the player loses the level', () => {
    const { s, p1, enemy } = arena();
    place(p1, -3, 0);
    place(enemy, 3, 0);
    run(s, 120, onFirstTick(enemy.id, fireAt(-Math.PI / 2)));
    expect(p1.alive).toBe(false);
    expect(s.outcome).toBe('lost');
  });

  it('a shell bounces once, then ends at the next wall', () => {
    const { s, p1, enemy } = arena();
    place(p1, -8, -5);
    place(enemy, 8, 5);
    s.bullets.push({ id: s.nextId++, owner: p1.id, pos: { x: 0, z: 0 }, vel: { x: BULLET.speed, z: 0 }, bounces: 1, life: BULLET.life });
    const events = run(s, Math.ceil(BULLET.life / DT));
    expect(count(events, 'bounce')).toBe(1);
    expect(count(events, 'bulletEnd')).toBe(1);
    expect(s.bullets).toHaveLength(0);
  });

  it('shells meeting head-on destroy each other', () => {
    const { s, p1, enemy } = arena();
    place(p1, -8, -5);
    place(enemy, 8, 5);
    s.bullets.push({ id: s.nextId++, owner: p1.id, pos: { x: -1, z: 0 }, vel: { x: BULLET.speed, z: 0 }, bounces: 1, life: BULLET.life });
    s.bullets.push({ id: s.nextId++, owner: enemy.id, pos: { x: 1, z: 0 }, vel: { x: -BULLET.speed, z: 0 }, bounces: 1, life: BULLET.life });
    const events = run(s, 30);
    expect(count(events, 'clash')).toBe(1);
    expect(s.bullets).toHaveLength(0);
  });

  it('an untouched mine goes off when its fuse runs out', () => {
    const { s, p1, enemy } = arena();
    place(p1, -8, -5);
    place(enemy, 8, 5);
    s.mines.push({ id: s.nextId++, owner: p1.id, team: 0, pos: { x: 0, z: 0 }, age: 0 });
    expect(firstTickOf(s, 'explode', 700)).toBe(540);
  });

  it('a mine arms before an enemy can trip it', () => {
    const { s, p1, enemy } = arena();
    place(p1, -8, -5);
    place(enemy, 0.5, 0);
    s.mines.push({ id: s.nextId++, owner: p1.id, team: 0, pos: { x: 0, z: 0 }, age: 0 });
    expect(firstTickOf(s, 'explode', 700)).toBe(45);
  });

  it("a tank never trips its own team's mine", () => {
    const { s, p1, enemy } = arena();
    place(p1, 0.3, 0);
    place(enemy, 8, 5);
    s.mines.push({ id: s.nextId++, owner: p1.id, team: 0, pos: { x: 0, z: 0 }, age: 1 });
    const events = run(s, 60);
    expect(count(events, 'explode')).toBe(0);
    expect(s.mines).toHaveLength(1);
  });

  it('a blast pops tanks and breaks cork inside its radius only', () => {
    const { s, p1, enemy } = arena();
    const g = s.grid;
    const cellIndex = (x: number, z: number) => {
      const [c, r] = worldToCell(g, x, z);
      return r * g.cols + c;
    };
    const near = cellIndex(1.5, 0.5); // 1.58 from the mine
    const far = cellIndex(2.5, 0.5); // 2.55 from the mine
    g.cells[near] = CORK;
    g.cells[far] = CORK;
    place(enemy, 0, 1.2);
    place(p1, 0, -1.9);
    s.mines.push({ id: s.nextId++, owner: p1.id, team: 0, pos: { x: 0, z: 0 }, age: MINE.fuse - DT / 2 });
    const events = run(s, 1);
    expect(count(events, 'explode')).toBe(1);
    expect(enemy.alive).toBe(false);
    expect(p1.alive).toBe(true);
    expect(g.cells[near]).toBe(EMPTY);
    expect(g.cells[far]).toBe(CORK);
    expect(count(events, 'wallBreak')).toBe(1);
  });

  it('mines need spacing and reload eight seconds after the last one', () => {
    const { s, p1, enemy } = arena();
    place(p1, -5, 0);
    place(enemy, 8, 5);
    const drop = { ...IDLE_INPUT, mine: true };
    step(s, { p1: drop });
    step(s, { p1: drop });
    expect(s.mines).toHaveLength(1);
    expect(p1.mines).toBe(1);
    run(s, 30, () => ({ p1: { ...IDLE_INPUT, move: { x: 1, z: 0 } } }));
    step(s, { p1: drop });
    expect(s.mines).toHaveLength(2);
    expect(p1.mines).toBe(0);
    run(s, 470);
    expect(p1.mines).toBe(0);
    run(s, 20);
    expect(p1.mines).toBe(2);
  });
});
