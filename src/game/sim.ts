import { BULLET, DT, MINE, TANK } from './config';
import { thinkAi } from './ai';
import { cellAt, cellCenter, circleHitsSolid, pushCircleOut } from './grid';
import { AI_CHARS, getLevel, levelDifficulty, parseLevel } from './levels';
import { forward, wrapAngle } from './math';
import { TANK_STATS, type TankKind } from './tanks';
import {
  CORK,
  EMPTY,
  type GameEvent,
  type GameState,
  type PlayerInput,
  type TankState,
  type Vec2,
} from './types';

export const PLAYER_COLORS: Record<string, string> = { p1: '#3d6da8', p2: '#4f8a6b' };
const PLAYER_CHARS: Record<string, string> = { P: 'p1', '2': 'p2' };

export const IDLE_INPUT: PlayerInput = { move: { x: 0, z: 0 }, aim: null, fire: false, mine: false };

function makeTank(id: string, kind: TankKind, team: number, pos: Vec2, color: string, facing: number): TankState {
  return {
    id,
    team,
    control: 'local',
    kind,
    color,
    pos,
    body: facing,
    turret: facing,
    alive: true,
    shots: TANK_STATS[kind].maxShots,
    mines: TANK_STATS[kind].maxMines,
    shotReload: 0,
    mineReload: 0,
    fireCooldown: 0,
  };
}

export function createGame(levelIndex: number, playerIds: string[], seed: number): GameState {
  const { grid, spawns } = parseLevel(getLevel(levelIndex));
  const difficulty = levelDifficulty(levelIndex);
  const tanks: TankState[] = [];

  for (const { ch, col, row } of spawns) {
    const pos = cellCenter(grid, col, row);
    const playerId = PLAYER_CHARS[ch];
    if (playerId && playerIds.includes(playerId)) {
      tanks.push(makeTank(playerId, 'player', 0, pos, PLAYER_COLORS[playerId], Math.PI / 2));
    }
    const kind = AI_CHARS[ch];
    if (kind) {
      const t = makeTank(`ai${tanks.length}`, kind, 1, pos, TANK_STATS[kind].color, -Math.PI / 2);
      t.control = 'ai';
      t.ai = { sweep: 0, sweepDir: 1, fireDelay: 2 + (1 - difficulty) * 1.5, path: [], retarget: 0, lastPos: { ...pos }, stuck: 0 };
      tanks.push(t);
    }
  }

  return {
    tick: 0,
    time: 0,
    rng: seed | 0,
    nextId: 1,
    difficulty,
    grid,
    tanks,
    bullets: [],
    mines: [],
    mode: 'campaign',
    winner: null,
    outcome: null,
    outcomeTime: 0,
  };
}

