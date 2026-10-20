import { describe, expect, it } from 'vitest';
import { redactCandidate, redactSdp } from './redact';

// Documentation addresses (RFC 5737, RFC 3849) stand in for a relay and a player.
const RELAY = 'candidate:1 1 udp 41885439 198.51.100.10 50000 typ relay raddr 203.0.113.7 rport 54321 generation 0 ufrag Ab12 network-id 1';

describe('redacting setup messages', () => {
  it("removes the player's own address from a relay candidate", () => {
    expect(redactCandidate(RELAY)).toBe(
      'candidate:1 1 udp 41885439 198.51.100.10 50000 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag Ab12 network-id 1',
    );
    expect(redactCandidate(RELAY)).not.toContain('203.0.113.7');
  });

  it('handles IPv6 and TCP candidates', () => {
    const v6 = 'candidate:2 1 tcp 25108223 2001:db8::10 443 typ relay raddr 2001:db8::77 rport 9 tcptype passive';
    expect(redactCandidate(v6)).toBe('candidate:2 1 tcp 25108223 2001:db8::10 443 typ relay raddr 0.0.0.0 rport 0 tcptype passive');
  });

  it('leaves a candidate without a related address unchanged', () => {
    const plain = 'candidate:3 1 udp 2122260223 198.51.100.10 50000 typ relay generation 0';
    expect(redactCandidate(plain)).toBe(plain);
    expect(redactCandidate('')).toBe('');
  });

  it('redacts every candidate line in a session description and nothing else', () => {
    const sdp = [
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      'm=application 50000 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 198.51.100.10',
      `a=${RELAY}`,
      `a=${RELAY.replace('candidate:1', 'candidate:4')}`,
      'a=ice-ufrag:Ab12',
      '',
    ].join('\r\n');
    const out = redactSdp(sdp);
    expect(out).not.toContain('203.0.113.7');
    expect(out.split('\r\n').filter((l) => l.includes('raddr 0.0.0.0 rport 0'))).toHaveLength(2);
    expect(out.replaceAll('raddr 0.0.0.0 rport 0', 'raddr 203.0.113.7 rport 54321')).toBe(sdp);
  });

  it('leaves a non-candidate line that mentions raddr unchanged', () => {
    const sdp = ['v=0', 's=raddr 192.0.2.5 rport 7', 'a=x-note:raddr 192.0.2.5 rport 7', `a=${RELAY}`, ''].join('\r\n');
    const out = redactSdp(sdp).split('\r\n');
    expect(out.slice(0, 3)).toEqual(['v=0', 's=raddr 192.0.2.5 rport 7', 'a=x-note:raddr 192.0.2.5 rport 7']);
    expect(out[3]).not.toContain('203.0.113.7');
  });
});
