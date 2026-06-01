// Head-to-head bar for a mayoral runoff (балотаж): a single 100%-width bar
// split between the two finalists in proportion to their round-2 vote, with the
// winner marked. Round 2 is a two-candidate race, so this reads far faster than
// re-running the full multi-candidate table — it sits above the round-2 table
// on the município page.

import { FC, useMemo } from "react";
import { Check } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { LocalMayorResult } from "@/data/local/types";

const NEUTRAL = "#9ca3af"; // independents / unresolved party colour

export const LocalMayorRunoffBar: FC<{ round2: LocalMayorResult[] }> = ({
  round2,
}) => {
  const { colorFor } = useCanonicalParties();
  const finalists = useMemo(
    () => [...round2].sort((a, b) => b.votes - a.votes).slice(0, 2),
    [round2],
  );
  if (finalists.length < 2) return null;
  const [a, b] = finalists;
  const total = a.votes + b.votes;
  const aShare = total > 0 ? (a.votes / total) * 100 : 50;
  const colorOf = (m: LocalMayorResult) =>
    m.primaryCanonicalId ? colorFor(m.primaryCanonicalId) || NEUTRAL : NEUTRAL;

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1">
          {a.isElected ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          ) : null}
          <span
            className={`truncate ${a.isElected ? "font-semibold" : "font-medium"}`}
          >
            {a.candidateName}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {a.pctOfValid.toFixed(1)}%
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1 text-right">
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {b.pctOfValid.toFixed(1)}%
          </span>
          <span
            className={`truncate ${b.isElected ? "font-semibold" : "font-medium"}`}
          >
            {b.candidateName}
          </span>
          {b.isElected ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          ) : null}
        </span>
      </div>
      <div
        className="flex h-5 overflow-hidden rounded ring-1 ring-border"
        role="img"
        aria-label={`${a.candidateName} ${a.pctOfValid.toFixed(1)}% — ${b.candidateName} ${b.pctOfValid.toFixed(1)}%`}
      >
        <div style={{ width: `${aShare}%`, backgroundColor: colorOf(a) }} />
        <div
          style={{ width: `${100 - aShare}%`, backgroundColor: colorOf(b) }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{a.localPartyName}</span>
        <span className="truncate text-right">{b.localPartyName}</span>
      </div>
    </div>
  );
};
