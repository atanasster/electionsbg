// ИСУН 2020 EU-funds public beneficiary register. The "Бенефициенти" report
// on 2020.eufunds.bg exposes an Excel export — one row per organisation that
// has signed an EU-funds contract, with all-time rollup totals. There is no
// lighter change signal (the portal is a SPA, the data.egov.bg ИСУН datasets
// are frozen at 2018), so we download the full export and fingerprint the
// corpus shape: beneficiary count + contract count + contracted/paid EUR.
// cadence: weekly — EU-funds disbursement data moves slowly.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { parseBeneficiaries } from "../../funds/parse";

const EXPORT_URL = "https://2020.eufunds.bg/bg/0/0/Beneficiary/ExportToExcel";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)";

interface FundsMeta {
  beneficiaries: number;
  contracts: number;
  contractedEur: number;
  paidEur: number;
}

const eur = (n: number): string => `€${Math.round(n).toLocaleString("en-US")}`;

export const isunEuFunds: WatchSource = {
  id: "isun_eu_funds",
  label: "ИСУН EU funds (beneficiaries)",
  url: EXPORT_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(EXPORT_URL, {
      headers: {
        "User-Agent": UA,
        Accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`ИСУН export → HTTP ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const rows = parseBeneficiaries(buf);
    if (rows.length === 0) {
      throw new Error("ИСУН export yielded zero beneficiary rows");
    }
    let contracts = 0;
    let contractedEur = 0;
    let paidEur = 0;
    for (const r of rows) {
      contracts += r.contractCount;
      contractedEur += r.contractedEur;
      paidEur += r.paidEur;
    }
    const meta: FundsMeta = {
      beneficiaries: rows.length,
      contracts,
      contractedEur,
      paidEur,
    };
    // toFixed(2) keeps the float-summation residue out of the change signal.
    const value = sha256Short(
      `${meta.beneficiaries}|${meta.contracts}|` +
        `${contractedEur.toFixed(2)}|${paidEur.toFixed(2)}`,
    );
    return {
      value,
      detail:
        `${meta.beneficiaries} beneficiaries · ${meta.contracts} contracts · ` +
        `${eur(contractedEur)} contracted`,
      meta: { ...meta },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Partial<FundsMeta>;
    const c = (curr.meta ?? {}) as Partial<FundsMeta>;
    const dBen = (c.beneficiaries ?? 0) - (p.beneficiaries ?? 0);
    const dCon = (c.contracts ?? 0) - (p.contracts ?? 0);
    const dEur = (c.contractedEur ?? 0) - (p.contractedEur ?? 0);
    const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    return (
      `${curr.detail} (${sign(dBen)} beneficiaries, ${sign(dCon)} contracts, ` +
      `${dEur >= 0 ? "+" : "-"}${eur(Math.abs(dEur))} contracted)`
    );
  },
};
