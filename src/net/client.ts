import { createConvexClient } from './convex';

/** The app's one Convex client, or null when VITE_CONVEX_URL is unset and only the campaign runs. */
export const convexClient = createConvexClient(import.meta.env.VITE_CONVEX_URL);
