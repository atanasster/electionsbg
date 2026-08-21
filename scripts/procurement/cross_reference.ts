// Join procurement contractors against the MP↔company link set.
//
// The join key is the 9-digit canonical EIK, on both sides: the contractor carries it in
// `Contract.contractorEik` and the link set is keyed on `company_politicians.eik`.
//
// Editorial guardrail: a connection is only flagged when it is recorded in the Commerce
// Registry (a management or ownership role) or in a Court-of-Audit declaration (a confirmed
// stake). Until 2026-08-20 the source was `companies-index.json`, whose registry arm matched
// an MP by NAME — guarded only by a „this name maps to exactly one company" heuristic
// (`buildTrNamesakeCounts`, deleted with this change) that migration 148's header calls wrong
// in both directions: it dropped a rare-name MP's whole set behind one busy registered agent,
// and passed a name held by two people with six companies each. The source is now the gated
// person layer, where a fold the registry says belongs to more than one human is REFUSED.
// Plan: docs/plans/company-page-consolidation-v1.md (Tier 5.1).
//
// ⚠️ NOTHING HERE LOADS `company_politicians` ANY MORE — it READS it. Until Tier 4 the flow
// ran the other way (this builder → mp_connected.json → load_tr_pg.ts → company_politicians),
// so a change here moved the served link set. It no longer does: `mp_connected.json` is now a
// downstream JOURNALISM payload, read by `scripts/budget/cross_reference.ts` (the per-ministry
// MP-connected flag) and by the three `gen_procurement` parity verifiers.

import fs from "fs";
import path from "path";
import { readMpLinkRows } from "../lib/mp_linkage";
import type {
  ContractorRollup,
  MpCompanyRelation,
  MpConnectedContractor,
  MpConnectedFile,
} from "./types";
import { byEurDesc, canonicalJson, writeStableJson } from "./validate";

// Returns EIK → linkages map. Each linkage is one (mpId, relation) pair,
// grouped by mpId so the cross-reference can emit one entry per (mpId, EIK)
// regardless of how many roles/stakes that pair has.
export interface MpLinkage {
  mpId: number;
  mpName: string;
  relations: MpCompanyRelation[];
}

export interface EikLinkageMap {
  byEik: Map<string, MpLinkage[]>;
}

// EIK → MP-linkage map, from the GATED PERSON LAYER (`company_politicians`, kind='mp').
//
// ⚠️ THE SANITY FLOOR IS KEPT, ONLY ITS SUBJECT MOVED. The old guard hard-failed when almost
// no companies-index entry carried a `tr.uic`, because without the join key `mp_connected.json`
// collapses to empty SILENTLY — the „the TR refresh was not run" failure. The same hole exists
// on the gated source: an unresolved person layer yields zero rows, `mp_connected.json` is
// rewritten empty, and the budget dashboard then states that no ministry awarded a contract to
// an MP-connected company. So an empty link set is REFUSED rather than returned.
//
// ⚠️ IT NO LONGER DEDUPES STAKES BY YEAR. It used to keep the latest filing per MP because
// companies-index carried one row per declaration; `company_politicians.relations` is already
// deduped per (person, company) by the loader's arm query, so re-doing it here would be a
// second, divergent copy of that rule.
export const buildEikLinkageMap = async (): Promise<EikLinkageMap> => {
  // scope 'contractors' — this builder's join population IS contractors, so the served
  // company_politicians is the right source and its contract restriction costs nothing here.
  // The funds sibling must NOT use it; see scripts/lib/mp_linkage.ts.
  const rows = await readMpLinkRows(
    "mp_connected.json would be rewritten empty and the budget dashboard would then state " +
      "that no ministry awarded a contract to an MP-connected company.",
    "contractors",
  );

  const byEik = new Map<string, MpLinkage[]>();
  for (const r of rows) {
    const list = byEik.get(r.eik) ?? [];
    list.push({
      mpId: r.mpId,
      mpName: r.mpName,
      relations: r.relations as MpCompanyRelation[],
    });
    byEik.set(r.eik, list);
  }

  return { byEik };
};

