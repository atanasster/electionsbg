// Ember Yearly Electricity Data watcher — the generation-mix / net-trade / CO2
// series behind the /sector/energy physics tile. Ember republishes the global
// long-format CSV periodically (roughly monthly + an annual full release). We
// HEAD the file (no 49MB body download) and fingerprint its ETag / Last-Modified
// so a republish flips the report without pulling the whole dataset each run.

import type { WatchSource, Fingerprint } from "../types";

const CSV_URL =
  "https://storage.googleapis.com/emb-prod-bkt-publicdata/public-downloads/yearly_full_release_long_format.csv";

export const emberGeneration: WatchSource = {
  id: "ember_generation",
  label: "Ember Yearly Electricity Data (generation mix, CC BY 4.0)",
  url: "https://ember-energy.org/data/",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const r = await fetch(CSV_URL, { method: "HEAD" });
    if (!r.ok) throw new Error(`Ember HEAD failed: HTTP ${r.status}`);
    const etag = r.headers.get("etag") ?? "";
    const lastMod = r.headers.get("last-modified") ?? "";
    const len = r.headers.get("content-length") ?? "";
    const value = etag || lastMod || len;
    if (!value)
      throw new Error("Ember CSV: no etag/last-modified/content-length header");
    return {
      value,
      detail: `Ember CSV ${lastMod || etag}${len ? ` (${len} bytes)` : ""}`,
    };
  },
};
