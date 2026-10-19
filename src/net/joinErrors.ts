import { ConvexError } from 'convex/values';

export type JoinError = 'CODE_NOT_FOUND' | 'CODE_EXPIRED' | 'MATCH_FULL' | 'OWN_CODE' | 'ALREADY_IN_MATCH' | 'UNKNOWN';

const KNOWN: readonly string[] = ['CODE_NOT_FOUND', 'CODE_EXPIRED', 'MATCH_FULL', 'OWN_CODE', 'ALREADY_IN_MATCH'];

/** The reason joinPrivate refused, for the join screen to explain. Only the server's ConvexError data counts. */
export function joinErrorOf(err: unknown): JoinError {
  if (err instanceof ConvexError && typeof err.data === 'string' && KNOWN.includes(err.data)) {
    return err.data as JoinError;
  }
  return 'UNKNOWN';
}
