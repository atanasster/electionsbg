// /budget/functional — what the money is spent ON, by function (COFOG).
//
// Plan: docs/plans/budget-hub-v1.md T6.8.
//
// THIS PAGE'S PERIMETER IS NOT THE MODULE'S. Every other page here reports the
// STATE budget — €24.78bn of expenditure on FY2024. This one is Eurostat's S13:
// general government, i.e. the state PLUS municipalities PLUS the social funds,
// €41.06bn on the same year. A reader arriving from /budget/spending will
// otherwise conclude the site cannot add up, and — worse — read GF07's €5.6bn as
// „what the state spends on health" when the state budget's own health line is a
// different number entirely.
//
// TWO MORE THINGS THE SOURCE FORCES:
//
//   * FUNCTIONS, NOT INSTITUTIONS. „Здравеопазване" is all health spending by
//     every level of government, not the Ministry of Health's budget.
//   * THE SERIES ENDS BEFORE THE MODULE'S. COFOG runs 2010-2024 while the КФП
//     feed reaches 2026, so the default year has no functional breakdown at all.
//     An empty page there must name the coverage rather than read as „nothing
//     was spent" — the same failure /budget/explorer's functional arm has.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { cofogLabelKey } from "@/lib/cofog";
import { useBudgetFunctional } from "@/data/budget/useBudgetFunctional";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

/** Server-resolved bases.
 *
 *  `share` is deliberately absent: every row already carries `pctOfTotal`, and
 *  offering the same number twice in two units on one screen is what §7.1
 *  forbids.
 *
 *  `capita` is absent for a harder reason — `budget_fiscal_year.population` is
 *  NULL on every row, so it resolves to null for all ten divisions in all
 *  fifteen years. `rows.length` is still 10, so the empty branch never fires
 *  and the page renders ten em dashes with live percentages and bars beside
 *  them. A control that cannot answer is worse than a control that is not
 *  offered; it comes back when the column is populated. */
const BASES = ["eur", "gdp"] as const;
type Basis = (typeof BASES)[number];
const isBasis = (v: string): v is Basis =>
  (BASES as readonly string[]).includes(v);

/** `budget_fiscal_year` — the source of `gdp_eur` — starts in 2021, while COFOG
 *  starts in 2010. Before that year `?basis=gdp` is the same ten-em-dash
 *  failure, so the control is hidden rather than dead. */
const GDP_FIRST_YEAR = 2021;

export const BudgetFunctionalScreen: FC = () => {
  const { t } = useTranslation();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const [basisParam, setBasisParam] = useSearchParam("basis", {
    replace: true,
  });
  const { stats } = useBudgetHubStats();
  const requestedBasis: Basis =
    basisParam && isBasis(basisParam) ? basisParam : "eur";

  // The COFOG series stops before the КФП feed does, so the default year must
  // come from THIS corpus rather than from the module's newest year — otherwise
  // the page opens empty on every visit.
  const coverageMax = useMemo(() => {
    const ys = stats?.cofogYears ?? null;
    return ys?.length ? Math.max(...ys) : null;
  }, [stats]);
  const requested = fyParam && /^\d{4}$/.test(fyParam) ? Number(fyParam) : null;
  const fy = requested ?? coverageMax ?? null;

  // Resolve the basis against what the YEAR can serve, and hand the control the
  // same resolved value — the pill and the numbers must be one value, per the
  // URL-contract rule in CLAUDE.md.
  const gdpAvailable = fy != null && fy >= GDP_FIRST_YEAR;
  const basis: Basis =
    requestedBasis === "gdp" && !gdpAvailable ? "eur" : requestedBasis;
  const availableBases = BASES.filter((b) => b !== "gdp" || gdpAvailable);

  const { functional, isLoading } = useBudgetFunctional(fy, basis);
  // Sorted HERE by share, not trusted from the server. `budget_cofog_list`
  // orders by `amount DESC NULLS LAST`, so on any basis that cannot resolve
  // every amount ties at null and the list silently falls back to code order —
  // „Общи държавни служби 7,5%" above „Социална закрила 36,8%", with both
  // percentages correct. `pctOfTotal` is basis-independent and always present.
  const rows = useMemo(
    () =>
      [...(functional?.rows ?? [])].sort(
        (a, b) => (b.pctOfTotal ?? 0) - (a.pctOfTotal ?? 0),
      ),
    [functional],
  );
  const total = functional?.totalEur ?? null;

  const renderAmount = (v: number | null): string => {
    if (v == null) return "—";
    return basis === "eur" ? formatEur(v) : `${v.toFixed(1)}%`;
  };

  const title = t("budget_func_title");
  const peak = useMemo(
    () => Math.max(...rows.map((r) => r.pctOfTotal ?? 0), 1),
    [rows],
  );

  return (
    <>
      <Title description={t("budget_func_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_func_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_func_intro")}
        </p>

        {/* THE PERIMETER, before any number. Read from the payload rather than
            hard-coded, so a change in the SQL cannot leave a stale caption. */}
        {functional?.perimeter ? (
          <p className="max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
            {t("budget_func_perimeter", {
              total: total == null ? "" : formatEur(total),
              defaultValue: "",
            })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {stats?.cofogYears?.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {stats.cofogYears.map((y) => (
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

          <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("budget_basis_label")}
          </span>
          {availableBases.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasisParam(b === "eur" ? "" : b)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                b === basis
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-border hover:border-primary/60",
              )}
            >
              {b === "eur" ? "€" : t("budget_basis_gdp")}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="h-80 animate-pulse rounded-xl border bg-card" />
        ) : rows.length === 0 ? (
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("budget_func_empty")}{" "}
            {/* The coverage, named. Without it a year past 2024 reads as „the
                state spent nothing on anything". */}
            {coverageMax && fy && fy > coverageMax
              ? t("budget_func_empty_coverage", {
                  year: coverageMax,
                  defaultValue: "",
                })
              : null}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-sm">
            {rows.map((r) => (
              <li key={r.code} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    {/* Labelled from `@/lib/cofog`: the corpus's own name
                        columns are NULL on every row of every year. */}
                    {(() => {
                      const key = cofogLabelKey(r.code);
                      return key ? t(key) : r.code;
                    })()}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {renderAmount(r.amount)}
                    {r.pctOfTotal != null ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.pctOfTotal.toFixed(1)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                {r.pctOfTotal != null ? (
                  <div className="mt-1 h-1 rounded bg-primary/20" aria-hidden>
                    <div
                      className="h-1 rounded bg-primary"
                      style={{
                        width: `${Math.min(100, (r.pctOfTotal / peak) * 100)}%`,
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* Functions, not institutions — the misreading this page most invites. */}
        <p className="max-w-3xl text-xs text-muted-foreground">
          {t("budget_func_not_ministries")}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_func_source", {
            source: functional?.source ?? "Eurostat gov_10a_exp",
            defaultValue: "",
          })}
        </p>
      </section>
    </>
  );
};
