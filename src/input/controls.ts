import type { PlayerInput, TankState, Vec2 } from '../game/types';

const KEY_AIM_RATE = 2.6;

// Mutable on purpose: written by DOM listeners, read every frame by the game loop without React re-renders.
export const controls = {
  keys: new Set<string>(),
  stick: { x: 0, z: 0 },
  pointerNdc: { x: 0, y: 0 },
  pointerActive: false,
  aimSource: 'pointer' as 'pointer' | 'keys',
  aimPoint: null as Vec2 | null,
  keyAim: null as number | null,
  fireQueued: false,
  mineQueued: false,
};

export function resetControls(): void {
  controls.keys.clear();
  controls.stick = { x: 0, z: 0 };
  controls.fireQueued = false;
  controls.mineQueued = false;
  controls.keyAim = null;
}

const MOVE_KEYS: Record<string, Vec2> = {
  KeyW: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 },
};

export function readInput(tank: TankState | undefined, dt: number): PlayerInput {
  let mx = controls.stick.x;
  let mz = controls.stick.z;
  for (const [code, v] of Object.entries(MOVE_KEYS)) {
    if (controls.keys.has(code)) {
      mx += v.x;
      mz += v.z;
    }
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }

  let aim: number | null = null;
  if (tank) {
    const turn = (controls.keys.has('ArrowLeft') ? 1 : 0) - (controls.keys.has('ArrowRight') ? 1 : 0);
    if (turn !== 0) {
      controls.aimSource = 'keys';
      controls.keyAim = (controls.keyAim ?? tank.turret) + turn * KEY_AIM_RATE * dt;
    }
    if (controls.aimSource === 'keys') {
      aim = controls.keyAim ?? tank.turret;
    } else if (controls.aimPoint) {
      aim = Math.atan2(controls.aimPoint.x - tank.pos.x, controls.aimPoint.z - tank.pos.z);
    }
  }
  return { move: { x: mx, z: mz }, aim, fire: controls.fireQueued, mine: controls.mineQueued };
}

export function clearActions(): void {
  controls.fireQueued = false;
  controls.mineQueued = false;
}

export function setPointer(clientX: number, clientY: number): void {
  controls.pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
  controls.pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;
  controls.pointerActive = true;
  controls.aimSource = 'pointer';
  controls.keyAim = null;
}

/** Keyboard and mouse bindings. Returns an unbind function. `onPause` fires on Escape or P. */
export function bindDesktop(surface: HTMLElement, onPause: () => void): () => void {
  const keyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      onPause();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'Space') {
      controls.fireQueued = true;
      e.preventDefault();
    } else if (e.code === 'KeyF') {
      controls.mineQueued = true;
    } else if (e.code.startsWith('Arrow')) {
      e.preventDefault();
    }
    controls.keys.add(e.code);
  };
  const keyUp = (e: KeyboardEvent) => controls.keys.delete(e.code);
  const blur = () => controls.keys.clear();
  const move = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setPointer(e.clientX, e.clientY);
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) {
      setPointer(e.clientX, e.clientY);
      controls.fireQueued = true;
    } else if (e.button === 2) {
      controls.mineQueued = true;
    }
  };
  // Right click drops a mine, so the browser's context menu has to stay out of the way.
  const noMenu = (e: MouseEvent) => e.preventDefault();
  const leave = () => {
    controls.pointerActive = false;
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  window.addEventListener('pointermove', move);
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('contextmenu', noMenu);
  document.documentElement.addEventListener('pointerleave', leave);
  return () => {
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
    window.removeEventListener('pointermove', move);
    surface.removeEventListener('pointerdown', down);
    surface.removeEventListener('contextmenu', noMenu);
    document.documentElement.removeEventListener('pointerleave', leave);
  };
}
