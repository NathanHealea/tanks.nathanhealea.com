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
import { LinkWatch, type LinkHealth } from '../../net/silence';
import { usePrivateMatch } from '../../net/usePrivateMatch';
import { useQuickMatch } from '../../net/useQuickMatch';
import { leaveWhenHidden } from '../../net/visibility';
import type { HudSnapshot } from '../../render/Scene';
import { TouchControls } from '../TouchControls';
import { initialScreen, reduce, type OnlineAction, type OnlineEffect, type OnlineScreen } from './flow';
import { Connecting, ConnectFailed, Countdown, Ended, LeaveConfirm, LinkLostBanner, MatchResult, PvpHud } from './MatchScreens';
import { endedText, linkLostText, rematchErrorMessage, roundResultText, scoreText } from './messages';
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

const MATCH_BEAT_MS = 5000;
// A waiting code beats less often: it only has to outlive a closed tab by less than its 10-minute expiry (R9).
const WAITING_BEAT_MS = 10_000;
// reportLost is usually called by the player whose network failed, and Convex queues mutations while offline, so the
// answer may never come; after this long the match is shown as having no result.
const REPORT_WAIT_MS = 5000;
// After a bye the leaver's own leave usually lands within a second. If it never does, the leaver's presence has gone
// stale by this point (last beat up to 5 s before, stale after 15 s), so reportLost gives the remaining player the win.
const BYE_SETTLE_MS = 21_000;
const LIVE_SCREENS = ['privateWaiting', 'connecting', 'countdown', 'playing', 'roundResult'];

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
  const [linkHealth, setLinkHealth] = useState<LinkHealth>({ state: 'ok' });
  const healthRef = useRef<LinkHealth>({ state: 'ok' });
  const watchRef = useRef<LinkWatch | null>(null);
  const byeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The match being played, so its end can be read from the server once myMatch stops reporting it.
  const liveMatch = useRef<{ id: Id<'matches'>; role: 'host' | 'guest' } | null>(null);
  const settledMatch = useRef<Id<'matches'> | null>(null);
  // myMatch reports only an active match, so this is exactly the match to leave on Leave or when the page goes.
  const activeMatchId = useRef<Id<'matches'> | null>(null);
  activeMatchId.current = priv.match?.id ?? null;
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

  const stopWatch = useCallback(() => {
    if (byeTimer.current !== null) clearTimeout(byeTimer.current);
    byeTimer.current = null;
    watchRef.current?.dispose();
    watchRef.current = null;
    healthRef.current = { state: 'ok' };
    setLinkHealth({ state: 'ok' });
  }, []);

  const endConnection = useCallback(() => {
    stopWatch();
    liveMatch.current = null;
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
    pendingResult.current = null;
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
        stopWatch();
        dispatch({ type: 'matchEnd', you, them });
        sessionRef.current = null;
        props.onSession(null);
      } else {
        pendingResult.current = `${roundResultText(outcome)}. ${scoreText(you, them)}.`;
        dispatch({ type: 'roundEnd', round, outcome, you, them });
      }
    };
    // Released in dispose, before a rematch closes this link, so its close is not taken for a lost connection.
    // Once play has started a close is left to the watch: the opponent may have left, or only the link may have died,
    // and only Convex can tell which.
    const offClose = link.onClose(() => {
      if (screenRef.current.name === 'connecting') {
        announce('Connection to your opponent was lost.');
        endConnection();
        dispatch({ type: 'connectFailed', reason: 'CONNECT_FAILED' });
      }
    });
    watchRef.current = new LinkWatch(link, {
      onHealth: (health) => {
        const was = healthRef.current.state;
        healthRef.current = health;
        setLinkHealth(health);
        if (health.state === 'lost' && was === 'ok') announce(linkLostText(health.secondsLeft));
        if (health.state === 'ok' && was === 'lost') announce('Connection restored.');
      },
      onLost: () => settleLostLink(match.id, match.role),
      // A bye is the peer's word only, so the win waits for the server: the leaver's own leave, seen through myMatch,
      // or failing that a report once the leaver's presence has gone stale. Silence from here on is expected.
      onBye: () => {
        watchRef.current?.dispose();
        watchRef.current = null;
        byeTimer.current = setTimeout(() => settleLostLink(match.id, match.role), BYE_SETTLE_MS);
      },
    });
    liveMatch.current = { id: match.id, role: match.role };
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

  /** Shows how the server recorded the match's end; resolves false while it is still in play. */
  async function showOutcome(matchId: Id<'matches'>, role: 'host' | 'guest'): Promise<boolean> {
    const outcome = await convex.query(api.matches.matchOutcome, { playerId: me, matchId });
    if (outcome.status === 'playing' || outcome.status === 'connecting' || outcome.status === 'waiting') return false;
    settledMatch.current = matchId;
    stopWatch();
    if (outcome.endReason === 'score') {
      const [you, them] = role === 'host' ? [outcome.hostScore, outcome.guestScore] : [outcome.guestScore, outcome.hostScore];
      dispatch({ type: 'matchEnd', you, them });
    } else if (outcome.endReason === 'left' && outcome.winner === role) {
      dispatch({ type: 'opponentLeft' });
    } else {
      dispatch({ type: 'linkLost', result: outcome.winner === undefined || outcome.winner === null ? 'none' : outcome.winner === role ? 'won' : 'lost' });
    }
    return true;
  }

  function settleLostLink(matchId: Id<'matches'>, role: 'host' | 'guest') {
    healthRef.current = { state: 'ok' };
    setLinkHealth({ state: 'ok' });
    const giveUp = setTimeout(() => dispatch({ type: 'linkLost', result: 'none' }), REPORT_WAIT_MS);
    convex
      .mutation(api.matches.reportLost, { playerId: me, matchId })
      .then(() => showOutcome(matchId, role))
      .catch((err) => {
        console.error('Reporting the lost connection failed', err);
        dispatch({ type: 'linkLost', result: 'none' });
      })
      .finally(() => clearTimeout(giveUp));
  }

  function leaveOnServer() {
    watchRef.current?.bye();
    const id = activeMatchId.current;
    if (!id) return;
    convex.mutation(api.matches.leave, { playerId: me, matchId: id }).catch((err) => {
      console.error('Leaving the match failed', err);
    });
  }

  function newCode() {
    lastCode.current = {};
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
        leaveOnServer();
        endConnection();
        break;
      case 'endLink':
        endConnection();
        break;
    }
  }
  runEffectRef.current = runEffect;
  const leaveOnServerRef = useRef(leaveOnServer);
  leaveOnServerRef.current = leaveOnServer;

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
  // Keyed to the expiry time it was raised for: after Make a new code, the old match is still reported until the new
  // one lands, and its 0:00 must not expire the code on its way.
  const expiredAt = useRef<number | null>(null);
  const expire = useCallback(
    (at: number) => {
      if (expiredAt.current === at) return;
      expiredAt.current = at;
      setCodeExpired(true);
      announce('Your match code has expired.');
    },
    [announce],
  );

  useEffect(() => {
    if (screen.name !== 'privateWaiting' || priv.match) return;
    const { expiresAt } = lastCode.current;
    if (expiresAt !== undefined && Date.now() > expiresAt) expire(expiresAt);
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
    if (screen.name === 'ended') announce(endedText(screen.reason));
  }, [screen, announce]);

  useEffect(() => {
    if (!inMatch) return;
    return leaveWhenHidden(document, () => dispatch({ type: 'away' }));
  }, [inMatch, dispatch]);

  // The server took the match out of play (the opponent's leave landed, or the last round was recorded): show its
  // result now rather than waiting for the link to go quiet.
  useEffect(() => {
    const live = liveMatch.current;
    if (!live || !inMatch || priv.match?.id === live.id || settledMatch.current === live.id) return;
    settledMatch.current = live.id;
    showOutcome(live.id, live.role).catch((err) => console.error('Reading the match result failed', err));
  });

  // Presence for Convex: a match beats while connecting or playing, a host's waiting code less often. Only while the
  // player is still on those screens: beating from a result or the menu would keep a dead match alive.
  const onLiveScreen = LIVE_SCREENS.includes(screen.name);
  const beatMatch =
    onLiveScreen && priv.match && ['waiting', 'connecting', 'playing'].includes(priv.match.status) ? priv.match : null;
  const beatId = beatMatch?.id ?? null;
  const beatMs = beatMatch?.status === 'waiting' ? WAITING_BEAT_MS : MATCH_BEAT_MS;
  useEffect(() => {
    if (!beatId) return;
    const beat = () =>
      convex.mutation(api.matches.heartbeat, { playerId: me, matchId: beatId }).catch((err) => {
        console.error('Match heartbeat failed', err);
      });
    void beat();
    const timer = setInterval(beat, beatMs);
    return () => clearInterval(timer);
  }, [beatId, beatMs, convex, me]);

  // Best effort: the page may be gone before the request lands; the opponent's silence check is the real guarantee.
  useEffect(() => {
    const onHide = () => {
      if (LIVE_SCREENS.includes(screenRef.current.name)) leaveOnServerRef.current();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // A match that ends or drops with Leave match? open must not bring it back at the next match's countdown.
  useEffect(() => {
    if (!inMatch) setLeaveOpen(false);
  }, [inMatch]);

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
      {inMatch && linkHealth.state === 'lost' && <LinkLostBanner secondsLeft={linkHealth.secondsLeft} />}
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
      {screen.name === 'ended' && <Ended reason={screen.reason} onBack={() => dispatch({ type: 'back' })} />}
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
