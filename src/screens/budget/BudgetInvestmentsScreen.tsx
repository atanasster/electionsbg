// /budget/investments — the state's investment programme.
//
// Plan: docs/plans/budget-hub-v1.md T6.10.
//
// ⚠️ THIS IS A PLAN, NOT SPENDING. The source is Приложение III to the budget
// act — the list of projects the law APPROPRIATES money for. Nothing here says
// a project was built, started, or that the money left the treasury. Every
// other page in this module reports execution against plan; this one has no
// execution side at all, and the copy says so before any figure.
//
// TWO MORE THINGS THE SOURCE FORCES:
//
//   * ONE YEAR. The programme exists for 2025 only, so there is no trend and no
//     year-on-year claim to make. The picker lists what the index actually has.
//   * TOP 50 OF 3 065, covering 20.81% of the money (measured). `topProjects`
//     is a leaderboard, not the corpus; rendered under „проектите" it invites a
//     reader to sum a column that is a fifth of the programme.
//
// The source is JSON rather than Postgres, unlike its siblings — the investment
// programme was never migrated. That is fine here: this is a SUB-page, and §1.2's
// payload budget is about the hub, which does not fetch it.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import {
  useInvestmentProgramIndex,
  useInvestmentProgram,
} from "@/data/budget/useBudget";

type Dim = "category" | "oblast";

/** The artifact builder's sentinel for projects whose place it could not
 *  resolve — 91 of 3 065 on FY2025, €113.3m, ranked 15th of 29. It must be
 *  LABELLED rather than filtered: the rollup rows sum to `grandTotal` exactly,
 *  and only because this row is among them. Dropped, every percentage on the
 *  page would be a share of a denominator the rows no longer cover. */
const UNRESOLVED_KEY = "_unresolved";

export const BudgetInvestmentsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const [dimParam, setDimParam] = useSearchParam("dim", { replace: true });
  const dim: Dim = dimParam === "oblast" ? "oblast" : "category";

  const { data: index } = useInvestmentProgramIndex();
  // The default year comes from the INDEX, not from the module's newest year:
  // the programme exists for 2025 alone, and the budget module reaches 2026.
  const years = useMemo(
    () => (index?.years ?? []).map((y) => y.fiscalYear).sort((a, b) => a - b),
    [index],
  );
  const requested = fyParam && /^\d{4}$/.test(fyParam) ? Number(fyParam) : null;
  const fy =
    requested != null && years.includes(requested)
      ? requested
      : (years[years.length - 1] ?? undefined);

  const { data: program, isLoading } = useInvestmentProgram(fy);

  const rows = useMemo(() => {
    const src = dim === "oblast" ? program?.byOblast : program?.byCategory;
    return [...(src ?? [])].sort(
      (a, b) => (b.total?.amountEur ?? 0) - (a.total?.amountEur ?? 0),
    );
  }, [program, dim]);

  const total = program?.grandTotal?.amountEur ?? null;
  const peak = useMemo(
    () => Math.max(...rows.map((r) => r.total?.amountEur ?? 0), 1),
    [rows],
  );

  const title = t("budget_inv_title");

  return (
    <>
      <Title description={t("budget_inv_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_inv_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-5">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_inv_intro")}
        </p>

        {/* PLAN, NOT SPENDING — before any number. */}
        <p className="max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
          {t("budget_inv_plan_warning")}
        </p>

        {years.length > 1 ? (
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

        {/* `isLoading` is FALSE while the index is still in flight: `fy` is
            undefined until it lands, the program query is `enabled: false`, and
            React Query v5 computes `isLoading` as `isPending && isFetching`. So
            the untouched page announced „Няма данни" on first paint, before it
            had asked for anything. */}
        {isLoading || fy == null ? (
          <div className="h-72 animate-pulse rounded-xl border bg-card" />
        ) : !program ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_inv_empty")}
          </p>
        ) : (
          <>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t("budget_inv_level_h", { fy, defaultValue: "" })}
              </h2>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {total == null ? "—" : formatEur(total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("budget_inv_project_count", {
                  count: program.projectCount,
                  defaultValue: "",
                })}
              </p>
            </div>

            {/* The dimension is the page's question, not a tab. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("budget_explorer_dimension_label")}
              </span>
              {(["category", "oblast"] as Dim[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDimParam(d === "category" ? "" : d)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    d === dim
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border hover:border-primary/60",
                  )}
                >
                  {d === "category"
                    ? t("budget_inv_dim_category")
                    : t("budget_inv_dim_oblast")}
                </button>
              ))}
            </div>

            <ul className="divide-y rounded-xl border bg-card shadow-sm">
              {rows.map((r) => {
                const v = r.total?.amountEur ?? 0;
                const share = total ? (v / total) * 100 : null;
                return (
                  <li key={r.key} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        {/* `||`, not `??` — an unmapped label is stored as the
                            empty string, which `??` sails past. */}
                        {r.key === UNRESOLVED_KEY
                          ? t("budget_inv_unresolved")
                          : (bg
                              ? r.labelBg || r.labelEn
                              : r.labelEn || r.labelBg) || r.key}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("budget_inv_n_projects", {
                            count: r.count,
                            defaultValue: "",
                          })}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatEur(v)}
                        {share != null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {share.toFixed(1)}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-1 h-1 rounded bg-primary/20" aria-hidden>
                      <div
                        className="h-1 rounded bg-primary"
                        style={{ width: `${Math.min(100, (v / peak) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* THE LEADERBOARD, LABELLED AS ONE. */}
            {program.topProjects?.length ? (
              <div>
                <h2 className="mb-1 text-sm font-semibold">
                  {t("budget_inv_top_h", {
                    shown: program.topProjects.length,
                    total: program.projectCount,
                    defaultValue: "",
                  })}
                </h2>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("budget_inv_top_note")}
                </p>
                <ul className="divide-y rounded-xl border bg-card shadow-sm">
                  {program.topProjects.map((p) => (
                    <li key={p.projectId} className="px-4 py-2 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        {/* The PDF parse yields a few unbroken 200-char tokens;
                            without these the euro amount is pushed off-screen
                            at 375px. */}
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {p.name}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatEur(p.cost?.amountEur ?? 0)}
                        </span>
                      </div>
                      {p.municipalityNameBg || p.oblastNameBg ? (
                        <span className="text-xs text-muted-foreground">
                          {[p.municipalityNameBg, p.oblastNameBg]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] text-muted-foreground/80">
              {t("budget_inv_source")}{" "}
              {program.source?.url ? (
                <a
                  href={program.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {t("budget_inv_source_link")}
                </a>
              ) : null}
            </p>
          </>
        )}
      </section>
    </>
  );
};
