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
}

interface MinistryRow {
  adminId: string;
  name: string;
  headcount: number;
  personnelEur: number;
  avgEur: number | null;
}

const sectionTitle = (lang: "bg" | "en"): string =>
  lang === "bg" ? "Численост на персонала" : "Public-sector workforce";
const sectionSubtitle = (lang: "bg" | "en"): string =>
  lang === "bg"
    ? "Колко души работят за държавата и колко им се плаща"
    : "How many people work for the state and how much they're paid";

export const BudgetPersonnelTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data } = usePersonnel();

  const trend: TrendDatum[] = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.national)
      .map(Number)
      .sort()
      .map((y) => {
        const d = data.national[String(y)] as DokladData;
        return {
          year: String(y),
          total: d.positions.total,
          filled: d.positions.filled,
          vacant: d.positions.vacant,
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

  const renderTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
  }): JSX.Element | null => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="rounded border bg-background p-2 text-xs shadow-sm">
        <div className="font-medium">{label}</div>
        {payload.map((p) => (
          <div key={p.name} style={{ color: p.color }}>
            {p.name}: {p.value.toLocaleString("en-US")}
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
          {sectionTitle(lang)}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{sectionSubtitle(lang)}</p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        {/* Big number + sparkline */}
        <div className="flex flex-col gap-4">
          {current && (
            <div>
              <div className="text-3xl font-bold">
                {current.positions.total.toLocaleString("en-US")}
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  {lang === "bg" ? "щатни бройки" : "positions"}
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {current.positions.filled != null && (
                  <span>
                    {current.positions.filled.toLocaleString("en-US")}{" "}
                    {lang === "bg" ? "заети" : "filled"}
                  </span>
                )}
                {current.positions.vacant != null &&
                  current.positions.total > 0 && (
                    <span>
                      {" · "}
                      {current.positions.vacant.toLocaleString("en-US")}{" "}
                      {lang === "bg" ? "незаети" : "vacant"} (
                      {(
                        (current.positions.vacant / current.positions.total) *
                        100
                      ).toFixed(1)}
                      %)
                    </span>
                  )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {lang === "bg"
                  ? `Доклад за състоянието на администрацията — ${current.year} г.`
                  : `Report on the State of the Administration — ${current.year}`}
              </div>
            </div>
          )}

          {trend.length > 1 && (
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    domain={["dataMin - 2000", "dataMax + 2000"]}
                    tickFormatter={(v) => compactN(v)}
                  />
                  <Tooltip content={renderTooltip} />
                  <Bar
                    dataKey="vacant"
                    name={lang === "bg" ? "Незаети" : "Vacant"}
                    fill="hsl(var(--muted-foreground))"
                    opacity={0.4}
                    stackId="positions"
                  />
                  <Bar
                    dataKey="filled"
                    name={lang === "bg" ? "Заети" : "Filled"}
                    fill="hsl(var(--primary))"
                    opacity={0.7}
                    stackId="positions"
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name={lang === "bg" ? "Общо" : "Total"}
                    stroke="hsl(var(--foreground))"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Top ministries */}
        {ministries.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium">
              {lang === "bg"
                ? `Топ министерства по разходи за персонал — ${ministryYear} г.`
                : `Top ministries by personnel spending — ${ministryYear}`}
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
              {lang === "bg"
                ? "Само министерства, които публикуват „Численост на щатния персонал“ в програмния отчет. МО не публикува (класифицирано)."
                : "Only ministries that publish staffing data in their program-budget execution report. MOD does not (classified)."}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
