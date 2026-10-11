// Settle a d3-force simulation OFF SCREEN before anyone sees it (motion-v1 §4.1).
//
// A force layout drawn from its first tick spends its first seconds flinging every node across
// the canvas — motion that means nothing (§0) on the page whose whole point is reading who is
// connected to whom. So the hot phase runs unseen, in small time-sliced chunks so a phone never
// gets a long task, and the caller reveals the layout once it is calm; the faint remainder of
// the cool-down then plays on screen, where it reads as the graph easing into place.
//
// ⚠️ TIME-SLICED WITH setTimeout, NOT requestAnimationFrame. rAF is throttled or paused in
// background tabs and hidden panes, which would leave the graph invisible until the tab is
// shown; a timer keeps settling, and the reveal is the same either way.

/** The part of a d3 `Simulation` this needs — kept structural so it is testable. */
export interface Settleable {
  alpha(): number;
  alphaMin(): number;
  tick(iterations?: number): unknown;
  stop(): unknown;
}

export interface PreSettleOptions {
  /** Reveal once alpha has cooled to this — low enough that what is left reads as easing. */
  revealAlpha: number;
  /** Longest single chunk of ticking, ms. */
  chunkMs?: number;
  /** Give up waiting and reveal after this long, ms, however hot the layout still is. */
  budgetMs?: number;
}

/** Stops `sim`'s own timer, ticks it in chunks until alpha ≤ `revealAlpha` (or the budget is
 *  spent), then calls `onSettled`. Returns a cancel function. */
export const preSettle = (
  sim: Settleable,
  { revealAlpha, chunkMs = 8, budgetMs = 1500 }: PreSettleOptions,
  onSettled: () => void,
  now: () => number = () => performance.now(),
): (() => void) => {
  sim.stop();
  const start = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    const chunkEnd = now() + chunkMs;
    while (sim.alpha() > revealAlpha && now() < chunkEnd) sim.tick();
    if (sim.alpha() <= revealAlpha || now() - start >= budgetMs) onSettled();
    else timer = setTimeout(step, 0);
  };
  timer = setTimeout(step, 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
};
