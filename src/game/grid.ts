import { EMPTY, SOLID, type Cell, type Grid, type Vec2 } from './types';

export function cellAt(g: Grid, c: number, r: number): Cell {
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return SOLID;
  return g.cells[r * g.cols + c];
}

export function cellCenter(g: Grid, c: number, r: number): Vec2 {
  return { x: -g.cols / 2 + c + 0.5, z: -g.rows / 2 + r + 0.5 };
}

export function worldToCell(g: Grid, x: number, z: number): [number, number] {
  return [Math.floor(x + g.cols / 2), Math.floor(z + g.rows / 2)];
}

function cellRange(g: Grid, x: number, z: number, rad: number) {
  const [c0, r0] = worldToCell(g, x - rad, z - rad);
  const [c1, r1] = worldToCell(g, x + rad, z + rad);
  return { c0, r0, c1, r1 };
}

export function circleHitsSolid(g: Grid, x: number, z: number, rad: number): boolean {
  const { c0, r0, c1, r1 } = cellRange(g, x, z, rad);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (cellAt(g, c, r) === EMPTY) continue;
      const minX = -g.cols / 2 + c;
      const minZ = -g.rows / 2 + r;
      const px = Math.max(minX, Math.min(x, minX + 1));
      const pz = Math.max(minZ, Math.min(z, minZ + 1));
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz < rad * rad) return true;
    }
  }
  return false;
}

export function pushCircleOut(g: Grid, pos: Vec2, rad: number): void {
  const { c0, r0, c1, r1 } = cellRange(g, pos.x, pos.z, rad);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (cellAt(g, c, r) === EMPTY) continue;
      const minX = -g.cols / 2 + c;
      const minZ = -g.rows / 2 + r;
      const px = Math.max(minX, Math.min(pos.x, minX + 1));
      const pz = Math.max(minZ, Math.min(pos.z, minZ + 1));
      const dx = pos.x - px;
      const dz = pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rad * rad) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rad - d);
        pos.z += (dz / d) * (rad - d);
      } else {
        // Center is inside the cell: exit through the nearest face.
        const left = pos.x - minX;
        const right = minX + 1 - pos.x;
        const top = pos.z - minZ;
        const bottom = minZ + 1 - pos.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = minX - rad;
        else if (m === right) pos.x = minX + 1 + rad;
        else if (m === top) pos.z = minZ - rad;
        else pos.z = minZ + 1 + rad;
      }
    }
  }
}

export function lineOfSight(g: Grid, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const [c, r] = worldToCell(g, a.x + dx * t, a.z + dz * t);
    if (cellAt(g, c, r) !== EMPTY) return false;
  }
  return true;
}
