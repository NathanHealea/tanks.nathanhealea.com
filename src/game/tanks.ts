import { BULLET, TANK } from './config';
import type { AiType } from './types';

export type TankKind = 'player' | AiType;

export interface TankStats {
  name: string;
  blurb: string;
  color: string;
  /** Top speed in units/second; 0 means it never drives. */
  speed: number;
  maxShots: number;
  maxMines: number;
  shellSpeed: number;
  bounces: number;
}

export const TANK_STATS: Record<TankKind, TankStats> = {
  player: { name: 'You', blurb: '', color: '#3d6da8', speed: TANK.speed, maxShots: 2, maxMines: 2, shellSpeed: BULLET.speed, bounces: 1 },
  turret: { name: 'Turret', blurb: 'Stays put and takes its time.', color: '#a27a4c', speed: 0, maxShots: 2, maxMines: 0, shellSpeed: 6, bounces: 1 },
  roamer: { name: 'Roamer', blurb: 'Drives around looking for an angle.', color: '#7d7f54', speed: 2, maxShots: 2, maxMines: 0, shellSpeed: 6.5, bounces: 1 },
  hunter: { name: 'Hunter', blurb: 'Fast, closes in, and drops mines.', color: '#94413b', speed: 2.6, maxShots: 2, maxMines: 2, shellSpeed: 7, bounces: 1 },
  rocket: { name: 'Rocket', blurb: 'Slow, but its shells are very fast. They do not bounce.', color: '#3f7a80', speed: 1.6, maxShots: 1, maxMines: 0, shellSpeed: 11.5, bounces: 0 },
  ace: { name: 'Ace', blurb: 'Quick, three shells that bounce twice.', color: '#5a4a6e', speed: 2.8, maxShots: 3, maxMines: 2, shellSpeed: 7.5, bounces: 2 },
};

/** Enemy types in the order they join the roster, one per block of 10 levels. */
export const ROSTER: AiType[] = ['turret', 'roamer', 'hunter', 'rocket', 'ace'];
