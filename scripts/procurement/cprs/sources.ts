// ЦПРС — Централен професионален регистър на строителя (Камара на строителите в
// България). Plan P2: which companies are licensed for which construction class,
// since when. It is the ELIGIBILITY CHECK on every works contract — „did this
// contractor hold the required licence class on the award date?" — and it is
// answerable nowhere else on the Bulgarian web.
//
// The register is a 1990s PHP frameset at register.ksb.bg. No Cloudflare, no
// login, no rate limiting observed. `listFirms.php` takes a POST of
// (Pod = област, GroupType = licence class) and returns an HTML table of
// ЕИК · name · protocol no/date. The class taxonomy is not served as data — it
// is embedded in the page as a JavaScript `GrNames` array, which is why
// `parseTaxonomy()` reads it from there rather than from the <select>.
//
// ⚠️ THE PRODUCT IS A CARTESIAN ONE, and that is the register's design, not ours:
// there is no „all областi" or „all classes" option, so membership is only
// obtainable as 30 × 54 = 1,620 queries.
//
// ⚠️ ОБЛАСТ IS THE FIRM'S SEAT, NOT A TERRITORY IT MAY WORK IN. Measured over
// the full crawl: every licence carries exactly one област, and NO firm's област
// varies by class (0 of 8,379). An earlier note here claimed a firm appears once
// per област it operates in — it does not, and modelling it that way put a
// 30-element array on each of 106,508 rows for a value that is one scalar per
// firm. It is folded per (eik, class); the seat lives on the firm.

export const CPRS_BASE = "https://register.ksb.bg";
export const CPRS_LIST_URL = `${CPRS_BASE}/listFirms.php`;
/** Struck-off builders — the historical arm, same shape. */
export const CPRS_REVOKED_URL = `${CPRS_BASE}/zalicheni.php`;

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/** Polite pacing. The register is a small association's PHP app on shared
 *  hosting, not a national platform — nothing here is worth pushing. Measured:
 *  a single query answers in ~0.4 s, so 2 concurrent is already 5 req/s. */
export const CONCURRENCY = 2;

export type CprsClass = { code: string; label: string };
export type CprsOblast = { code: string; label: string };

/** A group HEADER (ПЪРВА ГРУПА …) versus a real class (1.1, 42.11 …).
 *  The headers are `10`/`20`/`30`/`40`/`50`/`70` and returning them queries the
 *  whole group; the sub-codes are subsets of it. Both are crawled, because the
 *  header is the only way to see a firm licensed for a group with no sub-class. */
export const isGroupHeader = (code: string): boolean => /^[1-7]0$/.test(code);

/** The taxonomy lives in a JS array on the search page. Parsed rather than
 *  hard-coded: КСБ adds NACE-coded classes to group 5 over time, and a frozen
 *  list would silently stop covering them. */
export const parseTaxonomy = (html: string): CprsClass[] => {
  const out: CprsClass[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /GrNames\[\d+\]\s*=\s*new Array\("([^"]+)",\s*'((?:[^'\\]|\\.)*)'\s*\)/g,
  )) {
    const code = m[1].trim();
    // ⚠️ 43.91 appears TWICE with different labels („Зидарски и каменоделски"
    // and „Покривни работи") — a duplicate in КСБ's own array. Keep the first
    // and do not let the second overwrite it, or the class label flips between
    // runs depending on iteration order.
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: m[2].replace(/\\'/g, "'").trim() });
  }
  return out;
};

/** The 28 областi + Sofia's two entries, from the `Pod` <select>. */
export const parseOblasti = (html: string): CprsOblast[] => {
  const sel = html.match(/<select[^>]*name="Pod"[\s\S]*?<\/select>/i)?.[0];
  if (!sel) return [];
  return [
    ...sel.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g),
  ]
    .map((m) => ({
      code: m[1].trim(),
      label: m[2].replace(/<[^>]+>/g, "").trim(),
    }))
    .filter((o) => o.code && o.label);
};
