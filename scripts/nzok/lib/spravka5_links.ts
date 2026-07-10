// Shared matcher for НЗОК's "Справка 5" per-hospital antineoplastic/coagulopathy
// drug files on nhif.bg's nzok/medicine/5 listing page — used by the writer (and
// any future watcher) so a naming change on nhif.bg is a one-file edit (mirrors
// lib/bmp_links.ts / lib/drug_links.ts).
//
// The listing carries, newest-first, one .xls per calendar month
// ("Справка 5_ПЛС2_MM.YYYY.xls"), the occasional recomputed monthly correction
// ("…_MM cor.YYYY.xls"), and one annual roll-up per closed year
// ("Справка 5_ПЛС2_YYYY.xls"). We keep the include narrow ("Справка 5") and let
// the period parser below split monthly from annual so the writer can pick which
// grain it wants without re-reading the file.

export interface Spravka5Link {
  /** Raw href as it appears in the HTML (still percent-encoded). */
  href: string;
  /** Decoded filename/path for human-readable matching + display. */
  name: string;
  /** "05.2026" for a monthly file, "2025" for an annual roll-up. */
  period: string;
  kind: "monthly" | "annual";
  /** Calendar year the file covers. */
  year: number;
  /** 1..12 for a monthly file, null for an annual roll-up. */
  month: number | null;
}

/** True for a decoded "Справка 5 …" filename on the medicine/5 listing. */
export const isSpravka5Name = (name: string): boolean =>
  /Справка\s*5/i.test(name) && /\.xlsx?$/i.test(name);

/** Parse the period out of a "Справка 5" filename. Handles the three shapes seen
 *  on the page: monthly "…_MM.YYYY.xls", monthly correction "…_MM cor.YYYY.xls"
 *  (the recomputed month — same period, treated as monthly), and the annual
 *  roll-up "…_YYYY.xls". Returns null when neither shape matches. */
export const parseSpravka5Period = (
  name: string,
): {
  period: string;
  kind: "monthly" | "annual";
  year: number;
  month: number | null;
} | null => {
  // Trailing token after the last "_", minus the extension — the period lives
  // there ("05.2026", "10 cor.2025", "2025").
  const tail = name
    .replace(/\.xlsx?$/i, "")
    .split("_")
    .pop()
    ?.trim();
  if (!tail) return null;
  // Monthly (optionally a "cor" correction between month and year).
  const m = tail.match(/^(\d{1,2})[\s.]*(?:cor[\s.]*)?(\d{4})$/i);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month >= 1 && month <= 12)
      return {
        period: `${String(month).padStart(2, "0")}.${year}`,
        kind: "monthly",
        year,
        month,
      };
  }
  // Annual roll-up — a bare 4-digit year.
  const a = tail.match(/^(\d{4})$/);
  if (a)
    return { period: a[1], kind: "annual", year: Number(a[1]), month: null };
  return null;
};

/** All "Справка 5" xls links on the medicine/5 page, in document order (newest
 *  first). Links whose filename yields no recognizable period are dropped. */
export const spravka5Links = (html: string): Spravka5Link[] =>
  [...html.matchAll(/href="(\/upload\/[^"]+\.(?:xlsx|xls))"/gi)]
    .map((m) => ({ href: m[1], name: decodeURIComponent(m[1]) }))
    .filter((l) => isSpravka5Name(l.name))
    .flatMap((l) => {
      const p = parseSpravka5Period(l.name);
      return p ? [{ href: l.href, name: l.name, ...p }] : [];
    });
