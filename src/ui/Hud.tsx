import { TANK } from '../game/config';
import { TANK_STATS } from '../game/tanks';
import type { HudSnapshot } from '../render/Scene';

const TOP_BAR_HEIGHT = 44;
const TOP_BAR_GAP = 6;

interface Props {
  hud: HudSnapshot;
  level: number;
  levelCount: number;
  lives: number;
  muted: boolean;
  /** Page y of the board's top edge; the top bar sits just above it. */
  boardTop: number;
  onPause: () => void;
  onToggleMute: () => void;
}

export function Pips({ label, have, max, reload, reloadTotal }: { label: string; have: number; max: number; reload: number; reloadTotal: number }) {
  const reloading = have === 0 && reload > 0;
  return (
    <div className="ammo" aria-label={reloading ? `${label}: reloading` : `${label}: ${have} of ${max}`}>
      <span className="ammo-label">{label}</span>
      {reloading ? (
        <span className="reload-bar">
          <span className="reload-fill" style={{ width: `${(1 - reload / reloadTotal) * 100}%` }} />
        </span>
      ) : (
        <span className="pips">
          {Array.from({ length: max }, (_, i) => (
            <span key={i} className={i < have ? 'pip full' : 'pip'} />
          ))}
        </span>
      )}
    </div>
  );
}

export function Hud({ hud, level, levelCount, lives, muted, boardTop, onPause, onToggleMute }: Props) {
  return (
    <div className="hud">
      <div className="hud-top" style={{ top: `max(env(safe-area-inset-top), ${boardTop - TOP_BAR_HEIGHT - TOP_BAR_GAP}px)` }}>
        <div className="panel">
          Level {level + 1}/{levelCount} · Lives {lives} · Enemies {hud.enemiesLeft}
        </div>
        <div className="hud-buttons">
          <button type="button" className="panel button-small" onClick={onToggleMute} aria-pressed={muted}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button type="button" className="panel button-small" onClick={onPause}>
            Pause
          </button>
        </div>
      </div>
      <div className="hud-bottom panel">
        <Pips label="Shells" have={hud.shots} max={TANK_STATS.player.maxShots} reload={hud.shotReload} reloadTotal={TANK.shotReload} />
        <Pips label="Mines" have={hud.mines} max={TANK_STATS.player.maxMines} reload={hud.mineReload} reloadTotal={TANK.mineReload} />
      </div>
    </div>
  );
}
