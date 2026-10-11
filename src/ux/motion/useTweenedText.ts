import { useEffect, useRef, useState } from "react";
import { easeOutCubic, MOTION_MS } from "./motionTokens";
import { tweenNumberText } from "./tweenNumberText";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** The text to show for `value`, rolled from the previous value when the two are tweenable.
 *
 *  ⚠️ THE FIRST RENDER IS ALWAYS `value`, VERBATIM. That is what keeps this prerender- and
 *  hydration-safe and what makes it obey motion-v1's one rule: a figure moves only when the
 *  reader changed something (scope, election) — never on page load. */
export const useTweenedText = (
  value: string,
  duration: number = MOTION_MS.slow,
): string => {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  // What is on screen RIGHT NOW, so a change arriving mid-roll continues from the frame the
  // reader is looking at rather than jumping back to the previous target.
  const shownRef = useRef(value);

  useEffect(() => {
    if (value === shownRef.current) return;
    const interp =
      reduced || typeof requestAnimationFrame === "undefined"
        ? null
        : tweenNumberText(shownRef.current, value);
    if (!interp) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const text = interp(easeOutCubic(t));
      shownRef.current = text;
      setShown(text);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, duration]);

  return shown;
};