// Source-agnostic: emit (mpId, contractor) records for every linkage whose
// contractor is a procurement supplier. `getContractor(eik)` returns the
// contractor rollup or null. Output is sorted deterministically, so lookup order
// doesn't matter. buildMpConnected below reads the on-disk rollups; the SQL
// generator passes a lookup over its SQL-built rollups.
export const buildMpConnectedFrom = (
  getContractor: (eik: string) => ContractorRollup | null,
  linkageMap: EikLinkageMap,
): MpConnectedFile => {
  const entries: MpConnectedContractor[] = [];
  for (const [eik, linkages] of linkageMap.byEik) {
    if (!linkages || linkages.length === 0) continue;
    const contractor = getContractor(eik);
    if (!contractor) continue;
    for (const linkage of linkages) {
      entries.push({
        mpId: linkage.mpId,
        mpName: linkage.mpName,
        contractorEik: contractor.eik,
        contractorName: contractor.name,
        relations: linkage.relations,
        totalEur: contractor.totalEur,
        totalOther: contractor.totalOther,
        contractCount: contractor.contractCount,
        awardCount: contractor.awardCount,
        byYear: contractor.byYear,
        topAwarders: contractor.byAwarder.slice(0, 5),
      });
    }
  }
  // Sort: largest euro total first; stable on the (mp, contractor) key.
  entries.sort((a, b) =>
    byEurDesc(
      a.totalEur,
      b.totalEur,
      `${a.mpId}:${a.contractorEik}`,
      `${b.mpId}:${b.contractorEik}`,
    ),
  );
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
  };
};

// Walk data/procurement/contractors/*.json and emit (mpId, contractor) records
// for every match against the linkage map.
export const buildMpConnected = (
  contractorsDir: string,
  linkageMap: EikLinkageMap,
): MpConnectedFile => {
  if (!fs.existsSync(contractorsDir)) {
    return { generatedAt: new Date().toISOString(), total: 0, entries: [] };
  }
  return buildMpConnectedFrom((eik) => {
    const f = path.join(contractorsDir, `${eik}.json`);
    return fs.existsSync(f)
      ? (JSON.parse(fs.readFileSync(f, "utf8")) as ContractorRollup)
      : null;
  }, linkageMap);
};

export const writeMpConnected = (
  outDir: string,
  data: MpConnectedFile,
): void => {
  fs.mkdirSync(outDir, { recursive: true });
  writeStableJson(path.join(outDir, "mp_connected.json"), data);

  // Per-MP shards. The candidate page only needs one MP's contractor list;
  // sharding lets it skip the chamber-wide fetch. Idempotent — re-running
  // the cross-reference doesn't churn unchanged shards.
  writeMpConnectedShards(outDir, data);

  // Per-EIK shards for the reverse lookup. /company/{eik} and
  // /awarder/{eik} need "which MPs are connected to this contractor?",
  // which the aggregate mp_connected.json answers only by streaming the
  // full ~105 KB. The per-EIK shard does it in O(1).
  writeMpConnectedByEikShards(outDir, data);
};

const writeMpConnectedByEikShards = (
  outDir: string,
  data: MpConnectedFile,
): void => {
  const shardDir = path.join(outDir, "by-eik");
  fs.mkdirSync(shardDir, { recursive: true });

  // The aggregate's row is (mpId, contractorEik, ...); the reverse-lookup
  // shard groups by contractorEik. We keep the manifest small — just an
  // alphabetised list of EIKs that have at least one MP connection.
  const byEik = new Map<string, MpConnectedFile["entries"]>();
  for (const e of data.entries) {
    if (!e.contractorEik) continue;
    const arr = byEik.get(e.contractorEik) ?? [];
    arr.push(e);
    byEik.set(e.contractorEik, arr);
  }

  const wanted = new Set<string>();
  for (const [eik, entries] of byEik) {
    const file = `${eik}.json`;
    wanted.add(file);
    const content = canonicalJson({ eik, entries });
    const fullPath = path.join(shardDir, file);
    if (fs.existsSync(fullPath)) {
      try {
        if (fs.readFileSync(fullPath, "utf8") === content) continue;
      } catch {
        // overwrite
      }
    }
    fs.writeFileSync(fullPath, content);
  }

  // Manifest of EIKs that have a per-EIK shard. /company/{eik} reads this
  // small manifest first; if the EIK isn't listed, no shard fetch fires
  // at all.
  const eiks = [...byEik.keys()].sort();
  const manifest = JSON.stringify({ eiks }, null, 2) + "\n";
  const manifestPath = path.join(shardDir, "index.json");
  let existingManifest = "";
  if (fs.existsSync(manifestPath)) {
    try {
      existingManifest = fs.readFileSync(manifestPath, "utf8");
    } catch {
      // overwrite
    }
  }
  if (existingManifest !== manifest) {
    fs.writeFileSync(manifestPath, manifest);
  }

  for (const f of fs.readdirSync(shardDir)) {
    if (!f.endsWith(".json")) continue;
    if (f === "index.json") continue;
    if (wanted.has(f)) continue;
    fs.unlinkSync(path.join(shardDir, f));
  }
};

