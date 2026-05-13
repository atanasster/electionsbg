// МОН (Министерство на образованието и науката) — Държавни зрелостни
// изпити (DZI) results, published via data.egov.bg. Fingerprints the
// dataset's resource UUID list; when МОН uploads a new session's CSV the
// list grows (or a UUID changes) and the watcher fires.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const DATASET_PAGE =
  "https://data.egov.bg/data/view/066b4b04-d81d-444e-a61c-8ca0516079e4";

const collectResourceUuids = (html: string): string[] => {
  const re = /\/data\/resourceView\/([a-f0-9-]{36})/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) seen.add(m[1]);
  return Array.from(seen).sort();
};

export const indicatorsMonDzi: WatchSource = {
  id: "indicators_mon_dzi",
  label: "МОН: ДЗИ резултати (data.egov.bg)",
  url: DATASET_PAGE,
  // Annual cadence (one new session per year, plus Aug-Sep retakes).
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(DATASET_PAGE);
    if (!html) throw new Error(`empty response from ${DATASET_PAGE}`);
    const uuids = collectResourceUuids(html);
    const value = createHash("sha256").update(uuids.join("|")).digest("hex");
    return {
      value,
      detail: `${uuids.length} resources`,
      meta: { uuids },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevUuids = new Set((prev.meta?.uuids ?? []) as string[]);
    const currUuids = new Set((curr.meta?.uuids ?? []) as string[]);
    const added: string[] = [];
    const removed: string[] = [];
    for (const u of currUuids) if (!prevUuids.has(u)) added.push(u);
    for (const u of prevUuids) if (!currUuids.has(u)) removed.push(u);
    if (added.length === 0 && removed.length === 0) return curr.detail;
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} new resource(s)`);
    if (removed.length > 0) parts.push(`${removed.length} removed`);
    return parts.join(" · ");
  },
};
