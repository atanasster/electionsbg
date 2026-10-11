// Its own module so `FlowParticles.tsx` exports only a component (fast refresh).

/** How many beads a link gets, ∝ its share of the largest link, 1…`max`. */
export const particleCount = (value: number, maxValue: number, max = 4) =>
  maxValue > 0
    ? Math.min(max, Math.max(1, Math.round((value / maxValue) * max)))
    : 1;
