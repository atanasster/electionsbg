// /budget/municipal/capital — the municipalities' own capital programmes.
//
// Plan: docs/plans/budget-hub-v1.md §8 / T6.14.
//
// ⚠️ COVERAGE IS THE HEADLINE. This corpus is whichever municipalities
// published a поименен списък and had it parsed: 9 of 265 in 2022, 13 in 2024,
// 24 in 2025, ONE in 2026. Every figure on this page is a sum over that set,
// never a national one — „€833m of municipal capital spending in 2025" from a
// 9% sample is the single claim this page exists not to make. So the covered
// count leads, the denominator sits beside it, and no total is ever labelled
// national.
//
// The other thing this corpus is good for is the FUNDING MIX, which the чл. 53
// page cannot show: how much of a municipality's capital programme is the
// state's money, how much its own, how much EU, how much borrowed. On the
// covered set in 2025 the state subsidy is 1.8% and own funds dominate.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import {
  useBudgetMuniCapital,
  type CapitalMuniRow,
} from "@/data/budget/useBudgetMuniCapital";

/** The funding sources, in the order the списък lists them. Each is NULL — not
 *  zero — where a municipality publishes no such column. */
const SOURCES: { key: keyof CapitalMuniRow; labelKey: string }[] = [
  { key: "ownFundsEur", labelKey: "budget_cap_own" },
  { key: "euFundsEur", labelKey: "budget_cap_eu" },
  { key: "stateSubsidyEur", labelKey: "budget_cap_state" },
  { key: "debtEur", labelKey: "budget_cap_debt" },
  { key: "carryOverEur", labelKey: "budget_cap_carry" },
  { key: "otherEur", labelKey: "budget_cap_other" },
];

export const BudgetMuniCapitalScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  // The corpus's OWN years — 2022-2026, not the module's. Fetched once with no
  // year so the list is known, then re-fetched for the chosen one.
  const { capital: index } = useBudgetMuniCapital(null);
  const years = useMemo(() => index?.yearsAvailable ?? [], [index]);

  // NEVER null. `budget_muni_capital(NULL)` aggregates across ALL FIVE YEARS —
  // 13 875 projects, Столична at €1.38bn — and rendered it under „За  г." with
  // no chip selected and „26 от 265" as a five-year union. Since this page has
  // no in-app link yet, that unlabelled five-year total WAS the only entry
  // point. A year outside the corpus (`?fy=1899` passed the four-digit test and
  // was then dropped by the route's own 1990-2100 clamp) resolves the same way.
  const requested = fyParam && /^\d{4}$/.test(fyParam) ? Number(fyParam) : null;
  const fy =
    requested != null && years.includes(requested)
      ? requested
      : (years[years.length - 1] ?? null);

  const { capital, isLoading } = useBudgetMuniCapital(fy);

  // Memoised: a bare `?? []` mints a new array every render, so `peak` below
  // recomputes on each one and any consumer keyed on it never settles.
  const rows = useMemo(() => capital?.rows ?? [], [capital]);
  const covered = capital?.covered ?? null;
  const total = capital?.totalMunicipalities ?? null;
  const sources = capital?.sources ?? null;

  const sourceRows = useMemo(() => {
    if (!sources) return [];
    const sum = SOURCES.reduce(
      (acc, s) =>
        acc + ((sources[s.key as keyof typeof sources] as number) ?? 0),
      0,
    );
    return SOURCES.map((s) => ({
      ...s,
      value: (sources[s.key as keyof typeof sources] as number) ?? 0,
      // Share of the SOURCES that were published, not of `covered.totalEur` —
      // the two differ wherever a municipality publishes a total without a
      // full breakdown, and dividing by the total would silently under-state
      // every component.
      pct:
        sum > 0
          ? (((sources[s.key as keyof typeof sources] as number) ?? 0) / sum) *
            100
          : null,
    })).filter((s) => s.value > 0);
  }, [sources]);

  const peak = useMemo(
    () => Math.max(...rows.map((r) => r.totalEur ?? 0), 1),
    [rows],
  );

  const title = t("budget_cap_title");

  return (
    <>
      <Title description={t("budget_cap_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_cap_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_cap_intro")}{" "}
          <Link to="/budget/municipal" className="text-primary hover:underline">
            {t("budget_muni_see_all")}
          </Link>
        </p>

        {years.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setFyParam(String(y))}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  y === fy
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border hover:border-primary/60",
                )}
              >
                {y}
              </button>
            ))}
          </div>
        ) : null}

        {/* THE COVERAGE, FIRST AND IN FULL. */}
        {/* The disclaimer is NOT gated on `totalMunicipalities`: that value
            comes from `obshtina_population`, owned by migration 149 and a
            different loader, so an empty table would have rendered every figure
            on this page with no qualification at all. Without the denominator
            the note names the covered count alone, which is still true. */}
        {!isLoading && covered ? (
          <p className="max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            {t(total ? "budget_cap_coverage" : "budget_cap_coverage_nodenom", {
              covered: covered.municipalityCount,
              total: total ?? "",
              projects: covered.projectCount,
              fy: fy ?? "",
              defaultValue: "",
            })}
          </p>
        ) : null}

        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl border bg-card" />
        ) : capital == null ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_cap_unavailable")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_cap_empty")}
          </p>
        ) : (
          <>
            {/* THE FUNDING MIX — the thing this corpus can say that чл. 53
                cannot. Explicitly scoped to the covered set. */}
            {sourceRows.length > 0 ? (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h2 className="text-sm font-semibold">
                  {/* The MIX's own count, never the page's. Only two
                      municipalities publish a breakdown at all; labelled „за 9
                      общини" on FY2023 this heading sat above Бургас alone. */}
                  {t("budget_cap_mix_h", {
                    covered: sources?.municipalityCount ?? 0,
                    defaultValue: "",
                  })}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("budget_cap_mix_note", {
                    munis: sources?.municipalityCount ?? 0,
                    covered: covered?.municipalityCount ?? 0,
                    amount:
                      sources?.totalEur == null
                        ? ""
                        : formatEur(sources.totalEur),
                    total:
                      covered?.totalEur == null
                        ? ""
                        : formatEur(covered.totalEur),
                    defaultValue: "",
                  })}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {sourceRows.map((s) => (
                    <li
                      key={String(s.key)}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-muted-foreground">
                        {t(s.labelKey)}
                      </span>
                      <span className="tabular-nums">
                        {formatEur(s.value)}
                        {s.pct != null ? (
                          <span className="ml-2 text-muted-foreground">
                            {s.pct.toFixed(1)}%
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ul className="divide-y rounded-xl border bg-card shadow-sm">
              {rows.map((r) => (
                <li key={r.obshtina} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {(bg ? r.nameBg || r.nameEn : r.nameEn || r.nameBg) ||
                        r.obshtina}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t(
                          r.projectCount === 1
                            ? "budget_cap_n_projects_one"
                            : "budget_cap_n_projects_other",
                          { count: r.projectCount, defaultValue: "" },
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {r.totalEur == null ? "—" : formatEur(r.totalEur)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded bg-primary/20" aria-hidden>
                    <div
                      className="h-1 rounded bg-primary"
                      style={{
                        width: `${Math.min(100, ((r.totalEur ?? 0) / peak) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_cap_source")}
        </p>
      </section>
    </>
  );
};
