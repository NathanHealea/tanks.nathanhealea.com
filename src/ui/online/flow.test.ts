import { describe, expect, it } from 'vitest';
import { initialScreen, reduce, type OnlineAction, type OnlineScreen } from './flow';

const MENU: OnlineScreen = { name: 'menu' };

describe('online flow transitions', () => {
  it('walks a quick match from the menu through rounds to the match result', () => {
    let step = reduce(MENU, { type: 'quickMatch' });
    expect(step).toEqual({ screen: { name: 'searching' }, effects: [{ type: 'joinQueue' }] });

    step = reduce(step.screen, { type: 'matched' });
    expect(step).toEqual({ screen: { name: 'connecting' }, effects: [{ type: 'connect' }] });

    step = reduce(step.screen, { type: 'roundStart', round: 1 });
    expect(step).toEqual({ screen: { name: 'countdown', round: 1 }, effects: [] });

    step = reduce(step.screen, { type: 'countdownDone' });
    expect(step).toEqual({ screen: { name: 'playing', round: 1 }, effects: [] });

    step = reduce(step.screen, { type: 'roundEnd', round: 1, outcome: 'won', you: 1, them: 0 });
    expect(step).toEqual({
      screen: { name: 'roundResult', round: 1, outcome: 'won', you: 1, them: 0 },
      effects: [],
    });

    step = reduce(step.screen, { type: 'roundStart', round: 2 });
    expect(step).toEqual({ screen: { name: 'countdown', round: 2 }, effects: [] });

    step = reduce(step.screen, { type: 'countdownDone' });
    expect(step).toEqual({ screen: { name: 'playing', round: 2 }, effects: [] });

    step = reduce(step.screen, { type: 'roundEnd', round: 2, outcome: 'lost', you: 1, them: 1 });
    expect(step.screen).toEqual({ name: 'roundResult', round: 2, outcome: 'lost', you: 1, them: 1 });

    step = reduce(step.screen, { type: 'matchEnd', you: 3, them: 1 });
    expect(step).toEqual({
      screen: { name: 'matchResult', won: true, you: 3, them: 1, rematch: 'none' },
      effects: [],
    });
  });

  it('ends the match straight from playing, as a loss when the opponent has more', () => {
    const step = reduce({ name: 'playing', round: 4 }, { type: 'matchEnd', you: 1, them: 3 });
    expect(step).toEqual({
      screen: { name: 'matchResult', won: false, you: 1, them: 3, rematch: 'none' },
      effects: [],
    });
  });

  it('creates a private match and moves to connecting when a friend joins', () => {
    const created = reduce(MENU, { type: 'createPrivate' });
    expect(created).toEqual({ screen: { name: 'privateWaiting' }, effects: [{ type: 'createPrivate' }] });

    expect(reduce(created.screen, { type: 'matched' })).toEqual({
      screen: { name: 'connecting' },
      effects: [{ type: 'connect' }],
    });
  });

  it('joins by code, shows a server error, and retries', () => {
    const opened = reduce(MENU, { type: 'openJoin' });
    expect(opened).toEqual({ screen: { name: 'joining', code: '', error: null, busy: false }, effects: [] });

    const prefilled = reduce(MENU, { type: 'openJoin', code: 'HK7Q2M' });
    expect(prefilled.screen).toEqual({ name: 'joining', code: 'HK7Q2M', error: null, busy: false });

    const submitted = reduce(opened.screen, { type: 'submitCode', code: 'HK7Q2M' });
    expect(submitted).toEqual({
      screen: { name: 'joining', code: 'HK7Q2M', error: null, busy: true },
      effects: [{ type: 'joinPrivate', code: 'HK7Q2M' }],
    });

    const failed = reduce(submitted.screen, { type: 'joinFailed', error: 'CODE_EXPIRED' });
    expect(failed).toEqual({
      screen: { name: 'joining', code: 'HK7Q2M', error: 'CODE_EXPIRED', busy: false },
      effects: [],
    });

    const retried = reduce(failed.screen, { type: 'submitCode', code: 'ABC234' });
    expect(retried).toEqual({
      screen: { name: 'joining', code: 'ABC234', error: null, busy: true },
      effects: [{ type: 'joinPrivate', code: 'ABC234' }],
    });

    expect(reduce(retried.screen, { type: 'matched' })).toEqual({
      screen: { name: 'connecting' },
      effects: [{ type: 'connect' }],
    });
  });

  it('returns to the menu on cancel from every waiting state', () => {
    const joining: OnlineScreen = { name: 'joining', code: 'HK7Q2M', error: null, busy: false };
    for (const waiting of [{ name: 'searching' }, { name: 'privateWaiting' }, joining] as OnlineScreen[]) {
      expect(reduce(waiting, { type: 'cancel' }).screen).toEqual(MENU);
    }
    expect(reduce(joining, { type: 'back' })).toEqual({ screen: MENU, effects: [] });
    expect(reduce(joining, { type: 'cancel' }).effects).toEqual([]);
  });

  it('shows a connection failure and goes back to the menu from it', () => {
    const failed = reduce({ name: 'connecting' }, { type: 'connectFailed', reason: 'VERSION_MISMATCH' });
    expect(failed).toEqual({ screen: { name: 'connectFailed', reason: 'VERSION_MISMATCH' }, effects: [] });

    expect(reduce(failed.screen, { type: 'back' })).toEqual({ screen: MENU, effects: [] });
  });

  it('asks for a rematch, can cancel it, and connects when both players agree', () => {
    const result: OnlineScreen = { name: 'matchResult', won: true, you: 3, them: 2, rematch: 'none' };

    const asked = reduce(result, { type: 'requestRematch' });
    expect(asked).toEqual({
      screen: { name: 'matchResult', won: true, you: 3, them: 2, rematch: 'waiting' },
      effects: [{ type: 'requestRematch' }],
    });

    expect(reduce(asked.screen, { type: 'cancelRematch' })).toEqual({ screen: result, effects: [{ type: 'cancelRematch' }] });

    expect(reduce(asked.screen, { type: 'matched' })).toEqual({
      screen: { name: 'connecting' },
      effects: [{ type: 'connect' }],
    });
  });

  it('a refused rematch returns to the choice without withdrawing anything', () => {
    const waiting: OnlineScreen = { name: 'matchResult', won: true, you: 3, them: 1, rematch: 'waiting' };
    expect(reduce(waiting, { type: 'rematchFailed' })).toEqual({ screen: { ...waiting, rematch: 'none' }, effects: [] });
  });

  it('leaves the match from the result screen', () => {
    const result: OnlineScreen = { name: 'matchResult', won: false, you: 0, them: 3, rematch: 'none' };
    expect(reduce(result, { type: 'back' })).toEqual({ screen: MENU, effects: [{ type: 'leaveMatch' }] });

    const waiting: OnlineScreen = { ...result, rematch: 'waiting' };
    expect(reduce(waiting, { type: 'back' })).toEqual({
      screen: MENU,
      effects: [{ type: 'cancelRematch' }, { type: 'leaveMatch' }],
    });
  });

  it('a connection lost mid-match goes to the failure screen', () => {
    const live: OnlineScreen[] = [
      { name: 'countdown', round: 2 },
      { name: 'playing', round: 2 },
      { name: 'roundResult', round: 2, outcome: 'won', you: 1, them: 0 },
    ];
    for (const screen of live) {
      expect(reduce(screen, { type: 'connectFailed', reason: 'CONNECT_FAILED' })).toEqual({
        screen: { name: 'connectFailed', reason: 'CONNECT_FAILED' },
        effects: [],
      });
    }
  });

  it('stays on the menu on back; the App closes the online flow', () => {
    expect(reduce(MENU, { type: 'back' })).toEqual({ screen: MENU, effects: [] });
  });

  it('ignores actions a screen does not handle, returning the same screen object', () => {
    const cases: [OnlineScreen, OnlineAction][] = [
      [MENU, { type: 'matched' }],
      [MENU, { type: 'countdownDone' }],
      [{ name: 'searching' }, { type: 'quickMatch' }],
      [{ name: 'playing', round: 1 }, { type: 'countdownDone' }],
      [{ name: 'countdown', round: 1 }, { type: 'roundEnd', round: 1, outcome: 'draw', you: 0, them: 0 }],
      [{ name: 'connecting' }, { type: 'cancel' }],
      [{ name: 'matchResult', won: true, you: 3, them: 0, rematch: 'none' }, { type: 'matched' }],
      [{ name: 'matchResult', won: true, you: 3, them: 0, rematch: 'none' }, { type: 'cancelRematch' }],
      [{ name: 'unavailable', reason: 'offline' }, { type: 'quickMatch' }],
    ];
    for (const [screen, action] of cases) {
      const step = reduce(screen, action);
      expect(step.screen).toBe(screen);
      expect(step.effects).toEqual([]);
    }
  });
});

