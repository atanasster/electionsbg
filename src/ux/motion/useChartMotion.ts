import { useEffect, useRef } from "react";
import { MOTION_MS } from "./motionTokens";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Recharts animation that obeys motion-v1's rule: never on mount, a morph on a state change
// (§3.4). Call it once per chart and spread the result per series:
//   const motion = useChartMotion(year);
//   <Radar key="BG" {...motion("BG")} />
//
// ⚠️ PER SERIES, because „mount" is per series. A series is animated only once it has been
// DRAWN under an earlier value of `key`; one that first appears later — a peer added after the
// year moved, or polygons arriving after a loading skeleton — is a mount and appears still.
// Series not drawn in a commit are forgotten, so a series that leaves and comes back is a mount
// again too.
//
// ⚠️ IT TURNS ANIMATION ON IN THE SAME RENDER THE DATA CHANGES, and that timing is the trick.
// Bar, Line, Area and Radar record their previous points in `getDerivedStateFromProps` only
// when `animationId` changes — which a data change does — and do so whether or not animation
// is active. So the first animated render, being the change render, morphs FROM those points.
// Turned on in some LATER render, with no data change, the previous points are still unset and
// the series animates from nothing: the mount animation, a frame late.
//
// ⚠️ NOT FOR <Pie>. Pie's `getDerivedStateFromProps` checks an `isAnimationActive` flip FIRST
// and resets `prevSectors` to `[]`, so its first change would sweep the donut from nothing.
// A zero `animationDuration` is no way out either: react-smooth computes t = 0/0 on its first
// frame.

const OFF = { isAnimationActive: false } as const;

/** `key` names the reader-controlled state the chart redraws for (a year, a selection). */
export const useChartMotion = (key: string | number | null | undefined) => {
  const reduced = usePrefersReducedMotion();
  /** Per drawn series: the key it was first drawn under, and whether the key has moved since. */
  const seen = useRef(
    new Map<string, { firstKey: typeof key; changed: boolean }>(),
  );
  const drawn = new Set<string>();

  useEffect(() => {
    for (const id of [...seen.current.keys()])
      if (!drawn.has(id)) seen.current.delete(id);
  });

  return (series: string) => {
    drawn.add(series);
    const s = seen.current.get(series);
    if (!s) {
      seen.current.set(series, { firstKey: key, changed: false });
      return OFF;
    }
    if (s.firstKey !== key) s.changed = true;
    return s.changed && !reduced
      ? {
          isAnimationActive: true,
          animationDuration: MOTION_MS.slow,
          animationEasing: "ease-out" as const,
        }
      : OFF;
  };
};
