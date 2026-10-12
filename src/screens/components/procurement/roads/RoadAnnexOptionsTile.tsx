// „Анекси за точно +50%" — contracts whose current value is exactly 1.5 × their
// signing value, grouped by the ground the annex itself states.
//
// ⚠️ NOT AN OVERRUN, AND THE COPY MUST NEVER CALL IT ONE (plan D4/D6/R9) — but
// NOT ALL OPTIONS EITHER. Most of the cluster is ЗОП чл. 116, ал. 1, т. 1 (a +50%
// option written into the contract at signing); 12 of 45 cite т. 3, unforeseeable
// circumstances. The copy says „повечето", never „всички".
// АПИ accounts for ~94% of all such growth in the national corpus, which IS the
// finding: one buyer pre-sets the maximum option almost alone.
//
// Whole-corpus figures from the hub blob — the tile says so, because it sits on a
// scoped page.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileStack } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import type { AnnexReasonCode } from "@/lib/annexReasons";

const REASON_LABEL: Record<AnnexReasonCode, { bg: string; en: string }> = {
  option: {
    bg: "клауза за опция в договора (чл. 116, ал. 1, т. 1)",
    en: "an option clause in the contract (Art. 116(1)(1))",
  },
  unforeseen: {
    bg: "непредвидени обстоятелства (чл. 116, ал. 1, т. 3)",
    en: "unforeseeable circumstances (Art. 116(1)(3))",
  },
  additional: {
    bg: "допълнителни работи от същия изпълнител",
    en: "additional works from the same contractor",
  },
  non_substantial: {
    bg: "несъществени промени",
    en: "non-substantial changes",
  },
  replacement: {
    bg: "смяна на изпълнителя",
    en: "replacement of the contractor",
  },
  de_minimis: { bg: "под минималния праг", en: "de minimis" },
  other: { bg: "друго или неуказано", en: "other or not stated" },
};

export const RoadAnnexOptionsTile: FC<{
  options: RoadsHubStats["annexOptions"];
}> = ({ options }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  if (!options.contracts) return null;
  const eur = (n: number) => formatEurCompact(n, lang);
  const share =
    options.nationalGrowthEur > 0
      ? Math.round((options.growthEur / options.nationalGrowthEur) * 100)
      : null;
  const max = Math.max(...options.byReason.map((r) => r.growthEur), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <FileStack className="h-4 w-4" />
          {bg ? "Анекси за точно +50%" : "Annexes of exactly +50%"}
          <span className="text-xs font-normal text-muted-foreground">
            {bg ? "за целия период" : "whole period"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <p>
          {bg
            ? `${formatInt(options.contracts, lang)} договора са увеличени с точно 50% — общо ${eur(options.growthEur)} над стойността при подписване.`
            : `${formatInt(options.contracts, lang)} contracts were raised by exactly 50% — ${eur(options.growthEur)} in total above their signing value.`}
          {share != null
            ? bg
              ? ` Това е ${share}% от целия такъв ръст в страната (${formatInt(options.nationalContracts, lang)} договора, ${eur(options.nationalGrowthEur)}).`
              : ` That is ${share}% of all such growth nationally (${formatInt(options.nationalContracts, lang)} contracts, ${eur(options.nationalGrowthEur)}).`
            : null}
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="w-56 shrink-0">
              {bg ? "основание в анекса" : "ground in the annex"}
            </span>
            <span className="flex-1" />
            <span className="w-24 text-right">{bg ? "ръст" : "growth"}</span>
            <span className="w-10 text-right">{bg ? "дог." : "ctr"}</span>
          </div>
          {options.byReason.map((r) => (
            <div key={r.reason} className="flex items-center gap-2 text-xs">
              <span
                className="w-56 shrink-0 truncate"
                title={
                  bg ? REASON_LABEL[r.reason].bg : REASON_LABEL[r.reason].en
                }
              >
                {bg ? REASON_LABEL[r.reason].bg : REASON_LABEL[r.reason].en}
              </span>
              <span className="flex-1 h-2.5 rounded bg-muted overflow-hidden">
                <span
                  className="block h-full bg-primary/60"
                  style={{
                    width: `${Math.max(3, (r.growthEur / max) * 100)}%`,
                  }}
                />
              </span>
              <span className="w-24 text-right tabular-nums">
                {eur(r.growthEur)}
              </span>
              <span className="w-10 text-right tabular-nums text-muted-foreground">
                {r.contracts}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Основанието е това, което анексът сам посочва. Опцията е предвидена в договора при подписването му — упражнено право, а не преразход. Анексите по непредвидени обстоятелства са отделно основание и се показват отделно. Сумите са за целия корпус и не се променят с избрания период."
            : "The ground is the one the annex itself states. An option is provided for in the contract when it is signed — a right exercised, not an overrun. Annexes for unforeseeable circumstances are a separate ground, shown separately. Figures cover the whole corpus and do not change with the selected window."}
        </p>
      </CardContent>
    </Card>
  );
};