function drive(t: TankState, input: PlayerInput): void {
  const mag = Math.min(1, Math.hypot(input.move.x, input.move.z));
  if (mag < 0.15) return;
  const target = Math.atan2(input.move.x, input.move.z);
  let diff = wrapAngle(target - t.body);
  let dir = 1;
  // Tanks reverse rather than spin around when asked to go mostly backwards.
  if (Math.abs(diff) > Math.PI / 2 + 0.2) {
    diff = wrapAngle(diff + Math.PI);
    dir = -1;
  }
  const maxTurn = TANK.turnRate * DT;
  t.body = wrapAngle(t.body + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  const remaining = Math.abs(wrapAngle(target - t.body + (dir < 0 ? Math.PI : 0)));
  const align = Math.max(0, Math.cos(Math.min(remaining * 1.6, Math.PI / 2)));
  const f = forward(t.body);
  const speed = TANK_STATS[t.kind].speed * mag * align * dir * DT;
  t.pos.x += f.x * speed;
  t.pos.z += f.z * speed;
}

function tryFire(s: GameState, t: TankState, events: GameEvent[]): void {
  if (t.fireCooldown > 0 || t.shots <= 0) return;
  const stats = TANK_STATS[t.kind];
  t.shots--;
  t.fireCooldown = TANK.fireCooldown;
  if (t.shots === 0) t.shotReload = TANK.shotReload;
  const f = forward(t.turret);
  const pos = { x: t.pos.x + f.x * TANK.muzzle, z: t.pos.z + f.z * TANK.muzzle };
  if (circleHitsSolid(s.grid, pos.x, pos.z, BULLET.radius)) {
    events.push({ type: 'fizzle', pos });
    return;
  }
  s.bullets.push({
    id: s.nextId++,
    owner: t.id,
    pos,
    vel: { x: f.x * stats.shellSpeed, z: f.z * stats.shellSpeed },
    bounces: stats.bounces,
    life: BULLET.life,
  });
  events.push({ type: 'fire', pos, angle: t.turret, owner: t.id });
}

function tryMine(s: GameState, t: TankState, events: GameEvent[]): void {
  if (t.mines <= 0) return;
  if (s.mines.some((m) => Math.hypot(m.pos.x - t.pos.x, m.pos.z - t.pos.z) < MINE.minSpacing)) return;
  t.mines--;
  if (t.mines === 0) t.mineReload = TANK.mineReload;
  const pos = { x: t.pos.x, z: t.pos.z };
  s.mines.push({ id: s.nextId++, owner: t.id, team: t.team, pos, age: 0 });
  events.push({ type: 'mineDrop', pos });
}

function tickReloads(t: TankState): void {
  t.fireCooldown = Math.max(0, t.fireCooldown - DT);
  if (t.shots === 0) {
    t.shotReload -= DT;
    if (t.shotReload <= 0) t.shots = TANK_STATS[t.kind].maxShots;
  }
  if (t.mines === 0 && TANK_STATS[t.kind].maxMines > 0) {
    t.mineReload -= DT;
    if (t.mineReload <= 0) t.mines = TANK_STATS[t.kind].maxMines;
  }
}

function pop(t: TankState, events: GameEvent[]): void {
  if (!t.alive) return;
  t.alive = false;
  events.push({ type: 'pop', pos: { ...t.pos }, color: t.color, tankId: t.id });
}

function explode(s: GameState, pos: Vec2, events: GameEvent[]): void {
  events.push({ type: 'explode', pos: { ...pos } });
  const r2 = MINE.blastRadius * MINE.blastRadius;
  const inBlast = (p: Vec2) => (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 < r2;
  for (const t of s.tanks) if (t.alive && inBlast(t.pos)) pop(t, events);
  s.bullets = s.bullets.filter((b) => !inBlast(b.pos));
  for (const m of s.mines) if (inBlast(m.pos)) m.age = Math.max(m.age, MINE.fuse - 0.12);
  const g = s.grid;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (cellAt(g, c, r) !== CORK) continue;
      const center = cellCenter(g, c, r);
      if (inBlast(center)) {
        g.cells[r * g.cols + c] = EMPTY;
        events.push({ type: 'wallBreak', pos: center, col: c, row: r });
      }
    }
  }
}

