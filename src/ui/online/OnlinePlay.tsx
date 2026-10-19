import { useConvex } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { GameSession } from '../../game/session';
import type { PvpPlayer } from '../../game/types';
import { playerId } from '../../net/identity';
import type { Link } from '../../net/link';
import { GuestMatch, HostMatch } from '../../net/netMatch';
import { connectToOpponent } from '../../net/opponent';
import { PeerError } from '../../net/peer';
import { usePrivateMatch } from '../../net/usePrivateMatch';
import { useQuickMatch } from '../../net/useQuickMatch';
import type { HudSnapshot } from '../../render/Scene';
import { TouchControls } from '../TouchControls';
import { initialScreen, reduce, type OnlineAction, type OnlineEffect, type OnlineScreen } from './flow';
import { Connecting, ConnectFailed, Countdown, LeaveConfirm, MatchResult, PvpHud } from './MatchScreens';
import { rematchErrorMessage, roundResultText, scoreText } from './messages';
import { JoinWithCode, OnlineMenu, PrivateWaiting, SEARCH_FAILED, Searching, Unavailable } from './OnlineScreens';

const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

interface Props {
  joinCode: string | null;
  onExit(): void;
  onSession(session: GameSession | null): void;
  hud: HudSnapshot;
  boardTop: number;
  muted: boolean;
  onToggleMute(): void;
  registerEscape(handler: (() => void) | null): void;
}

type Outcome = 'won' | 'lost' | 'draw';

/**
 * Online play from the menu to the match result. The flow reducer decides the screens; this component runs the
 * server calls, the peer connection and the match, and reports each round's session to the App to render.
 */
