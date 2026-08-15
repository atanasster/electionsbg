// /budget/social-funds — the social-security funds, and what the state adds.
//
// Plan: docs/plans/budget-hub-v1.md T6.11. Source: НОИ's monthly per-fund
// cash-execution report (B1).
//
// THE PAGE IS ONE IDENTITY, and without it the figures look impossible:
//
//     приходи − разходи + трансфери − вноска в ЕС = салдо
//     6 590 528 454 − 12 585 473 587 + 5 892 736 120 − 0 = −102 209 013   (ДОО, 2024)
//
// ДОО'S OWN CONTRIBUTIONS COVER 52.4% OF ITS SPENDING. The rest — €5.89bn, of
// which 99.97% comes from the central budget — is a transfer in. Rendering
// revenue beside expenditure without it shows a €6bn hole next to a stated
// balance of −€102m, and a reader concludes one of the two is wrong.
//
// That €5.89bn is also the other end of a number this module already shows: it
// is part of „Трансфери (нето)" on /budget/spending, which is 58% of the state
// budget's expenditure section. The two pages are the same money seen from
// either side, and each links to the other.
//
// ONE MORE THING THE SOURCE FORCES: a year carries per-fund detail only once
// НОИ has published the B1 sheets. Mid-cycle the ingest publishes a
// yearbook-only shell with no `funds`, and that year must not render as three
// funds with zero in every column.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { formatEur, formatEurSigned } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useNoiFunds, useNoiFundPlan } from "@/data/budget/useBudget";
import {
  selectFundPlanYear,
  peerFundLines,
} from "@/screens/components/budget/fundPlanView";

const eur = (m: { amountEur?: number | null } | null | undefined) =>
  m?.amountEur ?? null;

