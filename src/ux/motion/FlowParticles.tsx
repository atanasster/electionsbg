import { FC } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Beads travelling along a Sankey link: what the link CARRIES, made visible.
//
// ⚠️ MOUNT IT ONLY FOR THE LINKS THE READER IS TRACING (motion-v1 §0: motion means state).
// Every link flowing all the time is a screensaver that drowns the one path the reader asked
// about; flowing on the hovered node's links turns the hover into „follow the money". Callers
// gate it on their own focus state, and the particles disappear with the focus.
//
// SMIL `<animateMotion>`, not a rAF loop: it runs without React re-rendering, needs no
// path-length measurement, and costs nothing when the element is unmounted. Under
// prefers-reduced-motion it renders nothing — the focus highlight still says which links.

export const FlowParticles: FC<{
  /** The link's own path data. */
  d: string;
  /** Beads on the link at once — use `particleCount`. */
  count: number;
  /** The link's stroke width; beads are sized inside it. */
  width: number;
  /** Travel against the path's direction — for a layout drawn target → source. */
  reverse?: boolean;
  /** One trip, end to end. */
  durationMs?: number;
}> = ({ d, count, width, reverse = false, durationMs = 2400 }) => {
  const reduced = usePrefersReducedMotion();
  if (reduced || !d || count < 1) return null;
  const r = Math.max(1.2, Math.min(3, width / 3));
  return (
    <g pointerEvents="none" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} r={r} fill="hsl(var(--background))" fillOpacity={0.9}>
          <animateMotion
            dur={`${durationMs}ms`}
            // Evenly spaced along the link from the first frame: a negative begin starts
            // each bead part-way through its trip instead of all leaving the source at once.
            begin={`${-Math.round((i * durationMs) / count)}ms`}
            repeatCount="indefinite"
            path={d}
            {...(reverse
              ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" }
              : {})}
          />
        </circle>
      ))}
    </g>
  );
};
