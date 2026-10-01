// The /about#accumulation-gap section — methodology and RIGHT OF REPLY for the "change in wealth
// against declared income" figure, which names individuals (governed by
// docs/methodology/accumulation-gap.md). Every figure on /person links here.
//
// ONE source for both renderers: AboutScreen and the /about prerender (scripts/prerender/routes.ts).
// Until 2026-10-01 the section lived ONLY in the prerender's hand-written HTML, so the anchor the
// person pages link to vanished the moment the app rendered — the safeguard the legitimate-interest
// assessment leans on was invisible to every reader with JavaScript.

import { escHtml, inlineHtml } from "@/lib/inlineMarkup";

type Lang = "bg" | "en";

/** The anchor PersonAccumulationGap links to. */
export const ACCUMULATION_GAP_ID = "accumulation-gap";

const CONTACT = "support@electionsbg.com";

export type GapParagraph = { lead?: string; text: string };

export const ACCUMULATION_GAP: Record<
  Lang,
  { heading: string; paragraphs: GapParagraph[] }
> = {
  bg: {
    heading: "Промяна в имуществото спрямо декларирания доход",
    paragraphs: [
      {
        text: "За част от публичните лица показваме разликата между промяната в декларираното им нетно имущество и декларирания от тях доход за същия период. Това е несъответствието, което по закон проверява КПКОНПИ.",
      },
      {
        lead: "За кого се изчислява.",
        text: "Само за народни представители (настоящи и бивши), министри и заместник-министри, кметове и магистрати. Не се изчислява за общински съветници и за администрация на по-ниско ниво — публикуването на такова число е защитимо за най-високите публични длъжности, не за първи мандат в общински съвет.",
      },
      {
        lead: "Кога изобщо не се показва.",
        text: "Ако лицето не е подавало декларация за всяка година от периода, числото не се показва — сравняването на десетгодишна промяна в имуществото с доход за четири години произвежда несъществуваща разлика. Не се показва и когато декларациите не съдържат данни за доход.",
      },
      {
        lead: "Какво числото не означава.",
        text: "Декларирано пред Сметна палата, не одитирано. Наследство, дарение, реституция, продажба на притежаван актив, доходи на съпруг/а и погасени заеми променят имуществото, без да се появяват като доход. Имоти без обявена стойност се броят за €0 и техният брой се показва до числото — тогава разликата не е точна величина. Страницата не твърди нарушение.",
      },
      {
        lead: "Право на отговор.",
        text: `Всяко засегнато лице може да оспори или допълни числото. Пишете ни на [${CONTACT}](mailto:${CONTACT}) или през [страницата на „Наясно“](https://www.facebook.com/naiasno); обоснована поправка (документиран източник, който декларацията не съдържа) се публикува до самото число.`,
      },
    ],
  },
  en: {
    heading: "Change in wealth against declared income",
    paragraphs: [
      {
        text: "For some public figures we show the difference between the change in their declared net worth and the income they declared over the same period — the discrepancy the Anti-Corruption Commission (КПКОНПИ) is statutorily meant to examine.",
      },
      {
        lead: "Who it is computed for.",
        text: "Only members of parliament (sitting and former), ministers and deputy ministers, mayors and magistrates. It is not computed for municipal councillors or lower administration — publishing such a figure is defensible for the highest public offices, not for a first-term councillor.",
      },
      {
        lead: "When it is not shown at all.",
        text: "If the person did not file in every year of the span, the figure is withheld — comparing a ten-year change in wealth against four years of income manufactures a difference that does not exist. It is also withheld when the declarations carry no income data.",
      },
      {
        lead: "What the number does not mean.",
        text: "Declared to the Court of Audit, not audited. Inheritance, gifts, restitution, the sale of a previously-owned asset, a spouse's income and repaid loans all move wealth without appearing as income. Real estate with no stated value counts as €0, and that count is shown next to the figure — where it is non-zero, the difference is not a precise number. The page asserts no wrongdoing.",
      },
      {
        lead: "Right of reply.",
        text: `Anyone named may dispute or contextualise the figure. Write to us at [${CONTACT}](mailto:${CONTACT}) or via the [Наясно page](https://www.facebook.com/naiasno); a substantiated correction (a documented source the declaration omits) is published alongside the figure itself.`,
      },
    ],
  },
};

/** The prerendered section — the same text AboutScreen renders. */
export const accumulationGapHtml = (lang: Lang): string => {
  const c = ACCUMULATION_GAP[lang];
  return [
    `<h2 id="${ACCUMULATION_GAP_ID}">${escHtml(c.heading)}</h2>`,
    ...c.paragraphs.map(
      (p) =>
        `<p>${p.lead ? `<strong>${escHtml(p.lead)}</strong> ` : ""}${inlineHtml(p.text)}</p>`,
    ),
  ].join("\n");
};
