type QueueResult = { status: 'queued' | 'matched' | 'dropped'; full: boolean };

export interface QuickMatchServer {
  join(): Promise<QueueResult>;
  heartbeat(): Promise<QueueResult>;
  leave(): Promise<null>;
}

/** 'full': queued, but the hour's match starts are used up; heartbeats keep trying until a slot opens. */
export type QuickMatchState = 'idle' | 'searching' | 'full' | 'matched' | 'error';

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
    if (this.state === 'searching' || this.state === 'full' || this.state === 'matched') return;
    const search = ++this.search;
    this.set('searching');
    let result: QueueResult;
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
    this.set(result.full ? 'full' : 'searching');
    this.stopHeartbeats();
    this.timer = setInterval(() => {
      this.server
        .heartbeat()
        .then((beat) => {
          if (search !== this.search) return;
          if (beat.status === 'matched') this.matched();
          // The server lost this player's queue entry (it went stale): join again rather than wait in a line we left.
          else if (beat.status === 'dropped') void this.rejoin(search);
          else this.set(beat.full ? 'full' : 'searching');
        })
        .catch((err) => console.error('Queue heartbeat failed', err));
    }, QUEUE_HEARTBEAT_MS);
  }

  private async rejoin(search: number): Promise<void> {
    try {
      const result = await this.server.join();
      if (search !== this.search) return;
      if (result.status === 'matched') this.matched();
      else this.set(result.full ? 'full' : 'searching');
    } catch (err) {
      console.error('Rejoining the match queue failed', err);
    }
  }

  matched(): void {
    // The match can arrive before join() resolves; invalidate that join so it cannot start heartbeats afterwards.
    this.search++;
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
    if (this.state !== 'searching' && this.state !== 'full') return;
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
    if (state === this.state) return;
    this.state = state;
    this.onChange(state);
  }
}
