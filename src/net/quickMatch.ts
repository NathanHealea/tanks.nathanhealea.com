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

  constructor(
    private readonly server: QuickMatchServer,
    private readonly onChange: (state: QuickMatchState) => void,
  ) {}

  async start(): Promise<void> {
    if (this.state === 'searching' || this.state === 'matched') return;
    this.set('searching');
    let result: { status: 'queued' | 'matched' };
    try {
      result = await this.server.join();
    } catch (err) {
      console.error('Joining the match queue failed', err);
      this.set('error');
      return;
    }
    // Read through a method: TypeScript keeps the narrowing from before the await, but cancel() may have run since.
    if (!this.isSearching()) return;
    if (result.status === 'matched') {
      this.set('matched');
      return;
    }
    this.timer = setInterval(() => {
      this.server.heartbeat().catch((err) => console.error('Queue heartbeat failed', err));
    }, QUEUE_HEARTBEAT_MS);
  }

  matched(): void {
    this.stopHeartbeats();
    if (this.state !== 'matched') this.set('matched');
  }

  async cancel(): Promise<void> {
    if (this.state !== 'searching') return;
    this.stopHeartbeats();
    this.set('idle');
    await this.server.leave();
  }

  dispose(): void {
    if (this.state !== 'searching') return;
    this.stopHeartbeats();
    this.state = 'idle';
    this.server.leave().catch((err) => console.error('Leaving the match queue failed', err));
  }

  private isSearching(): boolean {
    return this.state === 'searching';
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
