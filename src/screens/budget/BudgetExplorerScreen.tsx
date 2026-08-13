// /budget/explorer — drill through the budget, one level per call.
//
// Plan: docs/plans/budget-hub-v1.md §7.2 / T6.1. The pattern is USAspending's
// Spending Explorer: the DIMENSION is the page's first question rather than a
// tab, and a persistent breadcrumb shows each level's own total.
//
// Three things here are load-bearing rather than stylistic:
//
//   * ONE LEVEL PER CALL. The whole tree in one payload is the thing being
//     retired; `budget_explorer()` returns a level and the breadcrumb is free.
//   * THE CAPTION LIVES INSIDE THE DIMENSION BRANCH. This page has two
//     aggregates and one caption slot, so a caption written outside the branch
//     describes the other one — the skill's §6 rule, and here it would claim
//     the state budget is a general-government total.
//   * THE URL CARRIES THE WHOLE POSITION (dimension + path + fy + basis), so a
//     level is linkable and the back button works.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import {
  useBudgetExplorer,
  type BudgetDimension,
} from "@/data/budget/useBudgetExplorer";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

const DIMENSIONS: BudgetDimension[] = ["admin", "functional"];
const isDimension = (v: string): v is BudgetDimension =>
  (DIMENSIONS as string[]).includes(v);

/** The four bases, resolved SERVER-side (migration 155). The control only
 *  names which one to ask for — a second implementation here is what the plan's
 *  §7.1 forbids, because two divisions drift. */
const BASES = ["eur", "gdp", "share"] as const;
type Basis = (typeof BASES)[number];
const isBasis = (v: string): v is Basis =>
  (BASES as readonly string[]).includes(v);

/** How a figure reads under each basis. The unit belongs to the basis, not to
 *  the number, so it is decided in one place. */
const renderAmount = (amount: number | null, basis: Basis): string => {
  if (amount == null) return "—";
  if (basis === "eur") return formatEur(amount);
  return `${amount.toFixed(1)}%`;
};

