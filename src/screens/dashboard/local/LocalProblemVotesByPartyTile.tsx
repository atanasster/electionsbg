import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useLocalProblemSections } from "@/data/local/useLocalProblemSections";
import { buildProblemPartyRows } from "./problemPartyRows";
import { usePriorLocalCycle } from "@/data/local/useLocalCycles";
import { formatPct, formatThousands } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "../StatCard";

type Props = {
  obshtinaCode: string;
  cycle: string;
  // When set (a район drill-down page), restrict the aggregate to the
  // neighborhoods sitting in this 2-digit административен район; unset folds in
  // every flagged neighborhood of the município.
  rayonCode?: string;
};

// Local-elections counterpart of ProblemVotesByPartyTile: the council-ballot
// distribution across the flagged Roma-neighborhood sections in this município,
// with the change vs the prior local cycle (matched by canonical id).
export const LocalProblemVotesByPartyTile: FC<Props> = ({
  obshtinaCode,
  cycle,
  rayonCode,
}) => {
  const { t } = useTranslation();
  const { displayNameForId } = useCanonicalParties();
  const priorCycle = usePriorLocalCycle(cycle);
  const { data: current } = useLocalProblemSections(cycle);
  // `null` (not undefined) when there's no prior cycle — keeps the hook from
  // falling back to the latest cycle and skewing ΔPP.
  const { data: prior } = useLocalProblemSections(priorCycle ?? null);

  const rows = useMemo(
    () => buildProblemPartyRows(current, prior, obshtinaCode, rayonCode),
    [current, prior, obshtinaCode, rayonCode],
  );

  if (!rows.length) return null;

  const maxShare = rows[0]?.share ?? 0;
  const hasAnyPrior = rows.some((r) => r.deltaPP !== undefined);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Hint
            text={t("dashboard_local_problem_votes_by_party_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>{t("dashboard_problem_votes_by_party")}</span>
            </div>
          </Hint>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.4fr)_auto_minmax(80px,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("party")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("votes")}
        </span>
        <span />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_share_of_problem_votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {hasAnyPrior ? t("dashboard_change_pp") : ""}
        </span>
        {rows.map((r) => {
          const barPct = maxShare ? (r.share / maxShare) * 100 : 0;
          return (
            <div className="contents" key={r.key}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.color || "#888" }}
                />
                <span className="truncate font-medium">
                  {(r.canonicalId
                    ? displayNameForId(r.canonicalId)
                    : undefined) ?? r.rawName}
                </span>
              </div>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatThousands(r.votes)}
              </span>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, barPct))}%`,
                    backgroundColor: r.color || "#888",
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {formatPct(r.share, 1)}
              </span>
              <span
                className={`tabular-nums text-xs font-medium text-right ${
                  r.deltaPP === undefined
                    ? "text-muted-foreground"
                    : r.deltaPP > 0
                      ? "text-positive"
                      : r.deltaPP < 0
                        ? "text-negative"
                        : "text-muted-foreground"
                }`}
              >
                {r.deltaPP === undefined
                  ? "—"
                  : `${r.deltaPP > 0 ? "+" : r.deltaPP < 0 ? "−" : ""}${formatPct(Math.abs(r.deltaPP), 1)}`}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