export function OnlinePlay(props: Props) {
  const convex = useConvex();
  const quick = useQuickMatch();
  const priv = usePrivateMatch();
  const me = playerId();
  const [screen, setScreen] = useState<OnlineScreen>(() =>
    initialScreen({ hasBackend: true, online: navigator.onLine, joinCode: props.joinCode }),
  );
  const screenRef = useRef(screen);
  const [announcement, setAnnouncement] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [lastResult, setLastResult] = useState<Outcome | null>(null);
  const [score, setScore] = useState({ you: 0, them: 0 });
  const [error, setError] = useState<string | null>(null);
  const [localPlayer, setLocalPlayer] = useState<'p1' | 'p2'>('p1');
  const [codeExpired, setCodeExpired] = useState(false);
  const lastCode = useRef<{ code?: string; expiresAt?: number }>({});
  const matchRef = useRef<{ id: Id<'matches'>; link: Link | null; dispose(): void } | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const handledMatch = useRef<string | null>(null);
  const lastMatchId = useRef<Id<'matches'> | null>(null);

  // Setting the same text again changes nothing, so a repeat gets a trailing no-break space to be spoken again.
  const announce = useCallback(
    (message: string) => setAnnouncement((prev) => (prev === message ? `${message}\u00a0` : message)),
    [],
  );
  const showError = useCallback(
    (message: string) => {
      setError(message);
      announce(message);
    },
    [announce],
  );
  // The host starts the next round in the same task that ends the last one, so the result rides along with the
  // next round's announcement instead of being replaced by it before it is spoken.
  const pendingResult = useRef<string | null>(null);

  const endConnection = useCallback(() => {
    matchRef.current?.dispose();
    matchRef.current?.link?.close();
    matchRef.current = null;
    sessionRef.current = null;
    props.onSession(null);
  }, []);

  // dispatch is stable so effects and callbacks can hold it; it reaches this render's runEffect, and with it the
  // current priv and quick hooks, through a ref.
  const runEffectRef = useRef<(effect: OnlineEffect) => void>(() => {});
  const dispatch = useCallback(
    (action: OnlineAction) => {
      const { screen: next, effects } = reduce(screenRef.current, action);
      screenRef.current = next;
      setScreen(next);
      for (const effect of effects) runEffectRef.current(effect);
    },
    [],
  );

  const reportRound = (matchId: Id<'matches'>) => (round: number, result: PvpPlayer | null) =>
    convex.mutation(api.matches.reportRound, {
      playerId: me,
      matchId,
      round,
      // The host always plays p1.
      result: result === 'p1' ? 'host' : result === 'p2' ? 'guest' : null,
    });

  const connect = async () => {
    const match = priv.match;
    if (!match) return;
    // A rematch starts while the last match's link may still be open.
    endConnection();
    setScore({ you: 0, them: 0 });
    setLastResult(null);
    const link = await connectToOpponent({ convex, matchId: match.id, playerId: me, role: match.role }).catch((err) => {
      console.error('Connecting to the opponent failed', err);
      dispatch({ type: 'connectFailed', reason: err instanceof PeerError ? err.code : 'CONNECT_FAILED' });
      return null;
    });
    if (!link || screenRef.current.name !== 'connecting') {
      link?.close();
      return;
    }
    const onRound = (session: GameSession, round: number) => {
      sessionRef.current = session;
      props.onSession(session);
      setCountdown(session.countdownLeft);
      dispatch({ type: 'roundStart', round });
      const result = pendingResult.current ? `${pendingResult.current} ` : '';
      pendingResult.current = null;
      announce(`${result}Round ${round} starts in 3.`);
    };
    const endRound = (outcome: Outcome, you: number, them: number, round: number, over: boolean) => {
      setLastResult(outcome);
      setScore({ you, them });
      if (over) {
        dispatch({ type: 'matchEnd', you, them });
        sessionRef.current = null;
        props.onSession(null);
      } else {
        pendingResult.current = `${roundResultText(outcome)}. ${scoreText(you, them)}.`;
        dispatch({ type: 'roundEnd', round, outcome, you, them });
      }
    };
    // Released in dispose, before a rematch closes this link, so its close is not taken for a lost connection.
    const offClose = link.onClose(() => {
      if (['connecting', 'countdown', 'playing', 'roundResult'].includes(screenRef.current.name)) {
        announce('Connection to your opponent was lost.');
        endConnection();
        dispatch({ type: 'connectFailed', reason: 'CONNECT_FAILED' });
      }
    });
    if (match.role === 'host') {
      setLocalPlayer('p1');
      const host = new HostMatch(link, match.seed, {
        onRound,
        onRoundEnd: (round, result, s) =>
          endRound(result === null ? 'draw' : result === 'p1' ? 'won' : 'lost', s.wins.p1, s.wins.p2, round, s.winner !== null),
        onMatchEnd: () => {},
        reportRound: reportRound(match.id),
      });
      matchRef.current = {
        id: match.id,
        link,
        dispose: () => {
          offClose();
          host.dispose();
        },
      };
      host.start();
    } else {
      setLocalPlayer('p2');
      const guest = new GuestMatch(link, {
        onRound,
        onRoundEnd: (m) =>
          endRound(m.result === null ? 'draw' : m.result === 'p2' ? 'won' : 'lost', m.wins.p2, m.wins.p1, m.round, m.winner !== null),
        onMatchEnd: () => {},
      });
      matchRef.current = {
        id: match.id,
        link,
        dispose: () => {
          offClose();
          guest.dispose();
        },
      };
    }
  };

  function newCode() {
    lastCode.current = {};
    expiredRef.current = false;
    setCodeExpired(false);
    void priv.create();
  }

  function runEffect(effect: OnlineEffect) {
    setError(null);
    switch (effect.type) {
      case 'joinQueue':
        announce('Looking for an opponent.');
        void quick.start();
        break;
      case 'leaveQueue':
        void quick.cancel();
        break;
      case 'createPrivate':
        newCode();
        break;
      case 'cancelPrivate':
        void priv.cancel();
        break;
      case 'joinPrivate':
        void priv.join(effect.code);
        break;
      case 'connect':
        announce('Opponent found. Connecting.');
        void connect();
        break;
      case 'requestRematch': {
        const id = matchRef.current?.id ?? lastMatchId.current;
        if (!id) break;
        convex.mutation(api.matches.requestRematch, { playerId: me, matchId: id }).catch((err) => {
          console.error('Requesting a rematch failed', err);
          dispatch({ type: 'rematchFailed' });
          showError(rematchErrorMessage(err));
        });
        break;
      }
      case 'cancelRematch': {
        const id = matchRef.current?.id ?? lastMatchId.current;
        if (!id) break;
        convex.mutation(api.matches.cancelRematch, { playerId: me, matchId: id }).catch((err) => {
          console.error('Withdrawing a rematch request failed', err);
        });
        break;
      }
      case 'leaveMatch':
        endConnection();
        break;
    }
  }
  runEffectRef.current = runEffect;

  // The server reporting a connecting match is what moves every waiting screen on to connecting.
  useEffect(() => {
    const match = priv.match;
    if (match?.code) lastCode.current = { code: match.code, expiresAt: match.expiresAt };
    if (match?.status !== 'connecting' || handledMatch.current === match.id) return;
    handledMatch.current = match.id;
    lastMatchId.current = match.id;
    dispatch({ type: 'matched' });
  }, [priv.match, dispatch]);

  // The waiting screen's own timer reaching zero is the usual signal: myMatch filters on the time, but a query only
  // re-runs when its data changes, so it can keep reporting a code that has expired.
  const expiredRef = useRef(false);
  const expire = useCallback(() => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    setCodeExpired(true);
    announce('Your match code has expired.');
  }, [announce]);

  useEffect(() => {
    if (screen.name !== 'privateWaiting' || priv.match) return;
    const { expiresAt } = lastCode.current;
    if (expiresAt !== undefined && Date.now() > expiresAt) expire();
  }, [screen.name, priv.match, expire]);

  useEffect(() => {
    if (priv.joinError && screen.name === 'joining' && screen.busy) dispatch({ type: 'joinFailed', error: priv.joinError });
  }, [priv.joinError, screen, dispatch]);

  useEffect(() => {
    if (priv.createError) showError(priv.createError === 'ALREADY_IN_MATCH' ? "You're already in a match." : 'Making a code failed. Try again.');
  }, [priv.createError, showError]);

  useEffect(() => {
    if (quick.state === 'error' && screen.name === 'searching') announce(SEARCH_FAILED);
  }, [quick.state, screen.name, announce]);

  // The countdown is read from the session; when it ends, play starts on both screens.
  useEffect(() => {
    if (screen.name !== 'countdown') return;
    const timer = setInterval(() => {
      const left = sessionRef.current?.countdownLeft ?? 0;
      setCountdown(left);
      if (left <= 0) {
        announce('Go.');
        dispatch({ type: 'countdownDone' });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [screen.name, dispatch, announce]);

  useEffect(() => {
    if (screen.name === 'matchResult') announce(`${screen.won ? 'You win' : 'You lose'}, ${screen.you} to ${screen.them}.`);
  }, [screen, announce]);

  const inMatch = ['countdown', 'playing', 'roundResult'].includes(screen.name);

  useEffect(() => {
    props.registerEscape(() => {
      if (['countdown', 'playing', 'roundResult'].includes(screenRef.current.name)) toggleLeave();
    });
    return () => props.registerEscape(null);
  }, []);

  useEffect(() => () => endConnection(), [endConnection]);

  // aria-modal does not stop Tab, so the HUD behind Leave match? is made inert, and focus goes back where it was.
  // The opener is taken before opening because Stay's autoFocus moves focus before any effect runs.
  const leaveOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (leaveOpen) return;
    if (leaveOpener.current?.isConnected) leaveOpener.current.focus();
    leaveOpener.current = null;
  }, [leaveOpen]);

  function toggleLeave() {
    setLeaveOpen((open) => {
      if (!open) leaveOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return !open;
    });
  }

  const leave = () => {
    setLeaveOpen(false);
    dispatch({ type: 'leave' });
    announce('You left the match.');
  };

  const back = () => {
    endConnection();
    props.onExit();
  };

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {inMatch && (
        <PvpHud
          hud={props.hud}
          round={'round' in screen ? screen.round : 1}
          you={score.you}
          them={score.them}
          localPlayerId={localPlayer}
          muted={props.muted}
          inert={leaveOpen}
          boardTop={props.boardTop}
          onMenu={toggleLeave}
          onToggleMute={props.onToggleMute}
        />
      )}
      {isTouch && screen.name === 'playing' && !leaveOpen && <TouchControls />}

      {screen.name === 'menu' && (
        <OnlineMenu
          onQuick={() => dispatch({ type: 'quickMatch' })}
          onCreate={() => dispatch({ type: 'createPrivate' })}
          onJoin={() => dispatch({ type: 'openJoin' })}
          onBack={back}
        />
      )}
      {screen.name === 'unavailable' && <Unavailable reason={screen.reason} onBack={back} />}
      {screen.name === 'searching' && <Searching failed={quick.state === 'error'} onCancel={() => dispatch({ type: 'cancel' })} />}
      {screen.name === 'privateWaiting' && (
        <PrivateWaiting
          code={priv.match?.code ?? (codeExpired ? lastCode.current.code : undefined)}
          expiresAt={priv.match?.expiresAt}
          expired={codeExpired}
          onExpired={expire}
          error={error}
          onKeep={() => void priv.extend()}
          onNewCode={newCode}
          onCancel={() => dispatch({ type: 'cancel' })}
          announce={announce}
        />
      )}
      {screen.name === 'joining' && (
        <JoinWithCode
          initialCode={screen.code}
          fromLink={props.joinCode !== null && screen.code === props.joinCode}
          error={screen.error}
          busy={screen.busy}
          announce={announce}
          onSubmit={(code) => dispatch({ type: 'submitCode', code })}
          onBack={() => dispatch({ type: 'back' })}
        />
      )}
      {screen.name === 'connecting' && <Connecting onCancel={() => dispatch({ type: 'leave' })} />}
      {screen.name === 'connectFailed' && <ConnectFailed reason={screen.reason} onBack={() => dispatch({ type: 'back' })} />}
      {screen.name === 'countdown' && <Countdown round={screen.round} secondsLeft={countdown} lastResult={lastResult} />}
      {screen.name === 'matchResult' && (
        <MatchResult
          won={screen.won}
          you={screen.you}
          them={screen.them}
          rematch={screen.rematch}
          error={error}
          onRematch={() => dispatch({ type: 'requestRematch' })}
          onCancelRematch={() => dispatch({ type: 'cancelRematch' })}
          onMenu={() => dispatch({ type: 'back' })}
        />
      )}
      {leaveOpen && inMatch && <LeaveConfirm onStay={() => setLeaveOpen(false)} onLeave={leave} />}
    </>
  );
}
