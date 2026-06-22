// Join procurement contractors against the MP-companies graph (built by the
// /update-connections skill from declarations + Commerce Registry filings).
//
// The join key is the 9-digit canonical EIK. The contractors side stores it
// in `Contract.contractorEik` already; the companies side stores it at
// `companies[i].tr.uic` — present on ~87% of entries (the rest are stake-only
// declarations where the company couldn't be enriched from TR).
//
// PRD editorial guardrail: conservative MP linking — only flag a connection
// if it's recorded in the official declarations (cacbg) OR Commerce Registry.
// Don't guess via name matching. The TR-uic-keyed join enforces this.

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
  ContractorRollup,
  MpCompanyRelation,
  MpCompanyRelationKind,
  MpConnectedContractor,
  MpConnectedFile,
} from "./types";
import { canonicalJson } from "./validate";
import { normalize } from "../officials/shared";

// Distinct Commerce-Registry companies (UICs) per normalised person name.
// An MP↔company link drawn purely from a TR officer/owner record is only
// trustworthy when the MP's name maps to a SINGLE company — a name spread
// across several companies almost always means several distinct people
// (common Bulgarian names recur thousands of times), so attributing all of
// them to one MP is the classic false positive. Mirrors the officials-side
// guard in build_officials_company_links.ts. Returns an empty map when the
// TR SQLite is absent (callers then skip the filter — declared stakes still
// stand on their own).
export const buildTrNamesakeCounts = (
  sqlitePath: string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  if (!fs.existsSync(sqlitePath)) return counts;
  const uicsByName = new Map<string, Set<string>>();
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA cache_size = -64000;");
  for (const row of db
    .prepare(`SELECT uic, name FROM company_persons WHERE erased_at IS NULL`)
    .all() as Array<{ uic: string; name: string | null }>) {
    if (!row.name) continue;
    const key = normalize(row.name);
    const set = uicsByName.get(key) ?? new Set<string>();
    set.add(row.uic);
    uicsByName.set(key, set);
  }
  db.close();
  for (const [name, set] of uicsByName) counts.set(name, set.size);
  return counts;
};

interface CompaniesIndex {
  generatedAt: string;
  total: number;
  companies: CompanyEntry[];
}

interface CompanyEntry {
  slug: string;
  displayName: string;
  stakes?: Array<{
    mpId: number;
    declarantName: string;
    declarationYear: number;
    fiscalYear: number;
    institution: string;
    sourceUrl: string;
    stake: {
      shareSize?: string;
      valueEur?: number;
    };
  }>;
  tr?: {
    uic: string;
    legalForm?: string;
    status?: string;
  };
  mpRoles?: Array<{
    mpId: number;
    mpName: string;
    role: MpCompanyRelationKind;
    isCurrent: boolean;
    confidence: "high" | "medium" | "low";
  }>;
}

// Returns EIK → linkages map. Each linkage is one (mpId, relation) pair,
// grouped by mpId so the cross-reference can emit one entry per (mpId, EIK)
// regardless of how many roles/stakes that pair has.
export interface MpLinkage {
  mpId: number;
  mpName: string;
  relations: MpCompanyRelation[];
  companyDisplayName: string;
}

export interface EikLinkageMap {
  byEik: Map<string, MpLinkage[]>;
  totalCompanies: number;
  companiesWithUic: number;
}

