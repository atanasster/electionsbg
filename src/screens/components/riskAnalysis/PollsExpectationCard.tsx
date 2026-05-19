import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { useAgencies, usePollsAccuracy } from "@/data/polls/usePolls";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { partyHref } from "@/lib/utils";
import { StatCard } from "@/screens/dashboard/StatCard";

// Polls-vs-result panel for /risk-analysis. Surfaces the same agency
// table the home tile shows, with a quantitative comparison of *this*
// election's mean MAE against the historical distribution. The mean
// MAE also feeds the composite index's "polls" component (offset/
// capped formula in useRiskComposite) — see the integrity article's §6
// for the framing. Polling error has structural causes (methodology,
// late deciders, sample bias) so high values do NOT imply election
// irregularity, only forecast failure.

type Verdict = "lower" | "normal" | "higher";

const verdictBadge: Record<Verdict, string> = {
  lower:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-500/30",
  normal: "bg-muted text-foreground border-border",
  higher:
    "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border-amber-500/40",
};

export const PollsExpectationCard: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data: accuracy } = usePollsAccuracy();
  const { data: agencies } = useAgencies();
  const { colorFor, displayNameFor } = useCanonicalParties();

  const electionIso = selected?.replace(/_/g, "-");

  const result = useMemo(() => {
    if (!accuracy || !electionIso) return null;
    const current = accuracy.elections.find(
      (e) => e.electionDate === electionIso,
    );
    if (!current || !current.agencies.length) return null;
    const sortedAgencies = [...current.agencies].sort((a, b) => a.mae - b.mae);
    const currentMean =
      current.agencies.reduce((s, a) => s + a.mae, 0) / current.agencies.length;
    // Historical baseline: mean of per-election mean MAE across all OTHER
    // elections in the dataset. Stddev is only meaningful with ≥3 prior
    // elections; below that we still show the comparison but skip the
    // verdict label.
    const priorMeans = accuracy.elections
      .filter((e) => e.electionDate !== electionIso && e.agencies.length > 0)
      .map(
        (e) => e.agencies.reduce((s, a) => s + a.mae, 0) / e.agencies.length,
      );
    const histMean =
      priorMeans.length > 0
        ? priorMeans.reduce((s, m) => s + m, 0) / priorMeans.length
        : null;
    let histStd: number | null = null;
    if (priorMeans.length >= 3 && histMean !== null) {
      const variance =
        priorMeans.reduce((s, m) => s + (m - histMean) ** 2, 0) /
        priorMeans.length;
      histStd = Math.sqrt(variance);
    }
    let verdict: Verdict | null = null;
    if (histMean !== null && histStd !== null) {
      const z = (currentMean - histMean) / Math.max(histStd, 0.01);
      verdict = z > 0.5 ? "higher" : z < -0.5 ? "lower" : "normal";
    }
    return {
      currentMean,
      histMean,
      verdict,
      agencyCount: current.agencies.length,
      sortedAgencies,
    };
  }, [accuracy, electionIso]);

  if (!result || !agencies) return null;

  const agencyById = new Map(agencies.map((a) => [a.id, a]));
  const maxMae = Math.max(0.01, ...result.sortedAgencies.map((a) => a.mae));

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("risk_analysis_polls_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span>{t("risk_analysis_polls_title")}</span>
            </div>
          </Hint>
          <Link
            to="/polls"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
        {result.histMean !== null
          ? t("risk_analysis_polls_headline_with_baseline", {
              count: result.agencyCount,
              mean: result.currentMean.toFixed(2),
              baseline: result.histMean.toFixed(2),
            })
          : t("risk_analysis_polls_headline", {
              count: result.agencyCount,
              mean: result.currentMean.toFixed(2),
            })}
        {result.verdict ? (
          <>
            {" "}
            <span
              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium align-middle ${verdictBadge[result.verdict]}`}
            >
              {t(`risk_analysis_polls_verdict_${result.verdict}`)}
            </span>
          </>
        ) : null}
      </p>
      <p className="text-[11px] text-muted-foreground italic mt-1">
        {t("risk_analysis_polls_disclaimer_short")}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,4fr)_auto_auto_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 items-center mt-3 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_agency")}
        </span>
        <span />
        <Hint text={t("dashboard_polls_mae_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
            MAE
          </span>
        </Hint>
        <Hint text={t("dashboard_polls_days_before_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
            {t("polls_days_before")}
          </span>
        </Hint>
        <Hint text={t("dashboard_polls_biggest_miss_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("polls_biggest_miss")}
          </span>
        </Hint>
        {result.sortedAgencies.map((a) => {
          const ag = agencyById.get(a.agencyId);
          const name = ag ? (isBg ? ag.name_bg : ag.name_en) : a.agencyId;
          const widthPct = Math.max(2, (a.mae / maxMae) * 100);
          const hue = Math.max(0, 140 - a.mae * 30);
          const sign = a.biggestMiss.error > 0 ? "+" : "";
          const missColor =
            a.biggestMiss.error > 0 ? "text-emerald-600" : "text-rose-600";
          return (
            <div className="contents" key={a.agencyId}>
              <Link
                to={`/polls/${a.agencyId}`}
                className="font-medium truncate hover:underline"
                underline={false}
              >
                {name}
              </Link>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: `hsl(${hue} 70% 45%)`,
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {a.mae.toFixed(2)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {a.daysBefore}d
              </span>
              <span className="text-xs truncate flex items-center gap-1.5 min-w-0">
                <Link
                  to={partyHref(a.biggestMiss.key)}
                  className="inline-flex items-center gap-1 font-medium hover:underline min-w-0"
                  underline={false}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundColor: colorFor(a.biggestMiss.key) || "#888",
                    }}
                  />
                  <span className="truncate">
                    {displayNameFor(a.biggestMiss.key) ?? a.biggestMiss.key}
                  </span>
                </Link>
                <span
                  className={`tabular-nums font-semibold shrink-0 ${missColor}`}
                >
                  {sign}
                  {a.biggestMiss.error.toFixed(1)}pp
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
