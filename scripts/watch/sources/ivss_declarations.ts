// Инспекторат към ВСС — magistrate asset-declaration register watcher.
//
// Two things move here, and both matter:
//
//  1. The register itself ("Публикувани декларации", a Joomla site the ИВСС links
//     to at a bare IP) gains a new year every spring — a new block of 29
//     first-letter pages appears on its home page.
//  2. The ИВСС's own non-compliance lists (late filers, left-office-without-filing,
//     and the чл. 175ж discrepancy list) change whenever the Inspectorate adds or
//     clears a name. Those lists are short and newsworthy, so a content change is
//     worth a flag even without a new year.
//
// The register URL, the list pages and the HTML stripper all come from
// scripts/judiciary/sources.ts — the same module the ingest reads — so the
// watcher and the parser can't silently disagree about which pages exist.
//
// Downstream: `update-judiciary` re-runs scripts/judiciary/__write_declarations.ts.
//
// Cadence: monthly. The annual filing deadline is 15 May, so the register's new
// year lands late spring; the lists move sporadically.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import {
  INTEGRITY_PAGES,
  IVSS_PAGE,
  IVSS_REGISTER,
  stripHtml,
} from "../../judiciary/sources";

/** Only the table rows of a list page. Hashing the whole page would fold in the
 *  navigation, sidebars, news teasers and "последна актуализация" stamps, so any
 *  unrelated site edit would flip the fingerprint and trigger a pointless
 *  261-page re-scrape. The rows ARE the dataset. */
const listRows = (html: string): string =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter(Boolean)
    .join("~");

export const ivssDeclarations: WatchSource = {
  id: "ivss_declarations",
  label: "ИВСС — декларации на магистрати",
  url: IVSS_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const home = await fetchText(IVSS_REGISTER);
    if (!home) return { value: "missing", detail: "register fetch failed" };
    // Years present on the register index, and how many letter pages each has.
    const years = [
      ...new Set(
        [...home.matchAll(/през(?:<[^>]+>|\s)*?(20\d\d)/g)].map((m) =>
          Number(m[1]),
        ),
      ),
    ].sort();
    const letterLinks = [
      ...home.matchAll(
        /href="\/index\.php\?option=com_content[^"]*"[^>]*>\s*[А-Я]\s*<\/a>/g,
      ),
    ].length;
    const maxYear = years.length ? Math.max(...years) : 0;

    // The four non-compliance lists: hash only their table rows, so a name added
    // or cleared flips the fingerprint and a cookie banner doesn't.
    const listTexts: string[] = [];
    let namedRows = 0;
    for (const p of INTEGRITY_PAGES) {
      const html = await fetchText(
        `https://www.inspectoratvss.bg/bg/page/${p.page}`,
      );
      if (!html) {
        listTexts.push(`missing:${p.page}`);
        continue;
      }
      const rows = listRows(html);
      listTexts.push(rows);
      // Header row aside, each row is a named person.
      namedRows += Math.max(0, rows.split("~").length - 1);
    }

    const value = createHash("sha256")
      .update(`${maxYear}|${letterLinks}|${listTexts.join("|")}`)
      .digest("hex");
    return {
      value,
      detail: `register years ${years[0] ?? "?"}-${maxYear} (${letterLinks} letter pages) · ${INTEGRITY_PAGES.length} ИВСС lists, ${namedRows} named`,
      meta: { maxYear, letterLinks, namedRows },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYear = (prev.meta?.maxYear as number | undefined) ?? 0;
    const currYear = (curr.meta?.maxYear as number | undefined) ?? 0;
    if (currYear > prevYear)
      return `ИВСС declarations for ${currYear} appear to have landed (was ${prevYear}) — run update-judiciary`;
    const prevNamed = prev.meta?.namedRows as number | undefined;
    const currNamed = curr.meta?.namedRows as number | undefined;
    if (prevNamed != null && currNamed != null && prevNamed !== currNamed)
      return `ИВСС non-compliance lists changed: ${prevNamed} → ${currNamed} named people`;
    // Fall back to the plain detail like the sibling source, rather than
    // asserting "changed" on an unchanged fingerprint.
    return curr.detail;
  },
};
