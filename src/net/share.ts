export { formatCode, normalizeCode } from '../../convex/lib/codes';
import { normalizeCode } from '../../convex/lib/codes';

export function buildJoinUrl(code: string, origin: string): string {
  return `${origin}/?join=${code}`;
}

interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * The share code from a `?join=` link, removed from the address bar so a reload does not join again. Anything that
 * is not a valid code is ignored and left in place.
 */
export function readJoinParam(location: { href: string }, history: HistoryLike): string | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get('join');
  const code = raw === null ? null : normalizeCode(raw);
  if (!code) return null;
  url.searchParams.delete('join');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return code;
}
