// ИСУН 2020 EU-funds public Project register. Sibling of ./isun_eu_funds.ts:
// that source watches the Beneficiary rollup (one row per organisation);
// this source watches the Project register (one row per signed contract).
// The two exports update on different rhythms — the beneficiary one is
// rebuilt nightly even when nothing changes, the project one tracks new
// contracts and amendments. Fingerprint by contract count + summed amounts
// so a benign re-pack of the XLSX doesn't trigger a re-ingest.
// cadence: weekly — EU-funds contract data moves slowly.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { parseProjects } from "../../funds/projects_parse";

const EXPORT_URL = "https://2020.eufunds.bg/bg/0/0/Project/ExportToExcel";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)";

interface ProjectsMeta {
  contracts: number;
  totalEur: number;
  paidEur: number;
}

const eur = (n: number): string => `€${Math.round(n).toLocaleString("en-US")}`;

export const isunEuFundsProjects: WatchSource = {
  id: "isun_eu_funds_projects",
  label: "ИСУН EU funds (projects)",
  url: EXPORT_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(EXPORT_URL, {
      headers: {
        "User-Agent": UA,
        Accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new Error(
        `ИСУН projects export → HTTP ${res.status} ${res.statusText}`,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const rows = parseProjects(buf);
    if (rows.length === 0) {
      throw new Error("ИСУН projects export yielded zero contract rows");
    }
    let totalEur = 0;
    let paidEur = 0;
    for (const r of rows) {
      totalEur += r.totalEur;
      paidEur += r.paidEur;
    }
    const meta: ProjectsMeta = {
      contracts: rows.length,
      totalEur,
      paidEur,
    };
    // toFixed(2) keeps float-summation residue out of the change signal.
    const value = sha256Short(
      `${meta.contracts}|${totalEur.toFixed(2)}|${paidEur.toFixed(2)}`,
    );
    return {
      value,
      detail:
        `${meta.contracts} contracts · ${eur(totalEur)} total · ` +
        `${eur(paidEur)} paid`,
      meta: { ...meta },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Partial<ProjectsMeta>;
    const c = (curr.meta ?? {}) as Partial<ProjectsMeta>;
    const dCon = (c.contracts ?? 0) - (p.contracts ?? 0);
    const dTot = (c.totalEur ?? 0) - (p.totalEur ?? 0);
    const dPaid = (c.paidEur ?? 0) - (p.paidEur ?? 0);
    const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    return (
      `${curr.detail} (${sign(dCon)} contracts, ` +
      `${dTot >= 0 ? "+" : "-"}${eur(Math.abs(dTot))} total, ` +
      `${dPaid >= 0 ? "+" : "-"}${eur(Math.abs(dPaid))} paid)`
    );
  },
};
