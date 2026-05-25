// Personnel tile — national headcount totals from the annual Доклад за
// състоянието на администрацията plus the per-ministry breakdown derived
// from each ministry's program-budget execution report. Surfaces three
// pieces:
//   1. Big number — total positions + filled/vacant for the selected year.
//   2. Sparkline — total positions across all years where the Доклад has data.
//   3. Top ministries — sorted by executed personnel spend with avg salary.
//
// Renders nothing when no Доклад or per-ministry data exists for the
// selected year — falls through silently to keep the composition section
// uncluttered for pre-2017 years.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { usePersonnel } from "@/data/budget/useBudget";
import type { DokladData, MinistryHeadcountSummary } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

const compactN = (v: number): string => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString("en-US");
};

interface TrendDatum {
  year: string;
  total: number;
  filled: number | null;
  vacant: number | null;
  vacantPct: number | null;
}

interface MinistryRow {
  adminId: string;
  name: string;
  headcount: number;
  personnelEur: number;
  avgEur: number | null;
}

// Shortened label for the NSI rows — the source labels are long
// administrative names; we trim "Административни структури — изпълнителна
// власт" → "Стр. към изпълн. власт" etc. so the bar list reads. The shortened
// forms are the same in both languages (the source labels themselves are
// in Bulgarian).
const shortenNsiLabel = (label: string): string => {
  return label
    .replace(
      /Министерства и администрация на Министерския съвет/,
      "Министерства + АМС",
    )
    .replace(
      /Административни структури — изпълнителна власт/,
      "Стр. към изпълн. власт",
    )
    .replace(
      /Административни структури — Народно събрание/,
      "Стр. към Народно събрание",
    )
    .replace(
      /Структури по чл\. 60 от Закона за администрацията/,
      "Структури по чл. 60",
    )
    .replace(/Специализирани териториални администрации/, "Спец. териториални");
};

const NsiTypeBreakdown: FC<{
  data: {
    central: Record<string, number>;
    territorial: Record<string, number>;
    total: number;
  };
  year: number;
}> = ({ data, year }) => {
  const { t } = useTranslation();
  const rows = [
    ...Object.entries(data.central).map(([k, v]) => ({
      label: k,
      value: v,
      region: "central" as const,
    })),
    ...Object.entries(data.territorial).map(([k, v]) => ({
      label: k,
      value: v,
      region: "territorial" as const,
    })),
  ]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const max = rows.length > 0 ? rows[0].value : 0;
  const total =
    data.total > 0 ? data.total : rows.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <div className="mb-1 text-xs font-medium">
        {t("personnel_nsi_breakdown_title", { year })}
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => {
          const widthPct = max > 0 ? (r.value / max) * 100 : 0;
          const pct = total > 0 ? (r.value / total) * 100 : 0;
          return (
            <div
              key={r.label}
              className="grid grid-cols-[1fr_auto] items-center gap-2"
              title={r.label}
            >
              <div className="relative h-4">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor:
                      r.region === "central"
                        ? "hsl(var(--primary))"
                        : "hsl(var(--muted-foreground))",
                    opacity: 0.35,
                  }}
                />
                <div className="relative px-1 text-[10px] truncate leading-4">
                  {shortenNsiLabel(r.label)}
                </div>
              </div>
              <div className="text-[10px] tabular-nums text-muted-foreground whitespace-nowrap">
                {compactN(r.value)} ({pct.toFixed(1)}%)
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {t("personnel_nsi_caveat", { year })}
      </div>
    </div>
  );
};

