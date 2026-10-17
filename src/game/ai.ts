import { BULLET, DT, MINE, TANK } from './config';
import { cellAt, cellCenter, circleHitsSolid, lineOfSight, worldToCell } from './grid';
import { forward, rand, wrapAngle } from './math';
import { TANK_STATS } from './tanks';
import { EMPTY, type AiType, type GameState, type PlayerInput, type TankState, type Vec2 } from './types';

interface AiProfile {
  moveSpeed: number;
  turretTurn: number;
  sweepRange: number;
  sweepSpeed: number;
  fireInterval: number;
  dodges: boolean;
  preferRange: number;
  minesPerSecond: number;
}

const PROFILES: Record<AiType, AiProfile> = {
  turret: { moveSpeed: 0, turretTurn: 1.6, sweepRange: 0.35, sweepSpeed: 0.5, fireInterval: 1.8, dodges: false, preferRange: 0, minesPerSecond: 0 },
  roamer: { moveSpeed: 0.55, turretTurn: 2.2, sweepRange: 0.5, sweepSpeed: 0.8, fireInterval: 1.2, dodges: true, preferRange: 7, minesPerSecond: 0 },
  hunter: { moveSpeed: 0.85, turretTurn: 3.2, sweepRange: 0.6, sweepSpeed: 1.4, fireInterval: 0.75, dodges: true, preferRange: 4, minesPerSecond: 0.15 },
  rocket: { moveSpeed: 0.6, turretTurn: 1.8, sweepRange: 0.25, sweepSpeed: 0.6, fireInterval: 2.2, dodges: false, preferRange: 9, minesPerSecond: 0 },
  ace: { moveSpeed: 1, turretTurn: 3.6, sweepRange: 0.7, sweepSpeed: 1.8, fireInterval: 0.6, dodges: true, preferRange: 5, minesPerSecond: 0.1 },
};

/** Walk a would-be bullet along its path, up to `bounces` ricochets, and report the first tank it would hit. */
export function traceShot(s: GameState, shooter: TankState, angle: number, bounces: number): TankState | null {
  const stepLen = 0.1;
  const f = forward(angle);
  const pos = { x: shooter.pos.x + f.x * TANK.muzzle, z: shooter.pos.z + f.z * TANK.muzzle };
  if (circleHitsSolid(s.grid, pos.x, pos.z, BULLET.radius)) return null;
  const vel = { x: f.x * stepLen, z: f.z * stepLen };
  const hitR2 = (TANK.radius + BULLET.radius) ** 2;
  for (let i = 0; i < 260; i++) {
    let bounced = false;
    pos.x += vel.x;
    if (circleHitsSolid(s.grid, pos.x, pos.z, BULLET.radius)) {
      pos.x -= vel.x;
      vel.x = -vel.x;
      bounced = true;
    }
    pos.z += vel.z;
    if (circleHitsSolid(s.grid, pos.x, pos.z, BULLET.radius)) {
      pos.z -= vel.z;
      vel.z = -vel.z;
      bounced = true;
    }
    if (bounced && bounces-- <= 0) return null;
    for (const t of s.tanks) {
      if (!t.alive || (t === shooter && i < 10)) continue;
      if ((t.pos.x - pos.x) ** 2 + (t.pos.z - pos.z) ** 2 < hitR2) return t;
    }
  }
  return null;
}

function nearestEnemy(s: GameState, t: TankState): TankState | null {
  let best: TankState | null = null;
  let bestD = Infinity;
  for (const o of s.tanks) {
    if (!o.alive || o.team === t.team) continue;
    const d = Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

const NEIGHBORS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Mines block the cells around them, except mines the tank is already sitting near, so it can drive away. */
function mineFree(s: GameState, t: TankState, p: Vec2): boolean {
  const r = MINE.blastRadius * 0.8;
  return !s.mines.some(
    (m) => Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < r && Math.hypot(m.pos.x - t.pos.x, m.pos.z - t.pos.z) >= r,
  );
}

/**
 * Breadth-first search over open cells. Diagonal steps need both side cells open so tanks never clip a corner.
 * `avoidTanks` treats other tanks' cells as walls, which breaks head-on deadlocks in one-cell corridors.
 */
function searchFrom(s: GameState, t: TankState, avoidTanks: boolean): { start: number; parent: Int16Array } {
  const g = s.grid;
  const parent = new Int16Array(g.cols * g.rows).fill(-1);
  const [sc, sr] = worldToCell(g, t.pos.x, t.pos.z);
  const start = sr * g.cols + sc;
  const occupied = new Set<number>();
  if (avoidTanks) {
    for (const o of s.tanks) {
      if (o === t || !o.alive) continue;
      const [oc, or] = worldToCell(g, o.pos.x, o.pos.z);
      occupied.add(or * g.cols + oc);
    }
  }
  const open = (c: number, r: number) =>
    cellAt(g, c, r) === EMPTY && !occupied.has(r * g.cols + c) && mineFree(s, t, cellCenter(g, c, r));
  if (cellAt(g, sc, sr) !== EMPTY) return { start, parent };
  parent[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] % g.cols;
    const r = Math.floor(queue[head] / g.cols);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!open(nc, nr) || parent[nr * g.cols + nc] !== -1) continue;
      if (dc !== 0 && dr !== 0 && (!open(c + dc, r) || !open(c, r + dr))) continue;
      parent[nr * g.cols + nc] = queue[head];
      queue.push(nr * g.cols + nc);
    }
  }
  return { start, parent };
}

