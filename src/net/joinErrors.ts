import { ConvexError } from 'convex/values';

const KNOWN = ['CODE_NOT_FOUND', 'CODE_EXPIRED', 'MATCH_FULL', 'OWN_CODE', 'ALREADY_IN_MATCH', 'BUSY'] as const;

export type JoinError = (typeof KNOWN)[number] | 'UNKNOWN';

/** The reason joinPrivate refused, for the join screen to explain. Only the server's ConvexError data counts. */
export function joinErrorOf(err: unknown): JoinError {
  if (err instanceof ConvexError && typeof err.data === 'string' && (KNOWN as readonly string[]).includes(err.data)) {
    return err.data as JoinError;
  }
  return 'UNKNOWN';
}
