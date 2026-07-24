// The colour-chip + label used by both wealth charts' legends. Shared rather than copied:
// the two charts sit in the same section, and a second copy is how a fix lands on one
// legend and not the other.

import { FC } from "react";

export const LegendSwatch: FC<{ color: string; label: string }> = ({
  color,
  label,
}) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block h-2 w-3 rounded-sm"
      style={{ backgroundColor: color }}
    />
    {label}
  </span>
);
