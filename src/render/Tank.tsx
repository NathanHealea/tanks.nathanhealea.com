import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, type Group } from 'three';
import type { TankState } from '../game/types';
import type { Effects } from './effects';

const POP_INFLATE = 0.07;
const TRACK_SPACING = 0.22;

interface Props {
  tank: TankState;
  effects: Effects;
  /** Rings the local player's tank in a match, so which tank is yours never rests on color alone (WCAG 1.4.1). */
  marked?: boolean;
}

/** Built from primitives so it can be swapped for a glTF model later without touching the simulation. */
export function Tank({ tank, effects, marked = false }: Props) {
  const root = useRef<Group>(null);
  const turret = useRef<Group>(null);
  const deadFor = useRef(0);
  const lastMark = useRef({ x: tank.pos.x, z: tank.pos.z });
  const shades = useMemo(() => {
    const base = new Color(tank.color);
    return {
      base: tank.color,
      dark: base.clone().offsetHSL(0, -0.05, -0.12).getStyle(),
      light: base.clone().offsetHSL(0, -0.05, 0.08).getStyle(),
    };
  }, [tank.color]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g || !turret.current) return;
    g.position.set(tank.pos.x, 0, tank.pos.z);
    g.rotation.y = tank.body;
    turret.current.rotation.y = tank.turret - tank.body;
    if (tank.alive) {
      deadFor.current = 0;
      g.visible = true;
      g.scale.setScalar(1);
      const dx = tank.pos.x - lastMark.current.x;
      const dz = tank.pos.z - lastMark.current.z;
      if (dx * dx + dz * dz > TRACK_SPACING * TRACK_SPACING) {
        const sx = Math.cos(tank.body) * 0.3;
        const sz = -Math.sin(tank.body) * 0.3;
        effects.trackMark(tank.pos.x + sx, tank.pos.z + sz, tank.body);
        effects.trackMark(tank.pos.x - sx, tank.pos.z - sz, tank.body);
        lastMark.current = { x: tank.pos.x, z: tank.pos.z };
      }
      return;
    }
    deadFor.current += dt;
    const t = deadFor.current / POP_INFLATE;
    g.visible = t < 1;
    g.scale.set(1 + t * 0.3, 1 + t * 0.45, 1 + t * 0.3);
  });

  return (
    <group ref={root}>
      {marked && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.62, 0.74, 40]} />
          {/* Dark, because tanks only drive on the light plank floor: about 7.8:1 there (WCAG 1.4.11). */}
          <meshBasicMaterial color="#241f19" />
        </mesh>
      )}
      {[-0.3, 0.3].map((x) => (
        <group key={x} position={[x, 0.12, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.2, 0.22, 0.88]} />
            <meshStandardMaterial color="#3a3833" roughness={0.9} />
          </mesh>
          {[-0.3, -0.1, 0.1, 0.3].map((z) => (
            <mesh key={z} position={[x > 0 ? 0.105 : -0.105, 0, z]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.075, 0.075, 0.02, 12]} />
              <meshStandardMaterial color="#5b5850" roughness={0.6} metalness={0.2} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.58, 0.18, 0.8]} />
        <meshStandardMaterial color={shades.base} roughness={0.55} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.3, 0.42]} rotation-x={0.6} castShadow>
        <boxGeometry args={[0.56, 0.06, 0.16]} />
        <meshStandardMaterial color={shades.dark} roughness={0.6} />
      </mesh>
      <group ref={turret} position={[0, 0.37, -0.03]}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.23, 0.16, 20]} />
          <meshStandardMaterial color={shades.light} roughness={0.5} metalness={0.1} />
        </mesh>
        <mesh position={[0.06, 0.175, -0.05]}>
          <cylinderGeometry args={[0.07, 0.07, 0.03, 14]} />
          <meshStandardMaterial color={shades.dark} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.08, 0.38]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.48, 12]} />
          <meshStandardMaterial color={shades.dark} roughness={0.5} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.08, 0.62]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.062, 0.062, 0.06, 12]} />
          <meshStandardMaterial color="#2f2d29" roughness={0.5} metalness={0.3} />
        </mesh>
      </group>
    </group>
  );
}
