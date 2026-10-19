import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinkPair, type Channel } from './link';

function alternating(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('createLinkPair', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('link pair delays and drops state only', async () => {
    const [a, b] = createLinkPair({ delayMs: 50, stateDropRate: 0.5, random: alternating(0, 0.9) });
    const atB: [Channel, string][] = [];
    const atA: [Channel, string][] = [];
    b.onMessage((channel, message) => atB.push([channel, message]));
    a.onMessage((channel, message) => atA.push([channel, message]));

    for (let i = 0; i < 10; i++) {
      a.send('ctrl', `ctrl-${i}`);
      a.send('state', `state-${i}`);
    }
    b.send('ctrl', 'reply');

    await vi.advanceTimersByTimeAsync(49);
    expect(atB).toEqual([]);
    expect(atA).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    const ctrl = atB.filter(([channel]) => channel === 'ctrl').map(([, m]) => m);
    const state = atB.filter(([channel]) => channel === 'state').map(([, m]) => m);
    expect(ctrl).toEqual(Array.from({ length: 10 }, (_, i) => `ctrl-${i}`));
    expect(state).toHaveLength(5);
    for (const m of state) expect(m).toMatch(/^state-\d$/);
    expect(atA).toEqual([['ctrl', 'reply']]);
  });

  it('delivers asynchronously with no delay by default', async () => {
    const [a, b] = createLinkPair();
    const atB: [Channel, string][] = [];
    b.onMessage((channel, message) => atB.push([channel, message]));

    a.send('state', 'tick');
    a.send('ctrl', 'hello');
    expect(atB).toEqual([]);

    await vi.advanceTimersByTimeAsync(0);
    expect(atB).toContainEqual(['state', 'tick']);
    expect(atB).toContainEqual(['ctrl', 'hello']);
    expect(atB).toHaveLength(2);
  });

  it('unsubscribe stops delivery', async () => {
    const [a, b] = createLinkPair();
    const atB: string[] = [];
    const unsubscribe = b.onMessage((_channel, message) => atB.push(message));

    a.send('ctrl', 'first');
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    a.send('ctrl', 'second');
    await vi.advanceTimersByTimeAsync(0);

    expect(atB).toEqual(['first']);
  });

  it('close fires onClose on both ends once and drops later sends', async () => {
    const [a, b] = createLinkPair();
    const closedA = vi.fn();
    const closedB = vi.fn();
    a.onClose(closedA);
    b.onClose(closedB);
    const atA: string[] = [];
    const atB: string[] = [];
    a.onMessage((_channel, message) => atA.push(message));
    b.onMessage((_channel, message) => atB.push(message));

    a.close();
    b.close();
    a.close();
    await vi.advanceTimersByTimeAsync(0);
    a.send('ctrl', 'after-close');
    b.send('ctrl', 'after-close');
    await vi.advanceTimersByTimeAsync(0);

    expect(closedA).toHaveBeenCalledTimes(1);
    expect(closedB).toHaveBeenCalledTimes(1);
    expect(atA).toEqual([]);
    expect(atB).toEqual([]);
  });
});
