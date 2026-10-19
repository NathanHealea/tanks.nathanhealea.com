import { describe, expect, it } from 'vitest';
import { BULLET, DT, MINE } from './config';
import { cellCenter } from './grid';
import { IDLE_INPUT, createPvpGame, step } from './sim';
import { TANK_STATS } from './tanks';
import { EMPTY, type GameEvent, type GameState, type PlayerInput } from './types';

// P spawns at (-2.5, 0) and 2 at (2.5, 0), with open floor between them.
const OPEN = [
  '##########',
  '#........#',
  '#.P....2.#',
  '#........#',
  '##########',
];

function tank(s: GameState, id: string) {
  return s.tanks.find((t) => t.id === id)!;
}

function run(s: GameState, ticks: number, inputs: (tick: number) => Record<string, PlayerInput> = () => ({})): GameEvent[] {
  const events: GameEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) events.push(...step(s, inputs(tick)));
  return events;
}

const count = (events: GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type).length;

describe('pvp', () => {
  it('createPvpGame builds two opposing tanks', () => {
    const s = createPvpGame(OPEN, 7);
    expect(s.mode).toBe('pvp');
    expect(s.winner).toBeNull();
    expect(s.outcome).toBeNull();
    expect(s.tanks.map((t) => t.id).sort()).toEqual(['p1', 'p2']);

    const p1 = tank(s, 'p1');
    expect(p1.team).toBe(0);
    expect(p1.kind).toBe('player');
    expect(p1.control).toBe('local');
    expect(p1.pos).toEqual(cellCenter(s.grid, 2, 2));
    expect(p1.body).toBeCloseTo(Math.PI / 2);
    expect(p1.turret).toBeCloseTo(Math.PI / 2);
    expect(p1.shots).toBe(TANK_STATS.player.maxShots);
    expect(p1.mines).toBe(TANK_STATS.player.maxMines);

    const p2 = tank(s, 'p2');
    expect(p2.team).toBe(1);
    expect(p2.kind).toBe('player');
    expect(p2.control).toBe('local');
    expect(p2.pos).toEqual(cellCenter(s.grid, 7, 2));
    expect(p2.body).toBeCloseTo(-Math.PI / 2);
    expect(p2.turret).toBeCloseTo(-Math.PI / 2);
    expect(p2.shots).toBe(TANK_STATS.player.maxShots);
    expect(p2.mines).toBe(TANK_STATS.player.maxMines);
  });

  it('createPvpGame ignores enemy letters', () => {
    const rows = [
      '##########',
      '#...t....#',
      '#.P....2.#',
      '#.....h..#',
      '##########',
    ];
    const s = createPvpGame(rows, 7);
    expect(s.tanks).toHaveLength(2);
    expect(s.tanks.some((t) => t.id.startsWith('ai'))).toBe(false);
    expect(s.tanks.every((t) => t.control === 'local' && t.kind === 'player')).toBe(true);
    const cols = s.grid.cols;
    expect(s.grid.cells[1 * cols + 4]).toBe(EMPTY);
    expect(s.grid.cells[3 * cols + 6]).toBe(EMPTY);
  });

  it('createPvpGame rejects a layout without both spawns', () => {
    const noP2 = ['#####', '#P..#', '#####'];
    const noP1 = ['#####', '#..2#', '#####'];
    // Control case: proves the throws below come from the missing spawn, not from a missing function.
    expect(createPvpGame(['#####', '#P.2#', '#####'], 7).tanks).toHaveLength(2);
    expect(() => createPvpGame(noP2, 7)).toThrow(Error);
    expect(() => createPvpGame(noP1, 7)).toThrow(Error);
  });

  it('a hit wins the round', () => {
    const s = createPvpGame(OPEN, 7);
    const p1 = tank(s, 'p1');
    const p2 = tank(s, 'p2');
    const events = run(s, 120, (tick): Record<string, PlayerInput> => (tick === 0 ? { p1: { ...IDLE_INPUT, aim: Math.PI / 2, fire: true } } : {}));
    expect(events.some((e) => e.type === 'pop' && e.tankId === 'p2')).toBe(true);
    expect(p1.alive).toBe(true);
    expect(p2.alive).toBe(false);
    expect(s.outcome).toBe('won');
    expect(s.winner).toBe('p1');

    // A later pop of the winner must not rewrite a decided round.
    const decidedAt = s.outcomeTime;
    s.mines.push({ id: s.nextId++, owner: 'p2', team: 1, pos: { ...p1.pos }, age: MINE.fuse - DT / 2 });
    run(s, 1);
    expect(p1.alive).toBe(false);
    expect(s.outcome).toBe('won');
    expect(s.winner).toBe('p1');
    expect(s.outcomeTime).toBe(decidedAt);
  });

  it('a shared blast is a draw', () => {
    const s = createPvpGame(OPEN, 7);
    const p1 = tank(s, 'p1');
    const p2 = tank(s, 'p2');
    p1.pos = { x: -1, z: 0 };
    p2.pos = { x: 1, z: 0 };
    s.mines.push({ id: s.nextId++, owner: 'p1', team: 0, pos: { x: 0, z: 0 }, age: MINE.fuse - DT / 2 });
    const events = run(s, 1);
    expect(count(events, 'explode')).toBe(1);
    expect(p1.alive).toBe(false);
    expect(p2.alive).toBe(false);
    expect(s.outcome).toBe('draw');
    expect(s.winner).toBeNull();
  });

  it('crossed shells on one tick draw', () => {
    const s = createPvpGame(OPEN, 7);
    const p1 = tank(s, 'p1');
    const p2 = tank(s, 'p2');
    // Each shell starts 1 unit from its target and flies away from the other, so they cannot clash and land together.
    s.bullets.push({ id: s.nextId++, owner: 'p2', pos: { x: p1.pos.x + 1, z: p1.pos.z }, vel: { x: -BULLET.speed, z: 0 }, bounces: 1, life: BULLET.life });
    s.bullets.push({ id: s.nextId++, owner: 'p1', pos: { x: p2.pos.x - 1, z: p2.pos.z }, vel: { x: BULLET.speed, z: 0 }, bounces: 1, life: BULLET.life });
    const popTicks: number[] = [];
    for (let tick = 1; tick <= 30; tick++) {
      if (step(s, {}).some((e) => e.type === 'pop')) popTicks.push(tick);
    }
    expect(popTicks).toHaveLength(1);
    expect(p1.alive).toBe(false);
    expect(p2.alive).toBe(false);
    expect(s.outcome).toBe('draw');
    expect(s.winner).toBeNull();
  });

  it('own mine ignores owner, trips on opponent', () => {
    const s = createPvpGame(OPEN, 7);
    const p1 = tank(s, 'p1');
    const p2 = tank(s, 'p2');
    const minePos = { ...p1.pos };
    s.mines.push({ id: s.nextId++, owner: 'p1', team: 0, pos: minePos, age: MINE.arm + 0.1 });

    const parked = run(s, 120);
    expect(count(parked, 'explode')).toBe(0);
    expect(s.mines).toHaveLength(1);
    expect(p1.alive).toBe(true);

    p2.pos = { x: minePos.x + 0.9, z: minePos.z };
    const tripped = run(s, 1);
    expect(count(tripped, 'explode')).toBe(1);
    expect(s.mines).toHaveLength(0);
    expect(p2.alive).toBe(false);
    expect(p1.alive).toBe(false);
  });
});