export const BudgetExplorerScreen: FC = () => {
  const { t } = useTranslation();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const [dimParam] = useSearchParam("dimension", { replace: true });
  const [pathParam, setPathParam] = useSearchParam("path", { replace: true });
  const [basisParam, setBasisParam] = useSearchParam("basis", {
    replace: true,
  });

  // Changing dimension has to write TWO params at once. Two `useSearchParam`
  // setters cannot: each mutates and re-submits the SAME URLSearchParams
  // instance react-router handed this render, so the second call passes an
  // identical reference and React bails out — measured, the URL stayed empty
  // and the dimension never changed. One update, one new object.
  const [searchParams, setSearchParams] = useSearchParams();
  const switchDimension = (d: BudgetDimension) => {
    // From the ROUTER's params, not window.location: under MemoryRouter the
    // window URL is empty, so a window-based rebuild silently dropped every
    // other param — and made the test that covers this unable to fail.
    const next = new URLSearchParams(searchParams);
    if (d === "admin") next.delete("dimension");
    else next.set("dimension", d);
    // The path is a key in the tree being left; carried across it asks the new
    // dimension for a node it has never heard of.
    next.delete("path");
    setSearchParams(next, { replace: true });
  };

  const { stats } = useBudgetHubStats();
  // The default year comes from the stat call rather than from `new Date()`:
  // the corpus decides which year it can answer for, not the calendar.
  const fy =
    fyParam && /^\d{4}$/.test(fyParam)
      ? Number(fyParam)
      : (stats?.fiscalYear ?? null);
  const dimension: BudgetDimension =
    dimParam && isDimension(dimParam) ? dimParam : "admin";
  const basis: Basis = basisParam && isBasis(basisParam) ? basisParam : "eur";

  // The breadcrumb path. One segment today (the corpus is two levels deep), but
  // stored as a list so a third level needs no new URL shape.
  const path = useMemo(
    () => (pathParam ? pathParam.split("~").filter(Boolean) : []),
    [pathParam],
  );
  const parent = path.length ? path[path.length - 1] : null;

  const { level, isLoading } = useBudgetExplorer(fy, dimension, parent, basis);

  const drillTo = (key: string) => setPathParam([...path, key].join("~"));
  const upTo = (depth: number) =>
    setPathParam(depth === 0 ? "" : path.slice(0, depth).join("~"));

  const title = t("budget_explorer_title") || "Разгледай бюджета";
  const description =
    t("budget_explorer_description") ||
    "Пропътувай публичните разходи ниво по ниво — по разпоредител в държавния бюджет или по функция за целия сектор „Държавно управление“.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_explorer_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        {/* The dimension is the FIRST question, not a tab: which tree you are
            in changes what every number below means. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("budget_explorer_dimension_label") || "Разрез"}
          </span>
          {DIMENSIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => switchDimension(d)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                d === dimension
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-border hover:border-primary/60 hover:bg-accent/10",
              )}
            >
              {d === "admin"
                ? t("budget_explorer_dim_admin") || "По разпоредител"
                : t("budget_explorer_dim_functional") || "По функция"}
            </button>
          ))}

          <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("budget_basis_label") || "Мерна единица"}
          </span>
          {BASES.map((b) => (
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
              {b === "eur"
                ? "€"
                : b === "gdp"
                  ? t("budget_basis_gdp") || "% от БВП"
                  : t("budget_basis_share") || "% от нивото"}
            </button>
          ))}
        </div>

        {/* Breadcrumb. Rendered as buttons because they act; a span that looks
            clickable and is not is the affordance rule in §6. */}
        <nav
          aria-label={t("budget_explorer_path_label") || "Път"}
          className="flex flex-wrap items-center gap-1 text-sm"
        >
          <button
            type="button"
            onClick={() => upTo(0)}
            className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {t("budget_explorer_root") || "Целият бюджет"}
          </button>
          {path.map((seg, i) => (
            <span key={seg} className="flex items-center gap-1">
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
              {i === path.length - 1 ? (
                /* The current level's name comes from the PAYLOAD, so a shared
                   link shows it too — a client-held label only exists for the
                   session that did the clicking. */
                <span className="font-medium">{level?.parentName ?? seg}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => upTo(i + 1)}
                  className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {seg}
                </button>
              )}
            </span>
          ))}
        </nav>

        {/* THE CAPTION, INSIDE THE BRANCH. Written outside it, this would
            describe the other aggregate — and the two are genuinely different
            perimeters, not two views of one. */}
        <p className="text-xs text-muted-foreground max-w-3xl">
          {dimension === "admin"
            ? t("budget_explorer_caption_admin") ||
              "Първостепенните разпоредители по държавния бюджет (МФ). Сумите са по закона за бюджета; кликни върху разпоредител за неговите програми."
            : t("budget_explorer_caption_functional") ||
              "Разходите по функция (COFOG) идват от Евростат и покриват ЦЯЛОТО консолидирано управление — държава, общини и осигурителни фондове. Това НЕ е разбивка на държавния бюджет по-горе."}
        </p>

        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl border bg-card" />
        ) : !level || level.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_explorer_empty")}{" "}
            {/* An empty level names the corpus's OWN coverage. Without it,
                FY2026 on the functional dimension reads as „the state spent
                nothing" when the truth is that Eurostat's series ends in 2024. */}
            {level?.coverageLatestYear && fy && level.coverageLatestYear < fy
              ? t("budget_explorer_empty_coverage", {
                  year: level.coverageLatestYear,
                  defaultValue: "",
                })
              : null}
          </p>
        ) : (
          // data-og is the og:image capture's wait-for (scripts/og/capture-screens.ts). It sits
          // on the POPULATED branch, so a capture waiting on it can photograph neither the
          // skeleton above nor the empty-level message beside it.
          <div
            data-og="budget-explorer"
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
          >
            <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
              <span className="text-sm font-semibold">
                {t("budget_explorer_level_total") || "Общо за нивото"}
              </span>
              <span className="tabular-nums font-bold">
                {renderAmount(level.total, basis)}
              </span>
            </div>
            <ul>
              {level.rows.map((r) => {
                const label = r.nameBg || r.nameEn || r.key;
                // A row ACTS only when it has children. Giving every row a
                // button role and having a third do nothing is the affordance
                // defect §6 names.
                const Row = r.hasChildren ? "button" : "div";
                return (
                  <li key={r.key} className="border-b last:border-b-0">
                    <Row
                      {...(r.hasChildren
                        ? {
                            type: "button" as const,
                            onClick: () => drillTo(r.key),
                          }
                        : {})}
                      className={cn(
                        "flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm",
                        r.hasChildren &&
                          "hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span className={cn(r.hasChildren && "text-primary")}>
                        {label}
                        {r.hasChildren ? (
                          <span aria-hidden className="ml-1 opacity-60">
                            ›
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums shrink-0">
                        {renderAmount(r.amount, basis)}
                      </span>
                    </Row>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_explorer_source") || "Източник"}: {level?.source ?? "—"}
          {fy ? ` · ${t("budget_fy_heading") || "Бюджетна година"} ${fy}` : ""}
        </p>
        {/* Year picker last: it is the least-changed control on the page. */}
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
      </section>
    </>
  );
};