export const BudgetSocialFundsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const { data: file, isLoading } = useNoiFunds();
  // T9.10 — the LAW side. Reusing the pre-migration helpers rather than
  // reimplementing them: both encode a basis rule, and a second copy of a
  // basis rule is how two pages come to disagree about one.
  const { data: planFile } = useNoiFundPlan();

  // Only years that actually carry per-fund detail. A yearbook-only shell has
  // no `funds` at all, and offering it renders an empty table under a year
  // heading — „the funds reported nothing", which is not what happened.
  const years = useMemo(
    () =>
      (file?.years ?? [])
        .filter((y) => (y.funds?.length ?? 0) > 0)
        .map((y) => y.fiscalYear)
        .sort((a, b) => a - b),
    [file],
  );
  const requested = fyParam && /^\d{4}$/.test(fyParam) ? Number(fyParam) : null;
  const fy =
    requested != null && years.includes(requested)
      ? requested
      : (years[years.length - 1] ?? null);

  const year = useMemo(
    () => (file?.years ?? []).find((y) => y.fiscalYear === fy) ?? null,
    [file, fy],
  );
  const funds = useMemo(
    () =>
      [...(year?.funds ?? [])].sort(
        (a, b) => (eur(b.expenditure) ?? 0) - (eur(a.expenditure) ?? 0),
      ),
    [year],
  );

  /** The plan to show.
   *
   *  ⚠️ NOT gated on the selected execution year, and that is the whole point:
   *  measured, the two corpora DO NOT OVERLAP and structurally cannot be
   *  expected to. The B1 execution runs 2023-2024; the only ЗБДОО parsed is
   *  2026. A law for year N is passed before N begins and its execution report
   *  arrives after N ends, so „the plan for the year you are looking at" is a
   *  block that renders on almost no year — a first draft of this gated on `fy`
   *  and was dead code on every page in the corpus.
   *
   *  So: prefer the plan for the SELECTED year when one exists, otherwise show
   *  the newest one there is — and say, loudly, that it is a different year.
   *  `selectFundPlanYear`'s no-fallback rule is preserved for the first case,
   *  which is what it is for: it stops a 2026 plan being LABELLED 2019. Here
   *  the year is named in the heading, so the reader is never told otherwise. */
  const plan = useMemo(() => {
    // NO EXECUTED YEAR, NO PLAN BLOCK. `fy` is null both transiently (the 3.7 KB
    // plan file settles before the 20 KB execution file) and durably (a
    // yearbook-only corpus, which the module header documents as a real
    // mid-cycle state). In that state the whole block misreports itself: the
    // mismatch warning cannot name a year to differ FROM, so it is suppressed,
    // and the basis warning's „числата по-горе" points at the empty message. A
    // caveat that disappears exactly where the reader has least context is
    // worse than no block, so the block waits for its counterpart.
    if (fy == null) return null;
    const exact = selectFundPlanYear(planFile, fy);
    if (exact) return exact;
    const all = planFile?.years ?? [];
    return all.length
      ? [...all].sort((a, b) => b.fiscalYear - a.fiscalYear)[0]
      : null;
  }, [planFile, fy]);
  /** True when the plan on screen is for a different year than the execution.
   *  Today that is ALWAYS, and the copy says so rather than leaving the two
   *  years to be noticed. `fy` cannot be null here — `plan` is null when it is
   *  — so the mismatch is never silently read as agreement. */
  const planIsOtherYear = plan != null && fy != null && plan.fiscalYear !== fy;
  const planFunds = useMemo(() => (plan ? peerFundLines(plan) : []), [plan]);
  /** „Бюджет на НОИ" — excluded from the list above and NAMED here instead, so
   *  the omission is a stated decision rather than a silent one. It is 43% of
   *  the law's чл. 1 sum, which the block prints, so a reader adding the six
   *  visible lines can close the arithmetic instead of finding a €6.6bn hole.
   *
   *  EVERY non-peer line, not the first. Today the ЗБДОО has exactly one and
   *  the ingest asserts it (`scripts/budget/noi/__smoke_fund_plan.ts`) — but
   *  that gate is on the WRITER, and a `find` here would let a future second
   *  line be silently omitted while this sentence still presented itself as the
   *  explanation for the whole gap. Summed, the note is right whatever the law
   *  does; only the LABEL assumes one line, so it is rendered from the lines
   *  themselves rather than from a hard-coded name. */
  const excludedLines = useMemo(
    () => plan?.lines.filter((l) => !l.isPeerFund) ?? [],
    [plan],
  );
  const excludedEur = excludedLines.reduce(
    (sum, l) => sum + l.amount.amountEur,
    0,
  );
  const excludedPct =
    excludedLines.length > 0 && plan?.sumOfFunds?.amountEur
      ? (excludedEur / plan.sumOfFunds.amountEur) * 100
      : null;

  const title = t("budget_funds_title");

  return (
    <>
      <Title description={t("budget_funds_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_funds_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-5">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_funds_intro")}
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

        {isLoading || (fy == null && !file) ? (
          <div className="h-80 animate-pulse rounded-xl border bg-card" />
        ) : funds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_funds_empty")}
          </p>
        ) : (
          <>
            {funds.map((f) => {
              const rev = eur(f.revenue);
              const exp = eur(f.expenditure);
              const tr = eur(f.transfers);
              const eu = eur(f.euContribution);
              const bal = eur(f.balance);
              const central = eur(f.transfersCentralBudget);
              // The one derived figure the source supports: how much of the
              // fund's own spending its own revenue covers.
              const selfFunded =
                rev != null && exp != null && exp !== 0
                  ? (rev / exp) * 100
                  : null;
              // Only claimed when the published terms actually produce the
              // published balance.
              const identityHolds =
                rev != null && exp != null && tr != null && bal != null
                  ? Math.abs(rev - exp + tr - (eu ?? 0) - bal) < 1_000
                  : null;

              return (
                <div
                  key={f.fundCode}
                  className="rounded-xl border bg-card p-4 shadow-sm"
                >
                  <h2 className="text-base font-semibold">
                    {bg ? f.fundLabelBg : f.fundLabelEn}
                  </h2>

                  {selfFunded != null ? (
                    <p className="mt-1 text-sm">
                      {/* Two of the three funds cover MORE than their own
                          spending — Учителски 130.8%, ГВРС 133.5% — so one
                          sentence cannot serve both directions. */}
                      {t(
                        selfFunded >= 100
                          ? "budget_funds_self_over"
                          : "budget_funds_self",
                        { pct: selfFunded.toFixed(1), defaultValue: "" },
                      )}
                    </p>
                  ) : null}

                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {[
                      { k: "budget_funds_revenue", v: rev, sign: 1 as const },
                      {
                        k: "budget_funds_expenditure",
                        v: exp,
                        sign: -1 as const,
                      },
                      { k: "budget_funds_transfers", v: tr, sign: 1 as const },
                      { k: "budget_funds_eu", v: eu, sign: -1 as const },
                    ].map((row) => (
                      <div
                        key={row.k}
                        className="flex items-baseline justify-between gap-3 border-b py-1 last:border-b-0"
                      >
                        <dt className="text-muted-foreground">
                          {row.sign === -1 ? <span aria-hidden>− </span> : null}
                          {t(row.k)}
                        </dt>
                        <dd className="shrink-0 tabular-nums">
                          {row.v == null ? "—" : formatEur(row.v)}
                        </dd>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3 border-t-2 py-1 font-semibold sm:col-span-2">
                      <dt>{t("budget_funds_balance")}</dt>
                      <dd className="shrink-0 tabular-nums">
                        {bal == null ? "—" : formatEurSigned(bal)}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-xs text-muted-foreground">
                    {/* THREE states. The parser throws on a break above one
                        lev, so the „disagrees" branch is effectively
                        unreachable in practice — which means a two-way ternary
                        renders „НОИ's lines disagree" for what is really a
                        MISSING FIELD, a normal state while the bucket serves a
                        funds.json written before those columns were parsed
                        (see NoiFundSnapshot's own comment). */}
                    {identityHolds === true
                      ? t("budget_funds_identity")
                      : identityHolds === null
                        ? t("budget_funds_identity_missing")
                        : t("budget_funds_identity_broken")}
                  </p>

                  {/* The other end of the transfer, named and linked. */}
                  {central != null && central > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("budget_funds_central", {
                        amount: formatEur(central),
                        defaultValue: "",
                      })}{" "}
                      <Link
                        // …with the YEAR. Without it the link lands on the
                        // module's default year and the reader compares this
                        // fund's 2024 transfer against 2026's €8.17bn line.
                        to={`/budget/spending${fy ? `?fy=${fy}` : ""}`}
                        className="text-primary hover:underline"
                      >
                        {t("budget_funds_see_spending")}
                      </Link>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </>
        )}

        {/* THE ЗБДОО PLAN (T9.10). Below the execution, never beside it, and
            with no shared scale — the two are on different accounting bases and
            any layout that lines them up invites a variance reading that the
            data cannot support.

            THE TWO CORPORA DO NOT OVERLAP, and gating this on the page's
            selected year is therefore dead code rather than a safety measure.
            B1 execution (`funds.json`) runs 2023-2024; the ЗБДОО plan
            (`fund_plan.json`) holds 2026 alone — the law for a year that has
            not been executed yet, which is what a plan IS. An exact-year match
            renders on no page at all, now or after any ordinary refresh.

            So: the exact year when it exists, otherwise the NEWEST plan, with
            its own year in the heading and an amber warning naming the executed
            year beside it. `selectFundPlanYear` still takes the exact year with
            no fallback of its own — the fallback is here, where it can be
            labelled. */}
        {plan ? (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            {/* text-base, matching the per-fund card headings. At text-sm a whole
                second corpus on a different accounting basis read as a footnote
                appended to the last fund card — the type scale working against
                the copy, on the one block whose job is to be unmistakably a
                different thing from what precedes it. */}
            <h2 className="text-base font-semibold">
              {t("budget_funds_plan_h", {
                fy: plan.fiscalYear,
                defaultValue: "",
              })}
            </h2>
            {planIsOtherYear ? (
              <p className="mt-1 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                {t("budget_funds_plan_otheryear", {
                  execFy: fy,
                  defaultValue: "",
                })}
              </p>
            ) : null}
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              {t("budget_funds_plan_intro", {
                law: plan.law,
                dv: plan.dvIssue,
                defaultValue: "",
              })}
            </p>
            {/* THE LAW'S OWN чл. 1 SUM, printed. Without it the block shows one
                number (the six visible lines), names a second (the excluded НОИ
                line) and expresses the second as a share of a third that never
                appears — arithmetic the reader cannot close. It is also what
                the basis warning's „заглавната сума на закона" refers to. */}
            {plan.sumOfFunds?.amountEur ? (
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                {t("budget_funds_plan_sum", {
                  eur: formatEur(plan.sumOfFunds.amountEur),
                  defaultValue: "",
                })}
              </p>
            ) : null}
            <p className="mt-2 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
              {t("budget_funds_plan_basis")}
            </p>
            {/* A LIST, deliberately not bars: a bar carries an implicit shared
                axis, and the figures above are on a different basis.
                Gated on a non-empty set — an empty bordered rectangle between
                two warnings, with the excluded-line note beneath still claiming
                a share of a sum whose parts are not shown, is worse than
                nothing. */}
            {planFunds.length > 0 ? (
              <ul className="mt-2 divide-y rounded-xl border">
                {planFunds.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1">{bg ? l.bg : l.en}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatEur(l.amount.amountEur)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {/* Gated on the SHARE, not on the line: with `pct` empty the
                sentence still carried its „% от сбора по закона", rendering
                „(€6 610 463 300, % от сбора по закона)" — a unit with no number,
                which reads as a broken renderer rather than as missing data. */}
            {excludedLines.length > 0 && excludedPct != null ? (
              <p className="mt-2 max-w-3xl text-[11px] text-muted-foreground/80">
                {t("budget_funds_plan_excluded", {
                  amount: formatEur(excludedEur),
                  pct: excludedPct.toFixed(1),
                  defaultValue: "",
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_funds_source", {
            asOf: year?.asOf ?? "",
            defaultValue: "",
          })}
        </p>
      </section>
    </>
  );
};
