// NSI open-data (JSON-stat) regional indicator watcher. Fingerprints the
// oblast-grain datasets merged into data/regional.json by
// scripts/regional/fetch_nsi.ts — FDI (629), museum visits (844) and
// hospital beds (1206). Each JSON-stat document carries a top-level
// `updated` timestamp, so we fingerprint those rather than the values.
//
// These ids are cataloged on data.egov.bg (org_id 143) but the catalog is a
// 2021 snapshot — some sibling series (e.g. doctors id=1105) are frozen, so
// if a `describe` ever reports one of these stalling, re-resolve the live id
// before assuming an upstream outage.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface JsonStatMeta {
  updated?: string;
  label?: string;
}

// id → short label. Must match the ids fetched by fetch_nsi.ts.
const DATASETS: { id: number; label: string }[] = [
  { id: 629, label: "ЧПИ по области" },
  { id: 844, label: "Музеи – посещения по области" },
  { id: 1206, label: "Лечебни заведения и легла по области" },
];

const buildUrl = (id: number): string =>
  `http://www.nsi.bg/opendata/getopendata_json.php?l=bg&id=${id}`;

const fetchUpdated = async (id: number): Promise<string> => {
  const data = await fetchJson<JsonStatMeta>(buildUrl(id));
  if (!data) throw new Error(`empty NSI open-data response for id=${id}`);
  if (!data.updated)
    throw new Error(`NSI open-data id=${id} response missing updated field`);
  return data.updated;
};

export const nsiRegional: WatchSource = {
  id: "nsi_regional",
  label: "НСИ regional open-data (BG): 3 oblast datasets",
  url: "https://data.egov.bg/organisation/13b6e23a-1888-4ad6-8f86-fceb71ca123c",
  // Annual releases, but the shared infra runs all sources together; the
  // fingerprint is stable between releases so consecutive runs are no-ops.
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const entries: Record<string, string> = {};
    for (const d of DATASETS) {
      entries[String(d.id)] = await fetchUpdated(d.id);
    }
    const serialised = Object.keys(entries)
      .sort()
      .map((k) => `${k}:${entries[k]}`)
      .join("|");
    const value = createHash("sha256").update(serialised).digest("hex");
    const latest = Object.values(entries).sort().pop() ?? "";
    return {
      value,
      detail: `${DATASETS.length} datasets · latest update ${latest}`,
      meta: { datasets: entries, latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevDatasets = (prev.meta?.datasets ?? {}) as Record<string, string>;
    const currDatasets = (curr.meta?.datasets ?? {}) as Record<string, string>;
    const changed: string[] = [];
    for (const d of DATASETS) {
      const k = String(d.id);
      if (prevDatasets[k] !== currDatasets[k]) {
        changed.push(`${d.label} (id=${d.id}) → ${currDatasets[k]}`);
      }
    }
    if (changed.length === 0) return curr.detail;
    return `new release · ${changed.join(", ")}`;
  },
};
