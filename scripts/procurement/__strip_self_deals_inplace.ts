// One-time cleanup for the OCDS "self-deal" data-quality bug — rows where
// the AOP feed substituted the buyer's EIK on the supplier ref because the
// real supplier EIK was missing. The ingest now drops these (see
// scripts/procurement/normalize.ts), but the on-disk shards still hold
// 24-or-so legacy entries that confuse the /company/{eik} view.
//
// What this does:
//   1. Walk every data/procurement/contracts/{YYYY}/{YYYY-MM}.json
//   2. For each row where awarderEik === contractorEik AND the names
//      disagree → rewrite the row in-place with contractorEik = "" so the
//      downstream contractor aggregation drops it.
//   3. Re-aggregate the affected contractor shards (data/procurement/
//      contractors/{eik}.json) from the remaining rows. If a shard has
//      zero rows left after filtering, delete it.
//   4. Recompute data/procurement/derived/top_contractors.json from the
//      surviving contractor files.
//
// Run once: npx tsx scripts/procurement/__strip_self_deals_inplace.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const CONTRACTS_DIR = path.join(ROOT, "data/procurement/contracts");
const CONTRACTORS_DIR = path.join(ROOT, "data/procurement/contractors");
const DERIVED_TOP = path.join(
  ROOT,
  "data/procurement/derived/top_contractors.json",
);

const normalize = (s: string): string =>
  (s ?? "")
    .toLocaleLowerCase("bg")
    .replace(/[„""'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Row {
  key: string;
  awarderEik?: string;
  awarderName?: string;
  contractorEik?: string;
  contractorName?: string;
  amountEur?: number;
  [k: string]: unknown;
}

interface ContractorShard {
  eik: string;
  name: string;
  contractCount: number;
  awardCount: number;
  totalEur: number;
  totalOther?: Record<string, number>;
  byAwarder: Array<{
    eik: string;
    name: string;
    contractCount: number;
    totalEur: number;
    totalOther?: Record<string, number>;
  }>;
  byYear: Array<unknown>;
  topContracts: Array<unknown>;
}

const affectedEiks = new Set<string>();
// Per-contractor month-shard references, built from the contracts walk below.
// Replaces the `contractRefs` field that used to live on each contractor
// rollup (dropped — the SPA never read it). monthFile is relative to
// data/procurement (e.g. "contracts/2026/2026-04.json"); indexes are the
// row positions within that file where the EIK was the original contractor.
const refsByEik = new Map<string, Map<string, number[]>>();
let rowsPatched = 0;

console.log(`→ walking ${CONTRACTS_DIR} for self-deal rows`);

for (const yr of fs.readdirSync(CONTRACTS_DIR).sort()) {
  // Skip the per-contract by-id/ subtree — those files are individual
  // contract records, not arrays.
  if (yr === "by-id") continue;
  if (!/^\d{4}$/.test(yr)) continue;
  const yrPath = path.join(CONTRACTS_DIR, yr);
  if (!fs.statSync(yrPath).isDirectory()) continue;
  for (const file of fs.readdirSync(yrPath).sort()) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(yrPath, file);
    const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    if (!Array.isArray(parsed)) continue;
    const rows = parsed as Row[];
    const monthFile = `contracts/${yr}/${file}`;
    let changed = false;
    rows.forEach((r, idx) => {
      // Record where each original contractor EIK appears, so the re-aggregate
      // step below can re-read exactly that EIK's rows without a `contractRefs`
      // field on the shard.
      const origCEik = r.contractorEik ?? "";
      if (origCEik) {
        const perFile = refsByEik.get(origCEik) ?? new Map<string, number[]>();
        const arr = perFile.get(monthFile) ?? [];
        arr.push(idx);
        perFile.set(monthFile, arr);
        refsByEik.set(origCEik, perFile);
      }

      const aEik = r.awarderEik ?? "";
      const cEik = r.contractorEik ?? "";
      if (!aEik || !cEik || aEik !== cEik) return;
      const aN = normalize(r.awarderName ?? "");
      const cN = normalize(r.contractorName ?? "");
      if (!aN || !cN || aN === cN) return;
      // Self-deal: clear the contractor EIK so downstream aggregation
      // attaches this row to nothing on the supplier side. The buyer
      // side is untouched.
      affectedEiks.add(cEik);
      r.contractorEik = "";
      rowsPatched += 1;
      changed = true;
    });
    if (changed) {
      fs.writeFileSync(full, JSON.stringify(rows, null, 2) + "\n");
    }
  }
}
console.log(
  `✓ patched ${rowsPatched} self-deal row(s) across ${affectedEiks.size} EIK(s)`,
);

