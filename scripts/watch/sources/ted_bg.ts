// Watch TED for new Bulgarian notices. Maps to `update-procurement`.
//
// The fingerprint is the CURRENT YEAR's notice count — TED is append-only for
// closed years, so nothing else can move. Cheap: one POST, `limit: 1`, reading
// only `totalNoticeCount`.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { TED_SEARCH_URL, tedQuery } from "../../procurement/ted/sources";

const currentYearCount = async (): Promise<number> => {
  const res = await fetch(TED_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: tedQuery(new Date().getUTCFullYear()),
      fields: ["publication-number"],
      limit: 1,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  // ⚠️ A 429 is TED rate-limiting, not an empty year. Throwing keeps the
  // watcher's own „source unreachable" path, where reporting 0 would read as
  // „Bulgaria stopped publishing".
  if (!res.ok) throw new Error(`TED ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { totalNoticeCount?: number };
  return body.totalNoticeCount ?? 0;
};

export const tedBg: WatchSource = {
  id: "ted_bg",
  label: "TED — обявления за България (api.ted.europa.eu)",
  url: TED_SEARCH_URL,
  // Hourly, not daily: TED publishes daily, and the ratchet in ./cadence
  // requires a probe at least twice per publication period — a daily probe can
  // miss a full day. Declaring `publishes: "irregular"` would silence the gate
  // and be false. The probe is one POST with `limit: 1`, reading only a count.
  cadence: "hourly",
  publishes: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const n = await currentYearCount();
    return {
      value: createHash("sha256").update(String(n)).digest("hex"),
      detail: `${n.toLocaleString()} BG notices published this year`,
      meta: { count: n },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const a = Number((prev.meta as { count?: number } | undefined)?.count ?? 0);
    const b = Number((curr.meta as { count?: number } | undefined)?.count ?? 0);
    // TED does not withdraw notices, so a DECREASE is the API changing what it
    // indexes, never Bulgaria un-publishing. Say so rather than reporting it as
    // a fall in procurement.
    if (b < a)
      return `${b.toLocaleString()} notices, down from ${a.toLocaleString()} — TED does not withdraw notices, so its index has changed`;
    return `${(b - a).toLocaleString()} new BG notices (${b.toLocaleString()} this year)`;
  },
};
