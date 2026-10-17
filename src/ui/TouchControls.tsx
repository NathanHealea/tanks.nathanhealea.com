import { useRef, useState, type PointerEvent } from 'react';
import { controls, setPointer } from '../input/controls';

const STICK_RADIUS = 56;

interface StickView {
  ox: number;
  oy: number;
  kx: number;
  ky: number;
}

/** Left half: floating move stick. Right half: touch to aim, lift to fire. Plus a mine button. */
export function TouchControls() {
  const stickId = useRef<number | null>(null);
  const aimId = useRef<number | null>(null);
  const [stick, setStick] = useState<StickView | null>(null);

  const stickDown = (e: PointerEvent<HTMLDivElement>) => {
    if (stickId.current !== null) return;
    stickId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStick({ ox: e.clientX, oy: e.clientY, kx: 0, ky: 0 });
  };
  const stickMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current || !stick) return;
    let dx = e.clientX - stick.ox;
    let dy = e.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    controls.stick = { x: dx / STICK_RADIUS, z: dy / STICK_RADIUS };
    setStick({ ...stick, kx: dx, ky: dy });
  };
  const stickUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    controls.stick = { x: 0, z: 0 };
    setStick(null);
  };

  const aimDown = (e: PointerEvent<HTMLDivElement>) => {
    if (aimId.current !== null) return;
    aimId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPointer(e.clientX, e.clientY);
  };
  const aimMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === aimId.current) setPointer(e.clientX, e.clientY);
  };
  const aimUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== aimId.current) return;
    aimId.current = null;
    controls.fireQueued = true;
    controls.pointerActive = false;
  };
  const aimCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== aimId.current) return;
    aimId.current = null;
    controls.pointerActive = false;
  };

  return (
    <div className="touch-layer">
      <div
        className="touch-zone touch-left"
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        {stick && (
          <div className="stick-base" style={{ left: stick.ox, top: stick.oy }}>
            <div className="stick-knob" style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
          </div>
        )}
      </div>
      <div
        className="touch-zone touch-right"
        onPointerDown={aimDown}
        onPointerMove={aimMove}
        onPointerUp={aimUp}
        onPointerCancel={aimCancel}
      />
      <button
        type="button"
        className="mine-button"
        aria-label="Drop mine"
        onPointerDown={(e) => {
          e.stopPropagation();
          controls.mineQueued = true;
        }}
      >
        Mine
      </button>
    </div>
  );
}
