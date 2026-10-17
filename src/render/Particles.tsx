import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Euler, Matrix4, Quaternion, Vector3, type InstancedMesh, type PointLight } from 'three';
import { POOL_SIZE, POP_MARKS, TRACK_MARKS, type Effects, type ParticleKind } from './effects';
import { makePopMarkTexture } from './textures';

const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const scale = new Vector3();

function particleScale(kind: ParticleKind, t: number, size: number): number {
  if (kind === 'puff') return size * (0.6 + t * 1.6) * Math.sqrt(1 - t);
  if (kind === 'fire') return size * (1 - t);
  return t < 0.8 ? size : size * (1 - (t - 0.8) / 0.2);
}

export function Particles({ effects }: { effects: Effects }) {
  const meshes = {
    puff: useRef<InstancedMesh>(null),
    shard: useRef<InstancedMesh>(null),
    fire: useRef<InstancedMesh>(null),
  };
  const tracks = useRef<InstancedMesh>(null);
  const marks = useRef<InstancedMesh>(null);
  const light = useRef<PointLight>(null);
  const popTexture = useMemo(() => makePopMarkTexture(), []);

  useFrame((_, dt) => {
    effects.update(dt);
    for (const kind of Object.keys(meshes) as ParticleKind[]) {
      const mesh = meshes[kind].current;
      if (!mesh) continue;
      const list = effects.particles[kind];
      list.forEach((p, i) => {
        const s = particleScale(kind, p.age / p.life, p.size);
        q.setFromEuler(e.set(p.rx, p.ry, p.rz));
        m.compose(pos.set(p.x, p.y, p.z), q, scale.set(s, s, s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, p.color);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const tm = tracks.current;
    if (tm) {
      effects.tracks.forEach((t, i) => {
        q.setFromEuler(e.set(-Math.PI / 2, 0, t.angle));
        m.compose(pos.set(t.x, 0.004, t.z), q, scale.set(1, 1, 1));
        tm.setMatrixAt(i, m);
      });
      tm.count = effects.tracks.length;
      tm.instanceMatrix.needsUpdate = true;
    }
    const pm = marks.current;
    if (pm) {
      effects.popMarks.forEach((t, i) => {
        q.setFromEuler(e.set(-Math.PI / 2, 0, t.angle));
        m.compose(pos.set(t.x, 0.006, t.z), q, scale.set(1, 1, 1));
        pm.setMatrixAt(i, m);
      });
      pm.count = effects.popMarks.length;
      pm.instanceMatrix.needsUpdate = true;
    }
    if (light.current) {
      light.current.intensity = effects.flash * 30;
      light.current.position.set(effects.flashPos.x, 1, effects.flashPos.z);
    }
  });

  return (
    <>
      <instancedMesh ref={meshes.puff} args={[undefined, undefined, POOL_SIZE.puff]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={1} transparent opacity={0.8} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={meshes.shard} args={[undefined, undefined, POOL_SIZE.shard]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.14, 0.012, 0.09]} />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={meshes.fire} args={[undefined, undefined, POOL_SIZE.fire]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={tracks} args={[undefined, undefined, TRACK_MARKS]} frustumCulled={false}>
        <planeGeometry args={[0.16, 0.08]} />
        <meshBasicMaterial color="#5a4630" transparent opacity={0.22} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={marks} args={[undefined, undefined, POP_MARKS]} frustumCulled={false}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial map={popTexture} transparent depthWrite={false} />
      </instancedMesh>
      <pointLight ref={light} color="#ffb060" distance={6} decay={1.5} intensity={0} />
    </>
  );
}
