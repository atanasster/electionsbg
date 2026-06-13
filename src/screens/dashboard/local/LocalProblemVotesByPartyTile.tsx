import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  LocalProblemSectionsReport,
  useLocalProblemSections,
} from "@/data/local/useLocalProblemSections";
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

type Bucket = {
  votes: number;
  name: string;
  color: string;
  canonicalId: string | null;
};

// Sum the pre-aggregated party totals across the município's flagged
// neighborhoods (a município can hold several — e.g. Burgas has Pobeda + the
// two Ezerovo mahali), keyed by a stable bucket id: the canonical party id when
// known, else `local:<num>` for a local-only slate (OIK-scoped, so it never
// aligns across cycles).
const aggregate = (
  report: LocalProblemSectionsReport | undefined,
  obshtinaCode: string,
  rayonCode?: string,
): { totals: Map<string, Bucket>; total: number } => {
  const totals = new Map<string, Bucket>();
  let total = 0;
  if (!report) return { totals, total };
  for (const n of report.neighborhoods) {
    if (n.obshtinaCode !== obshtinaCode) continue;
    if (rayonCode && n.rayonCode !== rayonCode) continue;
    for (const p of n.parties) {
      const canonicalId = p.primaryCanonicalId ?? null;
      const key = canonicalId ?? `local:${p.localPartyNum}`;
      const cur = totals.get(key) ?? {
        votes: 0,
        name: p.localPartyName,
        color: p.color,
        canonicalId,
      };
      cur.votes += p.votes;
      totals.set(key, cur);
      total += p.votes;
    }
  }
  return { totals, total };
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

  const rows = useMemo(() => {
    const { totals, total } = aggregate(current, obshtinaCode, rayonCode);
    if (!total) return [];
    const { totals: priorTotals, total: priorTotal } = aggregate(
      prior,
      obshtinaCode,
      rayonCode,
    );

    const built = Array.from(totals.entries()).map(([key, b]) => {
      const share = (100 * b.votes) / total;
      let deltaPP: number | undefined;
      // Only canonical buckets are comparable across cycles — a local-only
      // slate's ballot number is reassigned each cycle.
      if (b.canonicalId && priorTotal) {
        const pb = priorTotals.get(b.canonicalId);
        if (pb) deltaPP = share - (100 * pb.votes) / priorTotal;
      }
      return {
        key,
        canonicalId: b.canonicalId,
        // Fallback name (raw local slate name); the canonical display name is
        // resolved in render so this memo stays stable.
        rawName: b.name,
        color: b.color,
        votes: b.votes,
        share,
        deltaPP,
      };
    });

    built.sort((a, b) => b.votes - a.votes);
    return built.filter((r) => r.votes > 0).slice(0, 8);
  }, [current, prior, obshtinaCode, rayonCode]);

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
