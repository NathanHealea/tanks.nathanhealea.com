import type { JoinError } from '../../net/joinErrors';
import type { PeerErrorCode } from '../../net/peer';

export type OnlineScreen =
  | { name: 'menu' }
  | { name: 'unavailable'; reason: 'no-backend' | 'offline' }
  | { name: 'searching' }
  | { name: 'privateWaiting' }
  | { name: 'joining'; code: string; error: JoinError | null; busy: boolean }
  | { name: 'connecting' }
  | { name: 'connectFailed'; reason: PeerErrorCode }
  | { name: 'countdown'; round: number }
  | { name: 'playing'; round: number }
  | { name: 'roundResult'; round: number; outcome: 'won' | 'lost' | 'draw'; you: number; them: number }
  | { name: 'matchResult'; won: boolean; you: number; them: number; rematch: 'none' | 'waiting' }
  | { name: 'ended'; reason: EndReason };

/** How a match ended other than by score. */
export type EndReason = 'opponentLeft' | 'opponentWon' | 'noResult' | 'away';

export type OnlineAction =
  | { type: 'quickMatch' }
  | { type: 'createPrivate' }
  | { type: 'openJoin'; code?: string }
  | { type: 'submitCode'; code: string }
  | { type: 'joinFailed'; error: JoinError }
  | { type: 'cancel' }
  | { type: 'back' }
  | { type: 'matched' }
  | { type: 'connectFailed'; reason: PeerErrorCode }
  | { type: 'roundStart'; round: number }
  | { type: 'countdownDone' }
  | { type: 'roundEnd'; round: number; outcome: 'won' | 'lost' | 'draw'; you: number; them: number }
  | { type: 'matchEnd'; you: number; them: number }
  | { type: 'requestRematch' }
  | { type: 'cancelRematch' }
  | { type: 'rematchFailed' }
  /** Leave match? → Leave: forfeits a live match. */
  | { type: 'leave' }
  | { type: 'opponentLeft' }
  /** The link went silent and Convex settled the match: won, lost, or no result. */
  | { type: 'linkLost'; result: 'won' | 'lost' | 'none' }
  /** This player's tab was hidden too long. */
  | { type: 'away' };

/** Server and connection work a transition asks the App to start; the reducer itself stays pure. */
export type OnlineEffect =
  | { type: 'joinQueue' }
  | { type: 'leaveQueue' }
  | { type: 'createPrivate' }
  | { type: 'cancelPrivate' }
  | { type: 'joinPrivate'; code: string }
  | { type: 'connect' }
  | { type: 'requestRematch' }
  | { type: 'cancelRematch' }
  /** This player leaves: the server is told. */
  | { type: 'leaveMatch' }
  /** The other player ended the match: only the connection is closed, since telling the server would forfeit it. */
  | { type: 'endLink' };

type Result = { screen: OnlineScreen; effects: OnlineEffect[] };

const go = (screen: OnlineScreen, ...effects: OnlineEffect[]): Result => ({ screen, effects });

