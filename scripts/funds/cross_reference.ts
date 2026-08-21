// Join EU-funds beneficiaries against the MP↔company link set.
//
// The join key is the 9-digit canonical EIK, on both sides: the beneficiary carries it in
// FundsBeneficiary.eik and the link set is keyed on company_politicians.eik.
//
// Editorial guardrail: a connection is only flagged when it is recorded in the Commerce
// Registry (a management or ownership role) or in a Court-of-Audit declaration (a confirmed
// stake). Until 2026-08-20 that guardrail was HALF TRUE — the source was
// companies-index.json, whose registry arm matched an MP by NAME with no people-per-name
// guard, so a common name attached one MP to another person's company and the EIK-keyed join
// then published it as a fact about EU money. The source is now the gated person layer.

import fs from "fs";
import { readMpLinkRows } from "../lib/mp_linkage";
import path from "path";
import type {
  FundsBeneficiary,
  FundsMpConnected,
  FundsMpConnectedFile,
  FundsMpRelation,
} from "./types";

export interface MpLinkage {
  mpId: number;
  mpName: string;
  relations: FundsMpRelation[];
}

export interface EikLinkageMap {
  byEik: Map<string, MpLinkage[]>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// EIK → MP-linkage map, from the GATED PERSON LAYER.
//
// Was companies-index.json — an MP NAME matched against Commerce-Registry officers with no
// people-per-name guard. It reads the same set `company_politicians` now carries (Tier 4a):
// `person_role` at source tr/ngo, minted through Bridge A/B and refused on a fold the
// registry says belongs to more than one human, unioned with 096's confirmed declared
// stakes. One linkage per (EIK, mpId), carrying every relation for that pair.
// Plan: docs/plans/company-page-consolidation-v1.md (Tier 5.1).
//
// ⚠️ THE FLOOR IS KEPT, ONLY ITS SUBJECT MOVED. The old guard hard-failed when almost no
// entry carried a `tr.uic`, because without the join key the cross-reference collapses to
// empty SILENTLY — the „the TR refresh was not run" failure. The same hole exists on the
// gated source: an unresolved person layer yields zero rows and the funds MP-tied payload
// would publish „no MP is linked to any beneficiary" at exit 0. So an empty linkage set is
// refused rather than returned.
//
// ⚠️ IT NO LONGER DEDUPES STAKES BY YEAR. It used to keep the latest filing per MP because
// companies-index carried one row per declaration; `company_politicians.relations` is already
// deduped per (person, company) by the arm query's DISTINCT ON, so re-doing it here would be
// a second, divergent copy of that rule.
export const buildEikLinkageMap = async (): Promise<EikLinkageMap> => {
  // ⚠️ scope 'all', NOT the served company_politicians. That table is contract-restricted —
  // every row in it is a politically linked CONTRACTOR — and this join's population is ИСУН
  // beneficiaries, so using it drops every MP-linked company that took EU money and never won
  // a public contract. Measured 2026-08-20: it answers 43 of this payload's 303 pairs.
  const rows = await readMpLinkRows(
    "the funds cross-reference would collapse to empty and publish that no MP is linked to " +
      "any beneficiary.",
    "all",
  );

  const byEik = new Map<string, MpLinkage[]>();
  for (const r of rows) {
    const list = byEik.get(r.eik) ?? [];
    list.push({
      mpId: r.mpId,
      mpName: r.mpName,
      relations: r.relations as FundsMpRelation[],
    });
    byEik.set(r.eik, list);
  }

  return { byEik };
};

// Emit one entry per (mpId, beneficiary) pair whose EIK matches the linkage
// map. Sorted by contracted funds, descending — the journalism payload.
export const buildMpConnected = (
  beneficiaries: FundsBeneficiary[],
  linkageMap: EikLinkageMap,
): FundsMpConnectedFile => {
  // The register lists sub-units (райони, териториални поделения, клонове) as
  // separate rows sharing the parent's EIK. Aggregate by canonical EIK first
  // so an MP-connected beneficiary is joined once, with summed totals (and a
  // stable React key downstream).
  interface Agg {
    name: string;
    orgType: string;
    contractCount: number;
    contractedEur: number;
    paidEur: number;
  }
  const byEik = new Map<string, Agg>();
  for (const b of beneficiaries) {
    if (!b.eik) continue;
    const prev = byEik.get(b.eik);
    if (!prev) {
      byEik.set(b.eik, {
        name: b.name,
        orgType: b.orgType,
        contractCount: b.contractCount,
        contractedEur: b.contractedEur,
        paidEur: b.paidEur,
      });
      continue;
    }
    // Keep the largest row's name + type (the parent); sum the rest.
    if (b.contractedEur > prev.contractedEur) {
      prev.name = b.name;
      prev.orgType = b.orgType;
    }
    prev.contractCount += b.contractCount;
    prev.contractedEur += b.contractedEur;
    prev.paidEur += b.paidEur;
  }

  const entries: FundsMpConnected[] = [];
  for (const [eik, b] of byEik) {
    const linkages = linkageMap.byEik.get(eik);
    if (!linkages?.length) continue;
    for (const linkage of linkages) {
      entries.push({
        mpId: linkage.mpId,
        mpName: linkage.mpName,
        beneficiaryEik: eik,
        beneficiaryName: b.name,
        orgType: b.orgType,
        relations: linkage.relations,
        contractCount: b.contractCount,
        contractedEur: round2(b.contractedEur),
        paidEur: round2(b.paidEur),
      });
    }
  }
  // Deterministic order for stable diffs: contracted desc, then mpId, then EIK.
  entries.sort(
    (a, b) =>
      b.contractedEur - a.contractedEur ||
      a.mpId - b.mpId ||
      a.beneficiaryEik.localeCompare(b.beneficiaryEik),
  );

  const mpIds = new Set(entries.map((e) => e.mpId));
  const benEiks = new Set(entries.map((e) => e.beneficiaryEik));
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    mpCount: mpIds.size,
    beneficiaryCount: benEiks.size,
    contractedEur: round2(entries.reduce((s, e) => s + e.contractedEur, 0)),
    paidEur: round2(entries.reduce((s, e) => s + e.paidEur, 0)),
    entries,
  };
};

