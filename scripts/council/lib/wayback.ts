// Wayback Machine CDX reader, shared by the four parsers whose councils
// publish no usable live index — Добрич, Габрово, Хасково and Казанлък all
// discover their protokols out of web.archive.org.
//
// Extracted because those four had the same reader copied four times, and
// because of what they have in common at RUNTIME rather than in source:
// they hit ONE host, one município after another, and that host is the one
// that rate-limits us. The 429 back-off in lib/fetch.ts exists for it. A
// change to how this repo talks to Wayback should land in one place.

import { fetchJson, COUNCIL_UA } from "./fetch";

/**
 * Read a CDX index and map each row's original URL through the caller's
 * ref parser, dropping rows it rejects and de-duplicating on `keyOf`.
 *
 * `keyOf` is a parameter rather than a hard-coded `pdfUrl` because the
 * four readers are NOT identical on this point: Габрово dedupes on
 * (date, session) while the rest use the URL, and collapsing that
 * difference silently would change which snapshot Габрово keeps when
 * Wayback holds several for one sitting.
 */
export const fetchCdxIndex = async <T>(
  cdxUrl: string,
  parseRef: (rawUrl: string) => T | null,
  keyOf: (ref: T) => string,
): Promise<T[]> => {
  const rows = await fetchJson<string[][]>(cdxUrl, {
    headers: { "User-Agent": COUNCIL_UA },
  });
  const out: T[] = [];
  const seen = new Set<string>();
  // Row 0 is the header.
  for (const row of rows.slice(1)) {
    const ref = parseRef(row[2]);
    if (!ref) continue;
    const key = keyOf(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};