/** The online screens as a state machine: every screen and the actions it accepts; anything else is ignored. */
export function reduce(screen: OnlineScreen, action: OnlineAction): Result {
  const same: Result = { screen, effects: [] };
  const live = ['connecting', 'countdown', 'playing', 'roundResult'].includes(screen.name);
  if (action.type === 'leave') return live ? go({ name: 'menu' }, { type: 'leaveMatch' }) : same;
  if (action.type === 'connectFailed' && live) return go({ name: 'connectFailed', reason: action.reason });
  const inMatch = live && screen.name !== 'connecting';
  if (inMatch && action.type === 'opponentLeft') return go({ name: 'ended', reason: 'opponentLeft' }, { type: 'endLink' });
  if (inMatch && action.type === 'linkLost') {
    const reason = action.result === 'won' ? 'opponentLeft' : action.result === 'lost' ? 'opponentWon' : 'noResult';
    return go({ name: 'ended', reason }, { type: 'endLink' });
  }
  if (inMatch && action.type === 'away') return go({ name: 'ended', reason: 'away' }, { type: 'leaveMatch' });
  switch (screen.name) {
    case 'menu':
      if (action.type === 'quickMatch') return go({ name: 'searching' }, { type: 'joinQueue' });
      if (action.type === 'createPrivate') return go({ name: 'privateWaiting' }, { type: 'createPrivate' });
      if (action.type === 'openJoin') return go({ name: 'joining', code: action.code ?? '', error: null, busy: false });
      return same;
    case 'searching':
      if (action.type === 'cancel') return go({ name: 'menu' }, { type: 'leaveQueue' });
      if (action.type === 'matched') return go({ name: 'connecting' }, { type: 'connect' });
      return same;
    case 'privateWaiting':
      if (action.type === 'cancel') return go({ name: 'menu' }, { type: 'cancelPrivate' });
      if (action.type === 'matched') return go({ name: 'connecting' }, { type: 'connect' });
      return same;
    case 'joining':
      if (action.type === 'submitCode') {
        return go({ ...screen, code: action.code, error: null, busy: true }, { type: 'joinPrivate', code: action.code });
      }
      if (action.type === 'joinFailed') return go({ ...screen, error: action.error, busy: false });
      if (action.type === 'cancel' || action.type === 'back') return go({ name: 'menu' });
      if (action.type === 'matched') return go({ name: 'connecting' }, { type: 'connect' });
      return same;
    case 'connecting':
      if (action.type === 'roundStart') return go({ name: 'countdown', round: action.round });
      return same;
    case 'connectFailed':
      return action.type === 'back' ? go({ name: 'menu' }) : same;
    case 'countdown':
      return action.type === 'countdownDone' ? go({ name: 'playing', round: screen.round }) : same;
    case 'playing':
      if (action.type === 'roundEnd') {
        const { round, outcome, you, them } = action;
        return go({ name: 'roundResult', round, outcome, you, them });
      }
      if (action.type === 'matchEnd') return go(matchResult(action.you, action.them));
      return same;
    case 'roundResult':
      if (action.type === 'roundStart') return go({ name: 'countdown', round: action.round });
      if (action.type === 'matchEnd') return go(matchResult(action.you, action.them));
      return same;
    case 'matchResult':
      if (action.type === 'requestRematch' && screen.rematch === 'none') {
        return go({ ...screen, rematch: 'waiting' }, { type: 'requestRematch' });
      }
      // The server refused the request, so there is nothing to withdraw.
      if (action.type === 'rematchFailed' && screen.rematch === 'waiting') return go({ ...screen, rematch: 'none' });
      if (action.type === 'cancelRematch' && screen.rematch === 'waiting') {
        return go({ ...screen, rematch: 'none' }, { type: 'cancelRematch' });
      }
      if (action.type === 'matched' && screen.rematch === 'waiting') return go({ name: 'connecting' }, { type: 'connect' });
      if (action.type === 'back' && screen.rematch === 'waiting') {
        return go({ name: 'menu' }, { type: 'cancelRematch' }, { type: 'leaveMatch' });
      }
      if (action.type === 'back') return go({ name: 'menu' }, { type: 'leaveMatch' });
      return same;
    case 'ended':
      return action.type === 'back' ? go({ name: 'menu' }) : same;
    case 'unavailable':
      return same;
  }
}

/**
 * Where the online flow opens. A join link only pre-fills the code: the player confirms, so a link preview that runs
 * the page cannot take the friend's guest slot.
 */
export function initialScreen(options: { hasBackend: boolean; online: boolean; joinCode: string | null }): OnlineScreen {
  if (!options.hasBackend) return { name: 'unavailable', reason: 'no-backend' };
  if (!options.online) return { name: 'unavailable', reason: 'offline' };
  if (options.joinCode) return { name: 'joining', code: options.joinCode, error: null, busy: false };
  return { name: 'menu' };
}

function matchResult(you: number, them: number): OnlineScreen {
  return { name: 'matchResult', won: you > them, you, them, rematch: 'none' };
}
