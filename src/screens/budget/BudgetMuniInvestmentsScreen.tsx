// /budget/municipal/investments — ИПОП, the municipal investment programme.
//
// Plan: docs/plans/budget-hub-v1.md §8 / T6.13.
//
// ONE SNAPSHOT, TWO NUMBERS THAT SHOULD BE READ TOGETHER: €2.98bn agreed
// against €0.99bn paid, across 3 492 projects in 264 municipalities. The
// agreement figure alone reads as investment delivered; the pair reads as what
// it is.
//
// ⚠️ „ОТБЕЛЯЗАН" IS A THRESHOLD, NOT A VERDICT — agreement ≥ €100 000 AND under
// 5% paid — and the page has to say so with EVIDENCE rather than with a
// disclaimer. Two facts do that, both measured and both from the payload:
//
//   * THE COHORT. The project id carries an OP-<yy> vintage. OP-24 is 35.4%
//     paid; OP-25 is 5.5%. 91 of the 769 flags are the youngest cohort, where
//     under 5% paid is unremarkable. (An earlier draft said the corpus had no
//     date at all — true of the columns, false of the ids.)
//   * THE CLAIM. 306 of the 769 — €343.4m — already have money submitted or
//     awaiting payment.
//
// The rule's own numbers come from the payload, never a constant here: the page
// must not describe a threshold the server has stopped applying.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useBudgetMuniIpop } from "@/data/budget/useBudgetMuniIpop";

export const BudgetMuniInvestmentsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [q, setQ] = useSearchParam("q", { replace: true });
  const { ipop, isLoading } = useBudgetMuniIpop(q);

  const rows = ipop?.rows ?? [];
  const nat = ipop?.national ?? null;
  const rule = ipop?.stalledRule ?? null;
  const cohorts = ipop?.national?.cohorts ?? [];

  const nationalPaidPct =
    nat?.agreementEur && nat.agreementEur > 0 && nat.paidEur != null
      ? (nat.paidEur / nat.agreementEur) * 100
      : null;

  const peak = useMemo(
    () => Math.max(...rows.map((r) => r.agreementEur ?? 0), 1),
    [rows],
  );

  const title = t("budget_ipop_title");

  return (
    <>
      <Title description={t("budget_ipop_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_ipop_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_ipop_intro")}{" "}
          <Link to="/budget/municipal" className="text-primary hover:underline">
            {t("budget_muni_see_all")}
          </Link>
        </p>

        {/* AGREED AND PAID, TOGETHER. The first alone reads as delivery. */}
        {/* Hidden while filtered: three NATIONAL cards above a one-row list
            read as that municipality's figures, and two of the three carry no
            scope wording at all. */}
        {!isLoading && nat && !q ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("budget_ipop_agreed")}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {nat.agreementEur == null ? "—" : formatEur(nat.agreementEur)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("budget_ipop_scope", {
                  projects: nat.projectCount,
                  munis: nat.municipalityCount,
                  defaultValue: "",
                })}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("budget_ipop_paid")}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {nat.paidEur == null ? "—" : formatEur(nat.paidEur)}
              </p>
              {nationalPaidPct != null ? (
                <p className="text-xs text-muted-foreground">
                  {t("budget_ipop_paid_pct", {
                    pct: nationalPaidPct.toFixed(1),
                    defaultValue: "",
                  })}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("budget_ipop_flagged")}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {nat.stalledCount}
              </p>
              <p className="text-xs text-muted-foreground">
                {nat.stalledAgreementEur != null
                  ? t("budget_ipop_flagged_worth", {
                      amount: formatEur(nat.stalledAgreementEur),
                      defaultValue: "",
                    })
                  : null}
              </p>
              {/* The evidence that keeps the count from reading as a verdict. */}
              {nat.stalledWithClaimCount != null &&
              nat.stalledWithClaimCount > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("budget_ipop_flagged_claimed", {
                    count: nat.stalledWithClaimCount,
                    total: nat.stalledCount,
                    amount:
                      nat.stalledWithClaimEur == null
                        ? ""
                        : formatEur(nat.stalledWithClaimEur),
                    defaultValue: "",
                  })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* THE RULE, from the payload, beside the count it explains. */}
        {rule ? (
          <p className="max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
            {t("budget_ipop_rule", {
              min: formatEur(rule.minAgreementEur),
              pct: rule.maxPaidPct,
              defaultValue: "",
            })}
            {/* The cohorts, so „under 5% paid" is read against its own vintage
                rather than against the programme as a whole. */}
            {cohorts.length > 1 ? (
              <>
                {" "}
                {t("budget_ipop_cohorts", {
                  list: cohorts
                    .map((c) =>
                      t("budget_ipop_cohort_item", {
                        year: `20${c.cohort}`,
                        n: c.projectCount,
                        pct:
                          c.agreementEur && c.agreementEur > 0
                            ? (
                                (100 * (c.paidEur ?? 0)) /
                                c.agreementEur
                              ).toFixed(1)
                            : "—",
                        defaultValue: "",
                      }),
                    )
                    .join("; "),
                  defaultValue: "",
                })}
              </>
            ) : null}
          </p>
        ) : null}

        <input
          type="search"
          value={q ?? ""}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("budget_ipop_search_placeholder")}
          aria-label={t("budget_ipop_search_placeholder")}
          className="w-full max-w-md rounded-lg border bg-background px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
        />

        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl border bg-card" />
        ) : ipop == null ? (
          /* „Няма намерени общини" is a claim about the CORPUS. A route that
             degraded has told us nothing about it. */
          <p className="text-sm text-muted-foreground">
            {t("budget_ipop_unavailable")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_ipop_empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-sm">
            {rows.map((r) => (
              <li key={r.obshtina} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    {(bg ? r.nameBg || r.nameEn : r.nameEn || r.nameBg) ||
                      r.obshtina}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {/* Suffix chosen here rather than left to i18next's
                          `count`: 58 municipalities have exactly one project,
                          „1 обекта" does not agree, and the suite mocks `t`
                          with a regex replace that would never see it. */}
                      {t(
                        r.projectCount === 1
                          ? "budget_ipop_n_projects_one"
                          : "budget_ipop_n_projects_other",
                        { count: r.projectCount, defaultValue: "" },
                      )}
                      {r.stalledCount > 0
                        ? ` · ${t(
                            r.stalledCount === 1
                              ? "budget_ipop_n_flagged_one"
                              : "budget_ipop_n_flagged_other",
                            { count: r.stalledCount, defaultValue: "" },
                          )}`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {r.agreementEur == null ? "—" : formatEur(r.agreementEur)}
                    {r.paidPct != null ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("budget_ipop_row_paid", {
                          pct: r.paidPct.toFixed(1),
                          defaultValue: "",
                        })}
                      </span>
                    ) : null}
                  </span>
                </div>
                {/* TWO SEPARATE TRACKS, not one nested in the other. Nested,
                    the paid bar is a percentage of the agreed bar's WIDTH, so a
                    small municipality at 89.2% paid rendered 0.42px and twelve
                    rows were under 6px on mobile — the rows where full payment
                    is the story disappeared. Scale on top, share below. */}
                <div className="mt-1 space-y-0.5" aria-hidden>
                  <div className="h-1 rounded bg-primary/15">
                    <div
                      className="h-1 rounded bg-primary/40"
                      style={{
                        width: `${Math.min(100, ((r.agreementEur ?? 0) / peak) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="h-1 rounded bg-muted">
                    <div
                      className="h-1 rounded bg-primary"
                      style={{
                        width: `${Math.min(100, Math.max(0, r.paidPct ?? 0))}%`,
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_ipop_source", {
            fy: ipop?.fiscalYear ?? "",
            defaultValue: "",
          })}
        </p>
      </section>
    </>
  );
};
