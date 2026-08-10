// Date-only localized format shared across procurement surfaces (tender detail,
// the recent-appeals tile, the appeals browser). Renders a raw ISO date
// ("2024-03-14") as "14 март 2024" (bg) / "14 Mar 2024" (en). Falls back to the
// raw string on an unparseable input rather than printing "Invalid Date".
//
// A DATE-ONLY input is formatted in UTC, and that is load-bearing rather than tidy:
// `new Date("2021-04-15")` is parsed as UTC midnight, so formatting it in the VIEWER's zone
// prints 14 April for everyone west of Greenwich. Measured under America/New_York (UTC-4),
// which is how this surfaced. Every caller passes a date-only value — a birth date, a
// complaint date, a publication date, a mandate's start — where "the day" is the whole fact
// and has no time of day to shift.
//
// The UTC pin is scoped to the date-only SHAPE rather than applied unconditionally, so a
// caller that later passes a real instant ("…T14:30:00Z") still renders in the reader's own
// zone, which for an instant is the correct answer.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const fmt = (iso: string, lang: string, month: "short" | "long"): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // `startsWith`, not `=== "bg"`: callers pass `i18n.language` straight through, and a
  // region-tagged code ("bg-BG") would fall to the en-GB branch — a Bulgarian page with an
  // English date next to a Bulgarian place name, which reads as a rendering bug rather than
  // a config one. detectLanguage() only ever returns the bare codes today; this costs
  // nothing and removes the trap.
  return new Intl.DateTimeFormat(lang?.startsWith("bg") ? "bg-BG" : "en-GB", {
    year: "numeric",
    month,
    day: "numeric",
    ...(DATE_ONLY.test(iso) ? { timeZone: "UTC" } : {}),
  }).format(d);
};

/** "14 март 2024" (bg) / "14 Mar 2024" (en). */
export const formatDate = (iso: string, lang: string): string =>
  fmt(iso, lang, "short");

/** "14 март 2024" (bg) / "14 March 2024" (en) — the spelled-out month. */
export const formatDateLong = (iso: string, lang: string): string =>
  fmt(iso, lang, "long");
