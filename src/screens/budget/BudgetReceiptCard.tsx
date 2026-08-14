// The tax receipt — the /budget hub's lead card.
//
// Plan: docs/plans/budget-hub-v1.md §7.5 / T5.5. Two halves already existed and
// were never joined: `BudgetCitizenViewTile` shows a POPULATION-AVERAGE split
// („за всеки €100"), and `/budget/tax-calculator` computes an INDIVIDUAL's
// actual tax. This card joins them.
//
// ⚠️ ONLY THE INCOME TAX IS PROJECTED ACROSS THE FUNCTIONS. This is the whole
// design, and the first draft got it wrong. Bulgarian social contributions are
// HYPOTHECATED — each component funds a named fund by statute (чл. 6 КСО,
// чл. 40 ЗЗО) — so spreading the full 13.78% across defence, education and the
// rest over-states every non-social line. Measured on a €2 000 salary, the
// defence row went from €176.05 to €67.76, a 2.60x over-statement. The receipt
// therefore shows FOUR destinations:
//
//     ДОО     8.38%  → пенсии, обезщетения          €2 011  (earmarked)
//     НЗОК    3.20%  → здравеопазване                 €768  (earmarked)
//     УПФ     2.20%  → a PRIVATE second-pillar fund    €528  (not government)
//     ДДФЛ   10.00%  → the ten COFOG functions      €2 069  (projected)
//                                                  ───────
//                                                   €5 376
//
// УПФ is the one that surprises: it is a private account and never enters the
// general-government sector at all, so no functional share can apply to it.
//
// THREE MORE THINGS THE COPY CARRIES, none of them a footnote:
//
//   1. THE PROJECTION IS NOT A TRACE. Nobody's euros are followed anywhere; the
//      ДДФЛ block applies published SHARES to the reader's own figure.
//   2. THOSE SHARES ARE S13 — the whole general-government sector — a DIFFERENT
//      perimeter from the state-budget tiles below, never to be summed with them.
//   3. NOTHING IS STORED OR SENT. The salary never leaves the browser.
//
// The receipt covers PIT + the employee's own contributions — what leaves a
// payslip. VAT is deliberately out: `computeVat` needs a consumption
// assumption, and a figure that moves with an invisible assumption does not
// belong on a card whose point is that its basis is legible.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatEur } from "@/lib/currency";
import {
  computeLabourTax,
  capMonths,
  SSC_EMPLOYEE_RATE,
  HEALTH_EMPLOYEE_RATE,
  UPF_EMPLOYEE_RATE,
  DOO_EMPLOYEE_RATE,
} from "@/lib/bgTax";
import { cofogLabelKey } from "@/lib/cofog";
import type { BudgetHubStats } from "@/data/budget/useBudgetHubStats";

/** How many functional lines the ДДФЛ block itemises. The rest folds into one
 *  row so the block always sums to the whole income tax. */
const SHOWN = 6;

/** Parse a salary a human typed. „2,000" and „2 000" are thousands, „2,5" is a
 *  decimal — treating every comma as a decimal point turned „2,000" into €2 and
 *  rendered „€5 данък и осигуровки за година" on the English card, where a
 *  comma IS the thousands separator. */
