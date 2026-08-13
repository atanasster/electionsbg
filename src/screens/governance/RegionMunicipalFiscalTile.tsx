// The oblast rollup on /governance/region/:oblast — the level at which the
// pattern is visible, because financial distress clusters regionally in a way
// neither the 265-row national table nor a single município page shows.
//
// Three rules, all inherited from the surfaces above and all easy to lose at
// this grain:
//
//   1. **The three stocks are summed ACROSS municipalities, never across each
//      other.** A total of commitments over an oblast is a real quantity; a
//      total of commitments PLUS obligations PLUS arrears counts the same lev
//      three times, because the stocks nest.
//   2. **A município that withheld a figure is excluded from that stock's sum
//      and COUNTED**, so an oblast total that is an undercount says so. Summing
//      nulls as zero would publish a smaller number with no sign that it is
//      smaller.
//   3. **The distress counts are two SEPARATE numbers**: how many municipalities
//      meet ≥3 чл. 130а criteria (our derivation) and how many are in a чл. 130д
//      recovery procedure (the ministry's administrative fact). Never one
//      „distressed" tally.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useMunicipalFiscalRanking } from "@/data/budget/useMunicipalFiscalRanking";
import { rollupOblast } from "./oblastFiscalRollup";

const eur = (v: number, locale: string): string =>
  v >= 1_000_000
    ? `€${(v / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
    : `€${v.toLocaleString(locale, { maximumFractionDigits: 0 })}`;

export const RegionMunicipalFiscalTile: FC<{ oblast: string }> = ({
  oblast,
}) => {
  const { t, i18n } = useTranslation();
  const { rows, isError } = useMunicipalFiscalRanking();
  const roll = useMemo(() => rollupOblast(rows, oblast), [rows, oblast]);

  // Self-suppress: an oblast with no municipalities in the corpus, or a
  // database that never ran the loader, has nothing to say here.
  //
  // `isError` is checked FIRST and separately. The hook throws rather than
  // degrading precisely so „the fetch failed" stays distinct from „there is
  // nothing here", and a consumer reading only `rows` collapses them again —
  // rendering a 500 as an oblast whose municipalities owe nothing.
  if (isError || !roll) return null;
  const locale = i18n.language;

  return (
    <StatCard
      label={
        <span className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("mf_region_title")}
        </span>
      }
      seeMoreTo="/governance/municipal-finance"
    >
      <div className="space-y-1">
        {roll.totals.map((tt) => (
          <div key={tt.key} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t(tt.labelKey)}</span>
            <span className="tabular-nums font-medium">
              {tt.n === 0 ? "—" : eur(tt.sum, locale)}
              {tt.n > 0 && tt.n < roll.municipalityCount && (
                <span className="text-xs text-muted-foreground ml-1">
                  {t("mf_region_of_n", {
                    n: tt.n,
                    total: roll.municipalityCount,
                  })}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Rule 1, said out loud — three numbers in a column invite being added. */}
      <p className="text-[11px] text-muted-foreground mt-2">
        {t("mf_region_nesting", { count: roll.municipalityCount })}
        {/* The per-row „(n of total)" chip covers a partial stock, but NOT the
            one state where it is absent and the total is wrong anyway: a stock
            nobody published renders a bare „—" with no chip. This says it. */}
        {roll.partial && ` ${t("mf_region_partial")}`}
      </p>

      {(roll.criteriaCount > 0 || roll.recoveryCount > 0) && (
        <p className="text-xs mt-2">
          {/* Two counts, two sentences, never one „distressed" tally. */}
          {roll.criteriaCount > 0 && (
            <span>
              {t("mf_region_criteria", { count: roll.criteriaCount })}{" "}
            </span>
          )}
          {roll.recoveryCount > 0 && (
            <span>
              {t("mf_region_recovery", { count: roll.recoveryCount })}
            </span>
          )}
        </p>
      )}
    </StatCard>
  );
};
