// data.egov.bg Commerce Registry bulk export. The dataset metadata is what
// /update-connections uses to refresh the company/management graph. Watching
// the metadata "modified" timestamp tells us a new bulk drop landed.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

// CKAN package id for the Commerce Registry bulk dataset.
const PACKAGE =
  "https://data.egov.bg/api/3/action/package_show?id=targovski-registar-bulk";

interface CkanResponse {
  success: boolean;
  result?: {
    metadata_modified?: string;
    resources?: Array<{ last_modified?: string; created?: string }>;
  };
}

export const egovCommerce: WatchSource = {
  id: "egov_commerce",
  label: "data.egov.bg Commerce Registry (bulk)",
  url: PACKAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<CkanResponse>(PACKAGE);
    if (!data?.success || !data.result) {
      throw new Error("Commerce Registry package not found on data.egov.bg");
    }
    const meta = data.result.metadata_modified ?? "";
    const resourceTimes = (data.result.resources ?? [])
      .map((r) => r.last_modified ?? r.created ?? "")
      .filter(Boolean)
      .sort();
    const latest = resourceTimes.length
      ? resourceTimes[resourceTimes.length - 1]
      : meta;
    return {
      value: latest,
      detail: `last updated ${latest.slice(0, 19)}`,
      meta: { metadata_modified: meta, latest_resource: latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `new bulk drop · ${curr.detail} (was ${prev.fingerprint.slice(0, 19)})`;
  },
};
