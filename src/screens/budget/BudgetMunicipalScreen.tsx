// /budget/municipal — what the state sends every municipality.
//
// Plan: docs/plans/budget-hub-v1.md §8 / T6.12. Source: чл. 53 of the budget
// act — the per-municipality transfer table, 265 rows a year, 2018-2026.
//
// TWO THINGS THIS PAGE MUST NOT DO:
//
//   * SUM IT WITH `municipal_fiscal`. That corpus (migration 149) is what
//     municipalities OWE — поети ангажименти, задължения, просрочия. This one
//     is what the state SENDS. Different grain, different source, and adding
//     them produces a number that means nothing. 154's header exists to say so.
//   * RANK BY TOTAL AND CALL IT FAIRNESS. Столична gets €718m and Трекляно
//     €2.2m; per resident that is €564 against €5 028, a 9x inversion. BOTH are
//     true and neither is the whole story — a municipality of 434 people still
//     needs a mayor's office and a school, and those costs do not shrink with
//     the population. The page offers both bases and says why they differ.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useBudgetMunicipal } from "@/data/budget/useBudgetMunicipal";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

const BASES = ["total", "capita"] as const;
type Basis = (typeof BASES)[number];

/** The components, in the order the act lists them. `equalizationEur` is NULL —
 *  not zero — where a municipality receives none. */
const PARTS: { key: keyof PartSource; labelKey: string }[] = [
  { key: "delegatedEur", labelKey: "budget_muni_delegated" },
  { key: "equalizationEur", labelKey: "budget_muni_equalization" },
  { key: "capitalEur", labelKey: "budget_muni_capital" },
  { key: "winterEur", labelKey: "budget_muni_winter" },
  { key: "otherTargetedEur", labelKey: "budget_muni_other" },
];
type PartSource = {
  delegatedEur: number | null;
  equalizationEur: number | null;
  capitalEur: number | null;
  winterEur: number | null;
  otherTargetedEur: number | null;
};

export const BudgetMunicipalScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const [q, setQ] = useSearchParam("q", { replace: true });
  const [basisParam, setBasisParam] = useSearchParam("basis", {
    replace: true,
  });
  const basis: Basis = basisParam === "capita" ? "capita" : "total";

  const { stats } = useBudgetHubStats();
  // THIS table's coverage (2018-2026), not the КФП feed's (2021-2026). Built
  // from `yearsAvailable` the picker omitted three years the corpus has, and
  // ?fy=2018 rendered correctly with no chip selected.
  const years = useMemo(
    () => [...(stats?.muniYears ?? stats?.yearsAvailable ?? [])],
    [stats],
  );
  const requested = fyParam && /^\d{4}$/.test(fyParam) ? Number(fyParam) : null;
  const fy =
    requested != null && years.includes(requested)
      ? requested
      : (years[years.length - 1] ?? stats?.fiscalYear ?? null);

  const { municipal, isLoading } = useBudgetMunicipal(fy, q);

  const rows = useMemo(() => {
    const src = municipal?.rows ?? [];
    return [...src].sort((a, b) =>
      basis === "capita"
        ? (b.totalPerCapitaEur ?? 0) - (a.totalPerCapitaEur ?? 0)
        : (b.totalEur ?? 0) - (a.totalEur ?? 0),
    );
  }, [municipal, basis]);

  /** The envelope. Summed over the ROWS RETURNED, so a search narrows it — and
   *  the heading says which, rather than letting a filtered sum read as the
   *  national total. */
  const envelope = useMemo(
    () => rows.reduce((acc, r) => acc + (r.totalEur ?? 0), 0),
    [rows],
  );
  const partTotals = useMemo(
    () =>
      PARTS.map((p) => ({
        ...p,
        value: rows.reduce((acc, r) => acc + (r[p.key] ?? 0), 0),
      })).filter((p) => p.value > 0),
    [rows],
  );

  const peak = useMemo(
    () =>
      Math.max(
        ...rows.map((r) =>
          basis === "capita" ? (r.totalPerCapitaEur ?? 0) : (r.totalEur ?? 0),
        ),
        1,
      ),
    [rows, basis],
  );

  /** From the payload, not hard-coded: the page must not outlive the census it
   *  divides by. */
  const censusYear = rows.find((r) => r.censusYear != null)?.censusYear ?? null;

  const title = t("budget_muni_title");

  return (
    <>
      <Title description={t("budget_muni_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_muni_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_muni_intro")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q ?? ""}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("budget_muni_search_placeholder")}
            aria-label={t("budget_muni_search_placeholder")}
            className="min-w-[14rem] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          />
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
        </div>

        {/* The envelope, and whether it is the whole one. */}
        {!isLoading && rows.length > 0 ? (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {/* „Сбор за 1 намерени общини" does not agree in Bulgarian, and
                  one result is the most common filtered state. The suffix is
                  chosen here rather than left to i18next's `count`, because the
                  suite mocks `t` with a plain regex replace and would never see
                  a plural break. */}
              {t(
                q
                  ? rows.length === 1
                    ? "budget_muni_envelope_filtered_one"
                    : "budget_muni_envelope_filtered_other"
                  : "budget_muni_envelope",
                { fy, count: rows.length, defaultValue: "" },
              )}
            </h2>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatEur(envelope)}
            </p>
            {partTotals.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-xs">
                {partTotals.map((p) => (
                  <li
                    key={p.key}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-muted-foreground">
                      {t(p.labelKey)}
                    </span>
                    <span className="tabular-nums">
                      {formatEur(p.value)}
                      <span className="ml-2 text-muted-foreground">
                        {envelope
                          ? `${((p.value / envelope) * 100).toFixed(1)}%`
                          : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* The basis, and the sentence that keeps it honest. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("budget_basis_label")}
          </span>
          {BASES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasisParam(b === "total" ? "" : b)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                b === basis
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-border hover:border-primary/60",
              )}
            >
              {b === "total"
                ? t("budget_muni_basis_total")
                : t("budget_muni_basis_capita")}
            </button>
          ))}
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {t(
            basis === "capita"
              ? "budget_muni_capita_note"
              : "budget_muni_total_note",
          )}
          {/* The denominator's vintage, beside the division rather than only in
              the source line at the foot: a 2026 transfer over a 2021 census is
              a real approximation and the reader is doing the comparing. */}
          {basis === "capita" && censusYear ? (
            <>
              {" "}
              {t("budget_muni_census_note", {
                year: censusYear,
                defaultValue: "",
              })}
            </>
          ) : null}
        </p>

        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl border bg-card" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_muni_empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-sm">
            {rows.map((r) => {
              const v = basis === "capita" ? r.totalPerCapitaEur : r.totalEur;
              return (
                <li key={r.obshtina} className="px-4 py-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {(bg ? r.nameBg || r.nameEn : r.nameEn || r.nameBg) ||
                        r.obshtina}
                      {r.population != null ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("budget_muni_residents", {
                            n: new Intl.NumberFormat("bg-BG").format(
                              r.population,
                            ),
                            defaultValue: "",
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {v == null ? "—" : formatEur(v)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded bg-primary/20" aria-hidden>
                    <div
                      className="h-1 rounded bg-primary"
                      style={{
                        width: `${Math.min(100, ((v ?? 0) / peak) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* The boundary with the OTHER municipal corpus, stated. */}
        <p className="max-w-3xl text-xs text-muted-foreground">
          {t("budget_muni_not_liabilities")}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_muni_source")}
        </p>
      </section>
    </>
  );
};
