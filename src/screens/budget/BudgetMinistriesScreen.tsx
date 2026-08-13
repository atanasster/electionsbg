// /budget/ministries — the picker for /budget/ministry/:id.
//
// Plan: docs/plans/budget-hub-v1.md T6.2. This page is the whole point of §1.2:
// 55 spending-unit pages are prerendered and carry 110 sitemap <loc>s, and
// until now every inbound link to them was emitted by a tile ~15,000 px down
// the hub. A parameterised route with no picker is the skill's §4 smell.
//
// TWO NAMING RULES, both of which the corpus punishes getting wrong:
//
//   * These are ПЪРВОСТЕПЕННИ РАЗПОРЕДИТЕЛИ, not ministries. On FY2024, 28 of
//     the 48 are not — Администрация на президента, ДФ „Земеделие", ДАНС, КЕВР,
//     КФН. The URL says /ministries for continuity with /budget/ministry/:id;
//     nothing a reader sees does.
//   * `hasExecution` is not a quality signal. Most units have a plan and no
//     report — 8 of 48 carry one in the best year — so the absence is the
//     ministry's silence, not ours, and the chip says which.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useBudgetAdminList } from "@/data/budget/useBudgetAdminList";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

export const BudgetMinistriesScreen: FC = () => {
  const { t } = useTranslation();
  // ?q seeds the search box — the hub finder's „see all" lands here, and a
  // destination that ignores the param advertises a filtered page and delivers
  // an unfiltered one.
  const [q, setQ] = useSearchParam("q", { replace: true });
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });

  const { stats } = useBudgetHubStats();
  const fy =
    fyParam && /^\d{4}$/.test(fyParam)
      ? Number(fyParam)
      : (stats?.fiscalYear ?? null);

  const { rows, isLoading } = useBudgetAdminList(fy, q);

  // The denominator is the units that HAVE a plan in the selected year, not the
  // length of the list. The picker deliberately lists every unit ever, so every
  // /budget/ministry page stays reachable — but 55 of them is not the FY2026
  // population, which is 44. „0 of 55" would be a coverage claim over a set that
  // includes units the year never budgeted.
  const inYear = useMemo(() => rows.filter((r) => r.amount != null), [rows]);
  const covered = useMemo(
    () => inYear.filter((r) => r.hasExecution).length,
    [inYear],
  );
  const absent = rows.length - inYear.length;

  // An execution report cannot exist for a year that has not closed, so the
  // „липсата е тяхна" line must not be said about one. FY2026 and FY2025 carry
  // zero executed rows for exactly that reason, and the default `fy` IS the
  // newest year — so the untouched page was accusing all 44 units of silence
  // about a year nobody is late for yet.
  const newestYear = stats?.yearsAvailable?.length
    ? Math.max(...stats.yearsAvailable)
    : null;
  const reportable =
    covered > 0 || (fy != null && newestYear != null && fy < newestYear);

  const title = t("budget_units_title");
  const description = t("budget_units_description");

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_units_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_units_intro")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q ?? ""}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("budget_units_search_placeholder")}
            aria-label={t("budget_units_search_placeholder")}
            className="min-w-[16rem] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          />
          {stats?.yearsAvailable?.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {stats.yearsAvailable.map((y) => (
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

        {/* The coverage line, stated before the list rather than implied by it.
            Most units publish no execution report, so a page that showed only
            the plan would let a reader assume the rest spent nothing. */}
        {/* Suppressed while a search is active: `rows` is server-FILTERED, so
            „1 от 1 разпоредители са публикували отчет" would be a claim about
            every spending unit rendered from one hit. A filtered list has no
            coverage story to tell. */}
        {!isLoading && rows.length > 0 && !q ? (
          <p className="text-xs text-muted-foreground">
            {reportable
              ? t("budget_units_coverage", {
                  covered,
                  total: inYear.length,
                  defaultValue: "",
                })
              : t("budget_units_pending", { fy, defaultValue: "" })}{" "}
            {absent > 0
              ? t("budget_units_absent", {
                  count: absent,
                  defaultValue: "",
                })
              : null}
          </p>
        ) : null}

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_units_empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-sm">
            {rows.map((r) => (
              <li key={r.nodeId}>
                <Link
                  to={`/budget/ministry/${r.nodeId}`}
                  className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-primary">{r.nameBg || r.nodeId}</span>
                    {r.hasExecution ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        {t("budget_units_has_report")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.amount == null ? "—" : formatEur(r.amount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_units_source")}
        </p>
      </section>
    </>
  );
};
