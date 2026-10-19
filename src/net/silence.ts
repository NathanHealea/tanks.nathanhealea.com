import type { Link } from './link';

export const PING_MS = 1000;
export const SILENCE_WARN_MS = 5000;
export const SILENCE_REPORT_MS = 15000;

export type LinkHealth = { state: 'ok' } | { state: 'lost'; secondsLeft: number };

/** A ctrl message about the link itself rather than the game; anything else is for the match to read. */
export function parseControl(raw: string): 'ping' | 'bye' | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || !('t' in value)) return null;
  return value.t === 'ping' || value.t === 'bye' ? value.t : null;
}

/**
 * Watches one match's link for its whole life, across rounds. A data channel can stay "open" while nothing arrives,
 * so silence is measured from the last message of any kind, and each side pings every second to keep it short.
 */
export class LinkWatch {
  private lastHeard = Date.now();
  private warning = false;
  private reported = false;
  private byeHeard = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly stopListening: () => void;

  constructor(
    private readonly link: Link,
    private readonly handlers: { onHealth(health: LinkHealth): void; onLost(): void; onBye(): void },
  ) {
    this.stopListening = link.onMessage((channel, raw) => this.heard(channel === 'ctrl' ? parseControl(raw) : null));
    this.timer = setInterval(() => this.tick(), PING_MS);
  }

  bye(): void {
    this.link.send('ctrl', JSON.stringify({ t: 'bye' }));
  }

  dispose(): void {
    clearInterval(this.timer);
    this.stopListening();
  }

  private heard(control: 'ping' | 'bye' | null): void {
    this.lastHeard = Date.now();
    if (this.warning) {
      this.warning = false;
      this.handlers.onHealth({ state: 'ok' });
    }
    if (control === 'bye' && !this.byeHeard) {
      this.byeHeard = true;
      this.handlers.onBye();
    }
  }

  private tick(): void {
    this.link.send('ctrl', JSON.stringify({ t: 'ping' }));
    if (this.reported) return;
    const silence = Date.now() - this.lastHeard;
    if (silence >= SILENCE_REPORT_MS) {
      this.reported = true;
      this.warning = false;
      this.handlers.onLost();
    } else if (silence >= SILENCE_WARN_MS) {
      this.warning = true;
      this.handlers.onHealth({ state: 'lost', secondsLeft: Math.ceil((SILENCE_REPORT_MS - silence) / 1000) });
    }
  }
}
