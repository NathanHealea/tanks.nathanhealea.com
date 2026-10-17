import { Color } from 'three';
import { BULLET } from '../game/config';
import type { GameEvent, Vec2 } from '../game/types';
import { sfx } from '../audio/sound';

export type ParticleKind = 'puff' | 'shard' | 'fire';

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  spin: number;
  age: number;
  life: number;
  size: number;
  gravity: number;
  drag: number;
  color: Color;
  grounded: boolean;
}

export const POOL_SIZE: Record<ParticleKind, number> = { puff: 400, shard: 400, fire: 160 };
export const TRACK_MARKS = 600;
export const POP_MARKS = 24;

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Render-side visual state. Lives outside React so the frame loop can mutate it freely. */
export class Effects {
  particles: Record<ParticleKind, Particle[]> = { puff: [], shard: [], fire: [] };
  tracks: { x: number; z: number; angle: number }[] = [];
  trackHead = 0;
  popMarks: { x: number; z: number; angle: number }[] = [];
  shake = 0;
  flash = 0;
  flashPos: Vec2 = { x: 0, z: 0 };
  readonly reducedMotion = reducedMotion;

  reset(): void {
    this.particles = { puff: [], shard: [], fire: [] };
    this.tracks = [];
    this.trackHead = 0;
    this.popMarks = [];
    this.shake = 0;
    this.flash = 0;
  }

  private spawn(kind: ParticleKind, p: Partial<Particle> & { x: number; y: number; z: number }): void {
    const list = this.particles[kind];
    if (list.length >= POOL_SIZE[kind]) list.shift();
    list.push({
      vx: 0,
      vy: 0,
      vz: 0,
      rx: Math.random() * Math.PI,
      ry: Math.random() * Math.PI,
      rz: Math.random() * Math.PI,
      spin: 0,
      age: 0,
      life: 1,
      size: 0.2,
      gravity: 0,
      drag: 0,
      color: new Color('#ffffff'),
      grounded: false,
      ...p,
    });
  }

  private count(n: number): number {
    return this.reducedMotion ? Math.ceil(n / 3) : n;
  }

