// „Конкуренция" on /sector/roads/procurement — the sector's single-bid share
// beside the national rate ON THE SAME WINDOW and the same basis (no €0
// consortium-member rows on either side — migration 167's ex-member pair).
//
// A whole-corpus baseline beside a scoped rate is a different sentence, and on
// culture it inverted the sign (plan §T5, sector-dashboard §3). And the rate is
// count-based, so it cannot know that some single-bid awards are single by
// construction: the card names how much of the single-bid money went through a
// framework mini-competition or a negotiation without prior notice — it does not
// re-score them.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { procedureBucket } from "@/lib/cpvSectors";
import { isSingleBid } from "@/lib/awarderModel";
import type { RoadsModel } from "@/lib/roadAttributes";

const isFrameworkMini = (method?: string) =>
  /вътрешен конкурентен избор/i.test(method ?? "");

export const RoadCompetitionCard: FC<{
  model: RoadsModel;
  /** nationalSingleBidExMembers() on the page's window — null shows no baseline. */
  nationalRate: number | null;
}> = ({ model, nationalRate }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const known = model.rows.filter((r) => r.c.numberOfTenderers != null);
  const single = known.filter((r) => isSingleBid(r.c.numberOfTenderers));
  if (!known.length) return null;
  const pct = (n: number, d: number) =>
    new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
      maximumFractionDigits: 1,
    }).format((n / d) * 100) + "%";
  const sector = pct(single.length, known.length);
  const nat = nationalRate != null ? pct(nationalRate, 1) : null;

  const singleEur = single.reduce((s, r) => s + r.amountEur, 0);
  const frameworkEur = single
    .filter((r) => isFrameworkMini(r.c.procurementMethod))
    .reduce((s, r) => s + r.amountEur, 0);
  const noNoticeEur = single
    .filter(
      (r) =>
        !isFrameworkMini(r.c.procurementMethod) &&
        procedureBucket(r.c.procurementMethod) === "direct",
    )
    .reduce((s, r) => s + r.amountEur, 0);
  const eur = (n: number) => formatEurCompact(n, lang);

  return (
    <Card id="competition" className="scroll-mt-24">
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
            ? `от ${formatInt(known.length, lang)} договора с известен брой оферти са с една оферта`
            : `of ${formatInt(known.length, lang)} contracts with a known bid count drew a single bid`}
          {nat
            ? bg
              ? ` — при ${nat} за всички възложители в същия период.`
              : ` — against ${nat} for all buyers in the same window.`
            : "."}
        </p>
        {singleEur > 0 ? (
          <p className="text-muted-foreground">
            {bg
              ? `От ${eur(singleEur)} по договори с една оферта ${eur(frameworkEur)} са вътрешен конкурентен избор по рамково споразумение и ${eur(noNoticeEur)} — договаряне без предварително обявление. При тези процедури кръгът участници е ограничен по закон, така че една оферта не означава непременно неуспял търг.`
              : `Of ${eur(singleEur)} in single-bid contracts, ${eur(frameworkEur)} was a mini-competition under a framework agreement and ${eur(noNoticeEur)} a negotiation without prior notice. Those procedures limit who may bid by law, so a single bid there is not necessarily a failed market.`}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "И двете страни на сравнението са без нулевите дялове на участниците в обединения — иначе едно обединение се брои веднъж за всяка фирма в него."
            : "Both sides of the comparison exclude the €0 shares of consortium members — otherwise one consortium counts once per member firm."}
        </p>
      </CardContent>
    </Card>
  );
};
