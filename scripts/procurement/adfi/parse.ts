// АДФИ — Агенция за държавна финансова инспекция (plan P7): who has been
// financially inspected, on what legal basis, and when.
//
// The plan's framing: „АДФИ is the body ACF says it will refer this case to —
// „has this buyer ever been inspected, with what finding" is a cheap, strong
// column on /awarder/:eik."
//
// ⚠️ THE PAGE CARRIES NO ЕИК. The inspected body is a free-text NAME
// („Община Неделино - гр. Неделино", „Водоснабдяване и канализация ООД, гр.
// Русе"), so every join to our corpus is a name match and must refuse ambiguity
// rather than grade it — the same discipline as the ДКИ register. An inspection
// attributed to the wrong municipality is a false accusation about a named
// public body, which is the most damaging error this repo can make.

export type AdfiInspection = {
  /** The report's own file name — the only stable per-inspection identifier the
   *  page offers. Two reports can share a subject and a date. */
  reportFile: string;
  reportUrl: string;
  /** As printed. Never normalised here: the fold belongs to the resolver. */
  subject: string;
  /** „чл. 5, ал. 2 от ЗДФИ" — which power АДФИ acted under. */
  legalBasis: string | null;
  /** ISO. The page prints „10.04.2024 г." */
  publishedAt: string | null;
};

const clean = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[\s\u00a0]+/g, " ")
    .trim();

/** „10.04.2024 г." → „2024-04-10". Returns null rather than guessing — a report
 *  with no date cannot answer „was this buyer inspected BEFORE that award". */
export const parseAdfiDate = (v: string): string | null => {
  const m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const pad = (x: string) => x.padStart(2, "0");
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
};

export const parseAdfiTable = (
  html: string,
  baseUrl: string,
): AdfiInspection[] => {
  const out: AdfiInspection[] = [];
  const seen = new Set<string>();
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = tr[1];
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (c) => clean(c[1]),
    );
    if (cells.length < 4) continue;
    // The DATE is the discriminator between a data row and the repeated header
    // — the table is split into 29 sections, each with its own header row, and
    // the columns are otherwise indistinguishable.
    const publishedAt = parseAdfiDate(cells[3]);
    if (!publishedAt) continue;
    const href = row.match(/href="([^"]+\.pdf)"/i)?.[1];
    if (!href) continue;
    const reportUrl = href.startsWith("http")
      ? href
      : new URL(href, baseUrl).toString();
    // The file name is the identity. Decoded, because the page percent-encodes
    // Cyrillic file names inconsistently between sections.
    let reportFile = decodeURIComponent(reportUrl.split("/").pop() ?? "");
    if (!reportFile) continue;
    reportFile = reportFile.replace(/\.pdf$/i, "");
    // ⚠️ De-duplicate on the URL, not the file name: АДФИ reuses names like
    // „ДИД4-СМ-3" across years under different upload folders, and folding them
    // would silently merge two inspections of two different bodies.
    if (seen.has(reportUrl)) continue;
    seen.add(reportUrl);
    out.push({
      reportFile,
      reportUrl,
      subject: cells[1],
      legalBasis: cells[2] || null,
      publishedAt,
    });
  }
  return out;
};

/** The ONE fold for comparing an АДФИ subject to a corpus awarder name.
 *
 *  ⚠️ IT LIVES HERE, NOT IN THE LOADER AND NOT IN SQL. It was briefly written
 *  twice — TypeScript in the loader, a regexp_replace chain in the gate — and
 *  the two immediately disagreed: the gate flagged „«Топлофикация София» ЕАД" →
 *  „ТОПЛОФИКАЦИЯ СОФИЯ ЕАД" as a misattribution because its copy did not strip
 *  the „, гр. Варна" tail or the dash in „Топлофикация - София". A gate that
 *  cannot reproduce the loader's decision is not checking the loader; it is
 *  checking a second implementation nobody uses. This is the `councilNameKey()`
 *  divergence CLAUDE.md records, one dataset over.
 *
 *  Deliberately conservative: lowercase, drop quotes and punctuation, drop the
 *  „гр."/„с." settlement marker, collapse whitespace. NO token dropping and no
 *  abbreviation expansion — this decides whether to attach a financial
 *  inspection to a named public body, and a fold clever enough to match
 *  „Община Неделино" to „Община Неделчево" is a fold that defames someone. */
export const adfiNameFold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[„“”"'‘’«»]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[.,;:№#()]/g, " ")
    .replace(/\bгр\b\.?|\bс\b\.?/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
