// /judiciary — the Съдебна власт dashboard.
//
// The money half of the judiciary story lives on the ВСС awarder page (the
// VssPack: budget by spending body, self-financing, procurement). This screen is
// the half that money can't tell: how many cases arrive, how many the courts
// finish, how long it takes, and how heavily the bench is loaded — from the ВСС's
// own annual statistical tables, which are published only as 170-page PDFs.
//
// Dashboard shell (no tabs, stacked sections, homepage width) per the house UX.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import type { Scope } from "@/data/scope/useScope";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import {
  clearanceRate,
  useJudiciaryCaseload,
} from "@/data/judiciary/useCaseload";
import { useJudiciaryDeclarations } from "@/data/judiciary/useDeclarations";
import { CaseloadFlowTile } from "./CaseloadFlowTile";
import { WorkloadTile } from "./WorkloadTile";
import { TierTable } from "./TierTable";
import { DeclarationsTile } from "./DeclarationsTile";
import { IntegrityListsTile } from "./IntegrityListsTile";
import { JudicialAwardersTile } from "./JudicialAwardersTile";

export const JudiciaryScreen = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data, isLoading, isError } = useJudiciaryCaseload();
  // The declarations register is a second, independent artifact — it must not
  // gate the caseload tiles, so it renders on its own once it lands.
  const { data: declarations } = useJudiciaryDeclarations();

  // Resolve the picked year against the data rather than trusting the override:
  // if a refreshed caseload.json drops the year the user picked, fall back to the
  // newest one instead of rendering nothing (the picker lives inside this guard,
  // so a null year would leave the reader with no way to recover).
  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const year = useMemo(() => {
    if (!data?.years.length) return null;
    const want = yearOverride ?? data.latestYear;
    return data.years.find((y) => y.year === want) ?? data.years[0];
  }, [data, yearOverride]);
  const selectedYear = year?.year ?? null;

  // Map the year state onto the shared scope-control vocabulary, so /judiciary
  // reads exactly like the other government-entity dashboards: an "Обхват" strip
  // with a "Последна година" pill and a years dropdown. There is no cross-year
  // aggregate here, so the control's "All years" option is switched off.
  // The pill is active iff there is no override; otherwise the Select shows the
  // RESOLVED year. Collapsing `selectedYear === latestYear` to "ns" left the years
  // dropdown — which lists every year, latest included — with no item matching its
  // own value, so picking 2025 from it rendered the placeholder while "Последна
  // година" lit up. Showing the resolved (not the requested) year also keeps the
  // control honest when a refreshed caseload.json drops the year the user picked.
  const scopeValue: Scope =
    yearOverride != null && selectedYear != null ? `y:${selectedYear}` : "ns";
  const onScopeChange = (next: Scope) => {
    if (next === "ns" || next === "all") setYearOverride(null);
    else setYearOverride(Number(next.slice(2)));
  };
  const yearList = useMemo(() => data?.years.map((y) => y.year) ?? [], [data]);

  const int = (v: number) => formatInt(v, lang);
  const pct = (v: number) => formatPct(v, lang);

  const title = bg ? "Съдебна власт" : "The judiciary";
  const description = bg
    ? "Колко дела постъпват в българските съдилища, колко се решават, колко остават висящи, колко бързо и с каква натовареност на съдиите — по данни на ВСС от 2018 г. насам."
    : "How many cases enter Bulgaria's courts, how many are resolved, how many stay pending, how fast, and how heavily judges are loaded — from the Supreme Judicial Council's own statistics since 2018.";

  return (
    <>
      {/* Title emits the <SEO> tags itself when given a string child. */}
      <Title description={description}>{title}</Title>
      <SectorBreadcrumb currentKey="judiciary_nav" />

      {isLoading && (
        <div className="my-4 h-[320px] animate-pulse rounded-xl border bg-card" />
      )}

      {/* React Query settles a failed fetch as isLoading:false, data:undefined —
          without this branch the reader would get the title above nothing. */}
      {!isLoading && (isError || !data) && (
        <div className="my-4 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за съдебната власт не се заредиха. Опитай да презаредиш страницата."
            : "The judiciary data failed to load. Try reloading the page."}
        </div>
      )}

      {data && year && (
        <div className="space-y-4">
          {/* Scope strip — same slot and styling as the other entity dashboards.
              The annual tables are the only grain the ВСС publishes. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" />
              {bg ? "Обхват" : "Scope"}
            </span>
            <ScopeControl
              value={scopeValue}
              onChange={onScopeChange}
              years={yearList}
              allowAll={false}
              nsLabelOverride={bg ? "Последна година" : "Latest year"}
            />
          </div>

          {/* Headline KPIs */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label={bg ? "Постъпили дела" : "Cases filed"}
              hint={
                bg
                  ? `Новообразувани дела във всички съдилища през ${year.year} г.`
                  : `New cases across all courts in ${year.year}.`
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {int(year.total.filed)}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Свършени дела" : "Cases resolved"}
              hint={
                bg
                  ? "Дела, приключени през годината (с акт по същество или прекратени)."
                  : "Cases closed during the year (decided on the merits or terminated)."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {int(year.total.resolved)}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Приключваемост" : "Clearance rate"}
              hint={
                bg
                  ? "Свършени ÷ постъпили дела. Под 100% висящите дела растат."
                  : "Resolved ÷ filed. Below 100% the backlog grows."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {pct(clearanceRate(year.total))}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Решени в срок" : "Resolved in time"}
              hint={
                bg
                  ? "Дял на свършените дела, приключени в законовия 3-месечен срок."
                  : "Share of resolved cases closed within the statutory 3-month deadline."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {year.total.withinDeadlinePct}%
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Висящи дела" : "Pending cases"}
              hint={
                bg
                  ? "Неприключени дела в края на годината."
                  : "Cases still open at year end."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {int(year.total.pendingEnd)}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Съдии по щат" : "Judge posts"}
              hint={
                bg
                  ? "Общ брой съдийски места по щат във всички съдилища."
                  : "Total allocated judge posts across all courts."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {int(year.total.judges)}
              </span>
            </StatCard>
          </div>

          {/* Hero — the flow of cases and the backlog it leaves */}
          <CaseloadFlowTile years={data.years} />

          {/* Workload — the two official measures, side by side */}
          <WorkloadTile tiers={year.tiers} year={year.year} />

          {/* Per-tier league table */}
          <TierTable tiers={year.tiers} total={year.total} year={year.year} />

          {/* Integrity — the ИВСС declaration register (independent artifact) */}
          {declarations && (
            <>
              <DeclarationsTile data={declarations} />
              <IntegrityListsTile lists={declarations.integrity} />
            </>
          )}

          {/* Bridge to the money half of the story — one link per judicial body */}
          <JudicialAwardersTile />

          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "Данните са от „Обобщени статистически таблици за дейността на съдилищата“ на Висшия съдебен съвет (Приложение № 1), публикувани годишно като PDF. Обхватът са апелативните, военните, окръжните, районните и административните съдилища; ВКС, ВАС и прокуратурата се отчитат отделно и не са включени."
              : "Data from the Supreme Judicial Council's annual “Summary statistical tables on the activity of the courts” (Appendix 1), published as PDFs. Coverage is the appellate, military, regional, district and administrative courts; the supreme courts and the prosecution report separately and are not included."}{" "}
            <a
              href={data.source.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary hover:underline"
            >
              {bg ? "Източник: ВСС" : "Source: ВСС"}
            </a>
          </p>
        </div>
      )}
    </>
  );
};
