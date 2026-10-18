import { ConvexReactClient } from 'convex/react';

/** The campaign must run with no backend, so a missing URL means no client rather than an error. */
export function createConvexClient(url: string | undefined): ConvexReactClient | null {
  return url ? new ConvexReactClient(url) : null;
}
