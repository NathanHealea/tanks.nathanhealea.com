import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import type { Grid } from '../game/types';
import type { Effects } from './effects';

const PITCH = (58 * Math.PI) / 180;
const MARGIN = 1.6;
// Screen pixels kept clear above the board for the HUD's top bar.
export const TOP_RESERVE = 56;
// Top edge of the far wall of the arena frame (see Arena.tsx).
const FRAME_TOP_Y = 0.9;
const FRAME_DEPTH = 0.6;

interface Props {
  grid: Grid;
  effects: Effects;
  /** Called with the board's top edge in page pixels whenever the layout changes. */
  onBoardTop: (y: number) => void;
}

/**
 * Fixed three-quarter camera, pulled back far enough that the whole arena fits any aspect ratio,
 * with the picture nudged down so TOP_RESERVE pixels stay free above the board.
 */
export function CameraRig({ grid, effects, onBoardTop }: Props) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const home = useRef(new Vector3());
  const look = useRef(new Vector3(0, 0, 0.4));

  useLayoutEffect(() => {
    const aspect = size.width / size.height;
    const halfFov = (camera.fov * Math.PI) / 360;
    const reserve = Math.min(TOP_RESERVE, size.height * 0.25);
    const usable = (size.height - reserve) / size.height;
    const w = grid.cols + MARGIN * 2;
    const d = grid.rows + MARGIN * 2;
    // Ground depth foreshortens by sin(pitch); the extra factor covers perspective stretch at the near edge.
    const byWidth = w / 2 / (Math.tan(halfFov) * aspect);
    const byDepth = ((d * Math.sin(PITCH)) / 2 / Math.tan(halfFov)) * 1.08 / usable;
    const dist = Math.max(byWidth, byDepth);
    home.current.set(0, Math.sin(PITCH) * dist, Math.cos(PITCH) * dist + look.current.z);
    camera.position.copy(home.current);
    camera.lookAt(look.current);
    // Shifting the view window up by half the reserve moves the picture down by the same amount.
    camera.setViewOffset(size.width, size.height, 0, -reserve / 2, size.width, size.height);
    camera.updateMatrixWorld();
    const edge = new Vector3(0, FRAME_TOP_Y, -grid.rows / 2 - FRAME_DEPTH).project(camera);
    onBoardTop(size.top + ((1 - edge.y) / 2) * size.height);
  }, [camera, size, grid, onBoardTop]);

  useFrame(() => {
    const s = effects.shake * effects.shake * 0.25;
    camera.position.set(
      home.current.x + (Math.random() - 0.5) * s,
      home.current.y + (Math.random() - 0.5) * s,
      home.current.z + (Math.random() - 0.5) * s,
    );
  });

  return null;
}
