// Комисия по досиетата (comdos.bg) — the decision archive that backs the `ds`
// facet.
//
// The site is an old PHP app with NO bulk export: a paginated archive of decision
// titles (D1), one HTML page per decision (D2), and on that page a link to the
// full decision as a Word / PDF file (D3). Everything the corpus knows about a
// person is in D3 — D2 shows only the first person of each decision.
//
// The pure helpers below are the parts that already cost a re-crawl each; they are
// exported so they can be tested without the network:
//
//   - the archive page carries a SIDEBAR of recent decisions whose titles start
//     with „>>" — they are duplicates of page-1 rows and must not be indexed as
//     part of whichever page they appear on;
//   - a decision page can link MORE THAN ONE document (four candidate-list pages
//     also link the PREVIOUS decision; others link archival „описи") — taking the
//     first link gave the 50th/51st/52nd НС identical data;
//   - hrefs carry HTML entities (`&ndash;`, `&sect;`) and sometimes a leading
//     space (`href=" /media/…"`), which a naive regex 404s on or misses entirely —
//     the latter hid the whole 49th НС candidate list.

export const COMDOS_ORIGIN = "https://comdos.bg";

export const COMDOS_UA = "electionsbg.com data pipeline (comdos/ds)";

/** 1-based archive page. The site clamps a page past the end to the LAST page,
 *  so the crawler stops when a page adds no new DecisionID, never on a 404. */
export const archivePageUrl = (page: number): string => {
  if (!Number.isInteger(page) || page < 1)
    throw new Error(
      `archivePageUrl: page must be a positive integer, got ${page}`,
    );
  return `${COMDOS_ORIGIN}/${encodeURI("Начало/Архив_Решения")}/p/page/${page}`;
};

export const decisionViewUrl = (decisionId: number): string =>
  `${COMDOS_ORIGIN}/${encodeURI("Начало/Decision-View")}/p/view?DecisionID=${decisionId}`;

/** A media path as found on the page → an absolute, percent-encoded URL. */
export const mediaUrl = (mediaPath: string): string =>
  `${COMDOS_ORIGIN}${encodeURI(mediaPath)}`;

const decodeEntities = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(
      /&(ndash|mdash|sect|quot|amp|lt|gt|nbsp|bdquo|ldquo|rdquo);/g,
      (m, n: string) =>
        (
          ({
            ndash: "–",
            mdash: "—",
            sect: "§",
            quot: '"',
            amp: "&",
            lt: "<",
            gt: ">",
            nbsp: " ",
            bdquo: "„",
            ldquo: "“",
            rdquo: "”",
          }) as Record<string, string>
        )[n] ?? m,
    );

export interface ArchiveRow {
  decisionId: number;
  title: string;
}

/** The decision rows of ONE archive page, sidebar excluded. */
export const parseArchivePage = (html: string): ArchiveRow[] => {
  const rows = new Map<number, string>();
  for (const m of html.matchAll(/DecisionID=(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.startsWith(">>")) continue;
    rows.set(Number(m[1]), title);
  }
  return [...rows].map(([decisionId, title]) => ({ decisionId, title }));
};

/** „Решение № 3-69 от 17.03.2026 г. - …" → "3-69"; „Решение № 14 от …" → "14";
 *  „№ 2-185А/ …" → "2-185А". One decision (DecisionID 557) prints no number. */
export const decisionNumber = (title: string): string | null =>
  title.match(/№\s*(\d+(?:-\d+)?[А-ЯA-Z]?)/)?.[1] ?? null;

/** „… от 17.03.2026 г. …" / „№ 3-143/ 28.07.2026 г." / „№ 250от 09.08.2011" →
 *  ISO date. The title's FIRST dd.mm.yyyy is the decision date (a decision
 *  number never contains a dot; a later date in the subject — „избран на
 *  06.06.2023" — comes after it). The YEAR must come from here, never from the
 *  first 4-digit run in the title — that picks up the decision number
 *  (`2-1997` → 1997). */
export const decisionDate = (title: string): string | null => {
  const m = title.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

const DOC_HREF = /href="\s*(\/media\/[^"]+?\.(?:docx?|pdf|rtf))\s*"/gi;

/** The decision's OWN full-text document, or null when the page links none.
 *
 *  Among several links, the one whose filename starts with the decision's own
 *  number wins; archival inventories (`/Opisi …`) are never the decision. With no
 *  number match, the single remaining candidate is taken — and with several, the
 *  first, which is how every page with exactly one decision file reads. */
export const pickDecisionDoc = (
  html: string,
  number: string | null,
): string | null => {
  const seen = new Set<string>();
  for (const m of html.matchAll(DOC_HREF)) {
    const p = decodeEntities(m[1]).trim();
    if (/\/Opisi/i.test(p)) continue;
    seen.add(p);
  }
  const all = [...seen];
  if (all.length === 0) return null;
  if (number) {
    const esc = number.replace(/-/g, "\\-");
    const own = all.find((p) => {
      const base = p.slice(p.lastIndexOf("/") + 1);
      return new RegExp(`^${esc}[-._ ]`).test(base);
    });
    if (own) return own;
  }
  return all[0];
};

export const docExtension = (mediaPath: string): string =>
  mediaPath.slice(mediaPath.lastIndexOf(".") + 1).toLowerCase();
