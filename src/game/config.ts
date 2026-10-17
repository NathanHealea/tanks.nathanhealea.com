// Fixed tick keeps the simulation reproducible and lets a future server run the same step().
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// World units: 1 unit = 1 grid cell. Times in seconds, speeds in units/second.
export const TANK = {
  radius: 0.42,
  speed: 2.4,
  turnRate: 7,
  muzzle: 0.72,
  // Reload starts only once the magazine is empty. Values are first-pass guesses; tune in playtesting.
  shotReload: 2.0,
  mineReload: 8.0,
  fireCooldown: 0.2,
};

export const BULLET = {
  speed: 6.5,
  radius: 0.1,
  bounces: 1,
  life: 8,
  height: 0.45,
};

export const MINE = {
  arm: 0.75,
  fuse: 9,
  triggerRadius: 1.0,
  blastRadius: 1.7,
  minSpacing: 0.8,
};

export const MAX_LIVES = 3;
export const OUTCOME_DELAY = 1.8;
