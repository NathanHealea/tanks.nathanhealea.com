import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_LEAVE_MS, leaveWhenHidden } from './visibility';

class FakePage extends EventTarget {
  hidden = false;
}

function setHidden(page: FakePage, hidden: boolean) {
  page.hidden = hidden;
  page.dispatchEvent(new Event('visibilitychange'));
}

describe('leaveWhenHidden', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the 15 s R5 states', () => {
    expect(HIDDEN_LEAVE_MS).toBe(15_000);
  });

  it('hidden tab leaves after 15 s', () => {
    const page = new FakePage();
    const onAway = vi.fn();
    leaveWhenHidden(page, onAway);

    setHidden(page, true);
    vi.advanceTimersByTime(14_999);
    expect(onAway).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it('coming back at 14 s keeps the player in the match', () => {
    const page = new FakePage();
    const onAway = vi.fn();
    leaveWhenHidden(page, onAway);

    setHidden(page, true);
    vi.advanceTimersByTime(14_000);
    setHidden(page, false);
    vi.advanceTimersByTime(16_000);

    expect(onAway).not.toHaveBeenCalled();
  });

  it('hiding again later restarts the full 15 s', () => {
    const page = new FakePage();
    const onAway = vi.fn();
    leaveWhenHidden(page, onAway);

    setHidden(page, true);
    vi.advanceTimersByTime(14_000);
    setHidden(page, false);
    vi.advanceTimersByTime(5_000);

    setHidden(page, true);
    vi.advanceTimersByTime(14_000);
    expect(onAway).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it('starts counting at once when the page is already hidden', () => {
    const page = new FakePage();
    page.hidden = true;
    const onAway = vi.fn();
    leaveWhenHidden(page, onAway);

    vi.advanceTimersByTime(15_000);
    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it('unbinding cancels a running timer and stops listening', () => {
    const page = new FakePage();
    const onAway = vi.fn();
    const unbind = leaveWhenHidden(page, onAway);

    setHidden(page, true);
    vi.advanceTimersByTime(10_000);
    unbind();
    vi.advanceTimersByTime(10_000);
    setHidden(page, false);
    setHidden(page, true);
    vi.advanceTimersByTime(30_000);

    expect(onAway).not.toHaveBeenCalled();
  });

  it('never leaves twice from one binding', () => {
    const page = new FakePage();
    const onAway = vi.fn();
    leaveWhenHidden(page, onAway);

    setHidden(page, true);
    vi.advanceTimersByTime(15_000);
    setHidden(page, false);
    setHidden(page, true);
    vi.advanceTimersByTime(30_000);

    expect(onAway).toHaveBeenCalledTimes(1);
  });
});
