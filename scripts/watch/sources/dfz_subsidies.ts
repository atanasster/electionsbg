// ДФ „Земеделие" (CAP paying agency) subsidy corpus on data.egov.bg (org 56).
// A new financial year lands as a fresh "Данни за изплатени субсидии" resource,
// and existing years are occasionally re-uploaded. Rather than pull ~300k rows
// per year, fingerprint the org's dataset shape: the set of payment-year
// resources + their updated_at timestamps. A new year or a re-upload flips the
// hash → the /update-nzok-style ingest re-runs.
// cadence: weekly — the portal refreshes a year at a time, slowly.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { listDatasets } from "../../budget/lib/egov_api";

const ORG_ID = 56; // ДФ „Земеделие"
const PAYMENT_RE = /изплатени субсидии/i;

interface DfzMeta {
  resources: number;
}

export const dfzSubsidies: WatchSource = {
  id: "dfz_subsidies",
  label: "ДФ Земеделие — изплатени субсидии",
  url: "https://data.egov.bg/data?org%5B0%5D=56",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const datasets = await listDatasets(ORG_ID, { recordsPerPage: 200 });
    // Only the payment-year datasets carry the corpus; ignore the frozen legacy
    // benefit-list / eligible-areas datasets.
    const stamps: string[] = [];
    for (const ds of datasets) {
      if (!PAYMENT_RE.test(ds.name)) continue;
      for (const r of ds.resources) {
        if (!PAYMENT_RE.test(r.name)) continue;
        stamps.push(`${r.uri}@${r.updated_at}`);
      }
    }
    stamps.sort();
    if (stamps.length === 0) {
      throw new Error("ДФЗ org 56 yielded zero payment-year resources");
    }
    const meta: DfzMeta = { resources: stamps.length };
    return {
      value: sha256Short(stamps.join("|")),
      detail: `${stamps.length} financial-year files`,
      meta: { ...meta },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Partial<DfzMeta>;
    const c = (curr.meta ?? {}) as Partial<DfzMeta>;
    const d = (c.resources ?? 0) - (p.resources ?? 0);
    if (d > 0) return `${curr.detail} (+${d} new year)`;
    if (d < 0) return `${curr.detail} (${-d} year removed)`;
    return `${curr.detail} (a year re-uploaded)`;
  },
};
