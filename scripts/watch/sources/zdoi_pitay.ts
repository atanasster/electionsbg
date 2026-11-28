// ЗДОИ — requests filed through pitay.government.bg („Платформа за достъп до
// обществена информация"), the corpus behind migration 207 and the mentions tool's
// „Заявления по ЗДОИ" arm.
//
// Application ids are sequential and the front page lists the newest ones, so the
// newest id is the whole fingerprint: it moves when a request is filed. The flip
// queues `update-zdoi` (`zdoi:fetch --refresh` → `db:load:zdoi:pg` → the :cloud load).
// The id is read with the crawler's own `newestIdFrom`, so the watcher and the ingest
// agree on what "newest" is.
//
// A failed fetch THROWS: the runner records it as an error (retrying through the BG
// proxy and counting the streak) and keeps the previous fingerprint, so an outage is
// never read as a change.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { BASE, newestIdFrom } from "../../zdoi/fetch_pitay";

export const zdoiPitay: WatchSource = {
  id: "zdoi_pitay",
  label:
    "Платформа за достъп до обществена информация (pitay.government.bg) — заявления по ЗДОИ",
  url: `${BASE}/`,
  cadence: "daily",
  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(`${BASE}/`);
    if (!html)
      throw new Error("pitay.government.bg front page returned nothing");
    const newest = newestIdFrom(html); // throws when the page lists no applications
    return {
      value: String(newest),
      detail: `newest ЗДОИ application id ${newest}`,
      meta: { latest: newest },
    };
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    const before = (prev?.meta?.latest as number | undefined) ?? null;
    const now = (curr.meta?.latest as number | undefined) ?? null;
    const what =
      before != null && now != null && before !== now
        ? `${now - before} new ЗДОИ request(s), newest id ${before} → ${now}`
        : curr.detail;
    return `${what} — crawl and load (update-zdoi: zdoi:fetch --refresh)`;
  },
};
