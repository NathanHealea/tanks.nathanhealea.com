/** Cloudflare's public STUN server (stun.cloudflare.com:3478/udp); the site is already on Cloudflare. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

/** ICE servers from VITE_ICE_SERVERS (a JSON array of RTCIceServer), falling back to the STUN default. */
export function iceServersFromEnv(raw: string | undefined): RTCIceServer[] {
  if (!raw) return DEFAULT_ICE_SERVERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('VITE_ICE_SERVERS is not valid JSON; using the default STUN server');
    return DEFAULT_ICE_SERVERS;
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        (typeof s.urls === 'string' || (Array.isArray(s.urls) && s.urls.every((u: unknown) => typeof u === 'string'))),
    );
  if (!valid) {
    console.error('VITE_ICE_SERVERS is not an array of ICE servers; using the default STUN server');
    return DEFAULT_ICE_SERVERS;
  }
  return parsed as RTCIceServer[];
}
