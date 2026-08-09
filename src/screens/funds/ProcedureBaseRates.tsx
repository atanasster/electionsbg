// „Какво обикновено се случва тук" — the base-rate card on /funds/procedure/:code.
//
// WHY IT IS ON THIS PAGE. The page already says what this procedure HAS done in total. What a
// person deciding whether to apply needs is the distribution: how much a typical grant is, how
// wide the spread runs, what kind of organisation actually wins, and how much of the signed money
// has moved. Those are all in `fund_fit` (143), a PK seek away.
//
// THE REFERENCE PRICE IS THE POINT, and it is arithmetic rather than advice. Measured demand
// (funds-module-v2 Appendix A, category D): „обърнах се към фирма … поискаха ми 4000 € и 5% от
// сумата — това реални цифри ли са?", answered in the same thread by the supply side. There is no
// fee corpus in Bulgaria, so we cannot say what a fair fee is and do not try. What we can publish
// is the denominator — the median grant — and the division, done in the open, so the reader can
// redo it with whatever percentage they were quoted. The plan is explicit that „a fair fee is Y"
// is out (§8.4-4); being demonstrably arithmetic is what makes publishing this defensible at all.
//
// NOTHING HERE IS AN APPROVAL RATE. The corpus holds only SIGNED contracts — ИСУН publishes no
// rejected applications — so „изплатени" is disbursement and is labelled as disbursement.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, Users } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import {
  disbursedShare,
  feeOnMedian,
  useFundsProcedureRates,
} from "@/data/funds/useFundsProcedureRates";

const numFmt = new Intl.NumberFormat("bg-BG");

/** The percentages consultancies were reported quoting, so the arithmetic covers the real range
 *  rather than one number that could read as an endorsement of that number. */
const FEE_PCTS = [3, 5, 10] as const;

const Stat: FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="flex flex-col">
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <span className="text-base font-semibold tabular-nums">{value}</span>
    {hint ? (
      <span className="text-[11px] text-muted-foreground/80">{hint}</span>
    ) : null}
  </div>
);

export const ProcedureBaseRates: FC<{ code: string }> = ({ code }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data, isError } = useFundsProcedureRates(code);
  // A failure must not render a card of zeroes, which on this page would read as „nobody applied
  // and nothing was paid". Null is also what the route returns for a code the rollup has never
  // seen, and the same silence is right for both.
  //
  // `isError` is belt-and-braces and no test can distinguish it: React Query leaves `data`
  // undefined on an error, so `!data` already covers it (verified — removing `isError` changes
  // nothing). It stays because a future `placeholderData` would make `data` survive an error, and
  // that is exactly when the guard would start mattering.
  if (isError || !data) return null;

  const share = disbursedShare(data);
  const kinds = data.orgKinds.slice(0, 4);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {t("rates_title")}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={t("rates_beneficiaries")}
              value={numFmt.format(data.beneficiaryCount)}
              hint={t("rates_of_projects", { count: data.projectCount })}
            />
            {data.grantMedian !== null ? (
              <Stat
                label={t("rates_median")}
                value={formatEur(data.grantMedian, lang)}
                // THE SPREAD, always beside the median. „Колко дават" has a long tail, and a lone
                // median over quartiles of €12k and €400k describes almost nobody.
                hint={
                  data.grantP25 !== null && data.grantP75 !== null
                    ? `${formatEur(data.grantP25, lang)} – ${formatEur(data.grantP75, lang)}`
                    : undefined
                }
              />
            ) : null}
            {share !== null ? (
              <Stat
                label={t("rates_disbursed")}
                value={`${Math.round(share)}%`}
                // Spelled out as a fraction so the label cannot be read as an approval rate.
                hint={t("rates_disbursed_hint", {
                  paid: numFmt.format(data.paidProjectCount),
                  total: numFmt.format(data.projectCount),
                })}
              />
            ) : null}
          </div>

          {kinds.length ? (
            <div className="mt-3 border-t pt-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("rates_who")}
              </span>
              {/* THE DENOMINATOR, spelled out. „Кой кандидатства успешно" beside a bare „57%"
                  reaches the approval-rate misreading by a door the „одобрен" gate cannot see:
                  the words are innocent and the percentage does the implying. */}
              <p className="text-[11px] text-muted-foreground/80">
                {t("rates_who_hint", { count: data.projectCount })}
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {kinds.map((k) => (
                  <li key={k.label} className="tabular-nums">
                    {k.label}{" "}
                    <span className="text-muted-foreground">
                      {numFmt.format(k.n)} (
                      {Math.round((100 * k.n) / data.projectCount)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* THE REFERENCE PRICE. Rendered only when there is a median to divide — without one the
          card would be a table of „—" beside a paragraph about consultancy fees, which reads as
          insinuation rather than arithmetic. */}
      {data.grantMedian !== null && data.grantMedian > 0 ? (
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Calculator className="h-3.5 w-3.5" />
              {t("rates_fee_title")}
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground/80">
              {t("rates_fee_hint")}
            </p>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {FEE_PCTS.map((pct) => (
                <li
                  key={pct}
                  className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                >
                  <span className="tabular-nums">
                    {t("rates_fee_row", { pct })}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatEur(feeOnMedian(data, pct) ?? 0, lang)}
                  </span>
                </li>
              ))}
            </ul>
            {/* THE HALF THIS SUM DOES NOT COVER. The measured quote (Appendix A, category D) is
                „4000 € предварително И 5% от сумата", and the supply-side reply in the same thread
                is specifically about the up-front half — „цената се заплаща ПРЕДИ спечелването".
                A card that computes only the percentage tells a reader checking that exact quote
                that the 5% is in range, and says nothing about the €4,000 payable whether or not
                they win. */}
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              {t("rates_fee_upfront")}
            </p>
            {/* THE BOUNDARY, stated. We publish the denominator, not a verdict — there is no fee
                corpus, so neither „this is usual" nor „this is fair" is ours to say. */}
            <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground/80">
              {t("rates_fee_disclaimer")}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
