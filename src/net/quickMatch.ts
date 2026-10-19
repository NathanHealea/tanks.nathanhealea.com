export interface QuickMatchServer {
  join(): Promise<{ status: 'queued' | 'matched' }>;
  heartbeat(): Promise<null>;
  leave(): Promise<null>;
}

export type QuickMatchState = 'idle' | 'searching' | 'matched' | 'error';

/** A third of the server's 30 s staleness window, so one dropped heartbeat never makes a live player look gone. */
export const QUEUE_HEARTBEAT_MS = 10_000;

/** The quick-match lifecycle without React, so the heartbeat and leave rules can be tested directly. */
export class QuickMatch {
  state: QuickMatchState = 'idle';
  private timer: ReturnType<typeof setInterval> | null = null;
  // Bumped by every start and cancel, so a join that resolves after the player cancelled and searched again is ignored.
  private search = 0;

  constructor(
    private readonly server: QuickMatchServer,
    private readonly onChange: (state: QuickMatchState) => void,
  ) {}

  async start(): Promise<void> {
    if (this.state === 'searching' || this.state === 'matched') return;
    const search = ++this.search;
    this.set('searching');
    let result: { status: 'queued' | 'matched' };
    try {
      result = await this.server.join();
    } catch (err) {
      console.error('Joining the match queue failed', err);
      if (search === this.search) this.set('error');
      return;
    }
    if (search !== this.search) return;
    if (result.status === 'matched') {
      this.set('matched');
      return;
    }
    this.stopHeartbeats();
    this.timer = setInterval(() => {
      this.server.heartbeat().catch((err) => console.error('Queue heartbeat failed', err));
    }, QUEUE_HEARTBEAT_MS);
  }

  matched(): void {
    this.stopHeartbeats();
    if (this.state !== 'matched') this.set('matched');
  }

  /** The server's match ended; the player may search again. */
  ended(): void {
    if (this.state === 'matched') this.set('idle');
  }

  async cancel(): Promise<void> {
    await this.stop();
  }

  /** Unmount or page hide. Goes through set() so a page restored from the back/forward cache shows idle, not searching. */
  dispose(): void {
    void this.stop();
  }

  private async stop(): Promise<void> {
    if (this.state !== 'searching') return;
    this.search++;
    this.stopHeartbeats();
    this.set('idle');
    // A failed leave is harmless: the entry goes stale after 30 s and the next join sweeps it.
    await this.server.leave().catch((err) => console.error('Leaving the match queue failed', err));
  }

  private stopHeartbeats(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private set(state: QuickMatchState): void {
    this.state = state;
    this.onChange(state);
  }
}
