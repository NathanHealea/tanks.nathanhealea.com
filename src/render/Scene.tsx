import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { BULLET, OUTCOME_DELAY } from '../game/config';
import type { GameSession } from '../game/session';
import type { GameState } from '../game/types';
import { clearActions, controls, readInput } from '../input/controls';
import { AimLine } from './AimLine';
import { Arena } from './Arena';
import { CameraRig } from './CameraRig';
import type { Effects } from './effects';
import { Particles } from './Particles';
import { Projectiles } from './Projectiles';
import { Tank } from './Tank';

export const LOCAL_PLAYER = 'p1';
const HUD_INTERVAL = 0.1;

export interface HudSnapshot {
  shots: number;
  mines: number;
  shotReload: number;
  mineReload: number;
  enemiesLeft: number;
}

interface Props {
  session: GameSession;
  effects: Effects;
  paused: boolean;
  onHud: (hud: HudSnapshot) => void;
  onOutcome: (outcome: NonNullable<GameState['outcome']>) => void;
  onBoardTop: (y: number) => void;
}

const aimPlane = new Plane(new Vector3(0, 1, 0), -BULLET.height);
const raycaster = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();

function hudOf(s: GameState, localPlayerId: string): HudSnapshot {
  const me = s.tanks.find((t) => t.id === localPlayerId);
  return {
    shots: me?.shots ?? 0,
    mines: me?.mines ?? 0,
    shotReload: me && me.shots === 0 ? Math.max(0, me.shotReload) : 0,
    mineReload: me && me.mines === 0 ? Math.max(0, me.mineReload) : 0,
    enemiesLeft: s.tanks.filter((t) => t.team === 1 && t.alive).length,
  };
}

function GameLoop({ session, effects, paused, onHud, onOutcome, onWallsChanged }: Props & { onWallsChanged: () => void }) {
  const hudClock = useRef(0);
  const reported = useRef(false);

  useFrame(({ camera }, dt) => {
    if (paused) return;
    const s = session.state;
    if (controls.pointerActive) {
      raycaster.setFromCamera(ndc.set(controls.pointerNdc.x, controls.pointerNdc.y), camera);
      if (raycaster.ray.intersectPlane(aimPlane, hit)) controls.aimPoint = { x: hit.x, z: hit.z };
    }
    const me = s.tanks.find((t) => t.id === session.localPlayerId);
    const input = readInput(me, dt);
    const events = session.advance(dt, input);
    if (session.ticksLastAdvance > 0) clearActions();
    effects.handle(events);
    if (events.some((e) => e.type === 'wallBreak')) onWallsChanged();

    hudClock.current += dt;
    if (hudClock.current >= HUD_INTERVAL || events.length > 0) {
      hudClock.current = 0;
      onHud(hudOf(s, session.localPlayerId));
    }
    if (s.outcome && !reported.current && s.time - s.outcomeTime >= OUTCOME_DELAY) {
      reported.current = true;
      onOutcome(s.outcome);
    }
  });
  return null;
}

function World(props: Props) {
  const { session, effects } = props;
  const [wallVersion, setWallVersion] = useState(0);
  const getState = () => session.state;
  const getMe = () => session.state.tanks.find((t) => t.id === session.localPlayerId);

  return (
    <>
      <CameraRig grid={session.state.grid} effects={effects} onBoardTop={props.onBoardTop} />
      <Arena grid={session.state.grid} version={wallVersion} />
      {session.state.tanks.map((t) => (
        <Tank key={t.id} tank={t} effects={effects} />
      ))}
      <Projectiles getState={getState} effects={effects} />
      <Particles effects={effects} />
      <AimLine getTank={getMe} />
      <GameLoop {...props} onWallsChanged={() => setWallVersion((v) => v + 1)} />
    </>
  );
}

/** The canvas outlives levels; the world inside it remounts per session so per-level refs start clean. */
export function Scene(props: Props & { sessionKey: number }) {
  const { sessionKey, ...rest } = props;
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 30, near: 0.5, far: 200 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      aria-label="Battlefield"
    >
      <color attach="background" args={['#2b2620']} />
      <hemisphereLight args={['#fff4e2', '#5a4a3a', 1.1]} />
      <directionalLight
        position={[-6, 14, 8]}
        intensity={2.2}
        color="#fff1dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <World key={sessionKey} {...rest} />
    </Canvas>
  );
}