function updateBullets(s: GameState, events: GameEvent[]): void {
  const g = s.grid;
  const dead = new Set<number>();
  for (const b of s.bullets) {
    b.life -= DT;
    if (b.life <= 0) {
      dead.add(b.id);
      events.push({ type: 'bulletEnd', pos: { ...b.pos } });
      continue;
    }
    // Axis-separated moves give clean reflections even at seams between cells.
    let bounced = false;
    b.pos.x += b.vel.x * DT;
    if (circleHitsSolid(g, b.pos.x, b.pos.z, BULLET.radius)) {
      b.pos.x -= b.vel.x * DT;
      b.vel.x = -b.vel.x;
      bounced = true;
    }
    b.pos.z += b.vel.z * DT;
    if (circleHitsSolid(g, b.pos.x, b.pos.z, BULLET.radius)) {
      b.pos.z -= b.vel.z * DT;
      b.vel.z = -b.vel.z;
      bounced = true;
    }
    if (bounced) {
      if (b.bounces <= 0) {
        dead.add(b.id);
        events.push({ type: 'bulletEnd', pos: { ...b.pos } });
        continue;
      }
      b.bounces--;
      events.push({ type: 'bounce', pos: { ...b.pos } });
    }
    const hitR = TANK.radius + BULLET.radius;
    const victim = s.tanks.find((t) => t.alive && (t.pos.x - b.pos.x) ** 2 + (t.pos.z - b.pos.z) ** 2 < hitR * hitR);
    if (victim) {
      dead.add(b.id);
      pop(victim, events);
      continue;
    }
    const mine = s.mines.find((m) => (m.pos.x - b.pos.x) ** 2 + (m.pos.z - b.pos.z) ** 2 < 0.35 * 0.35);
    if (mine) {
      dead.add(b.id);
      mine.age = MINE.fuse;
    }
  }
  const live = s.bullets.filter((b) => !dead.has(b.id));
  const clashR = BULLET.radius * 2.2;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const c = live[j];
      if (dead.has(a.id) || dead.has(c.id)) continue;
      if ((a.pos.x - c.pos.x) ** 2 + (a.pos.z - c.pos.z) ** 2 < clashR * clashR) {
        dead.add(a.id);
        dead.add(c.id);
        events.push({ type: 'clash', pos: { x: (a.pos.x + c.pos.x) / 2, z: (a.pos.z + c.pos.z) / 2 } });
      }
    }
  }
  s.bullets = s.bullets.filter((b) => !dead.has(b.id));
}

function updateMines(s: GameState, events: GameEvent[]): void {
  for (const m of s.mines) {
    m.age += DT;
    if (m.age >= MINE.arm && m.age < MINE.fuse) {
      const tr2 = MINE.triggerRadius * MINE.triggerRadius;
      const tripped = s.tanks.some(
        (t) => t.alive && t.team !== m.team && (t.pos.x - m.pos.x) ** 2 + (t.pos.z - m.pos.z) ** 2 < tr2,
      );
      if (tripped) m.age = MINE.fuse;
    }
  }
  // Explosions can chain into other mines, so keep going until no fuse is spent.
  let fired = s.mines.find((m) => m.age >= MINE.fuse);
  while (fired) {
    const m = fired;
    s.mines = s.mines.filter((x) => x !== m);
    explode(s, m.pos, events);
    fired = s.mines.find((x) => x.age >= MINE.fuse);
  }
}

function separateTanks(s: GameState): void {
  const alive = s.tanks.filter((t) => t.alive);
  const min = TANK.radius * 2;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i].pos;
      const b = alive[j].pos;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      a.x -= (dx / d) * push;
      a.z -= (dz / d) * push;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
  }
  for (const t of alive) pushCircleOut(s.grid, t.pos, TANK.radius);
}

function updateOutcome(s: GameState): void {
  if (s.outcome) return;
  const playersAlive = s.tanks.some((t) => t.team === 0 && t.alive);
  const enemiesAlive = s.tanks.some((t) => t.team === 1 && t.alive);
  if (!playersAlive) s.outcome = 'lost';
  else if (!enemiesAlive) s.outcome = 'won';
  if (s.outcome) s.outcomeTime = s.time;
}

/** Advance the world by one fixed tick. Mutates `s`; returns what happened for audio and effects. */
export function step(s: GameState, inputs: Record<string, PlayerInput>): GameEvent[] {
  const events: GameEvent[] = [];
  s.tick++;
  s.time += DT;
  for (const t of s.tanks) {
    if (!t.alive) continue;
    tickReloads(t);
    const input = t.control === 'ai' ? thinkAi(s, t) : (inputs[t.id] ?? IDLE_INPUT);
    drive(t, input);
    if (input.aim !== null) t.turret = wrapAngle(input.aim);
    if (input.fire) tryFire(s, t, events);
    if (input.mine) tryMine(s, t, events);
  }
  separateTanks(s);
  updateBullets(s, events);
  updateMines(s, events);
  updateOutcome(s);
  return events;
}
