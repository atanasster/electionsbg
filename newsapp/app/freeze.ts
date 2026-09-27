// The election-freeze sentence (news-person-sentiment-v1 §8.2), apart from its
// markup. Dates are STATED in Europe/Sofia time rather than relative — „до
// утре" is wrong for a reader in another zone, and wrong again tomorrow.

import { sofiaDateTime as sofia } from "@/lib/sofiaDateTime";
import type { FreezeStamps } from "./data";

/** The banner's sentence, or null when nothing is frozen. */
export const freezeText = (
  stamps: FreezeStamps | null | undefined,
  isEnglish: boolean,
): string | null => {
  const locale = isEnglish ? "en-GB" : "bg-BG";
  const tail = isEnglish
    ? "Scores of individual articles keep updating as usual."
    : "Оценките на отделните статии се обновяват както обикновено.";
  if (stamps?.frozen) {
    const asOf = sofia(stamps.frozen.as_of, locale, true);
    const until = sofia(stamps.frozen.until, locale, false);
    return isEnglish
      ? `Coverage data about people is frozen as of ${asOf} until the end of election day (${until}). ${tail}`
      : `Данните за отразяването на хора са замразени към ${asOf} до края на изборния ден (${until}). ${tail}`;
  }
  if (stamps?.withheld) {
    const until = sofia(stamps.withheld.until, locale, false);
    return isEnglish
      ? `Coverage data about people is not published until the end of election day (${until}). ${tail}`
      : `Данните за отразяването на хора не се публикуват до края на изборния ден (${until}). ${tail}`;
  }
  return null;
};
