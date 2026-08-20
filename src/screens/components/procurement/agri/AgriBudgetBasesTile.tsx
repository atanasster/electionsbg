// „Три различни числа за едно и също министерство" — the three-basis strip.
//
// ⚠ WHY IT IS ONE TILE AND NOT THREE. Agriculture has three defensible answers to
// „how much money is this", they differ by 8×, and each is quoted somewhere on this
// site: the payout the hub tile fronts (€1.59bn 2025), the paying agency's own
// state-budget line (€300.9M) and the ministry's (€200.3M). Put on separate tiles
// they read as parts of a whole; put in one row with their bases named, they read as
// what they are — answers to different questions. Nothing here may be summed.
//
// ⚠ TWO CLAIMS THIS TILE MADE AND COULD NOT SUPPORT, both caught in review:
//   * „Европейски пари" for the whole payout. Measured on 2025, €125,701,698 —
//     **7.92%** — is NATIONAL: държавна помощ отстъпка от акциза върху газьола
//     (€50.8M), ПНДТ (€33.1M), де минимис животни и пчели (€16.9M), ПНДЖ 1 and 3
//     (€24.7M). „САР" is the right word for most of it and the wrong word for all
//     of it, so the column is „Изплатено от ДФЗ" and the caption names the exception.
//   * „нито едно не е дял от друго" — a DISJOINTNESS claim, and the tile's own next
//     sentence contradicted it: national aid the fund disburses reaches farmers and
//     is therefore inside the payout column too. Whether it is funded from the
//     €300.9M line is not derivable from this source, so the copy now says the
//     overlap exists and that the source does not resolve it. Asserting either
//     „separate" or „a subset" would be inventing a fact.
//
// ⚠ THE PAYER'S PROGRAMME SPLIT IS DELIBERATELY NOT RENDERED. ДФЗ's programme lines
// total €18.99M against a €300.92M expenditure (2026): most of its state-budget line
// is money it DISBURSES, which this source does not itemise. Showing a split that
// accounts for 6% of its own header is the „parts don't sum to the header" defect
// (audit Failure mode I). The MINISTRY's four programmes sum exactly, so that one is
// shown — and `AgriBudgetBasesTile.test.tsx` asserts the sum rather than trusting it.
//
// Both figures come from data/budget/ministries/<node>.json (update-budget) — already
// committed and bucket-shipped, read by no sector page until now.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { ministryEurSeries } from "@/data/budget/ministrySeries";
import {
  AGRI_PAYER_BUDGET_NODE,
  AGRI_MINISTRY_BUDGET_NODE,
} from "@/lib/agriReferenceData";

/** The latest programme breakdown for a node, only when it RECONCILES to the figure
 *  the header actually PRINTS. Returning null on a mismatch is the point: a split
 *  that accounts for part of its own header is worse than no split, because the
 *  reader has no way to see the gap.
 *
 *  ⚠ THE DENOMINATOR IS THE PRINTED TOTAL, NOT `expenditure`. The header comes from
 *  `ministryEurSeries` = `expenditureLaw ?? expenditure`, and the corpus has a
 *  ministry-year where those two differ by 72.8% (МОСВ 2024, ЗДБ €60.33M vs отчет
 *  €104.23M) with the programmes summing to the LAW figure. Reconciling against
 *  `expenditure` there would both hide a correct split and — in the other direction —
 *  admit one that does not sum to what is on screen, which is the exact defect this
 *  guard exists to catch. So the caller passes in the number it is about to draw.
 *
 *  ⚠ THE BAND IS 0.1%, NOT 1%. Measured across 201 passing ministry-years the worst
 *  real gap is €2; 1% would be €2.0M of slack on МЗХ, which is most of a programme. */
const reconcilingPrograms = (
  /** The figure the header prints — see the ⚠ above. */
  printedTotal: number,
  years:
    | {
        fiscalYear: number;
        expenditure?: { amountEur?: number } | null;
        programs?: {
          nameBg: string;
          planned?: { amountEur?: number } | null;
        }[];
      }[]
    | undefined,
  fiscalYear: number,
): { name: string; eur: number }[] | null => {
  const y = years?.find((x) => x.fiscalYear === fiscalYear);
  if (!y || !printedTotal) return null;
  const progs = (y.programs ?? [])
    .map((p) => ({ name: p.nameBg, eur: p.planned?.amountEur ?? 0 }))
    .filter((p) => p.eur > 0)
    .sort((a, b) => b.eur - a.eur);
  if (!progs.length) return null;
  const sum = progs.reduce((n, p) => n + p.eur, 0);
  return Math.abs(sum - printedTotal) / printedTotal <= 0.001 ? progs : null;
};

