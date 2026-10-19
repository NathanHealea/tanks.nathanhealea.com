import { describe, expect, it } from 'vitest';
import { FALLBACK_ARENA, PVP_COLS, PVP_ROWS } from '../game/pvpMaps';
import { createPvpGame } from '../game/sim';
import {
  encode,
  parseGuestMessage,
  parseHostMessage,
  type InputMessage,
  type RoundEndMessage,
  type RoundStartMessage,
  type SnapshotMessage,
} from './protocol';

const INPUT: InputMessage = { t: 'input', seq: 4, move: { x: 0.6, z: -0.8 }, aim: 1.25, fire: 2, mine: 1 };

const ROUND_START: RoundStartMessage = { t: 'roundStart', round: 1, rows: [...FALLBACK_ARENA], seed: 12345 };

const ROUND_END: RoundEndMessage = { t: 'roundEnd', round: 2, result: 'p1', wins: { p1: 2, p2: 0 }, winner: null };

function snapshot(): SnapshotMessage {
  const s = createPvpGame([...FALLBACK_ARENA], 9);
  return {
    t: 'snap',
    tick: 10,
    time: 10 / 60,
    tanks: s.tanks,
    bullets: [{ id: 3, owner: 'p1', pos: { x: 1, z: 2 }, vel: { x: 6.5, z: 0 }, bounces: 1, life: 7.5 }],
    mines: [{ id: 4, owner: 'p2', team: 1, pos: { x: -1, z: 0.5 }, age: 0.3 }],
    events: [{ type: 'explode', pos: { x: -1, z: 0.5 } }],
    broken: [21, 22],
    outcome: null,
    winner: null,
  };
}

function withField(message: object, path: string[], value: unknown): string {
  const copy = JSON.parse(JSON.stringify(message));
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path[path.length - 1]] = value;
  return JSON.stringify(copy);
}

function withoutField(message: object, path: string[]): string {
  const copy = JSON.parse(JSON.stringify(message));
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  delete target[path[path.length - 1]];
  return JSON.stringify(copy);
}

// JSON.stringify cannot emit Infinity, but a hostile peer can send 1e999, which JSON.parse reads as Infinity.
function withInfinity(message: object, path: string[]): string {
  return withField(message, path, '__INF__').replace('"__INF__"', '1e999');
}

describe('protocol', () => {
  it('protocol rejects malformed messages', () => {
    expect(parseGuestMessage(encode(INPUT))).toEqual(INPUT);
    expect(parseHostMessage(encode(ROUND_START))).toEqual(ROUND_START);
    expect(parseHostMessage(encode(ROUND_END))).toEqual(ROUND_END);
    expect(parseHostMessage(encode(snapshot()))).toEqual(snapshot());
    expect(parseGuestMessage(encode({ ...INPUT, aim: null }))).toEqual({ ...INPUT, aim: null });

    expect(parseGuestMessage(encode({ ...INPUT, move: { x: 3, z: -4 } }))?.move).toEqual({
      x: expect.closeTo(0.6, 9),
      z: expect.closeTo(-0.8, 9),
    });
    expect(parseGuestMessage(JSON.stringify({ ...INPUT, extra: 'ignored' }))).toEqual(INPUT);

    for (const raw of [
      'not json',
      '42',
      'null',
      '[]',
      '"input"',
      JSON.stringify({ ...INPUT, t: 'snap' }),
      JSON.stringify({ ...INPUT, t: 'mystery' }),
      withoutField(INPUT, ['t']),
      withoutField(INPUT, ['seq']),
      withoutField(INPUT, ['move']),
      withoutField(INPUT, ['move', 'z']),
      withoutField(INPUT, ['aim']),
      withoutField(INPUT, ['fire']),
      withoutField(INPUT, ['mine']),
      withField(INPUT, ['seq'], -1),
      withField(INPUT, ['seq'], 1.5),
      withField(INPUT, ['seq'], '4'),
      withField(INPUT, ['move'], null),
      withField(INPUT, ['move', 'x'], 'NaN'),
      withField(INPUT, ['move', 'z'], null),
      withInfinity(INPUT, ['move', 'x']),
      withInfinity(INPUT, ['move', 'z']),
      withField(INPUT, ['aim'], 'NaN'),
      withInfinity(INPUT, ['aim']),
      withField(INPUT, ['fire'], -1),
      withField(INPUT, ['fire'], 0.5),
      withInfinity(INPUT, ['fire']),
      withField(INPUT, ['mine'], true),
      withInfinity(INPUT, ['seq']),
    ]) {
      expect(parseGuestMessage(raw), raw).toBeNull();
    }

    const ragged = [...FALLBACK_ARENA];
    ragged[3] = ragged[3].slice(0, PVP_COLS - 1);
    const wide = FALLBACK_ARENA.map((row) => row + '.');
    const tall = [...FALLBACK_ARENA, '.'.repeat(PVP_COLS)];
    const badChar = [...FALLBACK_ARENA];
    badChar[0] = 'x' + badChar[0].slice(1);
    const notStrings: unknown[] = [...FALLBACK_ARENA];
    notStrings[5] = 7;
    expect(tall).toHaveLength(PVP_ROWS + 1);

    const snap = snapshot();
    for (const raw of [
      'not json',
      'null',
      JSON.stringify({ t: 'mystery' }),
      encode(INPUT),
      withField(ROUND_START, ['rows'], []),
      withField(ROUND_START, ['rows'], notStrings),
      withField(ROUND_START, ['rows'], ragged),
      withField(ROUND_START, ['rows'], wide),
      withField(ROUND_START, ['rows'], tall),
      withField(ROUND_START, ['rows'], badChar),
      withField(ROUND_START, ['rows'], 'P2'),
      withoutField(ROUND_START, ['rows']),
      withField(ROUND_START, ['round'], 0),
      withField(ROUND_START, ['round'], 1.5),
      withField(ROUND_START, ['seed'], 1.5),
      withInfinity(ROUND_START, ['seed']),
      withoutField(ROUND_START, ['seed']),
      withField(ROUND_END, ['round'], 0),
      withField(ROUND_END, ['result'], 'p3'),
      withoutField(ROUND_END, ['result']),
      withField(ROUND_END, ['wins', 'p1'], -1),
      withField(ROUND_END, ['wins', 'p2'], 'NaN'),
      withoutField(ROUND_END, ['wins']),
      withField(ROUND_END, ['winner'], 'x'),
      withInfinity(snap, ['tick']),
      withField(snap, ['time'], 'NaN'),
      withoutField(snap, ['tanks']),
      withField(snap, ['bullets'], {}),
      withoutField(snap, ['mines']),
      withField(snap, ['events'], null),
      withField(snap, ['broken'], [-1]),
      withField(snap, ['broken'], [1.5]),
      withField(snap, ['outcome'], 'bogus'),
      withField(snap, ['tanks', '0', 'id'], 5),
      withInfinity(snap, ['tanks', '0', 'pos', 'x']),
      withField(snap, ['tanks', '1', 'pos', 'z'], 'NaN'),
      withInfinity(snap, ['tanks', '0', 'body']),
      withoutField(snap, ['tanks', '1', 'turret']),
      withField(snap, ['tanks', '0', 'alive'], 1),
      withInfinity(snap, ['bullets', '0', 'pos', 'x']),
      withoutField(snap, ['bullets', '0', 'pos']),
      withField(snap, ['mines', '0', 'pos', 'z'], 'NaN'),
    ]) {
      expect(parseHostMessage(raw), raw.slice(0, 120)).toBeNull();
    }
  });
});
