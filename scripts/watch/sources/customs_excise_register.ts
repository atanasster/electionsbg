// Excise-warehouse register watcher — Агенция „Митници" publishes the licensed
// excise warehouse keepers (лицензирани складодържатели и данъчни складове) via
// the BACIS REST endpoint (an HTML table). It changes as licences are issued or
// terminated — a slow drip, so cadence is monthly.
//
// Fingerprint = sha256 over the sorted set of `EIK|status` rows (not the raw
// HTML, which carries volatile formatting/whitespace). A flip means an operator
// was added, terminated, or re-licensed — re-run the ingest
// (`npm run customs:excise-register`), which rewrites both
// data/customs/excise_register.json and the geolocated
// data/customs/excise_warehouses.json; then `npm run db:load:excise-warehouses:pg`
// reloads the warehouse count-map table (schema 072). See the
// process-watch-report mapping for the prod (bucket:sync + :cloud reload) steps.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { parseRows, isValidStatus } from "../../customs/bacis_table";

// Plain HTTP (no TLS) — a bare fetch is all the ingest uses too. If BACIS ever
// moves to HTTPS with an incomplete chain, add an undici tolerant dispatcher here.
const SRC = "http://extlb.bacis.customs.bg/BACIS/seam/resource/rest/licensing";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; +https://electionsbg.com)";

// ⚠️ The table's shape is NOT re-derived here. This watcher decides WHETHER to
// re-ingest and scripts/customs/excise_register.ts decides WHAT is ingested, and
// until 2026-08-19 each carried its own copy of the `<tr>` split, the row guard,
// the EIK probe and the column indices. A column shift on the register's side
// would have drifted them silently and ASYMMETRICALLY — this side can keep
// reporting „no change" (fingerprinting the wrong two cells, but consistently)
// while the ingest mis-parses everything, and neither would fail, because the
// ingest's only structural guard is a row count that a column shift does not
// move. One definition, in scripts/customs/bacis_table.ts.
const rowSignatures = (html: string): string[] =>
  parseRows(html)
    .map((r) => `${r.eik}|${r.status}`)
    .sort();

export const customsExciseRegister: WatchSource = {
  id: "customs_excise_register",
  label:
    'Агенция "Митници" — регистър на лицензираните акцизни складодържатели',
  url: SRC,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    let sigs: string[] = [];
    try {
      const res = await fetch(SRC, {
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "follow",
      });
      sigs = rowSignatures(await res.text());
    } catch (e) {
      return {
        value: `err:${(e as Error).message.slice(0, 40)}`,
        detail: "fetch failed",
      };
    }
    // Counted through the ingest's own predicate, so „active" means here exactly
    // what it means there. isValidStatus THROWS on a status BACIS has not emitted
    // before — a real event worth reporting, but not one that should abort the
    // whole watch run, so it is caught and named in the detail instead. The
    // fingerprint stays valid either way: it is over the raw `EIK|status` set,
    // which is what actually flips when the vocabulary changes.
    let active = 0;
    let unknownStatus: string | null = null;
    for (const sig of sigs) {
      const status = sig.slice(sig.indexOf("|") + 1);
      try {
        if (isValidStatus(status)) active += 1;
      } catch {
        unknownStatus ??= status;
      }
    }
    const value = createHash("sha256")
      .update(sigs.join("\n"))
      .digest("hex")
      .slice(0, 16);
    const warn = unknownStatus
      ? ` · ⚠️ unknown status ${JSON.stringify(unknownStatus)} — the ingest will THROW on it`
      : "";
    return {
      value,
      detail: `${sigs.length} licences (${active} active) · hash ${value}${warn}`,
      meta: { total: sigs.length, active },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as { total?: number; active?: number };
    const c = (curr.meta ?? {}) as { total?: number; active?: number };
    const dActive = (c.active ?? 0) - (p.active ?? 0);
    const dTotal = (c.total ?? 0) - (p.total ?? 0);
    const parts: string[] = [];
    if (dActive) parts.push(`${dActive > 0 ? "+" : ""}${dActive} active`);
    if (dTotal) parts.push(`${dTotal > 0 ? "+" : ""}${dTotal} total`);
    const delta = parts.length ? ` (${parts.join(", ")})` : "";
    return `Register changed${delta} — run \`npm run customs:excise-register\`.`;
  },
};