export const BudgetPersonnelTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data } = usePersonnel();

  const trend: TrendDatum[] = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.national)
      .map(Number)
      .sort()
      .map((y) => {
        const d = data.national[String(y)] as DokladData;
        // Older Доклади (2017) don't publish `filled` directly. Derive it
        // from total - vacant so the chart isn't missing a bar.
        const filled =
          d.positions.filled ??
          (d.positions.vacant != null
            ? d.positions.total - d.positions.vacant
            : null);
        const vacantPct =
          d.positions.vacant != null && d.positions.total > 0
            ? (d.positions.vacant / d.positions.total) * 100
            : null;
        return {
          year: String(y),
          total: d.positions.total,
          filled,
          vacant: d.positions.vacant,
          vacantPct,
        };
      });
  }, [data]);

  const current: DokladData | null = useMemo(() => {
    if (!data) return null;
    // Prefer the selected fiscal year; if the Доклад for that year isn't
    // available (e.g. user picked 2026 before publication), fall back to the
    // most recent available.
    const wanted = data.national[String(fiscalYear)];
    if (wanted) return wanted as DokladData;
    const years = Object.keys(data.national).map(Number).sort();
    return years.length > 0
      ? (data.national[String(years[years.length - 1])] as DokladData)
      : null;
  }, [data, fiscalYear]);

  // Year of ministry data shown. The selected fiscal year often lags the
  // execution-report publication cycle (selected FY = 2025 before any 2025
  // year-end reports exist), so fall back to the most recent year that
  // actually has per-ministry data.
  const ministryYear = useMemo(() => {
    if (!data) return null;
    if ((data.byMinistry[String(fiscalYear)] ?? []).length > 0)
      return fiscalYear;
    const yearsWithData = Object.keys(data.byMinistry)
      .map(Number)
      .filter((y) => (data.byMinistry[String(y)] ?? []).length > 0)
      .sort((a, b) => b - a);
    return yearsWithData[0] ?? null;
  }, [data, fiscalYear]);

  const ministries: MinistryRow[] = useMemo(() => {
    if (!data || ministryYear == null) return [];
    const summaries = data.byMinistry[String(ministryYear)] ?? [];
    return (summaries as MinistryHeadcountSummary[])
      .map((m) => ({
        adminId: m.adminId,
        name: lang === "bg" ? m.nameBg : m.nameEn,
        headcount: m.totalHeadcount.executed ?? 0,
        personnelEur: m.totalPersonnel.executed?.amountEur ?? 0,
        avgEur: m.avgAnnualCostPerFte?.amountEur ?? null,
      }))
      .filter((m) => m.headcount > 0 || m.personnelEur > 0)
      .sort((a, b) => b.personnelEur - a.personnelEur);
  }, [data, ministryYear, lang]);

  if (!data || (!current && ministries.length === 0)) return null;

  const RenderTooltip: FC<{
    active?: boolean;
    payload?: Array<{
      name: string;
      value: number;
      color: string;
      dataKey: string;
    }>;
    label?: string;
  }> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="rounded border bg-background p-2 text-xs shadow-sm">
        <div className="font-medium">{label}</div>
        {payload.map((p) => (
          <div key={p.name} style={{ color: p.color }}>
            {p.name}:{" "}
            {p.dataKey === "vacantPct"
              ? `${p.value.toFixed(1)}%`
              : p.value.toLocaleString("en-US")}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {t("personnel_section_title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("personnel_section_subtitle")}
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        {/* Big number + sparkline */}
        <div className="flex flex-col gap-4">
          {current && (
            <div>
              <div className="text-3xl font-bold">
                {current.positions.total.toLocaleString("en-US")}
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  {t("personnel_positions_word")}
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {current.positions.filled != null && (
                  <span>
                    {current.positions.filled.toLocaleString("en-US")}{" "}
                    {t("personnel_filled_word")}
                  </span>
                )}
                {current.positions.vacant != null &&
                  current.positions.total > 0 && (
                    <span>
                      {" · "}
                      {current.positions.vacant.toLocaleString("en-US")}{" "}
                      {t("personnel_vacant_word")} (
                      {(
                        (current.positions.vacant / current.positions.total) *
                        100
                      ).toFixed(1)}
                      %)
                    </span>
                  )}
              </div>
              {/* Central / territorial / long-term-vacancy split — the
                  Доклад's most distinct secondary signals. */}
              {(current.positions.central != null ||
                current.positions.territorial != null ||
                current.positions.vacantOverSixMonths != null) && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {current.positions.central != null && (
                    <>
                      <dt className="text-muted-foreground">
                        {t("personnel_central_label")}
                      </dt>
                      <dd className="tabular-nums text-right">
                        {current.positions.central.toLocaleString("en-US")}
                      </dd>
                    </>
                  )}
                  {current.positions.territorial != null && (
                    <>
                      <dt className="text-muted-foreground">
                        {t("personnel_territorial_label")}
                      </dt>
                      <dd className="tabular-nums text-right">
                        {current.positions.territorial.toLocaleString("en-US")}
                      </dd>
                    </>
                  )}
                  {current.positions.municipal != null && (
                    <>
                      <dt className="text-muted-foreground pl-3">
                        {t("personnel_municipal_label")}
                      </dt>
                      <dd className="tabular-nums text-right text-muted-foreground">
                        {current.positions.municipal.toLocaleString("en-US")}
                      </dd>
                    </>
                  )}
                  {current.positions.vacantOverSixMonths != null &&
                    current.positions.vacant != null &&
                    current.positions.vacant > 0 && (
                      <>
                        <dt className="text-muted-foreground">
                          {t("personnel_vacant_long_term")}
                        </dt>
                        <dd className="tabular-nums text-right">
                          {current.positions.vacantOverSixMonths.toLocaleString(
                            "en-US",
                          )}{" "}
                          <span className="text-muted-foreground">
                            (
                            {(
                              (current.positions.vacantOverSixMonths /
                                current.positions.vacant) *
                              100
                            ).toFixed(0)}
                            %)
                          </span>
                        </dd>
                      </>
                    )}
                </dl>
              )}
              {/* Count of administrative bodies (Доклад Table 1). Total =
                  central + territorial. Folded into the caption line. */}
              {(() => {
                const central = Object.values(
                  current.structureCounts.central,
                ).reduce((s, n) => s + n, 0);
                const territorial = Object.values(
                  current.structureCounts.territorial,
                ).reduce((s, n) => s + n, 0);
                const total = central + territorial;
                if (total === 0) return null;
                return (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("personnel_admin_bodies_caption", {
                      total,
                      central,
                      territorial,
                    })}
                  </div>
                );
              })()}
              <div className="mt-2 text-xs text-muted-foreground">
                {t("personnel_doklad_source")} — {current.year}
                {lang === "bg" ? " г." : ""}
              </div>
            </div>
          )}

          {trend.length > 1 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={trend}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  {/* Left axis = absolute positions on a TIGHT range so the
                      year-to-year variation (~5% across 9 years) is visible
                      instead of getting flattened against 0. Floor at the
                      lowest observed value minus a small breathing-room. */}
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10 }}
                    domain={[
                      (dataMin: number) =>
                        Math.floor((dataMin - 5000) / 5000) * 5000,
                      (dataMax: number) =>
                        Math.ceil((dataMax + 2000) / 5000) * 5000,
                    ]}
                    tickFormatter={(v) => compactN(v)}
                    width={42}
                  />
                  {/* Right axis = vacancy rate (%). The most analytically
                      interesting variable in the Доклад series. Floor at 0;
                      ceiling auto-scales with a 2pp ceiling padding so the
                      line doesn't clip if vacancy spikes above the historical
                      range. */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    domain={[
                      0,
                      (dataMax: number) => Math.max(12, Math.ceil(dataMax + 2)),
                    ]}
                    tickFormatter={(v) => `${v}%`}
                    width={32}
                  />
                  <Tooltip content={<RenderTooltip />} />
                  <Bar
                    yAxisId="left"
                    dataKey="filled"
                    name={t("personnel_filled_word")}
                    fill="hsl(var(--primary))"
                    opacity={0.55}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="total"
                    name={t("personnel_total_word")}
                    stroke="hsl(var(--foreground))"
                    strokeWidth={1.5}
                    dot={{ r: 2 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="vacantPct"
                    name={t("personnel_chart_vacant_pct")}
                    stroke="hsl(var(--destructive))"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    dot={{ r: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* NSI Table II-1 — actual headcount by administration type
              (excludes МВР + МО). The single most distinct insight in the
              Доклад: where the bodies are actually working. Shows as a
              proportional bar list ordered by size. */}
          {current &&
            (Object.keys(current.nsiHeadcount.central).length > 0 ||
              Object.keys(current.nsiHeadcount.territorial).length > 0) && (
              <NsiTypeBreakdown
                data={current.nsiHeadcount}
                year={current.year}
              />
            )}
        </div>

        {/* Top ministries */}
        {ministries.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium">
              {t("personnel_top_ministries_title", { year: ministryYear })}
            </div>
            <div className="space-y-1">
              {ministries.slice(0, 8).map((m) => (
                <Link
                  key={m.adminId}
                  to={`/budget/ministry/${m.adminId}`}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 rounded px-2 py-1 text-sm hover:bg-muted/50"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {compactN(m.headcount)}
                  </span>
                  <span className="tabular-nums">
                    {compactEur(m.personnelEur)}
                  </span>
                  <span className="tabular-nums text-muted-foreground text-xs">
                    {m.avgEur != null ? `${compactEur(m.avgEur)}/yr` : "—"}
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t("personnel_ministries_caveat")}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
