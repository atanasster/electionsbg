// When an office was held, phrased so the reader can tell WHAT the dates measure.
//
// person_role carries start_date/end_date plus a `date_basis` (081) because the three
// sources that fill them measure three different events, and a bare "2023 – 2025" would
// present them as one kind of fact:
//
//   term      the mandate itself (MP terms). Says what it looks like it says.
//   election  the election that PRODUCED the mandate, parsed off the cycle in the ref. The
//             mandate legally begins at the constitutive session, days to weeks later, so
//             the phrasing names the ELECTION and never claims a day of taking office.
//   filing    when a встъпителна / при напускане declaration reached the Сметна палата.
//             ЗПКОНПИ allows a month, so it trails the real event by up to ~30 days — an
//             upper bound. The phrasing says "declaration", because that is what the date is.
//
// Returned as an i18n key + params rather than a string so the screen owns rendering and
// this stays pure (and testable) — the same split the rest of src/screens/person uses.

import { formatDate } from "@/lib/formatDate";

export type OfficeDates = {
  start?: string | null;
  end?: string | null;
  dateBasis?: "term" | "election" | "filing" | null;
};

export type OfficeTermPhrase = {
  /** i18n key for the visible text. */
  key: string;
  /** Interpolation params, already localized. */
  params: { start?: string; end?: string };
  /** i18n key for the `title` tooltip — where the basis' caveat is spelled out. */
  titleKey: string;
};

/**
 * Phrase a role's dates, or null when there is nothing to say.
 *
 * A date with NO basis yields null rather than a bare range: an undeclared basis means some
 * writer filled a date and did not say what it measures, and guessing "term" there is
 * exactly the mislabelling the basis column exists to prevent. Showing nothing is the
 * recoverable failure; showing a filing date as a start of office is not.
 */
export const officeTermPhrase = (
  r: OfficeDates,
  lang: string,
): OfficeTermPhrase | null => {
  const basis = r.dateBasis;
  if (!basis) return null;

  const start = r.start ? formatDate(r.start, lang) : null;
  const end = r.end ? formatDate(r.end, lang) : null;
  if (!start && !end) return null;

  const shape = start && end ? "range" : start ? "since" : "until";
  return {
    key: `pp_period_${basis}_${shape}`,
    params: {
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    },
    titleKey: `pp_period_${basis}_note`,
  };
};

/**
 * Phrase every stretch a seat was held for, newest first.
 *
 * Plural because a seat can be held, lost and regained: 1,675 people in the corpus hold a
 * local seat across a gap, and rendering their first and last dates as one range would state
 * a tenure they did not have. The screen joins these with a comma — "2007 - 2011, от 2025".
 *
 * Newest first because the current stretch is the one a reader is looking for; `spans`
 * arrives oldest-first from foldOffices, which is the order the merge needs.
 */
export const officeTermPhrases = (
  r: {
    spans?: Array<{ start: string | null; end: string | null }>;
  } & OfficeDates,
  lang: string,
): OfficeTermPhrase[] =>
  [...(r.spans ?? [])]
    .reverse()
    .map((s) => officeTermPhrase({ ...s, dateBasis: r.dateBasis }, lang))
    .filter((p): p is OfficeTermPhrase => p !== null);
