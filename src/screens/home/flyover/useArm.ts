// When the flyover band is allowed to become a moving canvas — `docs/plans/home-flyover-v1.md`
// §0.5 and §8.5.
//
// ⚠️ THE POSTER IS THE DEFAULT STATE AND THE CANVAS IS THE EXCEPTION. `/` is the site's entry
// page: its first paint is budgeted at two GCS requests, its HTML at 18,000 characters and its
// CLS at zero. So the band renders a static `<img>` first and swaps in the canvas only when
// ALL FIVE of these hold — in view, document visible, browser idle after load, motion not
// refused, and data not being saved. Any one of them false leaves a reader with the poster,
// which is a complete picture rather than a degraded one.
//
// ⚠️ AND „REDUCED MOTION" MEANS NO ANIMATION FRAME IS EVER SCHEDULED, not a slower one (plan
// §2.9). A reader who has asked their operating system not to animate things has asked once,
// globally; honouring it with a gentler animation is not honouring it.
//
// Every signal is read defensively, because three of the five are optional browser features
// and the fourth (`navigator.connection`) is not in Safari at all. An unavailable signal reads
// as „no objection", never as „refuse" — the poster is already the fallback, so a browser
// that cannot tell us about Save-Data should still get the scene.

import { useEffect, useState } from "react";
import { useInView } from "@/ux/useInView";

/**
 * How long after mount the band waits before arming, when `requestIdleCallback` is missing.
 *
 * Safari has no `requestIdleCallback`, so without a fallback the band would never arm there.
 * Two seconds is long enough for the page's own work — the hub stats, the feed, the tile grid
 * — to have settled on a slow connection.
 */
export const IDLE_FALLBACK_MS = 2000;

export const prefersReducedMotion = (): boolean => {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Save-Data, from the Network Information API.
 *
 * ⚠️ Absent in Safari and in every Firefox, so this is `false` for most readers and must not
 * be read as „nobody is saving data". It is a signal we honour when we get it, not a
 * measurement of anything.
 */
export const prefersSavedData = (): boolean => {
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return conn?.saveData === true;
};

const documentHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

export interface ArmState {
  /** Attach to the band's wrapper: the in-view half of the decision. */
  ref: React.RefObject<HTMLDivElement | null>;
  /**
   * True when the canvas may mount AND the artifact may be fetched. Latches on the first
   * time every condition holds; `visible` is what pauses afterwards, so a reader who scrolls
   * away and back does not re-fetch.
   */
  armed: boolean;
  /**
   * Whether the loop should be RUNNING right now. Distinct from `armed`: the canvas stays
   * mounted when the tab is hidden, and only the animation stops — resuming at the same `t`
   * rather than restarting the programme.
   */
  running: boolean;
  /** True when the reader has asked for no animation. The switch still changes the poster. */
  reducedMotion: boolean;
}

export const useArm = (): ArmState => {
  const { ref, inView } = useInView<HTMLDivElement>("200px");
  const [idle, setIdle] = useState(false);
  const [visible, setVisible] = useState(() => !documentHidden());
  // Read ONCE at mount rather than on every render: a media query that flipped mid-session
  // would otherwise start an animation under a reader who had just asked for none.
  const [reducedMotion] = useState(prefersReducedMotion);
  const [savedData] = useState(prefersSavedData);

  useEffect(() => {
    if (idle) return;
    const done = () => setIdle(true);
    const ric = (
      window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          o?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (h: number) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      const handle = ric(done, { timeout: IDLE_FALLBACK_MS });
      return () => {
        const cancel = (
          window as Window & { cancelIdleCallback?: (h: number) => void }
        ).cancelIdleCallback;
        if (typeof cancel === "function") cancel(handle);
      };
    }
    const timer = window.setTimeout(done, IDLE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [idle]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setVisible(!documentHidden());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const allowed = !reducedMotion && !savedData;
  const armed = allowed && inView && idle;
  return { ref, armed, running: armed && visible, reducedMotion };
};
