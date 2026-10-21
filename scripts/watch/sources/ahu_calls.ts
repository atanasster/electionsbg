// АХУ (Агенция за хората с увреждания) — its grant competitions, as open calls. Maps to
// `update-open-calls` (`npm run opencalls:ahu`).
//
// cadence: daily, publishes: irregular. АХУ announces each programme's competition once a year,
// mostly in February, with windows of about five weeks — a week's lag costs a reader a fifth of
// their preparation time, the same reasoning as `isun_procedures`.
//
// FINGERPRINT = the set of funding-competition keys on the news page (`ahuCallKey`, the same
// key the crawler stores), so a new announcement, a withdrawn one or a re-titled one moves it,
// while the ~120 other news items (protocols, events) do not.
//
// A page that parses to almost nothing is a probe failure, not an empty register: the news page
// has carried ~125 items since 2025.

import { sha256Short, fetchText } from "../fingerprint";
import type { Fingerprint, WatchSource, WatchState } from "../types";
import {
  AHU_NEWS_URL,
  MIN_NEWS_ITEMS,
  ahuCallKey,
  isFundingCall,
  parseAhuNews,
} from "../../opencalls/ahu_parse";

interface AhuCallsMeta {
  keys: string[];
}

export const ahuCalls: WatchSource = {
  id: "ahu_calls",
  label: "АХУ — конкурси за финансиране (хора с увреждания)",
  url: AHU_NEWS_URL,
  cadence: "daily",
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(AHU_NEWS_URL, { retries: 2 });
    if (html === null) throw new Error(`${AHU_NEWS_URL}: no response`);
    const items = parseAhuNews(html);
    if (items.length < MIN_NEWS_ITEMS)
      throw new Error(
        `АХУ news page parsed to ${items.length} item(s) (~125 expected) — a markup change or an interstitial, not an empty register`,
      );
    const keys = items
      .filter((i) => isFundingCall(i.text))
      .map(ahuCallKey)
      .sort();
    return {
      value: sha256Short(keys.join("|")),
      detail: `${keys.length} конкурса за финансиране на страницата с новини`,
      meta: { keys } satisfies AhuCallsMeta,
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = new Set(((prev.meta ?? {}) as Partial<AhuCallsMeta>).keys ?? []);
    const c = ((curr.meta ?? {}) as Partial<AhuCallsMeta>).keys ?? [];
    const added = c.filter((k) => !p.has(k)).length;
    const removed = [...p].filter((k) => !c.includes(k)).length;
    const bits = [
      added ? `${added} нови` : "",
      removed ? `${removed} свалени` : "",
    ].filter(Boolean);
    return bits.length ? `АХУ: ${bits.join(", ")}` : curr.detail;
  },
};
