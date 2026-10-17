import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Matrix4, type InstancedMesh, type Mesh } from 'three';
import { BULLET, TANK } from '../game/config';
import type { TankState } from '../game/types';
import { controls } from '../input/controls';

const MAX_DOTS = 40;
const SPACING = 0.38;
const m = new Matrix4();

/** Dotted line from the barrel toward the cursor, plus a ring where the cursor is. */
export function AimLine({ getTank }: { getTank: () => TankState | undefined }) {
  const dots = useRef<InstancedMesh>(null);
  const ring = useRef<Mesh>(null);

  useFrame(() => {
    const d = dots.current;
    const r = ring.current;
    if (!d || !r) return;
    const tank = getTank();
    const target = controls.aimPoint;
    const show = !!tank?.alive && !!target && controls.pointerActive && controls.aimSource === 'pointer';
    r.visible = show;
    if (!show || !tank || !target) {
      d.count = 0;
      return;
    }
    r.position.set(target.x, BULLET.height, target.z);
    const sx = Math.sin(tank.turret);
    const sz = Math.cos(tank.turret);
    const length = Math.hypot(target.x - tank.pos.x, target.z - tank.pos.z) - TANK.muzzle;
    const n = Math.max(0, Math.min(MAX_DOTS, Math.floor(length / SPACING)));
    for (let i = 0; i < n; i++) {
      const k = TANK.muzzle + (i + 0.5) * SPACING;
      d.setMatrixAt(i, m.makeTranslation(tank.pos.x + sx * k, BULLET.height, tank.pos.z + sz * k));
    }
    d.count = n;
    d.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={dots} args={[undefined, undefined, MAX_DOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.16, 0.22, 28]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.75} depthWrite={false} />
      </mesh>
    </>
  );
}
