// One-off: re-emit per-MP shards alongside an existing mp_connected.json
// aggregate. Used after lifting the shard-write logic into the cross-
// reference module — re-running the full ingest would re-scrape every
// upstream source, which is wasteful when only the on-disk shape changed.
//
//   tsx scripts/lib/reshard_mp_connected.ts data/procurement/derived
//   tsx scripts/lib/reshard_mp_connected.ts data/funds/derived

import fs from "fs";
import path from "path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: reshard_mp_connected.ts <derivedDir>");
  process.exit(2);
}

const aggPath = path.join(dir, "mp_connected.json");
if (!fs.existsSync(aggPath)) {
  console.error(`missing ${aggPath}`);
  process.exit(1);
}

interface ProcurementEntry {
  mpId: number;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  [k: string]: unknown;
}

interface FundsEntry {
  mpId: number;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
  [k: string]: unknown;
}

const isProcurement = dir.includes("procurement");

const agg = JSON.parse(fs.readFileSync(aggPath, "utf8")) as {
  entries: Array<ProcurementEntry | FundsEntry>;
};

const shardDir = path.join(dir, "per-mp");
fs.mkdirSync(shardDir, { recursive: true });

const byMp = new Map<number, Array<ProcurementEntry | FundsEntry>>();
for (const e of agg.entries) {
  const arr = byMp.get(e.mpId) ?? [];
  arr.push(e);
  byMp.set(e.mpId, arr);
}

// Cohort distribution for procurement scorecard stats. Funds doesn't
// currently surface a per-MP scorecard rank, so skip the heavier calc there.
let procurementCohortSize = 0;
let procurementCohortMedian = 0;
const procurementRankByMp = new Map<number, number>();
if (isProcurement) {
  const cohortTotals = [...byMp.values()].map((entries) =>
    (entries as ProcurementEntry[]).reduce((s, e) => s + e.totalEur, 0),
  );
  cohortTotals.sort((a, b) => b - a);
  procurementCohortSize = cohortTotals.length;
  procurementCohortMedian =
    procurementCohortSize === 0
      ? 0
      : procurementCohortSize % 2 === 1
        ? cohortTotals[(procurementCohortSize - 1) >> 1]
        : (cohortTotals[procurementCohortSize >> 1] +
            cohortTotals[(procurementCohortSize >> 1) - 1]) /
          2;
  for (const [mpId, entries] of byMp) {
    const total = (entries as ProcurementEntry[]).reduce(
      (s, e) => s + e.totalEur,
      0,
    );
    let rank = 1;
    for (const v of cohortTotals) {
      if (v > total) rank += 1;
      else break;
    }
    procurementRankByMp.set(mpId, rank);
  }
}

const wanted = new Set<string>();
for (const [mpId, entries] of byMp) {
  const file = `${mpId}.json`;
  wanted.add(file);

  let shard: object;
  if (isProcurement) {
    const summary = {
      totalEur: 0,
      totalOther: {} as Record<string, number>,
      contractCount: 0,
      awardCount: 0,
    };
    for (const e of entries as ProcurementEntry[]) {
      summary.totalEur += e.totalEur;
      for (const [cur, amt] of Object.entries(e.totalOther)) {
        summary.totalOther[cur] = (summary.totalOther[cur] ?? 0) + amt;
      }
      summary.contractCount += e.contractCount;
      summary.awardCount += e.awardCount;
    }
    const scorecard = {
      value: summary.totalEur,
      rank: procurementRankByMp.get(mpId) ?? null,
      cohortSize: procurementCohortSize,
      cohortMedian: procurementCohortMedian,
    };
    shard = { mpId, summary, scorecard, entries };
  } else {
    const summary = {
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    for (const e of entries as FundsEntry[]) {
      summary.contractCount += e.contractCount;
      summary.contractedEur += e.contractedEur;
      summary.paidEur += e.paidEur;
    }
    shard = { mpId, summary, entries };
  }

  const content = JSON.stringify(shard, null, 2) + "\n";
  const fullPath = path.join(shardDir, file);
  if (fs.existsSync(fullPath)) {
    try {
      const existing = fs.readFileSync(fullPath, "utf8");
      if (existing === content) continue;
    } catch {
      // overwrite
    }
  }
  fs.writeFileSync(fullPath, content);
}

// Manifest of MP ids with a shard. For procurement we also embed cohort
// size + median so MPs WITHOUT connections (the common case) can still
// render "0 contracts vs N median" on the scorecard without loading the
// chamber-wide aggregate.
const mpIds = [...byMp.keys()].sort((a, b) => a - b);
const manifestBody = isProcurement
  ? {
      mpIds,
      cohort: { size: procurementCohortSize, median: procurementCohortMedian },
    }
  : { mpIds };
fs.writeFileSync(
  path.join(shardDir, "index.json"),
  JSON.stringify(manifestBody, null, 2) + "\n",
);

let pruned = 0;
for (const f of fs.readdirSync(shardDir)) {
  if (!f.endsWith(".json")) continue;
  if (f === "index.json") continue;
  if (wanted.has(f)) continue;
  fs.unlinkSync(path.join(shardDir, f));
  pruned++;
}

console.log(
  `✓ ${shardDir}: ${byMp.size} shards + manifest written from ${agg.entries.length} entries, ${pruned} pruned`,
);
