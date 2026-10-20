// A relay candidate's related address (raddr) can be the player's own public address as the relay saw it (RFC 8445
// §5.1.1.2), and browsers are not documented to hide it. Connectivity checks never use it, so it is blanked before any
// setup message leaves the browser: no player's address may reach another (turn-relay R6).
const RELATED = /\braddr \S+ rport \d+/g;

export function redactCandidate(candidate: string): string {
  return candidate.replace(RELATED, 'raddr 0.0.0.0 rport 0');
}

/** Redacts every a=candidate line of a session description; everything else is passed through unchanged. */
export function redactSdp(sdp: string): string {
  return sdp
    .split('\r\n')
    .map((line) => (line.startsWith('a=candidate:') ? redactCandidate(line) : line))
    .join('\r\n');
}
