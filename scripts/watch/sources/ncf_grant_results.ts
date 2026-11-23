// Watch НФК (Национален фонд „Култура") for new grant activity — the source
// behind data/culture/grants.json (success rates). The результати PDFs are NOT
// linked on the news index (they live inside individual posts / the richeditor
// path), so we can't fingerprint them directly. Instead we track the SET of
// RESULTS posts — those whose slug says „резултати" or „класиране". Every other
// post (deadline extensions, schedules, staff news) used to flip this source
// too, and each flip opened an operator item that asked for a PDF that did not
// exist: 8 of the 9 posts after #746 were of that kind. Maps to `update-culture`.
//
// Since post #755 (20.11.2026) the results are no longer PDFs: each programme
// links to konkursi.ncf.bg, the fund's electronic competition system, so a new
// results post now needs a konkursi ingest rather than a NCF_RESULTS entry.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { BROWSER_UA } from "../../culture/sources";

const NOVINI = "https://ncf.bg/bg/novini";

const postLinks = async (): Promise<string[]> => {
  // ncf.bg's WAF 403s the default watcher bot UA — send a real-browser UA.
  const html = await fetchText(NOVINI, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!html) return [];
  const links = new Set<string>();
  const re = /href="(\/bg\/novini\/[^"]+\/\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) links.add(m[1]);
  return [...links].filter(isResultsPost).sort();
};

/** A results announcement — the slug is a transliteration of its title, so
 *  „Резултати …" / „Класиране …" appear as `rezultat…` / `klasiran…`. The
 *  schedule post („Индикативен график за обявяване на резултатите") is excluded:
 *  it announces dates, not results. */
export const isResultsPost = (href: string): boolean =>
  /rezultat|klasiran/.test(href) && !/grafik/.test(href);

const newestId = (links: string[]): number =>
  links.reduce(
    (mx, l) => Math.max(mx, Number(/\/(\d+)$/.exec(l)?.[1] ?? 0)),
    0,
  );

export const ncfGrantResults: WatchSource = {
  id: "ncf_grant_results",
  label: "НФК news feed (grant results, ncf.bg)",
  url: NOVINI,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const links = await postLinks();
    const value = createHash("sha256").update(links.join("\n")).digest("hex");
    const latest = newestId(links);
    return {
      value,
      detail: `${links.length} results post(s) on the feed · newest #${latest}`,
      meta: { count: links.length, latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const wasId = Number(
      (prev.meta as { latest?: number } | undefined)?.latest ?? 0,
    );
    const nowId = Number(
      (curr.meta as { latest?: number } | undefined)?.latest ?? 0,
    );
    return nowId > wasId
      ? `new results post(s) — newest #${nowId} (was #${wasId})`
      : "the set of results posts changed";
  },
};
