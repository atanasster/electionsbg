// Hash-anchor scroll for SPA navigation. Browsers handle `#foo` natively on full-page loads,
// but client-side route changes leave the page at the top — `useLocation()` updates `hash`
// without scrolling. Drop this hook into screens that expect deep links like
// `/governance#macro` or `/indicators/economy#inflation`.
//
// ⚠️ TIMERS, NOT `requestAnimationFrame`. rAF does not fire in a hidden or backgrounded tab, so
// an rAF-driven scroll silently does nothing when a link is opened in a background tab and read
// later — the reader switches to it and finds the top of the page. Measured: with the tab
// hidden the effect ran three times and the rAF callback fired ZERO times. Timers are throttled
// there rather than suspended, which is the behaviour this needs.
//
// ⚠️ AND ONE PASS IS NOT ENOUGH. These pages render their sections only once `macro` resolves
// and then keep moving for a second or more as Recharts measures, fonts land and panels expand.
// A single deferred scroll either finds no element or measures a position that is about to
// change. So it POLLS: re-issue the scroll whenever the target's absolute offset moves, stop
// once it holds still, give up at a deadline. `deps` still matters — passing the payloads
// restarts the watch when data lands rather than relying on the poll to outlive the fetch.
//
// ⚠️ AND IT YIELDS TO THE READER. A poll that keeps yanking the viewport back is worse than no
// scroll at all, so genuine input — wheel, touch, a key — cancels it. Our own programmatic
// scroll fires `scroll` events but none of those three, which is why they are the signal.
//
// ⚠️ THERE IS A SECOND IMPLEMENTATION OF THIS, and anyone changing either should know.
// `ScrollToTop` in `src/routes.tsx` handles the same hashes app-wide with a MutationObserver
// and its own nav-height offset. The two have coexisted for a while; consolidating them is a
// deliberate change to behaviour on every route and does not belong in a per-screen fix. See
// docs/plans/home-kpi-destination-continuity-v1.md.
//
// The target also gets `data-hash-target` for ~2.6s so the page can mark where the reader
// landed; the styling is in `src/index.css` and says why it is an attribute, not `:target`.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** How long to keep watching for the layout to settle. Chart pages take ~1s; this is slack. */
const DEADLINE_MS = 5000;
/** Poll cadence. Comfortably above the ~1s clamp a background tab imposes on timers. */
const STEP_MS = 120;
/** Movement under this many px counts as „settled" — sub-pixel jitter is not a layout shift. */
const STABLE_PX = 4;
/** Once scrolled, hold still this long before declaring the arrival done. */
const SETTLE_MS = 600;
/** How long the arrival marker stays on the target. Matches the animation in index.css. */
const MARK_MS = 2600;

export const useHashScroll = (deps: ReadonlyArray<unknown> = []) => {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    /**
     * ⚠️ SMOOTH SCROLLING DOES NOT RUN IN A HIDDEN TAB — the browser animates it off the frame
     * clock, which is suspended there, so `scrollIntoView({ behavior: "smooth" })` moves the
     * page by exactly nothing and reports no error. Measured on this very anchor with the tab
     * backgrounded: smooth → 0px, auto → 957px. That is a real reader path (a deep link opened
     * in a background tab and read later), not only a test artefact, and an animation nobody
     * is watching has no value anyway — so jump instead.
     */
    const behavior = (): ScrollBehavior =>
      reduced || document.hidden ? "auto" : "smooth";
    const started = Date.now();
    let poll: ReturnType<typeof setTimeout> | undefined;
    let markTimer: ReturnType<typeof setTimeout> | undefined;
    let marked: HTMLElement | undefined;
    let lastY: number | null = null;
    let stableSince: number | null = null;
    let done = false;

    const stop = () => {
      done = true;
      if (poll) clearTimeout(poll);
    };
    // ⚠️ Only genuine input. A `scroll` listener would fire on our own smooth scroll and cancel
    // the very thing it exists to protect.
    const yieldToReader = () => stop();

    const tick = () => {
      if (done) return;
      const el = document.getElementById(id);
      if (el) {
        const y = Math.round(el.getBoundingClientRect().top + window.scrollY);
        if (lastY === null || Math.abs(y - lastY) > STABLE_PX) {
          lastY = y;
          stableSince = Date.now();
          el.scrollIntoView({ behavior: behavior(), block: "start" });
          if (!marked) {
            el.setAttribute("data-hash-target", "true");
            marked = el;
            markTimer = setTimeout(
              () => el.removeAttribute("data-hash-target"),
              MARK_MS,
            );
          }
        } else if (
          stableSince !== null &&
          Date.now() - stableSince > SETTLE_MS
        ) {
          // Found, scrolled, and holding still — nothing left to chase.
          stop();
          return;
        }
      }
      if (Date.now() - started > DEADLINE_MS) {
        stop();
        return;
      }
      poll = setTimeout(tick, STEP_MS);
    };

    window.addEventListener("wheel", yieldToReader, { passive: true });
    window.addEventListener("touchstart", yieldToReader, { passive: true });
    window.addEventListener("keydown", yieldToReader);
    // A first pass on the next macrotask rather than immediately: the effect runs before the
    // browser has laid the freshly-committed DOM out, so measuring now reads a stale box.
    poll = setTimeout(tick, 0);

    return () => {
      stop();
      if (markTimer) clearTimeout(markTimer);
      // Leaving it set would mark a section the reader is no longer arriving at — and a second
      // deep link to the same page would have two elements claiming to be the destination.
      marked?.removeAttribute("data-hash-target");
      window.removeEventListener("wheel", yieldToReader);
      window.removeEventListener("touchstart", yieldToReader);
      window.removeEventListener("keydown", yieldToReader);
    };
    // The caller-supplied deps let consumers restart the watch after data arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, ...deps]);
};
