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
  const extendMutation = useMutation(api.privateMatch.extendPrivate);
  const match = useQuery(api.matchmaking.myMatch, { playerId: id });
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  const [createError, setCreateError] = useState<JoinError | null>(null);
  const hostWaiting = match?.role === 'host' && match.status === 'waiting' ? match : null;

  return {
    match: match ?? null,
    joinError,
    createError,
    /** Also replaces the host's current code, so it doubles as "Make a new code". */
    create: async () => {
      setCreateError(null);
      try {
        await createMutation({ playerId: id });
      } catch (err) {
        const reason = joinErrorOf(err);
        if (reason === 'UNKNOWN') console.error('Creating a private match failed', err);
        setCreateError(reason);
      }
    },
    /** "Keep this code": the same code works for another 10 minutes. */
    extend: () => (hostWaiting ? extendMutation({ playerId: id, matchId: hostWaiting.id }) : Promise.resolve(null)),
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
    cancel: () => (hostWaiting ? cancelMutation({ playerId: id, matchId: hostWaiting.id }) : Promise.resolve(null)),
  };
}
