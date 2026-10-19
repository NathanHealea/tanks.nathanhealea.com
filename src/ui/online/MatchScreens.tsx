import { TANK } from '../../game/config';
import { TANK_STATS } from '../../game/tanks';
import type { PeerErrorCode } from '../../net/peer';
import type { HudSnapshot } from '../../render/Scene';
import { Pips } from '../Hud';
import { Card } from './OnlineScreens';
import type { EndReason } from './flow';
import { colorName, connectFailedMessage, endedText, linkLostText, matchResultText, roundResultText, scoreText } from './messages';

const TOP_BAR_HEIGHT = 44;
const TOP_BAR_GAP = 6;

export function Connecting({ onCancel }: { onCancel(): void }) {
  return (
    <Card title="Connecting to your opponent">
      <p>This takes a few seconds.</p>
      <button type="button" className="secondary" onClick={onCancel} autoFocus>
        Cancel
      </button>
    </Card>
  );
}

export function ConnectFailed({ reason, onBack }: { reason: PeerErrorCode; onBack(): void }) {
  return (
    <Card title="Couldn't connect">
      <p>{connectFailedMessage(reason)}</p>
      <button type="button" className="primary" onClick={onBack} autoFocus>
        Back to online menu
      </button>
    </Card>
  );
}

/** Not a dialog: the arena stays visible and playable underneath, and focus stays with the game. */
export function Countdown(props: { round: number; secondsLeft: number; lastResult: 'won' | 'lost' | 'draw' | null }) {
  return (
    <div className="countdown" aria-hidden="true">
      {props.lastResult && <p className="countdown-result">{roundResultText(props.lastResult)}</p>}
      <p className="countdown-round">Round {props.round}</p>
      <p className="countdown-number">{Math.max(1, Math.ceil(props.secondsLeft))}</p>
    </div>
  );
}

export function Ended({ reason, onBack }: { reason: EndReason; onBack(): void }) {
  return (
    <Card title={endedText(reason)}>
      <button type="button" className="primary" onClick={onBack} autoFocus>
        Back to online menu
      </button>
    </Card>
  );
}

/** Over the arena, not a dialog: play may resume at any moment. Announced once on appearing, not every second. */
export function LinkLostBanner({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div className="link-lost panel" aria-hidden="true">
      {linkLostText(secondsLeft)}
    </div>
  );
}

export function MatchResult(props: {
  won: boolean;
  you: number;
  them: number;
  rematch: 'none' | 'waiting';
  error: string | null;
  onRematch(): void;
  onCancelRematch(): void;
  onMenu(): void;
}) {
  return (
    <Card title={matchResultText(props.won, props.you, props.them)}>
      {props.error && <p className="error-text">{props.error}</p>}
      {props.rematch === 'waiting' ? (
        <>
          <p>Waiting for your opponent…</p>
          <div className="button-column">
            <button type="button" className="secondary" onClick={props.onCancelRematch} autoFocus>
              Cancel rematch
            </button>
            <button type="button" className="secondary" onClick={props.onMenu}>
              Main menu
            </button>
          </div>
        </>
      ) : (
        <div className="button-column">
          <button type="button" className="primary" onClick={props.onRematch} autoFocus>
            Rematch
          </button>
          <button type="button" className="secondary" onClick={props.onMenu}>
            Main menu
          </button>
        </div>
      )}
    </Card>
  );
}

export function LeaveConfirm({ onStay, onLeave }: { onStay(): void; onLeave(): void }) {
  return (
    <Card title="Leave match?">
      <p>Leaving counts as a loss. The match keeps running until you choose.</p>
      <div className="button-column">
        <button type="button" className="primary" onClick={onStay} autoFocus>
          Stay
        </button>
        <button type="button" className="secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </Card>
  );
}

/** The match HUD: round, score and which tank is yours by name, so identity never rests on color alone. */
export function PvpHud(props: {
  hud: HudSnapshot;
  round: number;
  you: number;
  them: number;
  localPlayerId: 'p1' | 'p2';
  muted: boolean;
  inert: boolean;
  boardTop: number;
  onMenu(): void;
  onToggleMute(): void;
}) {
  return (
    <div className="hud" inert={props.inert}>
      <div className="hud-top" style={{ top: `max(env(safe-area-inset-top), ${props.boardTop - TOP_BAR_HEIGHT - TOP_BAR_GAP}px)` }}>
        <div className="panel">
          Round {props.round} · {scoreText(props.you, props.them)} · You are {colorName(props.localPlayerId)}, ringed
        </div>
        <div className="hud-buttons">
          <button type="button" className="panel button-small" onClick={props.onToggleMute} aria-pressed={props.muted}>
            {props.muted ? 'Sound off' : 'Sound on'}
          </button>
          <button type="button" className="panel button-small" onClick={props.onMenu}>
            Menu
          </button>
        </div>
      </div>
      <div className="hud-bottom panel">
        <Pips label="Shells" have={props.hud.shots} max={TANK_STATS.player.maxShots} reload={props.hud.shotReload} reloadTotal={TANK.shotReload} />
        <Pips label="Mines" have={props.hud.mines} max={TANK_STATS.player.maxMines} reload={props.hud.mineReload} reloadTotal={TANK.mineReload} />
      </div>
    </div>
  );
}
