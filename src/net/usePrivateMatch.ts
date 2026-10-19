import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import { playerId } from './identity';
import { joinErrorOf, type JoinError } from './joinErrors';

/** Private matches for the current page load. Needs a ConvexProvider above it. */
export function usePrivateMatch() {
  const id = playerId();
  const createMutation = useMutation(api.privateMatch.createPrivate);
  const joinMutation = useMutation(api.privateMatch.joinPrivate);
  const cancelMutation = useMutation(api.privateMatch.cancelPrivate);
  const match = useQuery(api.matchmaking.myMatch, { playerId: id });
  const [joinError, setJoinError] = useState<JoinError | null>(null);

  return {
    match: match ?? null,
    joinError,
    /** Also replaces the host's current code, so it doubles as "Make a new code". */
    create: () => createMutation({ playerId: id }),
    join: async (code: string) => {
      setJoinError(null);
      try {
        await joinMutation({ playerId: id, code });
      } catch (err) {
        const reason = joinErrorOf(err);
        if (reason === 'UNKNOWN') console.error('Joining a private match failed', err);
        setJoinError(reason);
      }
    },
    cancel: () => (match ? cancelMutation({ playerId: id, matchId: match.id }) : Promise.resolve(null)),
  };
}
