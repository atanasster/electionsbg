// Watch НФК (Национален фонд „Култура") for new grant activity — the source
// behind data/culture/grants.json (success rates). The результати PDFs are NOT
// linked on the news index (they live inside individual posts / the richeditor
// path), so we can't fingerprint them directly. Instead we track the SET of news
// posts (each carries an incrementing id): a new results post — like any new post
// — flips the fingerprint, and the operator adds its PDF URL to NCF_RESULTS in
// scripts/culture/ncf_grants.ts before re-running. Maps to `update-culture`.

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
  return [...links].sort();
};

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
      detail: `${links.length} posts on the feed · newest #${latest}`,
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
      ? `new post(s) — newest #${nowId} (was #${wasId}); check for a new grant класиране`
      : "the news feed changed";
  },
};
