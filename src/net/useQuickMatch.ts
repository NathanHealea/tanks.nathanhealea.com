import { useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { playerId } from './identity';
import { QuickMatch, type QuickMatchState } from './quickMatch';

/** Quick match for the current page load. Needs a ConvexProvider above it. */
export function useQuickMatch() {
  const id = playerId();
  const join = useMutation(api.matchmaking.joinQueue);
  const heartbeat = useMutation(api.matchmaking.queueHeartbeat);
  const leave = useMutation(api.matchmaking.leaveQueue);
  const match = useQuery(api.matchmaking.myMatch, { playerId: id });
  const [state, setState] = useState<QuickMatchState>('idle');

  const quick = useMemo(
    () =>
      new QuickMatch(
        {
          join: () => join({ playerId: id }),
          heartbeat: () => heartbeat({ playerId: id }),
          leave: () => leave({ playerId: id }),
        },
        setState,
      ),
    [id, join, heartbeat, leave],
  );

  useEffect(() => {
    if (match) quick.matched();
  }, [match, quick]);

  useEffect(() => {
    const onHide = () => quick.dispose();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      quick.dispose();
    };
  }, [quick]);

  return { state, match: match ?? null, start: () => quick.start(), cancel: () => quick.cancel() };
}
