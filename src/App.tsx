import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isMuted, setMuted, unlockAudio } from './audio/sound';
import { MAX_LIVES } from './game/config';
import { LEVEL_COUNT, newTankAt } from './game/levels';
import { LocalSession } from './game/session';
import { TANK_STATS } from './game/tanks';
import { bindDesktop, resetControls } from './input/controls';
import { Effects } from './render/effects';
import { LOCAL_PLAYER, Scene, type HudSnapshot } from './render/Scene';
import { Hud } from './ui/Hud';
import { TouchControls } from './ui/TouchControls';

type Screen = 'title' | 'playing' | 'paused' | 'popped' | 'cleared' | 'gameover' | 'victory';

const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function Overlay({ title, children, action, onAction }: { title: string; children?: ReactNode; action: string; onAction: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="overlay-title">
      <div className="overlay-card">
        <h1 id="overlay-title">{title}</h1>
        {children}
        <button type="button" className="primary" onClick={onAction} autoFocus>
          {action}
        </button>
      </div>
    </div>
  );
}

function NewTankNotice({ index }: { index: number }) {
  const kind = newTankAt(index);
  if (!kind) return null;
  const stats = TANK_STATS[kind];
  return (
    <p className="new-tank">
      <span className="swatch" style={{ background: stats.color }} aria-hidden="true" />
      New enemy next level: <strong>{stats.name}</strong>. {stats.blurb}
    </p>
  );
}

function ControlsHelp() {
  return isTouch ? (
    <ul className="help">
      <li>Drag on the left side to drive.</li>
      <li>Touch the right side to aim, lift to fire.</li>
      <li>Tap Mine to drop a mine.</li>
    </ul>
  ) : (
    <ul className="help">
      <li>
        <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> drive
      </li>
      <li>Mouse aims · left click or <kbd>Space</kbd> fires</li>
      <li>Right click or <kbd>F</kbd> drops a mine</li>
      <li>
        <kbd>←</kbd> <kbd>→</kbd> aim without a mouse · <kbd>Esc</kbd> pauses
      </li>
    </ul>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [level, setLevel] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [session, setSession] = useState(() => new LocalSession(0, [LOCAL_PLAYER], newSeed()));
  const [sessionKey, setSessionKey] = useState(0);
  const [hud, setHud] = useState<HudSnapshot>({ shots: 2, mines: 2, shotReload: 0, mineReload: 0, enemiesLeft: 0 });
  const [muted, setMutedState] = useState(isMuted());
  const [boardTop, setBoardTop] = useState(0);
  const effects = useMemo(() => new Effects(), []);
  const surface = useRef<HTMLDivElement>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const startLevel = useCallback(
    (index: number) => {
      unlockAudio();
      resetControls();
      effects.reset();
      setLevel(index);
      setSession(new LocalSession(index, [LOCAL_PLAYER], newSeed()));
      setSessionKey((k) => k + 1);
      setScreen('playing');
    },
    [effects],
  );

  const togglePause = useCallback(() => {
    if (screenRef.current === 'playing') setScreen('paused');
    else if (screenRef.current === 'paused') {
      resetControls();
      setScreen('playing');
    }
  }, []);

  useEffect(() => {
    if (!surface.current) return;
    return bindDesktop(surface.current, togglePause);
  }, [togglePause]);

  useEffect(() => {
    const onHide = () => {
      if (document.hidden && screenRef.current === 'playing') setScreen('paused');
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const onOutcome = useCallback(
    (outcome: 'won' | 'lost') => {
      if (outcome === 'won') {
        setScreen(level + 1 >= LEVEL_COUNT ? 'victory' : 'cleared');
        return;
      }
      const left = lives - 1;
      setLives(left);
      setScreen(left > 0 ? 'popped' : 'gameover');
    },
    [level, lives],
  );

  const restart = () => {
    setLives(MAX_LIVES);
    startLevel(0);
  };

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  const inGame = screen !== 'title';

  return (
    <div className="app">
      <div className="surface" ref={surface}>
        <Scene
          session={session}
          sessionKey={sessionKey}
          effects={effects}
          paused={screen !== 'playing'}
          onHud={setHud}
          onOutcome={onOutcome}
          onBoardTop={setBoardTop}
        />
      </div>
      {isTouch && screen === 'playing' && <TouchControls />}
      {inGame && (
        <Hud
          hud={hud}
          level={level}
          levelCount={LEVEL_COUNT}
          lives={lives}
          muted={muted}
          boardTop={boardTop}
          onPause={togglePause}
          onToggleMute={toggleMute}
        />
      )}

      {screen === 'title' && (
        <Overlay title="Tanks" action="Start" onAction={() => startLevel(0)}>
          <p>Pop every enemy tank. Shots bounce once. You carry two shells and two mines, then reload.</p>
          <ControlsHelp />
        </Overlay>
      )}
      {screen === 'paused' && (
        <Overlay title="Paused" action="Resume" onAction={togglePause}>
          <ControlsHelp />
        </Overlay>
      )}
      {screen === 'popped' && (
        <Overlay title="Popped!" action="Try again" onAction={() => startLevel(level)}>
          <p role="status">
            {lives} {lives === 1 ? 'life' : 'lives'} left.
          </p>
        </Overlay>
      )}
      {screen === 'cleared' && (
        <Overlay title={`Level ${level + 1} clear`} action="Next level" onAction={() => startLevel(level + 1)}>
          <NewTankNotice index={level + 1} />
        </Overlay>
      )}
      {screen === 'gameover' && (
        <Overlay title="Game over" action="Play again" onAction={restart}>
          <p role="status">You reached level {level + 1}.</p>
        </Overlay>
      )}
      {screen === 'victory' && (
        <Overlay title="All clear" action="Play again" onAction={restart}>
          <p role="status">Every tank popped, every level cleared.</p>
        </Overlay>
      )}
    </div>
  );
}
