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
});