const writeMpConnectedShards = (
  outDir: string,
  data: MpConnectedFile,
): void => {
  const shardDir = path.join(outDir, "per-mp");
  fs.mkdirSync(shardDir, { recursive: true });

  const byMp = new Map<number, MpConnectedFile["entries"]>();
  for (const e of data.entries) {
    const arr = byMp.get(e.mpId) ?? [];
    arr.push(e);
    byMp.set(e.mpId, arr);
  }

  // Cohort-wide totalEur distribution. Pre-computed here so each shard can
  // carry the MP's rank without the frontend ever loading the chamber-wide
  // mp_connected.json — and so MPs WITHOUT any connections can still read
  // cohort.size + cohort.median from the manifest for context like "0 vs
  // 12k average".
  const cohortTotals = [...byMp.values()].map((entries) =>
    entries.reduce((sum, e) => sum + e.totalEur, 0),
  );
  cohortTotals.sort((a, b) => b - a);
  const cohortSize = cohortTotals.length;
  const cohortMedian =
    cohortSize === 0
      ? 0
      : cohortSize % 2 === 1
        ? cohortTotals[(cohortSize - 1) >> 1]
        : (cohortTotals[cohortSize >> 1] +
            cohortTotals[(cohortSize >> 1) - 1]) /
          2;
  // 1-based rank by total. Map mpId → rank. Ties get the same rank, with the
  // next rank advancing past the cluster — same semantics as the runtime
  // rankIn() helper in useMpScorecard.
  const rankByMp = new Map<number, number>();
  for (const [mpId, entries] of byMp) {
    const total = entries.reduce((s, e) => s + e.totalEur, 0);
    let rank = 1;
    for (const v of cohortTotals) {
      if (v > total) rank += 1;
      else break;
    }
    rankByMp.set(mpId, rank);
  }

  const wanted = new Set<string>();
  for (const [mpId, entries] of byMp) {
    const file = `${mpId}.json`;
    wanted.add(file);
    const summary = {
      totalEur: 0,
      totalOther: {} as Record<string, number>,
      contractCount: 0,
      awardCount: 0,
    };
    for (const e of entries) {
      summary.totalEur += e.totalEur;
      for (const [cur, amt] of Object.entries(e.totalOther)) {
        summary.totalOther[cur] = (summary.totalOther[cur] ?? 0) + amt;
      }
      summary.contractCount += e.contractCount;
      summary.awardCount += e.awardCount;
    }
    // Embed per-MP scorecard stats so the candidate-page tile can render
    // rank + cohort context without fetching mp_connected.json (chamber-
    // wide, ~15 KB gzipped). Drops the procurement aggregate off the
    // candidate-page critical path entirely.
    const scorecard = {
      value: summary.totalEur,
      rank: rankByMp.get(mpId) ?? null,
      cohortSize,
      cohortMedian,
    };
    const shard = { mpId, summary, scorecard, entries };
    const content = canonicalJson(shard);
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

  // Manifest of MP ids that have a shard. Carries cohort.size + median so
  // candidate pages for MPs WITHOUT connections (the common case) can still
  // render "0 contracts vs N median" without loading the aggregate.
  const mpIds = [...byMp.keys()].sort((a, b) => a - b);
  const manifest =
    JSON.stringify(
      { mpIds, cohort: { size: cohortSize, median: cohortMedian } },
      null,
      2,
    ) + "\n";
  const manifestPath = path.join(shardDir, "index.json");
  let existingManifest = "";
  if (fs.existsSync(manifestPath)) {
    try {
      existingManifest = fs.readFileSync(manifestPath, "utf8");
    } catch {
      // overwrite
    }
  }
  if (existingManifest !== manifest) {
    fs.writeFileSync(manifestPath, manifest);
  }

  // Prune stale shards (MP disappeared from the cross-reference, e.g. a
  // declared interest was retracted). The manifest is intentionally
  // preserved by the `!== "index.json"` guard.
  for (const f of fs.readdirSync(shardDir)) {
    if (!f.endsWith(".json")) continue;
    if (f === "index.json") continue;
    if (wanted.has(f)) continue;
    fs.unlinkSync(path.join(shardDir, f));
  }
};
