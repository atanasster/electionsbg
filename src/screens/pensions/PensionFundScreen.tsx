// /pension-fund/:slug — one private pension fund (КФН pillars 2 & 3).
//
// The trend is the point, and it only exists because the ingest now RETAINS
// quarters (T5a): the served file used to be a single snapshot, so this page
// would have been a static card. It shows the quarters the fund actually
// appears in — never padded — because a fund that launched mid-series did not
// exist at zero assets, it did not exist.
//
// A fund is big or small relative to ITS PILLAR, not to the whole market: a
// voluntary (ДПФ) fund and a universal (УПФ) one are not comparable, so the
// share is computed within the pillar.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PiggyBank, Users, Building2, TrendingUp } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useKfnFund } from "@/data/budget/useBudget";
import { kfnFundSlug, kfnFundName } from "@/lib/kfnFundSlug";
import { kfnSharePct } from "@/lib/kfnPeriod";
import { formatEur, formatEurCompact } from "@/lib/currency";

export const PensionFundScreen: FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const { fund, isLoading } = useKfnFund(slug);

  const row = fund?.latest.row ?? null;
  // Composed, not `row.fundName` — that field is in the ARCHIVE's language, so
  // the raw value puts Cyrillic on the English page and will put Latin on the
  // Bulgarian one after the next English ingest.
  const displayName = row
    ? kfnFundName(row.pillar, row.companyBg, row.companyEn, bg)
    : null;
  const pillarLabel = row ? (bg ? row.pillarLabelBg : row.pillarLabelEn) : "";
  const share =
    row && fund && fund.typeTotal > 0
      ? ((row.netAssetsEur ?? 0) / fund.typeTotal) * 100
      : null;
  // First and last quarter the fund appears in — the honest growth window.
  const first = fund?.series[0] ?? null;
  // >= 2 quarters, not merely a positive first value: on a single-quarter
  // archive `first` IS `latest`, and the card rendered "+0.0% since 2026 Q1".
  const growth =
    fund &&
    fund.series.length >= 2 &&
    first &&
    row &&
    (first.row.netAssetsEur ?? 0) > 0
      ? ((row.netAssetsEur ?? 0) / (first.row.netAssetsEur ?? 1) - 1) * 100
      : null;

  return (
    <>
      <Title
        description={
          row
            ? bg
              ? `${displayName} — нетни активи, осигурени лица и дял в стълба, по тримесечни данни на КФН.`
              : `${displayName} — net assets, insured persons and share of its pillar, from the FSC's quarterly register.`
            : bg
              ? "Частен пенсионен фонд."
              : "A private pension fund."
        }
      >
        {displayName ?? (bg ? "Непознат фонд" : "Unknown fund")}
      </Title>

      {isLoading ? (
        <div className="my-6 h-40 animate-pulse rounded-xl border bg-card" />
      ) : !fund || !row ? (
        // Soft 404 — deliberately does NOT reflect the raw slug into the
        // heading, which would mint an indexable page named after the URL.
        <p className="my-8 text-center text-muted-foreground">
          {bg
            ? "Няма такъв фонд в регистъра на КФН."
            : "No such fund in the FSC register."}
        </p>
      ) : (
        <section aria-label={displayName ?? ""} className="my-4">
          {/* Every card below is AS OF the fund's own latest quarter, which is
              not necessarily the archive's: a fund that closed shows its last
              filing. Saying it once beats labelling one card and letting the
              other three read as current. */}
          <p className="mb-3 text-xs text-muted-foreground">
            {bg
              ? `Данни към ${fund.latest.periodLabel} (КФН).`
              : `As of ${fund.latest.periodLabel} (FSC).`}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={bg ? "Нетни активи" : "Net assets"}>
              <div className="flex items-baseline gap-2">
                <PiggyBank className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {formatEurCompact(row.netAssetsEur, L)}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {fund.latest.periodLabel}
              </span>
            </StatCard>
            <StatCard label={bg ? "Осигурени лица" : "Insured"}>
              <div className="flex items-baseline gap-2">
                <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {(row.insured ?? 0).toLocaleString(L)}
                </span>
              </div>
            </StatCard>
            <StatCard label={bg ? "Дял сред същия вид" : "Share of fund type"}>
              <div className="flex items-baseline gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {share != null ? kfnSharePct(share, L) : "—"}
                </span>
              </div>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {pillarLabel}
              </span>
            </StatCard>
            {growth != null && first && (
              <StatCard label={bg ? "Промяна" : "Change"}>
                <div className="flex items-baseline gap-2">
                  <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-2xl font-bold tabular-nums">
                    {growth > 0 ? "+" : ""}
                    {growth.toFixed(1)}%
                  </span>
                </div>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {bg ? "от" : "since"} {first.periodLabel}
                </span>
              </StatCard>
            )}
          </div>

          <DashboardSection
            id="pension-fund-trend"
            title={bg ? "По тримесечия" : "By quarter"}
            icon={TrendingUp}
          >
            <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 pr-2 text-left font-normal">
                        {bg ? "Тримесечие" : "Quarter"}
                      </th>
                      <th className="py-1.5 pr-2 text-right font-normal">
                        {bg ? "Нетни активи" : "Net assets"}
                      </th>
                      <th className="py-1.5 text-right font-normal">
                        {bg ? "Осигурени" : "Insured"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {fund.series.map((q) => (
                      <tr key={q.period} className="hover:bg-muted/40">
                        <td className="py-1.5 pr-2">{q.periodLabel}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {formatEur(q.row.netAssetsEur, L)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {(q.row.insured ?? 0).toLocaleString(L)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fund.series.length < 2 && (
                // Say it rather than showing a one-row "trend". The archive
                // starts where the ingest started; older quarters need their
                // ZIP seeded (see the update-noi skill).
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  {bg
                    ? "Само едно тримесечие в архива — по-старите се добавят при следващо зареждане."
                    : "Only one quarter in the archive — older ones are added as they are ingested."}
                </p>
              )}
            </div>
          </DashboardSection>

          {fund.siblings.length > 0 && (
            <DashboardSection
              id="pension-fund-siblings"
              title={
                bg
                  ? `Другите фондове на ${row.companyBg}`
                  : `${row.companyEn}'s other funds`
              }
              icon={Building2}
            >
              <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
                <ul className="divide-y">
                  {fund.siblings.map((s) => (
                    <li key={s.pillar}>
                      <Link
                        to={`/pension-fund/${kfnFundSlug(s.pillar, s.companyEn)}`}
                        className="flex items-baseline justify-between gap-3 py-2 hover:text-primary"
                      >
                        <span className="min-w-0 truncate">
                          {kfnFundName(s.pillar, s.companyBg, s.companyEn, bg)}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {bg ? s.pillarLabelBg : s.pillarLabelEn}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                          {formatEurCompact(s.netAssetsEur, L)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </DashboardSection>
          )}

          <p className="mt-6 text-center text-sm">
            <Link to="/pensions" className="text-primary hover:underline">
              ← {bg ? "Пенсии" : "Pensions"}
            </Link>
          </p>
        </section>
      )}
    </>
  );
};