describe('online flow', () => {
  it('cancel releases server state', () => {
    expect(reduce({ name: 'searching' }, { type: 'cancel' })).toEqual({
      screen: MENU,
      effects: [{ type: 'leaveQueue' }],
    });
    expect(reduce({ name: 'privateWaiting' }, { type: 'cancel' })).toEqual({
      screen: MENU,
      effects: [{ type: 'cancelPrivate' }],
    });
  });

  it('join link enters join flow', () => {
    const fromLink = initialScreen({ hasBackend: true, online: true, joinCode: 'HK7Q2M' });
    // Confirm-first, not auto-join: a link-preview bot running the page must not take the friend's guest slot.
    expect(fromLink).toEqual({ name: 'joining', code: 'HK7Q2M', error: null, busy: false });

    expect(initialScreen({ hasBackend: false, online: true, joinCode: 'HK7Q2M' })).toEqual({
      name: 'unavailable',
      reason: 'no-backend',
    });
    expect(initialScreen({ hasBackend: false, online: false, joinCode: 'HK7Q2M' })).toEqual({
      name: 'unavailable',
      reason: 'no-backend',
    });
    expect(initialScreen({ hasBackend: true, online: false, joinCode: 'HK7Q2M' })).toEqual({
      name: 'unavailable',
      reason: 'offline',
    });
    expect(initialScreen({ hasBackend: true, online: true, joinCode: null })).toEqual(MENU);
  });

  it('leaving a live match forfeits it and returns to the menu', () => {
    const live: OnlineScreen[] = [
      { name: 'connecting' },
      { name: 'countdown', round: 2 },
      { name: 'playing', round: 2 },
      { name: 'roundResult', round: 1, outcome: 'won', you: 1, them: 0 },
    ];
    for (const screen of live) {
      expect(reduce(screen, { type: 'leave' })).toEqual({ screen: { name: 'menu' }, effects: [{ type: 'leaveMatch' }] });
    }
    const menu: OnlineScreen = { name: 'menu' };
    expect(reduce(menu, { type: 'leave' }).screen).toBe(menu);
  });
});