export const AgriBudgetBasesTile: FC<{
  /** The CAP payout for the scope on screen, and the PERIOD LABEL it belongs to.
   *  Passed in rather than re-fetched so this tile cannot show a different vintage
   *  from the hero above it. Null only while the payload is loading — the row then
   *  omits the column rather than showing a zero.
   *
   *  ⚠ A LABEL, NOT A YEAR. `scopeYear` is NULL BY DESIGN on the `all` scope
   *  (migration 162), which is one click away and where the payout is €11.04bn — its
   *  largest value. Gating the column on a year therefore dropped the biggest figure
   *  on the tile and left two boxes under a heading promising three. */
  payoutEur: number | null;
  payoutLabel: string | null;
}> = ({ payoutEur, payoutLabel }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const { data: payer } = useBudgetMinistryRollup(AGRI_PAYER_BUDGET_NODE);
  const { data: ministry } = useBudgetMinistryRollup(AGRI_MINISTRY_BUDGET_NODE);
  // `ministryEurSeries` rather than `expenditure` — a ministry's own отчет restates
  // the appropriation at a consolidated scope in some years, which reads as a spike.
  const payerYears = ministryEurSeries(payer?.years);
  const ministryYears = ministryEurSeries(ministry?.years);
  const payerLatest = payerYears[payerYears.length - 1] ?? null;
  const ministryLatest = ministryYears[ministryYears.length - 1] ?? null;
  if (!payerLatest && !ministryLatest) return null;

  const progs = ministryLatest
    ? reconcilingPrograms(
        ministryLatest.eur,
        ministry?.years,
        ministryLatest.fiscalYear,
      )
    : null;
  const progTotal = progs?.reduce((n, p) => n + p.eur, 0) ?? 0;

  const cols: { label: string; sub: string; eur: number; when: string }[] = [];
  if (payoutEur != null && payoutLabel)
    cols.push({
      eur: payoutEur,
      when: payoutLabel,
      label: bg ? "Изплатено от ДФЗ" : "Paid out by the fund",
      sub: bg
        ? "Пари, изплатени на земеделски стопани. Преобладаващата част е европейска (САР), но не всичко: преходната национална помощ, де минимис и отстъпката от акциза върху газьола са национални схеми."
        : "Money paid out to farmers. Most of it is European (CAP) but not all: the transitional national aid, de minimis and the fuel-excise rebate are national schemes.",
    });
  if (payerLatest)
    cols.push({
      eur: payerLatest.eur,
      when: String(payerLatest.fiscalYear),
      label: bg ? "Бюджет на ДФЗ" : "The paying agency's budget",
      sub: bg
        ? "Разходната част на ДФ „Земеделие“ по ЗДБРБ. Издръжката на самия фонд е малка част от нея — програма „Администрация“ е около една шестнайсета; източникът не разбива остатъка."
        : "The fund's expenditure line in the State Budget Law. Running the fund itself is a small part of it — the „Администрация“ programme is roughly a sixteenth; this source does not itemise the rest.",
    });
  if (ministryLatest)
    cols.push({
      eur: ministryLatest.eur,
      when: String(ministryLatest.fiscalYear),
      label: bg ? "Бюджет на МЗХ" : "The ministry's budget",
      sub: bg
        ? "Разходната част на министерството по ЗДБРБ — политиките по земеделие, гори, рибарство и администрация."
        : "The ministry's expenditure line in the State Budget Law — agriculture, forestry, fisheries and administration policy.",
    });
  if (!cols.length) return null;

  return (
    <Card id="agri-budget-bases">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" />
          {bg
            ? "Три различни числа — и трите верни"
            : "Three different figures — all three true"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-3 md:p-4">
        <p className="text-sm leading-snug text-muted-foreground">
          {bg
            ? "„Колко пари има в земеделието“ няма едно число. Тези три отговарят на различни въпроси, върху различни основи и за различни години — затова НЕ се събират. Не са и напълно отделни: националните помощи, които ДФЗ изплаща, са в първата колона, а източникът не показва от коя бюджетна линия идват."
            : "„How much money is in agriculture“ has no single answer. These three answer different questions, on different bases and for different years — so they do NOT add up. Nor are they fully separate: the national aid the fund pays out is in the first column, and the source does not show which budget line it comes from."}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cols.map((c) => (
            <div key={c.label} className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatEurCompact(c.eur, lang)}
              </div>
              {/* The YEAR rides on every column. The three genuinely differ — the
                  payout is a closed CAP year and the budgets are the enacted law —
                  and a row of bare euros invites reading them as one moment. */}
              <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {c.when}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {c.sub}
              </p>
            </div>
          ))}
        </div>

        {progs && ministryLatest && (
          <div className="space-y-2">
            <div className="text-xs font-medium">
              {bg
                ? `Бюджетът на МЗХ по политики (${ministryLatest.fiscalYear})`
                : `The ministry's budget by policy (${ministryLatest.fiscalYear})`}
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {progs.map((p, i) => (
                <div
                  key={p.name}
                  className={
                    [
                      "bg-primary",
                      "bg-emerald-600",
                      "bg-amber-500",
                      "bg-sky-600",
                    ][i % 4]
                  }
                  style={{ width: `${(100 * p.eur) / progTotal}%` }}
                  aria-hidden="true"
                />
              ))}
            </div>
            <ul className="space-y-1 text-xs">
              {progs.map((p, i) => (
                <li key={p.name} className="flex items-baseline gap-2">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      [
                        "bg-primary",
                        "bg-emerald-600",
                        "bg-amber-500",
                        "bg-sky-600",
                      ][i % 4]
                    }`}
                  />
                  <span className="min-w-0 flex-1">{p.name}</span>
                  <b className="shrink-0 tabular-nums">
                    {formatEurCompact(p.eur, lang)}
                  </b>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Източник: Закон за държавния бюджет (админ. единици „Държавен фонд „Земеделие““ и „Министерство на земеделието и храните“), разход в евро; изплатеното по САР — ДФ „Земеделие“."
            : "Source: State Budget Law (the „Държавен фонд „Земеделие““ and „Министерство на земеделието и храните“ admin units), expenditure in EUR; the CAP payout — the State Fund Agriculture."}
        </p>
      </CardContent>
    </Card>
  );
};