export const writeMpConnected = (
  outDir: string,
  data: FundsMpConnectedFile,
): void => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "mp_connected.json"),
    JSON.stringify(data, null, 2) + "\n",
  );

  // Per-MP shards. Same pattern as procurement — the candidate-page tile
  // only needs one MP's slice, so we ship a tiny shard alongside the
  // aggregate. Aggregate stays for the standalone /funds index screen.
  writeMpConnectedShards(outDir, data);

  // Per-EIK shards. /company/{eik} needs the reverse lookup (which MPs are
  // declared in this beneficiary?) — without this it streams the full
  // ~93 KB aggregate just to filter for one EIK.
  writeMpConnectedByEikShards(outDir, data);
};

const writeMpConnectedByEikShards = (
  outDir: string,
  data: FundsMpConnectedFile,
): void => {
  const shardDir = path.join(outDir, "by-eik");
  fs.mkdirSync(shardDir, { recursive: true });

  const byEik = new Map<string, FundsMpConnectedFile["entries"]>();
  for (const e of data.entries) {
    if (!e.beneficiaryEik) continue;
    const arr = byEik.get(e.beneficiaryEik) ?? [];
    arr.push(e);
    byEik.set(e.beneficiaryEik, arr);
  }

  const wanted = new Set<string>();
  for (const [eik, entries] of byEik) {
    const file = `${eik}.json`;
    wanted.add(file);
    const content = JSON.stringify({ eik, entries }, null, 2) + "\n";
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

  // Manifest of EIKs with at least one MP linkage. /company/{eik} reads
  // this small manifest first; if the EIK isn't listed, no shard fetch
  // fires at all.
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
  data: FundsMpConnectedFile,
): void => {
  const shardDir = path.join(outDir, "per-mp");
  fs.mkdirSync(shardDir, { recursive: true });

  const byMp = new Map<number, FundsMpConnectedFile["entries"]>();
  for (const e of data.entries) {
    const arr = byMp.get(e.mpId) ?? [];
    arr.push(e);
    byMp.set(e.mpId, arr);
  }

  const wanted = new Set<string>();
  for (const [mpId, entries] of byMp) {
    const file = `${mpId}.json`;
    wanted.add(file);
    const summary = {
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    for (const e of entries) {
      summary.contractCount += e.contractCount;
      summary.contractedEur += e.contractedEur;
      summary.paidEur += e.paidEur;
    }
    const shard = { mpId, summary, entries };
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

  // Manifest of MP ids with a shard. Mirrors the procurement side — the
  // frontend fetches this once to know whether to expect a per-MP shard,
  // skipping both the shard fetch AND the aggregate fallback for MPs with
  // no declared fund connections.
  const mpIds = [...byMp.keys()].sort((a, b) => a - b);
  const manifest = JSON.stringify({ mpIds }, null, 2) + "\n";
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