export const parseSalary = (raw: string): number | null => {
  const cleaned = raw.replace(/[\s\u00a0]/g, "");
  if (!cleaned) return null;
  // A comma with exactly three digits after it and more to come is a grouping
  // separator; anything else is a decimal comma.
  const normalised = /,\d{3}(\D|$)/.test(cleaned)
    ? cleaned.replace(/,/g, "")
    : cleaned.replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Annual direct tax, priced month by month against the cap actually in force.
 *  `× 12` at one cap costs €163.52/yr for anyone above €2 111.64 in 2026,
 *  because the МОД stepped from €2 111.64 to €2 300 on 1 August. */
export const annualDirectTax = (monthlyGross: number, year: number) => {
  let ssc = 0;
  let pit = 0;
  for (const { capEur, months } of capMonths(year)) {
    const r = computeLabourTax({
      monthlyGross,
      mod: capEur,
      profile: "employee",
      children: 0,
    });
    ssc += r.ssc * months;
    pit += r.pit * months;
  }
  return { ssc, pit, total: ssc + pit };
};

export const BudgetReceiptCard: FC<{
  stats: BudgetHubStats | null;
  /** The reader's locale, so money formats the way the rest of the page does.
   *  `formatEur` defaults to bg-BG, which rendered „€5376" on /en. */
  locale?: string;
  className?: string;
}> = ({ stats, locale = "bg-BG", className }) => {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");

  const shares = useMemo(() => stats?.cofogShares ?? [], [stats]);
  const year = stats?.fiscalYear ?? new Date().getFullYear();

  const split = useMemo(() => {
    const monthly = parseSalary(raw);
    if (monthly == null) return null;
    const { ssc, pit, total } = annualDirectTax(monthly, year);
    // The contribution split by legal destination. Ratios of the statutory
    // rates, so a cap that binds scales all three together.
    return {
      total,
      pit,
      doo: (ssc * DOO_EMPLOYEE_RATE) / SSC_EMPLOYEE_RATE,
      health: (ssc * HEALTH_EMPLOYEE_RATE) / SSC_EMPLOYEE_RATE,
      upf: (ssc * UPF_EMPLOYEE_RATE) / SSC_EMPLOYEE_RATE,
    };
  }, [raw, year]);

  // The base the FUNCTIONAL block is itemised against: the reader's own income
  // tax when they have entered a salary, and €100 otherwise. The €100 column is
  // the tile this card replaces, kept so an empty input still answers.
  const base = split?.pit ?? 100;
  const personal = split != null;

  const rows = useMemo(() => {
    const top = shares.slice(0, SHOWN);
    const shown = top.reduce((acc, s) => acc + (s.pct ?? 0), 0);
    // 100 − Σ(shown), NOT Σ(tail): if a tail share is ever NULL the receipt
    // would silently sum to less than the reader's tax.
    return { top, restPct: Math.max(0, 100 - shown) };
  }, [shares]);

  if (!shares.length) return null;

  const money = (v: number) => formatEur(v, locale);

  return (
    <div
      className={`rounded-2xl border bg-card p-4 shadow-sm sm:p-5 ${className ?? ""}`}
    >
      <h2 className="text-base font-semibold">{t("budget_receipt_title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {t("budget_receipt_intro")}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">
            {t("budget_receipt_input_label")}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t("budget_receipt_input_placeholder")}
            aria-label={t("budget_receipt_input_label")}
            className="w-40 rounded-lg border bg-background px-3 py-1.5 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <p className="pb-1.5 text-sm">
          {personal ? (
            <>
              <span className="font-semibold tabular-nums">
                {money(split.total)}
              </span>{" "}
              <span className="text-muted-foreground">
                {t("budget_receipt_your_tax")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {t("budget_receipt_no_income")}
            </span>
          )}
        </p>
      </div>

      {/* THE EARMARKED HALF. Only rendered with a salary entered — there is no
          „average" version of a legal destination. */}
      {personal ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("budget_receipt_earmarked_h")}
          </h3>
          <ul className="mt-1 divide-y rounded-xl border">
            {[
              { k: "budget_receipt_doo", v: split.doo },
              { k: "budget_receipt_health", v: split.health },
              { k: "budget_receipt_upf", v: split.upf },
            ].map((r) => (
              <li
                key={r.k}
                className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm"
              >
                <span>{t(r.k)}</span>
                <span className="shrink-0 tabular-nums">{money(r.v)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* THE PROJECTED HALF — the income tax only. */}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {personal
          ? t("budget_receipt_projected_h", {
              amount: money(base),
              defaultValue: "",
            })
          : t("budget_receipt_projected_h_avg")}
      </h3>
      <ul className="mt-1 divide-y rounded-xl border">
        {rows.top.map((s) => (
          <li
            key={s.code}
            className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm"
          >
            <span>
              {(() => {
                const k = cofogLabelKey(s.code);
                return k ? t(k) : s.code;
              })()}
            </span>
            <span className="shrink-0 tabular-nums">
              {money((base * (s.pct ?? 0)) / 100)}
              <span className="ml-2 text-xs text-muted-foreground">
                {(s.pct ?? 0).toFixed(1)}%
              </span>
            </span>
          </li>
        ))}
        {rows.restPct > 0 ? (
          <li className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm text-muted-foreground">
            <span>{t("budget_receipt_rest")}</span>
            <span className="shrink-0 tabular-nums">
              {money((base * rows.restPct) / 100)}
              <span className="ml-2 text-xs">{rows.restPct.toFixed(1)}%</span>
            </span>
          </li>
        ) : null}
      </ul>

      {/* THE DISCLAIMER IS PART OF THE CARD. It is the difference between an
          illustration of proportions and a false claim about somebody's money. */}
      <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
        {t("budget_receipt_disclaimer")}
      </p>

      <p className="mt-2 text-xs">
        <Link
          to="/budget/tax-calculator"
          className="text-primary hover:underline"
        >
          {t("budget_receipt_calculator_link")}
        </Link>
      </p>
    </div>
  );
};