  puff(x: number, y: number, z: number, n: number, spread: number, size: number, life = 0.6, color = '#ece8df'): void {
    for (let i = 0; i < this.count(n); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.4 + Math.random() * 0.6);
      this.spawn('puff', {
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: Math.random() * spread * 0.4 + 0.2,
        vz: Math.sin(a) * sp,
        life: life * (0.7 + Math.random() * 0.6),
        size: size * (0.7 + Math.random() * 0.6),
        drag: 3,
        color: new Color(color),
      });
    }
  }

  trail(pos: Vec2): void {
    this.spawn('puff', {
      x: pos.x,
      y: BULLET.height,
      z: pos.z,
      vy: 0.15,
      life: 0.45,
      size: 0.08,
      drag: 2,
      color: new Color('#d8d3c8'),
    });
  }

  trackMark(x: number, z: number, angle: number): void {
    if (this.tracks.length < TRACK_MARKS) this.tracks.push({ x, z, angle });
    else this.tracks[this.trackHead] = { x, z, angle };
    this.trackHead = (this.trackHead + 1) % TRACK_MARKS;
  }

  /** The tank bursts like a balloon: rubbery shreds snap outward, slow fast in the air, and settle. */
  balloonPop(pos: Vec2, color: string): void {
    const base = new Color(color);
    for (let i = 0; i < this.count(36); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 4;
      const c = base.clone().offsetHSL(0, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.12);
      this.spawn('shard', {
        x: pos.x,
        y: 0.35,
        z: pos.z,
        vx: Math.cos(a) * sp,
        vy: 2 + Math.random() * 4,
        vz: Math.sin(a) * sp,
        spin: (Math.random() - 0.5) * 30,
        life: 2.2 + Math.random() * 1.2,
        size: 0.7 + Math.random() * 0.8,
        gravity: 9,
        drag: 2.6,
        color: c,
      });
    }
    for (let i = 0; i < this.count(14); i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawn('puff', {
        x: pos.x,
        y: 0.35,
        z: pos.z,
        vx: Math.cos(a) * 5,
        vy: 0.3,
        vz: Math.sin(a) * 5,
        life: 0.3,
        size: 0.22,
        drag: 9,
        color: new Color('#f4f1ea'),
      });
    }
    if (this.popMarks.length >= POP_MARKS) this.popMarks.shift();
    this.popMarks.push({ x: pos.x, z: pos.z, angle: Math.random() * Math.PI });
    this.addShake(0.18);
  }

  explosion(pos: Vec2): void {
    for (let i = 0; i < this.count(26); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      this.spawn('fire', {
        x: pos.x,
        y: 0.2,
        z: pos.z,
        vx: Math.cos(a) * sp,
        vy: 1 + Math.random() * 2.5,
        vz: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.3,
        size: 0.35 + Math.random() * 0.35,
        drag: 4,
        color: new Color().setHSL(0.07 + Math.random() * 0.06, 0.9, 0.55),
      });
    }
    this.puff(pos.x, 0.3, pos.z, 18, 2.4, 0.45, 1.2, '#b9b3a8');
    this.flash = 1;
    this.flashPos = { ...pos };
    this.addShake(0.5);
  }

  corkBurst(pos: Vec2): void {
    for (let i = 0; i < this.count(12); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2;
      this.spawn('shard', {
        x: pos.x + (Math.random() - 0.5) * 0.6,
        y: 0.5,
        z: pos.z + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * sp,
        vy: 1.5 + Math.random() * 2,
        vz: Math.sin(a) * sp,
        spin: (Math.random() - 0.5) * 12,
        life: 1.5,
        size: 1.1,
        gravity: 9,
        drag: 1.5,
        color: new Color('#b98d5c'),
      });
    }
    this.puff(pos.x, 0.5, pos.z, 5, 1, 0.35, 0.8, '#d6c2a4');
  }

  spark(pos: Vec2, n = 4): void {
    for (let i = 0; i < this.count(n); i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn('fire', {
        x: pos.x,
        y: BULLET.height,
        z: pos.z,
        vx: Math.cos(a) * 2,
        vy: Math.random() * 1.5,
        vz: Math.sin(a) * 2,
        life: 0.15,
        size: 0.1,
        drag: 4,
        color: new Color('#ffd27a'),
      });
    }
  }

  addShake(amount: number): void {
    if (!this.reducedMotion) this.shake = Math.min(1, this.shake + amount);
  }

  handle(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          const fx = Math.sin(e.angle);
          const fz = Math.cos(e.angle);
          this.puff(e.pos.x + fx * 0.1, BULLET.height, e.pos.z + fz * 0.1, 5, 0.9, 0.14, 0.45);
          this.spark(e.pos, 3);
          this.addShake(0.04);
          sfx.shot();
          break;
        }
        case 'fizzle':
          this.puff(e.pos.x, BULLET.height, e.pos.z, 4, 0.6, 0.12, 0.4);
          sfx.fizzle();
          break;
        case 'bounce':
          this.spark(e.pos, 3);
          sfx.bounce();
          break;
        case 'bulletEnd':
          this.puff(e.pos.x, BULLET.height, e.pos.z, 5, 0.8, 0.13, 0.4);
          sfx.fizzle();
          break;
        case 'clash':
          this.spark(e.pos, 8);
          this.puff(e.pos.x, BULLET.height, e.pos.z, 4, 0.8, 0.12, 0.4);
          sfx.clash();
          break;
        case 'pop':
          this.balloonPop(e.pos, e.color);
          sfx.pop();
          break;
        case 'mineDrop':
          sfx.mineDrop();
          break;
        case 'explode':
          this.explosion(e.pos);
          sfx.explode();
          break;
        case 'wallBreak':
          this.corkBurst(e.pos);
          break;
      }
    }
  }

  update(dt: number): void {
    for (const kind of Object.keys(this.particles) as ParticleKind[]) {
      const list = this.particles[kind];
      let w = 0;
      for (const p of list) {
        p.age += dt;
        if (p.age >= p.life) continue;
        if (!p.grounded) {
          const k = Math.exp(-p.drag * dt);
          p.vx *= k;
          p.vz *= k;
          p.vy = p.vy * (kind === 'shard' ? k : 1) - p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.rx += p.spin * dt;
          p.rz += p.spin * 0.7 * dt;
          if (kind === 'shard' && p.y <= 0.02) {
            p.y = 0.02;
            p.grounded = true;
            p.rx = 0;
            p.rz = 0;
          }
        }
        list[w++] = p;
      }
      list.length = w;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 5);
  }
}