/** Pick a reachable cell near the preferred fighting distance and return the waypoints to it. */
function planRoute(s: GameState, t: TankState, enemy: TankState, prof: AiProfile, avoidTanks: boolean): Vec2[] {
  const g = s.grid;
  const { start, parent } = searchFrom(s, t, avoidTanks);
  const [tc, tr] = worldToCell(g, t.pos.x, t.pos.z);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < 12; i++) {
    const c = tc + Math.floor(rand(s) * 11) - 5;
    const r = tr + Math.floor(rand(s) * 11) - 5;
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
    const idx = r * g.cols + c;
    if (idx === start || parent[idx] === -1) continue;
    const p = cellCenter(g, c, r);
    const d = Math.hypot(p.x - enemy.pos.x, p.z - enemy.pos.z);
    const score = Math.abs(d - prof.preferRange) + rand(s) * 2 + (mineFree(s, t, p) ? 0 : 100);
    if (score < bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  const path: Vec2[] = [];
  for (let idx = best; idx !== -1 && idx !== start; idx = parent[idx]) {
    path.unshift(cellCenter(g, idx % g.cols, Math.floor(idx / g.cols)));
  }
  return path;
}

function dodge(s: GameState, t: TankState): Vec2 | null {
  for (const b of s.bullets) {
    const rx = t.pos.x - b.pos.x;
    const rz = t.pos.z - b.pos.z;
    const dist = Math.hypot(rx, rz);
    if (dist > 2.8) continue;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const along = (rx * b.vel.x + rz * b.vel.z) / speed;
    if (along <= 0) continue;
    const across = (rx * b.vel.z - rz * b.vel.x) / speed;
    if (Math.abs(across) > 1.0) continue;
    const away = across >= 0 ? 1 : -1;
    const px = b.vel.z / speed;
    const pz = -b.vel.x / speed;
    for (const side of [away, -away]) {
      if (!circleHitsSolid(s.grid, t.pos.x + px * side * 0.6, t.pos.z + pz * side * 0.6, TANK.radius)) {
        return { x: px * side, z: pz * side };
      }
    }
    return null;
  }
  return null;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Scale a profile by level difficulty (0 = first level, 1 = last). Early enemies are slower and sloppier. */
function scaled(base: AiProfile, d: number): AiProfile {
  return {
    ...base,
    moveSpeed: base.moveSpeed * lerp(0.6, 1, d),
    turretTurn: base.turretTurn * lerp(0.45, 1, d),
    fireInterval: base.fireInterval * lerp(2.2, 1, d),
    dodges: base.dodges && d >= 0.5,
    minesPerSecond: d >= 0.5 ? base.minesPerSecond : 0,
  };
}

export function thinkAi(s: GameState, t: TankState): PlayerInput {
  const prof = scaled(PROFILES[t.kind as AiType], s.difficulty);
  const m = t.ai!;
  const input: PlayerInput = { move: { x: 0, z: 0 }, aim: null, fire: false, mine: false };
  const enemy = nearestEnemy(s, t);
  if (!enemy) return input;

  const visible = lineOfSight(s.grid, t.pos, enemy.pos);
  // With no clear line, sweep wider so the trace has a chance to find a bank shot.
  const range = visible ? prof.sweepRange : prof.sweepRange * 2.5;
  m.sweep += m.sweepDir * prof.sweepSpeed * DT;
  if (Math.abs(m.sweep) > range) {
    m.sweep = Math.sign(m.sweep) * range;
    m.sweepDir = m.sweepDir === 1 ? -1 : 1;
  }
  const desired = Math.atan2(enemy.pos.x - t.pos.x, enemy.pos.z - t.pos.z) + m.sweep;
  const maxTurn = prof.turretTurn * DT;
  input.aim = t.turret + Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(desired - t.turret)));

  m.fireDelay -= DT;
  if (m.fireDelay <= 0 && t.shots > 0 && t.fireCooldown <= 0) {
    // Bank shots are the deadliest thing the AI does, so early levels only take direct shots.
    const hit = traceShot(s, t, input.aim, s.difficulty >= 0.5 ? TANK_STATS[t.kind].bounces : 0);
    if (hit && hit.team !== t.team) {
      input.fire = true;
      m.fireDelay = prof.fireInterval * (0.7 + rand(s) * 0.6);
    }
  }

  if (prof.moveSpeed > 0) {
    const evade = prof.dodges ? dodge(s, t) : null;
    if (evade) {
      input.move = { x: evade.x, z: evade.z };
    } else {
      m.retarget -= DT;
      if (m.retarget <= 0) {
        m.stuck = Math.hypot(t.pos.x - m.lastPos.x, t.pos.z - m.lastPos.z) < 0.15 ? m.stuck + 1 : 0;
        m.lastPos = { ...t.pos };
        m.retarget = 0.6;
        if (m.path.length === 0 || m.stuck > 1) {
          m.path = planRoute(s, t, enemy, prof, m.stuck > 1);
          m.stuck = 0;
        }
      }
      while (m.path.length && Math.hypot(m.path[0].x - t.pos.x, m.path[0].z - t.pos.z) < 0.2) m.path.shift();
      if (m.path.length) {
        const dx = m.path[0].x - t.pos.x;
        const dz = m.path[0].z - t.pos.z;
        const len = Math.hypot(dx, dz);
        input.move = { x: (dx / len) * prof.moveSpeed, z: (dz / len) * prof.moveSpeed };
      }
    }
  }

  if (prof.minesPerSecond > 0 && Math.hypot(enemy.pos.x - t.pos.x, enemy.pos.z - t.pos.z) < 3.5) {
    input.mine = rand(s) < prof.minesPerSecond * DT;
  }
  return input;
}