export const buildEikLinkageMap = (
  companiesIndexPath: string,
  trNamesake?: Map<string, number>,
): EikLinkageMap => {
  if (!fs.existsSync(companiesIndexPath)) {
    throw new Error(
      `companies-index.json not found at ${companiesIndexPath}. ` +
        `Run /update-connections first to build the MP-companies graph.`,
    );
  }
  const idx = JSON.parse(
    fs.readFileSync(companiesIndexPath, "utf8"),
  ) as CompaniesIndex;

  // Hard-fail if TR enrichment is missing on almost every entry. Without
  // tr.uic the join key doesn't exist and mp_connected.json would silently
  // collapse to empty — exactly the "TR refresh wasn't run" failure mode the
  // PRD's plan called out.
  const withUic = idx.companies.filter((c) => c.tr?.uic).length;
  if (withUic < idx.companies.length * 0.1) {
    throw new Error(
      `companies-index.json has only ${withUic}/${idx.companies.length} entries with tr.uic. ` +
        `Commerce Registry (TR) enrichment looks missing — run /update-connections with TR refresh ` +
        `before re-running the cross-reference (otherwise the EIK join key is unavailable for ${idx.companies.length - withUic} companies).`,
    );
  }

  const byEik = new Map<string, MpLinkage[]>();
  for (const company of idx.companies) {
    const uic = company.tr?.uic;
    if (!uic) continue;
    // Aggregate relations per (eik, mpId) — one MP can have multiple roles in
    // the same company (manager + partner is common), plus separate stake
    // declarations for different years.
    const perMp = new Map<number, MpLinkage>();

    for (const role of company.mpRoles ?? []) {
      // mpRoles are name-matched TR officer/owner records (declared stakes
      // come from the stakes loop below). Keep one only when the MP's name
      // maps to a single TR company — otherwise it's a namesake collision.
      // Skipped when no TR namesake map was supplied (TR SQLite absent).
      if (trNamesake && (trNamesake.get(normalize(role.mpName)) ?? 0) !== 1) {
        continue;
      }
      let linkage = perMp.get(role.mpId);
      if (!linkage) {
        linkage = {
          mpId: role.mpId,
          mpName: role.mpName,
          relations: [],
          companyDisplayName: company.displayName,
        };
        perMp.set(role.mpId, linkage);
      }
      linkage.relations.push({
        kind: role.role,
        isCurrent: role.isCurrent,
        confidence: role.confidence,
      });
    }

    // Keep only the most recent stake per (mpId). Multiple stake rows are
    // year-by-year filings of the same ownership; the latest year is what we
    // surface in the UI (older filings remain visible on the per-MP
    // declarations page).
    const latestStakeByMp = new Map<
      number,
      NonNullable<CompanyEntry["stakes"]>[number]
    >();
    for (const s of company.stakes ?? []) {
      const prev = latestStakeByMp.get(s.mpId);
      if (!prev || s.fiscalYear > prev.fiscalYear) {
        latestStakeByMp.set(s.mpId, s);
      }
    }
    for (const [mpId, s] of latestStakeByMp) {
      let linkage = perMp.get(mpId);
      if (!linkage) {
        linkage = {
          mpId,
          mpName: s.declarantName,
          relations: [],
          companyDisplayName: company.displayName,
        };
        perMp.set(mpId, linkage);
      }
      linkage.relations.push({
        kind: "stake",
        shareSize: s.stake.shareSize,
        valueEur: s.stake.valueEur,
        fiscalYear: s.fiscalYear,
        declarationYear: s.declarationYear,
      });
    }

    if (perMp.size === 0) continue;
    byEik.set(uic, [...perMp.values()]);
  }

  return {
    byEik,
    totalCompanies: idx.companies.length,
    companiesWithUic: withUic,
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
  const entries: MpConnectedContractor[] = [];
  for (const file of fs.readdirSync(contractorsDir).sort()) {
    if (!file.endsWith(".json")) continue;
    const eik = file.replace(/\.json$/, "");
    const linkages = linkageMap.byEik.get(eik);
    if (!linkages || linkages.length === 0) continue;
    const contractor = JSON.parse(
      fs.readFileSync(path.join(contractorsDir, file), "utf8"),
    ) as ContractorRollup;
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
  // Sort: largest euro total first.
  entries.sort((a, b) => b.totalEur - a.totalEur);
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
  };
};

export const writeMpConnected = (
  outDir: string,
  data: MpConnectedFile,
): void => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "mp_connected.json"), canonicalJson(data));

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
