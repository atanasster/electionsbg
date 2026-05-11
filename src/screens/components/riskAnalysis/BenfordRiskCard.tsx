import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sigma } from "lucide-react";
import { useBenford, type BenfordPartyEntry } from "@/data/benford/useBenford";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { BenfordChart } from "@/screens/components/benford/BenfordChart";

const partyLabel = (
  p: Pick<BenfordPartyEntry, "nickName" | "name" | "name_en">,
  isBg: boolean,
) =>
  isBg ? p.nickName || p.name || "?" : p.nickName || p.name_en || p.name || "?";

type Bucket = "moderate" | "strong";
const bucketOf = (mad: number): Bucket => (mad >= 0.08 ? "strong" : "moderate");

const bucketBadge: Record<Bucket, string> = {
  moderate: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  strong: "bg-orange-600/15 text-orange-700 dark:text-orange-300 border-orange-600/40",
};

// Risk-analysis page section — every party with a 2BL (preferred) or 1BL
// MAD ≥ 0.04, plotted as a small-multiples grid. The headline counts split
// strong (≥0.08) vs moderate (≥0.04) so the reader sees both thresholds
// at a glance. Parties below 0.04 are not shown — they live on /benford.
export const BenfordRiskCard: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useBenford();

  const { qualifying, mode, totalEvaluated, strongCount, moderateCount } =
    useMemo(() => {
      if (!data?.parties.length)
        return {
          qualifying: [],
          mode: "second" as const,
          totalEvaluated: 0,
          strongCount: 0,
          moderateCount: 0,
        };
      const hasAnyTwo = data.parties.some((p) => p.secondDigit);
      const useMode: "first" | "second" = hasAnyTwo ? "second" : "first";
      const rows = data.parties
        .map((p) => ({
          p,
          test: useMode === "second" ? p.secondDigit : p.firstDigit,
        }))
        .filter(
          (
            x,
          ): x is {
            p: BenfordPartyEntry;
            test: NonNullable<BenfordPartyEntry["secondDigit"]>;
          } => !!x.test,
        );
      let str = 0;
      let mod = 0;
      for (const r of rows) {
        if (r.test.mad >= 0.08) str++;
        else if (r.test.mad >= 0.04) mod++;
      }
      const qual = rows
        .filter((r) => r.test.mad >= 0.04)
        .sort((a, b) => b.test.mad - a.test.mad);
      return {
        qualifying: qual,
        mode: useMode,
        totalEvaluated: rows.length,
        strongCount: str,
        moderateCount: mod,
      };
    }, [data]);

  if (!data) return null;

  const headline =
    qualifying.length === 0
      ? t("risk_analysis_benford_none", { total: formatThousands(totalEvaluated) })
      : t("risk_analysis_benford_headline", {
          strong: formatThousands(strongCount),
          moderate: formatThousands(moderateCount),
          total: formatThousands(totalEvaluated),
        });

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("risk_analysis_benford_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Sigma className="h-4 w-4" />
              <span>{t("risk_analysis_benford_title")}</span>
            </div>
          </Hint>
          <Link
            to="/benford"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
        {headline}{" "}
        <span className="text-[11px]">
          ({mode === "second" ? t("benford_mode_second") : t("benford_mode_first")})
        </span>
      </p>
      {qualifying.length > 0 ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 mt-2">
          {qualifying.map(({ p, test }) => {
            const b = bucketOf(test.mad);
            return (
              <Link
                key={p.partyNum}
                to={`/benford/${p.partyNum}`}
                className="block rounded-xl border bg-card p-3 hover:bg-muted/30 transition-colors"
                underline={false}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color || "#888" }}
                    />
                    <span className="truncate text-xs font-semibold">
                      {partyLabel(p, isBg)}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    n={formatThousands(test.n)}
                  </span>
                </div>
                <BenfordChart test={test} mode={mode} color={p.color} small />
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>
                    MAD <span className="font-mono">{test.mad.toFixed(4)}</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${bucketBadge[b]}`}
                  >
                    {t(`risk_analysis_benford_bucket_${b}`)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}
    </StatCard>
  );
};
