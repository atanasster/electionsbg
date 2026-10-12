// „Пари, които остават в сектора" on /water/procurement (docs/plans/water-hub-v1.md
// W2 / D4 / D5). A contract whose supplier is itself a water-sector EIK is not a
// purchase on a market: on 2026-10-12 most of it was subsidiaries LENDING to
// Български ВиК холдинг („Договор за заем"), plus two rows where an awarder is
// recorded as its own contractor. It stays IN the headline — the register's own
// basis, and the hub's KPI 1 equals sector_stats.json — so it is disclosed here
// rather than subtracted. The concentration tile labels the same suppliers
// „в групата" and states a market-only index beside its own.
//
// Two windows on one card, each named: the in-window total comes from the page's
// group model; the loan / self / credit split comes from the hub blob and is
// whole-period, because the per-contract titles that split it are not in the
// group payload.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";
import { Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { isWaterSectorEik } from "@/lib/vikReferenceData";
import { useWaterHubStats } from "@/data/water/hubStats";

export const WaterIntraGroupCard: FC<{
  /** The page's in-window supplier list (group model). */
  suppliers: { eik: string; totalEur: number }[];
  /** The page's in-window headline total. */
  totalEur: number;
}> = ({ suppliers, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub } = useWaterHubStats();
  const eur = (n: number) => formatEurCompact(n, lang);

  const inWindow = suppliers
    .filter((s) => isWaterSectorEik(s.eik))
    .reduce((a, s) => a + s.totalEur, 0);
  const g = hub?.intraGroup;
  if (!inWindow && !g?.contracts) return null;
  const share =
    totalEur > 0
      ? new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
          maximumFractionDigits: 2,
        }).format((inWindow / totalEur) * 100) + "%"
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Repeat className="h-4 w-4" />
          {bg
            ? "Пари, които остават в сектора"
            : "Money that stays in the sector"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {eur(inWindow)}
          </span>{" "}
          {bg
            ? `в избрания период са договори, при които изпълнителят е друго дружество от ВиК сектора${share ? ` (${share} от сумата)` : ""} — без договорите, в които възложителят е посочен и като изпълнител.`
            : `in the selected window are contracts whose contractor is another water-sector company${share ? ` (${share} of the total)` : ""} — excluding contracts that name the awarder as its own contractor.`}
        </p>
        {g?.contracts ? (
          <p className="text-muted-foreground">
            {bg
              ? `За целия период: ${eur(g.eur - g.selfEur)} по ${formatInt(g.contracts - g.selfContracts, lang)} договора между дружества от сектора, от тях ${eur(g.loansToHoldingEur)} по ${formatInt(g.loansToHoldingContracts, lang)} договора за заем към Български ВиК холдинг. Отделно ${eur(g.selfEur)} по ${formatInt(g.selfContracts, lang)} договора, в които възложителят е посочен и като изпълнител.`
              : `Over the whole period: ${eur(g.eur - g.selfEur)} across ${formatInt(g.contracts - g.selfContracts, lang)} contracts between sector companies, of which ${eur(g.loansToHoldingEur)} across ${formatInt(g.loansToHoldingContracts, lang)} are loan agreements to the Bulgarian Water Holding. Separately, ${eur(g.selfEur)} across ${formatInt(g.selfContracts, lang)} name the awarder as its own contractor.`}
            {hub?.credits.contracts
              ? bg
                ? ` Кредитите от банки — ${eur(hub.credits.eur)} по ${formatInt(hub.credits.contracts, lang)} договора — са от външни доставчици и остават в класацията.`
                : ` Bank credit — ${eur(hub.credits.eur)} across ${formatInt(hub.credits.contracts, lang)} contracts — comes from external suppliers, which stay in the ranking.`
              : ""}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Сумите са включени в общата стойност на поръчките на сектора; в концентрацията на изпълнителите тези дружества са отбелязани „в групата“."
            : "These sums are included in the sector's procurement total; in the contractor concentration these companies are marked as in-group."}
        </p>
      </CardContent>
    </Card>
  );
};
