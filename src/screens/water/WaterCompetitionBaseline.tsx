// „Конкуренция" on /water/procurement — the water sector's single-bid share
// beside the national rate ON THE SAME WINDOW and the same basis: €0 consortium
// MEMBER rows excluded on both sides (the rollup's exMembers switch, migration
// 167's ex-member pair). Plan: docs/plans/water-hub-v1.md T4 / G3.
//
// A whole-corpus baseline beside a scoped rate is a different sentence — on
// culture it inverted the sign — so the baseline travels with the page's window,
// and when either side cannot vouch for its basis the card shows NO baseline
// rather than a mismatched one. Single-bid is a flag for review, not proof.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatInt } from "@/lib/currency";
import { isBg } from "@/i18n";
import type { VikOperatorAgg } from "@/data/procurement/useVik";
import {
  nationalSingleBidExMembers,
  useNationalCompetition,
} from "@/data/procurement/useNationalCompetition";

export const WaterCompetitionBaseline: FC<{
  /** The page's ex-member operator rollup (useVikGroupRollup) — the SAME rows
   *  the per-operator tile beneath this card ranks. */
  operators: VikOperatorAgg[];
  /** The server confirmed the ex-member basis; false shows no baseline. */
  exMembers: boolean;
}> = ({ operators, exMembers }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: national } = useNationalCompetition();

  const known = operators.reduce((s, o) => s + o.bidKnownN, 0);
  const single = operators.reduce((s, o) => s + o.singleBidN, 0);
  if (!known) return null;
  const pct = (share: number) =>
    new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
      maximumFractionDigits: 1,
    }).format(share * 100) + "%";
  const sector = pct(single / known);
  // Only on a confirmed ex-member basis on BOTH sides.
  const natShare = exMembers ? nationalSingleBidExMembers(national) : null;
  const nat = natShare != null ? pct(natShare) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {bg ? "Конкуренция" : "Competition"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">{sector}</span>{" "}
          {bg
            ? `от ${formatInt(known, lang)} договора на ВиК сектора с известен брой оферти са с една оферта`
            : `of ${formatInt(known, lang)} water-sector contracts with a known bid count drew a single bid`}
          {nat
            ? bg
              ? ` — при ${nat} за всички възложители в същия период.`
              : ` — against ${nat} for all buyers in the same window.`
            : "."}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "И двете страни на сравнението са без нулевите дялове на участниците в обединения. Една оферта е сигнал за проверка, не доказателство — при някои процедури кръгът участници е ограничен по закон."
            : "Both sides of the comparison exclude the €0 shares of consortium members. A single bid is a flag for review, not proof — some procedures limit who may bid by law."}
        </p>
      </CardContent>
    </Card>
  );
};
