// Pre-generate the headline stat for the government-sector tiles (the
// /governance/sectors hub + the "featured sectors" strip on /procurement): the
// all-time total procurement € flowing through each sector's awarder(s). Written
// as one small static file the tiles read — same pattern + serving path as
// hub_stats.json (committed + bucket-synced; the rest of procurement is PG-only).
//
// All-time (not per-scope): the sectors hub has no scope control, and this is the
// "scale of the sector" figure. Each sector maps to an awarder EIK or, for the
// multi-body sectors (water / defense / judiciary), the whole group EIK-set.
//
//   npm run db:gen-sector-stats   # reads PG (after db:refresh), writes the file
//
// pension + schools are intentionally omitted: pension is the whole-fund view
// (its procurement € would just duplicate НОИ / `social`), and schools has no
// single procurement seat — both keep their descriptor with no stat.

import fs from "node:fs";
import path from "node:path";
import { allRows } from "../lib/pg";
import { API_EIK } from "../../../src/lib/roadAttributes";
import { NOI_EIK } from "../../../src/lib/noiBenchmarks";
import { NZOK_EIK } from "../../../src/lib/nzokBenchmarks";
import { MON_EIK } from "../../../src/lib/monBenchmarks";
import { NAP_EIK } from "../../../src/lib/napReferenceData";
import { CUSTOMS_EIK } from "../../../src/lib/customsReferenceData";
import { KULTURA_EIK } from "../../../src/lib/kulturaReferenceData";
import { WATER_SECTOR_EIKS } from "../../../src/lib/vikReferenceData";
import { DEFENSE_SECTOR_EIKS } from "../../../src/lib/defenseReferenceData";
import {
  VSS_EIK,
  VSS_ALIAS_EIKS,
  JUDICIAL_EIKS,
} from "../../../src/lib/vssReferenceData";
import { AGRI_PAYER_EIK } from "../../../src/data/agri/constants";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/procurement/derived/sector_stats.json");

// sector id (matches SECTOR_SCENES / sectorRegistry ids) → the awarder EIK-set
// whose procurement rolls up to that sector.
const SECTOR_EIKS: Record<string, string[]> = {
  roads: [API_EIK],
  water: WATER_SECTOR_EIKS,
  transport: ["000695388"], // МТС
  social: [NOI_EIK],
  health: [NZOK_EIK],
  edu: [MON_EIK],
  revenue: [NAP_EIK],
  customs: [CUSTOMS_EIK],
  administration: ["180680495"], // МЕУ
  defense: DEFENSE_SECTOR_EIKS,
  justice: [VSS_EIK, ...VSS_ALIAS_EIKS, ...JUDICIAL_EIKS],
  agri: [AGRI_PAYER_EIK],
  culture: [KULTURA_EIK],
};

interface SectorStat {
  totalEur: number;
  contracts: number;
}

const main = async (): Promise<void> => {
  const t0 = Date.now();
  const out: Record<string, SectorStat> = {};
  for (const [id, eiks] of Object.entries(SECTOR_EIKS)) {
    const rows = (await allRows(
      // ROUND for determinism (raw double sums carry per-order noise) — same rule
      // as the procurement payloads. amendments excluded (tag='contract') so the
      // total matches the headline, not the double-counted annex value.
      "SELECT COALESCE(ROUND(SUM(amount_eur)), 0)::float8 AS eur, COUNT(*)::int AS n FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)",
      [eiks],
    )) as { eur: number; n: number }[];
    out[id] = { totalEur: rows[0]?.eur ?? 0, contracts: rows[0]?.n ?? 0 };
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  console.log(
    `sector_stats: ${Object.keys(out).length} sector(s) → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(0);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
