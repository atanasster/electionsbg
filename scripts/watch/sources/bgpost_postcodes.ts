// BG Post → settlement postal-code register (CC0, data.egov.bg). Consumed by
// /update-connections to disambiguate village name collisions when resolving
// MP registered-office text → EKATTE settlements. Source moves rarely (last
// known update 2023 → 2024 cycle), so we probe monthly and POST-fetch the
// API directly because data.egov.bg's resource HTML page is an SPA shell.
//
// Fingerprint: short sha of the full row payload. Tiny ~800 KB JSON, weekly
// download cost is negligible, and content equality is the only signal we
// trust (the page itself doesn't expose a usable "updated" timestamp).

import type { Fingerprint, WatchSource, WatchState } from "../types";
import { sha256Short } from "../fingerprint";

const RESOURCE_URI = "a3edccd8-65d1-4e4b-b5f7-9aa2d7367455";
const API_URL = "https://data.egov.bg/api/getResourceData";
const PAGE_URL = `https://data.egov.bg/data/view/acb135ab-00a2-4aa7-b5e5-49c992385ef5`;

type ApiResponse = { success: boolean; data?: string[][] };

const fetchRows = async (): Promise<string[][]> => {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_uri: RESOURCE_URI }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${API_URL}`);
  const json = (await res.json()) as ApiResponse;
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error("BG Post API returned non-success payload");
  }
  return json.data.slice(1); // strip header row
};

export const bgpostPostcodes: WatchSource = {
  id: "bgpost_postcodes",
  label: "Български пощи — пощенски кодове (data.egov.bg)",
  url: PAGE_URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const rows = await fetchRows();
    // Stringify before hashing so we catch added/removed rows AND reordering.
    const value = sha256Short(JSON.stringify(rows));
    return {
      value,
      detail: `${rows.length} postcode rows, hash ${value}`,
      meta: { rowCount: rows.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevRows = (prev.meta?.rowCount as number | undefined) ?? null;
    const currRows = (curr.meta?.rowCount as number | undefined) ?? null;
    if (prevRows != null && currRows != null && prevRows !== currRows) {
      const delta = currRows - prevRows;
      const sign = delta > 0 ? "+" : "";
      return `${curr.detail} (row count ${sign}${delta})`;
    }
    return `${curr.detail} (content updated, row count unchanged)`;
  },
};
