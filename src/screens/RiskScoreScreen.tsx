import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import {
  useRiskScore,
  type RiskBand,
  type RiskScoreRow,
} from "@/data/riskScore/useRiskScore";
import { useElectionContext } from "@/data/ElectionContext";
import { formatPct, formatThousands } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { RiskWaterfall } from "@/screens/components/riskScore/RiskWaterfall";

// Overview screen — ranked list (NOT a map). Maps invite geographic
// narrative the score doesn't support; the list keeps the focus on
// individual sections + their decomposition. Default filter is "band
// ≥ elevated AND signalsAvailable ≥ 3" so the top of the list isn't
// just noise from sparse-signal sections.

const BAND_ORDER: RiskBand[] = ["critical", "high", "elevated", "low"];

export const RiskScoreScreen = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { data } = useRiskScore();
  const [minSignals, setMinSignals] = useState(3);
  const [minBand, setMinBand] = useState<RiskBand>("elevated");

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const filtered = useMemo(() => {
    const minIdx = BAND_ORDER.indexOf(minBand);
    return rows.filter((r) => {
      const bIdx = BAND_ORDER.indexOf(r.band);
      return bIdx <= minIdx && r.signalsAvailable >= minSignals;
    });
  }, [rows, minBand, minSignals]);

  const counts = useMemo(() => {
    const c: Record<RiskBand, number> = {
      critical: 0,
      high: 0,
      elevated: 0,
      low: 0,
    };
    for (const r of rows) c[r.band] += 1;
    return c;
  }, [rows]);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <SEO
        title={t("risk_score_title")}
        description={t("risk_score_description")}
      />
      <div className="py-4 md:py-6">
        <H1 className="text-xl md:text-2xl font-bold text-foreground">
          {t("risk_score_title")}
        </H1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          {t("risk_score_description")}
        </p>
      </div>

      <MethodologyCallout
        variant="disputed"
        title={t("risk_score_caveat_title")}
        className="mb-4"
      >
        {t("risk_score_caveat_body")}
      </MethodologyCallout>

      {/* Band summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {BAND_ORDER.slice(0, 3).map((band) => (
          <StatCard
            key={band}
            label={
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <RiskBandBadge band={band} size="sm" />
              </div>
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {formatThousands(counts[band])}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t(`risk_band_${band}_caption`)}
            </div>
          </StatCard>
        ))}
        <StatCard
          label={
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <RiskBandBadge band="low" size="sm" />
            </div>
          }
        >
          <div className="text-2xl font-bold tabular-nums">
            {formatThousands(counts.low)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("risk_band_low_caption")}
          </div>
        </StatCard>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("risk_filter_min_band")}
          </span>
          <div className="inline-flex rounded-md border bg-card overflow-hidden">
            {BAND_ORDER.map((b) => (
              <button
                key={b}
                onClick={() => setMinBand(b)}
                className={`px-2 py-1 ${
                  minBand === b
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`risk_band_${b}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("risk_filter_min_signals")}
          </span>
          <div className="inline-flex rounded-md border bg-card overflow-hidden">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setMinSignals(n)}
                className={`px-2 py-1 ${
                  minSignals === n
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}+
              </button>
            ))}
          </div>
        </div>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {t("risk_results")}: {formatThousands(filtered.length)}
        </span>
      </div>

      {/* Ranked list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-3 px-3 py-2 border-b bg-muted/30 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("risk_col_band")}</span>
          <span>{t("section")}</span>
          <span className="text-right">{t("risk_col_percentile")}</span>
          <span className="text-right">{t("risk_col_signals")}</span>
        </div>
        {filtered.slice(0, 200).map((r) => (
          <Link
            key={r.section}
            to={`/risk-score/${r.section}`}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-3 items-center px-3 py-2 border-b last:border-b-0 hover:bg-muted/20 transition-colors text-sm"
          >
            <RiskBandBadge band={r.band} score={r.score} size="sm" />
            <div className="min-w-0">
              <div className="font-mono text-xs tabular-nums">{r.section}</div>
              <div className="text-[10px] text-muted-foreground">
                {r.obshtina ?? "—"}
              </div>
            </div>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {r.percentileInMunicipality !== undefined
                ? formatPct(r.percentileInMunicipality * 100, 0)
                : "—"}
            </span>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {r.signalsAvailable}/{r.signalsTotal}
            </span>
          </Link>
        ))}
        {filtered.length > 200 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground text-center">
            {t("risk_truncated", { count: filtered.length - 200 })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground mt-6">
        {t("risk_footer")} · {selected}
      </p>
    </div>
  );
};

// Per-section detail page — full waterfall decomposition + band +
// percentile + neighborhood flag. Linked from the overview list AND
// from each section's own page.
export const RiskScoreDetailScreen = () => {
  const { t } = useTranslation();
  const { sectionId } = useParams<{ sectionId: string }>();
  const { data } = useRiskScore();
  const row: RiskScoreRow | undefined = useMemo(
    () => data?.rows.find((r) => r.section === sectionId),
    [data, sectionId],
  );

  if (!data) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-12">
      <SEO
        title={
          row
            ? `${t("risk_score_title")} — ${row.section}`
            : t("risk_score_title")
        }
        description={t("risk_score_description")}
      />
      <Link
        to="/risk-score"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2 mt-4"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("risk_score_title")}
      </Link>

      {!row && (
        <div className="mt-4 text-sm text-muted-foreground">
          {t("risk_score_not_found")}
        </div>
      )}

      {row && (
        <>
          <div className="flex items-center gap-3 flex-wrap mt-1 mb-3">
            <H1 className="text-xl md:text-2xl font-bold text-foreground font-mono">
              {row.section}
            </H1>
            <RiskBandBadge
              band={row.band}
              score={row.score}
              signalsAvailable={row.signalsAvailable}
              signalsTotal={row.signalsTotal}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {row.obshtina && <span>{row.obshtina}</span>}
            <Link
              to={`/section/${row.section}`}
              className="ml-3 text-primary hover:underline"
            >
              {t("risk_open_section_page")} →
            </Link>
          </div>

          <MethodologyCallout
            variant="disputed"
            title={t("risk_score_caveat_title")}
            className="mt-4 mb-4"
          >
            {t("risk_score_caveat_body")}
          </MethodologyCallout>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <StatCard
              label={
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("risk_score_label")}
                </span>
              }
            >
              <div className="text-3xl font-bold tabular-nums">
                {row.score.toFixed(1)}
                <span className="text-base text-muted-foreground ml-1">
                  /100
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t(`risk_band_${row.band}_caption`)}
              </div>
            </StatCard>
            <StatCard
              label={
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("risk_percentile_label")}
                </span>
              }
            >
              <div className="text-3xl font-bold tabular-nums">
                {row.percentileInMunicipality !== undefined
                  ? formatPct(row.percentileInMunicipality * 100, 0)
                  : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("risk_percentile_caption")}
              </div>
            </StatCard>
            <StatCard
              label={
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("risk_signals_label")}
                </span>
              }
            >
              <div className="text-3xl font-bold tabular-nums">
                {row.signalsAvailable}
                <span className="text-base text-muted-foreground ml-1">
                  / {row.signalsTotal}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {row.signalsAvailable < row.signalsTotal
                  ? t("risk_partial_signals_hint")
                  : t("risk_full_signals_hint")}
              </div>
            </StatCard>
          </div>

          {row.neighborhoodFlag && (
            <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span>{t("risk_neighborhood_flag")}</span>
            </div>
          )}

          <StatCard
            label={
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("risk_decomposition_label")}
              </span>
            }
          >
            <RiskWaterfall row={row} />
          </StatCard>

          <p className="text-xs text-muted-foreground leading-relaxed mt-4">
            {t("risk_interpretation")}
          </p>
        </>
      )}
    </div>
  );
};
