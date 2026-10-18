import { describe, expect, it, vi } from 'vitest';
import { ConvexReactClient } from 'convex/react';
import { createConvexClient } from './convex';

// A real ConvexReactClient opens a WebSocket on construction.
vi.mock('convex/react', () => ({
  ConvexReactClient: vi.fn(function (this: { url: string }, url: string) {
    this.url = url;
  }),
}));

describe('createConvexClient', () => {
  it('client is null without a url', () => {
    vi.mocked(ConvexReactClient).mockClear();

    expect(createConvexClient(undefined)).toBeNull();
    expect(createConvexClient('')).toBeNull();
    expect(ConvexReactClient).not.toHaveBeenCalled();
  });

  it('client is created with a url', () => {
    vi.mocked(ConvexReactClient).mockClear();

    const client = createConvexClient('https://x.convex.cloud');

    expect(client).toBeInstanceOf(ConvexReactClient);
    expect(ConvexReactClient).toHaveBeenCalledWith('https://x.convex.cloud');
  });
});
