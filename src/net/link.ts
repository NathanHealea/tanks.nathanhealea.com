export type Channel = 'ctrl' | 'state';

/** A two-channel message pipe to the opponent: `ctrl` is reliable and ordered, `state` may drop messages. */
export interface Link {
  send(channel: Channel, message: string): void;
  onMessage(handler: (channel: Channel, message: string) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}

interface Endpoint {
  messageHandlers: Set<(channel: Channel, message: string) => void>;
  closeHandlers: Set<() => void>;
}

/** Two connected in-memory links for tests, with optional latency and loss on the `state` channel. */
export function createLinkPair(
  options: { delayMs?: number; stateDropRate?: number; random?: () => number } = {},
): [Link, Link] {
  const { delayMs = 0, stateDropRate = 0, random = Math.random } = options;
  const ends: [Endpoint, Endpoint] = [
    { messageHandlers: new Set(), closeHandlers: new Set() },
    { messageHandlers: new Set(), closeHandlers: new Set() },
  ];
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    for (const end of ends) for (const handler of end.closeHandlers) handler();
  };

  const link = (self: number): Link => {
    const peer = ends[1 - self];
    return {
      send(channel, message) {
        if (closed) return;
        if (channel === 'state' && random() < stateDropRate) return;
        setTimeout(() => {
          if (closed) return;
          for (const handler of peer.messageHandlers) handler(channel, message);
        }, delayMs);
      },
      onMessage(handler) {
        ends[self].messageHandlers.add(handler);
        return () => ends[self].messageHandlers.delete(handler);
      },
      onClose(handler) {
        ends[self].closeHandlers.add(handler);
        return () => ends[self].closeHandlers.delete(handler);
      },
      close,
    };
  };
  return [link(0), link(1)];
}
