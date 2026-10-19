import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_HEARTBEAT_MS, QuickMatch, type QuickMatchState } from './quickMatch';

function fakeServer(joinStatus: 'queued' | 'matched' = 'queued') {
  return {
    join: vi.fn(() => Promise.resolve({ status: joinStatus })),
    heartbeat: vi.fn(() => Promise.resolve(null)),
    leave: vi.fn(() => Promise.resolve(null)),
  };
}

describe('QuickMatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hook heartbeats and leaves', async () => {
    const server = fakeServer();
    const states: QuickMatchState[] = [];
    const quick = new QuickMatch(server, (s) => states.push(s));

    expect(QUEUE_HEARTBEAT_MS).toBe(10_000);
    expect(quick.state).toBe('idle');
    await quick.start();
    expect(quick.state).toBe('searching');
    expect(server.join).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(server.heartbeat).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.heartbeat).toHaveBeenCalledTimes(2);

    await quick.cancel();
    expect(server.leave).toHaveBeenCalledTimes(1);
    expect(quick.state).toBe('idle');
    expect(states).toEqual(['searching', 'idle']);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('dispose while searching leaves once and stops heartbeats', async () => {
    const server = fakeServer();
    const quick = new QuickMatch(server, () => {});

    await quick.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.heartbeat).toHaveBeenCalledTimes(1);

    quick.dispose();
    quick.dispose();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(server.leave).toHaveBeenCalledTimes(1);
    expect(server.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('matched stops heartbeats without leaving', async () => {
    const server = fakeServer();
    const states: QuickMatchState[] = [];
    const quick = new QuickMatch(server, (s) => states.push(s));

    await quick.start();
    quick.matched();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(quick.state).toBe('matched');
    expect(states).toEqual(['searching', 'matched']);
    expect(server.heartbeat).not.toHaveBeenCalled();
    expect(server.leave).not.toHaveBeenCalled();

    await quick.cancel();
    quick.dispose();
    expect(server.leave).not.toHaveBeenCalled();
  });

  it('join that pairs at once goes straight to matched', async () => {
    const server = fakeServer('matched');
    const states: QuickMatchState[] = [];
    const quick = new QuickMatch(server, (s) => states.push(s));

    await quick.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(quick.state).toBe('matched');
    expect(states).toEqual(['searching', 'matched']);
    expect(server.heartbeat).not.toHaveBeenCalled();
    expect(server.leave).not.toHaveBeenCalled();
  });

  it('join rejection is an error with no heartbeats', async () => {
    const server = fakeServer();
    server.join.mockImplementation(() => Promise.reject(new Error('network down')));
    const states: QuickMatchState[] = [];
    const quick = new QuickMatch(server, (s) => states.push(s));

    await quick.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(quick.state).toBe('error');
    expect(states).toEqual(['searching', 'error']);
    expect(server.heartbeat).not.toHaveBeenCalled();
  });

  it('start while searching does not join twice', async () => {
    const server = fakeServer();
    const quick = new QuickMatch(server, () => {});

    await quick.start();
    await quick.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(server.join).toHaveBeenCalledTimes(1);
    expect(server.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('cancel when idle does not leave', async () => {
    const server = fakeServer();
    const quick = new QuickMatch(server, () => {});

    await quick.cancel();
    quick.dispose();

    expect(server.leave).not.toHaveBeenCalled();
    expect(quick.state).toBe('idle');
  });

  it('a join that resolves after cancel and a new search starts only one heartbeat', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (v: { status: 'queued' }) => void;
    const server = {
      join: vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
        .mockResolvedValue({ status: 'queued' }),
      heartbeat: vi.fn().mockResolvedValue(null),
      leave: vi.fn().mockResolvedValue(null),
    };
    const quick = new QuickMatch(server, () => {});
    const first = quick.start();
    await quick.cancel();
    await quick.start();
    resolveFirst({ status: 'queued' });
    await first;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.heartbeat).toHaveBeenCalledTimes(1);
    await quick.cancel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('dispose tells the listener it is idle', async () => {
    const states: QuickMatchState[] = [];
    const quick = new QuickMatch(fakeServerQueued(), (s) => states.push(s));
    await quick.start();
    quick.dispose();
    expect(states).toEqual(['searching', 'idle']);
  });

  it('a finished match lets the player search again', async () => {
    const server = fakeServerQueued();
    const quick = new QuickMatch(server, () => {});
    await quick.start();
    quick.matched();
    quick.ended();
    expect(quick.state).toBe('idle');
    await quick.start();
    expect(server.join).toHaveBeenCalledTimes(2);
    quick.dispose();
  });

  it('a failed leave on cancel is logged, not thrown', async () => {
    const server = { ...fakeServerQueued(), leave: vi.fn().mockRejectedValue(new Error('offline')) };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const quick = new QuickMatch(server, () => {});
    await quick.start();
    await expect(quick.cancel()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('QuickMatch edge cases', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a match that arrives before join resolves starts no heartbeats', async () => {
    vi.useFakeTimers();
    let resolveJoin!: (v: { status: 'queued' }) => void;
    const server = { ...fakeServerQueued(), join: vi.fn(() => new Promise<{ status: 'queued' }>((r) => (resolveJoin = r))) };
    const quick = new QuickMatch(server, () => {});
    const started = quick.start();
    quick.matched();
    resolveJoin({ status: 'queued' });
    await started;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.heartbeat).not.toHaveBeenCalled();
    expect(quick.state).toBe('matched');
  });

  it('ended does nothing while searching', async () => {
    const server = fakeServerQueued();
    const quick = new QuickMatch(server, () => {});
    await quick.start();
    quick.ended();
    expect(quick.state).toBe('searching');
    await quick.cancel();
    expect(server.leave).toHaveBeenCalledTimes(1);
  });

  it('a match already running when the controller is created shows as matched', () => {
    const states: QuickMatchState[] = [];
    const quick = new QuickMatch(fakeServerQueued(), (s) => states.push(s));
    quick.matched();
    expect(quick.state).toBe('matched');
    expect(states).toEqual(['matched']);
  });

  it('a player can retry after a failed join', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = {
      ...fakeServerQueued(),
      join: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'queued' }),
    };
    const quick = new QuickMatch(server, () => {});
    await quick.start();
    expect(quick.state).toBe('error');
    await quick.start();
    expect(quick.state).toBe('searching');
    expect(server.join).toHaveBeenCalledTimes(2);
    quick.dispose();
    errors.mockRestore();
  });

  it('a stale join failure does not overwrite a newer search', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFirst!: (err: Error) => void;
    const server = {
      ...fakeServerQueued(),
      join: vi
        .fn()
        .mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
        .mockResolvedValue({ status: 'queued' }),
    };
    const quick = new QuickMatch(server, () => {});
    const first = quick.start();
    await quick.cancel();
    await quick.start();
    rejectFirst(new Error('late'));
    await first;
    expect(quick.state).toBe('searching');
    await quick.cancel();
    expect(server.leave).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});

function fakeServerQueued() {
  return {
    join: vi.fn().mockResolvedValue({ status: 'queued' as const }),
    heartbeat: vi.fn().mockResolvedValue(null),
    leave: vi.fn().mockResolvedValue(null),
  };
}
