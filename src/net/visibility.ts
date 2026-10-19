export const HIDDEN_LEAVE_MS = 15_000;

type Page = { readonly hidden: boolean } & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Calls onAway once if the page stays hidden for `ms`. A hidden tab stops animating, so a hidden host stops the match
 * for both players; leaving after a short grace ends it instead of freezing it. Returns an unbind function.
 */
export function leaveWhenHidden(page: Page, onAway: () => void, ms = HIDDEN_LEAVE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let left = false;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const update = () => {
    if (!page.hidden) return stop();
    if (timer !== null || left) return;
    timer = setTimeout(() => {
      timer = null;
      left = true;
      onAway();
    }, ms);
  };
  page.addEventListener('visibilitychange', update);
  update();
  return () => {
    page.removeEventListener('visibilitychange', update);
    stop();
  };
}
