// The arithmetic behind the /budget tax receipt — what a payslip actually loses in a year,
// and how to read the number a human typed into the box.
//
// Split out of `BudgetReceiptCard` so both are testable without a rendered tree: these are
// the two places the card can be quietly wrong about a reader's own money, and neither needs
// React to be exercised.

import { computeLabourTax, capMonths } from "@/lib/bgTax";

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
