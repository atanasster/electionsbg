// data.egov.bg — state budget execution by major budget indicators. The
// Ministry of Finance publishes one resource per monthly cash-execution
// snapshot inside a single dataset. A new month publishes by adding a resource,
// so we fingerprint the dataset page's resource-UUID list — same approach as
// egov_procurement / egov_commerce (the CKAN /api endpoints return
// success:false, so we parse the HTML). The /update-budget skill consumes it.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const DATASET_UUID = "79ce7de2-0150-4ba7-a96c-dbacb76c95b6";
const PAGE = `https://data.egov.bg/data/view/${DATASET_UUID}`;

export const egovBudgetExecution: WatchSource = {
  id: "egov_budget_execution",
  label: "data.egov.bg бюджет (изпълнение на държавния бюджет)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty budget-execution dataset page");
    const uuids = Array.from(html.matchAll(/resourceView\/([0-9a-f-]{36})/gi))
      .map((m) => m[1])
      .filter((u, i, arr) => arr.indexOf(u) === i);
    if (uuids.length === 0) {
      throw new Error(
        "budget-execution dataset page yielded zero resource UUIDs",
      );
    }
    const value = sha256Short(uuids.join(","));
    return {
      value,
      detail: `${uuids.length} monthly resource(s), hash ${value}`,
      meta: { uuids, count: uuids.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevUuids = (prev.meta?.uuids as string[] | undefined) ?? [];
    const currUuids = (curr.meta?.uuids as string[] | undefined) ?? [];
    const added = currUuids.filter((u) => !prevUuids.includes(u));
    const removed = prevUuids.filter((u) => !currUuids.includes(u));
    if (added.length === 0 && removed.length === 0) {
      return `${curr.detail} (resource set unchanged)`;
    }
    const parts: string[] = [];
    if (added.length) parts.push(`${added.length} new monthly snapshot(s)`);
    if (removed.length) parts.push(`${removed.length} removed`);
    return `${parts.join(", ")} — run /update-budget`;
  },
};