// Belt-and-braces: even if the contracts have already been patched on a
// prior partial run, scan contractor shards for the self-deal pattern
// (byAwarder[].eik === shard.eik) and add to affectedEiks so the rebuild
// step kicks in.
console.log(`→ scanning contractor shards for legacy self-deal records`);
let legacyShards = 0;
for (const file of fs.readdirSync(CONTRACTORS_DIR)) {
  if (!file.endsWith(".json")) continue;
  const eik = file.replace(/\.json$/, "");
  if (affectedEiks.has(eik)) continue;
  try {
    const shard = JSON.parse(
      fs.readFileSync(path.join(CONTRACTORS_DIR, file), "utf8"),
    ) as ContractorShard;
    if ((shard.byAwarder ?? []).some((a) => a.eik === eik)) {
      affectedEiks.add(eik);
      legacyShards += 1;
    }
  } catch {
    // skip malformed
  }
}
if (legacyShards > 0) {
  console.log(
    `  found ${legacyShards} legacy shard(s) with stale self-deal data`,
  );
}

// Re-aggregate the affected contractor shards. We rebuild only the rows we
// touched — for each affected EIK, walk its contractor file's
// `contractRefs` and rebuild totals from the on-disk contracts/. If after
// filtering the EIK has zero rows, delete the shard file.
const removedShards: string[] = [];
const updatedShards: string[] = [];

for (const eik of affectedEiks) {
  const shardPath = path.join(CONTRACTORS_DIR, `${eik}.json`);
  if (!fs.existsSync(shardPath)) continue;
  const shard = JSON.parse(
    fs.readFileSync(shardPath, "utf8"),
  ) as ContractorShard;
  // Walk contractRefs and re-read each row.
  interface Survivor {
    awarderEik: string;
    awarderName: string;
    amountEur: number;
    isAward: boolean;
    year: string;
    row: Row;
  }
  const survivors: Survivor[] = [];
  const refs = refsByEik.get(eik) ?? new Map<string, number[]>();
  for (const [monthFile, indexes] of refs) {
    const file = path.join(ROOT, "data/procurement", monthFile);
    if (!fs.existsSync(file)) continue;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
    for (const idx of indexes) {
      const r = rows[idx];
      if (!r) continue;
      if (r.contractorEik !== eik) continue; // patched away — drop
      survivors.push({
        awarderEik: r.awarderEik ?? "",
        awarderName: (r.awarderName as string) ?? "",
        amountEur: typeof r.amountEur === "number" ? r.amountEur : 0,
        isAward: r.tag === "award",
        year: (r.date as string)?.slice(0, 4) ?? "",
        row: r,
      });
    }
  }
  if (survivors.length === 0) {
    fs.unlinkSync(shardPath);
    removedShards.push(eik);
    continue;
  }
  // Recompute totals + byAwarder. Keep the original shape minus the
  // self-deal awarder.
  let contractCount = 0;
  let awardCount = 0;
  let totalEur = 0;
  const byAwarder = new Map<
    string,
    { eik: string; name: string; contractCount: number; totalEur: number }
  >();
  for (const s of survivors) {
    if (s.isAward) awardCount += 1;
    else contractCount += 1;
    totalEur += s.amountEur;
    const a = byAwarder.get(s.awarderEik) ?? {
      eik: s.awarderEik,
      name: s.awarderName,
      contractCount: 0,
      totalEur: 0,
    };
    if (!s.isAward) a.contractCount += 1;
    a.totalEur += s.amountEur;
    byAwarder.set(s.awarderEik, a);
  }
  shard.contractCount = contractCount;
  shard.awardCount = awardCount;
  shard.totalEur = totalEur;
  shard.byAwarder = [...byAwarder.values()].sort(
    (a, b) => b.totalEur - a.totalEur,
  );
  fs.writeFileSync(shardPath, JSON.stringify(shard, null, 2) + "\n");
  updatedShards.push(eik);
}

console.log(
  `✓ rebuilt ${updatedShards.length} contractor shard(s); deleted ${removedShards.length} now-empty shard(s)`,
);

// Recompute derived/top_contractors.json by walking every contractor shard.
if (fs.existsSync(DERIVED_TOP)) {
  console.log(`→ rebuilding ${path.relative(ROOT, DERIVED_TOP)}`);
  interface TopEntry {
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
    awardCount: number;
    mpTied: boolean;
    mpIds: number[];
  }
  const top = JSON.parse(fs.readFileSync(DERIVED_TOP, "utf8")) as {
    generatedAt: string;
    total: number;
    entries: TopEntry[];
  };
  // Patch only the entries we touched (the rest are unchanged).
  for (const e of top.entries) {
    if (!affectedEiks.has(e.eik)) continue;
    const shardPath = path.join(CONTRACTORS_DIR, `${e.eik}.json`);
    if (!fs.existsSync(shardPath)) {
      // Deleted shard → mark for removal below.
      e.totalEur = 0;
      e.contractCount = 0;
      e.awardCount = 0;
      continue;
    }
    const shard = JSON.parse(
      fs.readFileSync(shardPath, "utf8"),
    ) as ContractorShard;
    e.totalEur = shard.totalEur;
    e.contractCount = shard.contractCount;
    e.awardCount = shard.awardCount;
  }
  const surviving = top.entries.filter(
    (e) => e.contractCount + e.awardCount > 0,
  );
  surviving.sort((a, b) => b.totalEur - a.totalEur);
  fs.writeFileSync(
    DERIVED_TOP,
    JSON.stringify(
      { ...top, total: surviving.length, entries: surviving },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ ${path.relative(ROOT, DERIVED_TOP)} rewritten`);
}

console.log(`done.`);
