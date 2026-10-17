import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CapsuleGeometry, Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { BULLET, MINE } from '../game/config';
import type { GameState } from '../game/types';
import type { Effects } from './effects';

const MAX_BULLETS = 64;
const MAX_MINES = 32;
const TRAIL_INTERVAL = 0.035;

const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const scale = new Vector3();

export function Projectiles({ getState, effects }: { getState: () => GameState; effects: Effects }) {
  const bullets = useRef<InstancedMesh>(null);
  const mines = useRef<InstancedMesh>(null);
  const lights = useRef<InstancedMesh>(null);
  const trailClock = useRef(0);
  const shell = useMemo(() => new CapsuleGeometry(BULLET.radius * 0.8, 0.14, 4, 10).rotateX(Math.PI / 2), []);

  useFrame((_, dt) => {
    const s = getState();
    const b = bullets.current;
    if (b) {
      trailClock.current += dt;
      const emit = trailClock.current >= TRAIL_INTERVAL;
      if (emit) trailClock.current = 0;
      const list = s.bullets.slice(0, MAX_BULLETS);
      list.forEach((bullet, i) => {
        q.setFromEuler(e.set(0, Math.atan2(bullet.vel.x, bullet.vel.z), 0));
        m.compose(pos.set(bullet.pos.x, BULLET.height, bullet.pos.z), q, scale.set(1, 1, 1));
        b.setMatrixAt(i, m);
        if (emit) effects.trail(bullet.pos);
      });
      b.count = list.length;
      b.instanceMatrix.needsUpdate = true;
    }
    const mm = mines.current;
    const ml = lights.current;
    if (mm && ml) {
      const list = s.mines.slice(0, MAX_MINES);
      list.forEach((mine, i) => {
        q.identity();
        m.compose(pos.set(mine.pos.x, 0.04, mine.pos.z), q, scale.set(1, 1, 1));
        mm.setMatrixAt(i, m);
        const remaining = MINE.fuse - mine.age;
        const rate = remaining < 2.5 ? 8 : 2;
        const on = mine.age > MINE.arm && Math.sin(mine.age * rate * Math.PI) > 0;
        m.compose(pos.set(mine.pos.x, 0.1, mine.pos.z), q, scale.setScalar(on ? 1 : 0.001));
        ml.setMatrixAt(i, m);
      });
      mm.count = ml.count = list.length;
      mm.instanceMatrix.needsUpdate = ml.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={bullets} args={[shell, undefined, MAX_BULLETS]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#e8e2d4" roughness={0.3} metalness={0.4} />
      </instancedMesh>
      <instancedMesh ref={mines} args={[undefined, undefined, MAX_MINES]} castShadow receiveShadow frustumCulled={false}>
        <cylinderGeometry args={[0.2, 0.22, 0.08, 20]} />
        <meshStandardMaterial color="#c9a23a" roughness={0.6} metalness={0.2} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[undefined, undefined, MAX_MINES]} frustumCulled={false}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshBasicMaterial color="#ff4a3a" toneMapped={false} />
      </instancedMesh>
    </>
  );
}
