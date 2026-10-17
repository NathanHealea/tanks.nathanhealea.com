import { useLayoutEffect, useMemo, useRef } from 'react';
import { Matrix4, type InstancedMesh } from 'three';
import { cellAt, cellCenter } from '../game/grid';
import { CORK, SOLID, type Grid } from '../game/types';
import { makeBlockTexture, makeCorkTexture, makeFloorTexture } from './textures';

const BLOCK_H = 0.9;
const FRAME = 0.6;

function Blocks({ grid, kind, version }: { grid: Grid; kind: typeof SOLID | typeof CORK; version: number }) {
  const ref = useRef<InstancedMesh>(null);
  const map = useMemo(() => (kind === SOLID ? makeBlockTexture() : makeCorkTexture()), [kind]);
  const max = grid.cols * grid.rows;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    let n = 0;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (cellAt(grid, c, r) !== kind) continue;
        const p = cellCenter(grid, c, r);
        mesh.setMatrixAt(n++, m.makeTranslation(p.x, BLOCK_H / 2, p.z));
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [grid, kind, version]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, max]} castShadow receiveShadow>
      <boxGeometry args={[1, BLOCK_H, 1]} />
      <meshStandardMaterial map={map} roughness={0.85} />
    </instancedMesh>
  );
}

export function Arena({ grid, version }: { grid: Grid; version: number }) {
  const floor = useMemo(() => {
    const t = makeFloorTexture();
    t.repeat.set(grid.cols / 4, grid.rows / 4);
    return t;
  }, [grid]);
  const w = grid.cols;
  const d = grid.rows;
  const frame: [number, number, number, number][] = [
    [0, -d / 2 - FRAME / 2, w + FRAME * 2, FRAME],
    [0, d / 2 + FRAME / 2, w + FRAME * 2, FRAME],
    [-w / 2 - FRAME / 2, 0, FRAME, d],
    [w / 2 + FRAME / 2, 0, FRAME, d],
  ];

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.6} receiveShadow>
        <planeGeometry args={[w * 4, d * 4]} />
        <meshStandardMaterial color="#3b332a" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={floor} roughness={0.9} />
      </mesh>
      {frame.map(([x, z, fw, fd], i) => (
        <mesh key={i} position={[x, BLOCK_H / 2 - 0.3, z]} castShadow receiveShadow>
          <boxGeometry args={[fw, BLOCK_H + 0.6, fd]} />
          <meshStandardMaterial color="#7a5a3c" roughness={0.8} />
        </mesh>
      ))}
      <Blocks grid={grid} kind={SOLID} version={version} />
      <Blocks grid={grid} kind={CORK} version={version} />
    </group>
  );
}
