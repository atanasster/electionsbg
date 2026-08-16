// "Къде отиват парите за социална защита" — the signature hero (plan §4.2). Social
// protection is €15.09bn = ~37% of ALL government spending (2024), the largest
// COFOG function. This tile places the МТСП/АСП disbursement slice (~€1.46bn) inside
// that whole, with the pensions + other remainder (НОИ, cross-linked to /pensions),
// then blows up the group's competed procurement (~€19M/yr) as a sliver — the
// inversion: here procurement is ~1% of the МТСП budget and ~0.1% of the function.
//
// Reads data/cofog.json (GF10 total) + the МТСП budget node (the slice). Uses the
// shared PassThroughHero. data-og="social-hero".

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PiggyBank } from "lucide-react";
import { formatEurCompact } from "@/lib/currency";
import { useCofog } from "@/data/macro/useCofog";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { SOCIAL_BUDGET_NODE } from "@/lib/socialReferenceData";
import { PassThroughHero } from "../PassThroughHero";

export const SocialHeroTile: FC<{
  /** The group's competed ЗОП procurement in the active scope (annual if perYear). */
  procEur: number | null;
  perYear: boolean;
}> = ({ procEur, perYear }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data: cofog } = useCofog();
  const { data: budget } = useBudgetMinistryRollup(SOCIAL_BUDGET_NODE);

  const gf10 = cofog?.series?.GF10 ?? [];
  const gf10Latest = gf10.length ? gf10[gf10.length - 1] : null;
  if (!gf10Latest || gf10Latest.valueEur <= 0) return null;
  const year = gf10Latest.year;
  const whole = gf10Latest.valueEur;

  // The МТСП disbursement slice for the SAME year as GF10 (fall back to latest).
  const budgetYears = (budget?.years ?? []).filter(
    (y) => (y.expenditure?.amountEur ?? 0) > 0,
  );
  const mtspYear =
    budgetYears.find((y) => y.fiscalYear === year) ??
    budgetYears.sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  const mtsp = mtspYear?.expenditure?.amountEur ?? 0;
  if (mtsp <= 0) return null;
  const remainder = Math.max(0, whole - mtsp);

  const proc = procEur ?? 0;
  // The two figures in the sliver caption used to be written down — „под 0,2%" and
  // „€15 млрд." — beside a `whole` the tile computes and renders three lines above.
  // They agree today (0.13% of €15.09bn) and the next COFOG vintage silently breaks
  // the pairing: the bar says one total and the sentence names another. Both are
  // now derived from the same number the bar is drawn from.
  //
  // Precision follows the value rather than being fixed, because the whole point of
  // the sliver is that the number is small but REAL: rounded to whole percent this
  // prints „0%", which reads as none. One decimal covers the usual case (0,1%); a
  // narrow scope with a few hundred thousand euro needs two, or it rounds to „0,0%"
  // and says the same wrong thing one digit further along.
  const pctOfWhole = whole > 0 ? (proc / whole) * 100 : 0;
  const shareDigits = pctOfWhole > 0 && pctOfWhole < 0.1 ? 2 : 1;
  const shareOfWhole = `${pctOfWhole.toLocaleString(lang, {
    minimumFractionDigits: shareDigits,
    maximumFractionDigits: shareDigits,
  })}%`;

  return (
    <PassThroughHero
      id="social-hero"
      dataOg="social-hero"
      icon={PiggyBank}
      title={
        bg
          ? "Къде отиват парите за социална защита"
          : "Where the money for social protection goes"
      }
      wholeEur={whole}
      wholeLabel={
        bg
          ? `социална защита — най-големият разход на държавата, ${year} г.`
          : `social protection — the state's largest expenditure, ${year}`
      }
      lang={lang}
      segments={[
        {
          label: bg
            ? "Социално подпомагане (МТСП/АСП)"
            : "Social assistance (МТСП/АСП)",
          eur: mtsp,
          colorClass: "bg-primary",
          highlight: true,
        },
        {
          label: bg
            ? "Пенсии и друга соц. защита (НОИ)"
            : "Pensions & other social protection (НОИ)",
          eur: remainder,
          colorClass: "bg-muted-foreground/30",
          to: "/pensions",
        },
      ]}
      sliver={
        proc > 0
          ? {
              label: bg ? "Обществени поръчки" : "Public procurement",
              eur: proc,
              ofEur: mtsp,
              caption: (share) =>
                bg ? (
                  <>
                    Обществените поръчки на цялата група (
                    <span className="font-semibold tabular-nums">
                      {formatEurCompact(proc, lang)}
                    </span>
                    {perYear ? "/год." : ""}) са{" "}
                    <span className="font-semibold">{share}</span> от бюджета на
                    МТСП — и{" "}
                    <span className="font-semibold">{shareOfWhole}</span> от{" "}
                    {formatEurCompact(whole, lang)} социална защита. Историята е
                    в изплатените помощи, не в поръчките.
                  </>
                ) : (
                  <>
                    The whole group's public procurement (
                    <span className="font-semibold tabular-nums">
                      {formatEurCompact(proc, lang)}
                    </span>
                    {perYear ? "/yr" : ""}) is{" "}
                    <span className="font-semibold">{share}</span> of the МТСП
                    budget — and{" "}
                    <span className="font-semibold">{shareOfWhole}</span> of the{" "}
                    {formatEurCompact(whole, lang)} function. The story is in
                    the benefits paid, not the procurement.
                  </>
                ),
            }
          : undefined
      }
      footnote={
        bg
          ? "Източник: Eurostat COFOG GF10 (социална защита, обща стойност) и Закон за държавния бюджет (МТСП). Пенсиите (НОИ) са в остатъка — виж изгледа „Пенсии“."
          : "Source: Eurostat COFOG GF10 (social protection, total) and the State Budget Law (МТСП). Pensions (НОИ) are in the remainder — see the Pensions view."
      }
    />
  );
};
