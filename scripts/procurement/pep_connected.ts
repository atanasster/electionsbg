// Officials → procurement cross-reference. Mirrors cross_reference.ts (the MP-companies join)
// but for the rest of the political class: cabinet members, deputy ministers, agency heads,
// regional governors, mayors, deputy-mayors, council chairs, councillors and chief architects.
// The join key is the 9-digit EIK on both sides.
//
// EDITORIAL GUARDRAIL: only links the registry itself supports — a declared stake 096
// confirmed against the Commerce Registry, or a registry role on a folded name migration 148
// says belongs to exactly one human.
//
// ⚠️ THE SOURCE MOVED, AND WITH IT WHAT „HIGH CONFIDENCE" MEANS (2026-08-21). It was
// `data/officials/derived/company_links.json`, which graded every link high/medium/low and
// which this module then filtered to `high`. That grade was the discredited one — "high only
// when the name is rare on BOTH sides: unique among officials AND mapped to a single TR
// company" — the one-company straitjacket migration 158's header calls wrong in both
// directions, applied to 70,525 links of which 85.5% were low. It is now the gated person
// layer (`readOfficialLinkRows` in `scripts/lib/mp_linkage.ts`), where a shared name is
// REFUSED rather than scored, so there is no per-row grade left to filter on: the emitted
// `confidence: "high"` describes the SET. Plan:
// docs/plans/company-page-consolidation-v1.md (Tier 6).

import fs from "fs";
import path from "path";
import type { ContractorRollup } from "./types";
import { canonicalEik } from "./eik";
import { byEurDesc, canonicalJson, writeStableJson } from "./validate";
import {
  mpLinkageAvailable,
  readOfficialLinkRows,
  type OfficialLinkRow,
} from "../lib/mp_linkage";

export type PepRelation = {
  role: string;
  confidence: "high" | "medium" | "low";
  shareSize?: string;
  valueEur?: number;
};

export type PepAwarder = {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
};

export type PepByYear = {
  year: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
};

export type PepConnectedEntry = {
  slug: string;
  name: string;
  tier: string;
  role: string;
  contractorEik: string;
  contractorName: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  relations: PepRelation[];
  // Per-year totals + top awarders from the contractor rollup, so the
  // /officials/:slug procurement section can render the same per-company
  // history (chart + top buyers) as the MP procurement page.
  byYear: PepByYear[];
  topAwarders: PepAwarder[];
};

export type PepConnectedFile = {
  generatedAt: string;
  total: number;
  /** Distinct officials with at least one procurement-winning company. */
  officialCount: number;
  entries: PepConnectedEntry[];
};

// Source-agnostic core: join the gated officials link rows to procurement contractors via
// `getContractor(eik)` (returns the rollup or null). buildPepConnected below reads the on-disk
// rollups; the SQL generator passes a lookup over its SQL-built rollups.
//
// ⚠️ NO CONFIDENCE FILTER, and its absence is not an omission. The rows arrive gated (see the
// header), so the `l.confidence !== "high"` skip this loop used to open with would drop
// nothing — while looking like it still guarded something.
export const buildPepConnectedFrom = (
  links: readonly OfficialLinkRow[],
  getContractor: (eik: string) => ContractorRollup | null,
): PepConnectedFile => {
  const entries: PepConnectedEntry[] = [];
  const officials = new Set<string>();

  // One row per (official, company) already, but an official can hold several roles in one
  // firm, so the relations are folded per EIK exactly as before.
  const byOfficial = new Map<
    string,
    { row: OfficialLinkRow; perEik: Map<string, PepRelation[]> }
  >();
  for (const r of links) {
    if (!/^\d{9,13}$/.test(r.eik)) continue;
    // Canonicalise exactly as the contractor rollup filenames are keyed (13-digit branch →
    // 9-digit; 10/11/12-digit BULSTAT kept as-is), so the contractors/{eik}.json lookup
    // cannot miss on a length mismatch.
    const eik = canonicalEik(r.eik);
    const g = byOfficial.get(r.slug) ?? { row: r, perEik: new Map() };
    const arr = g.perEik.get(eik) ?? [];
    for (const rel of r.relations as Array<{
      kind?: string;
      role?: string;
      shareSize?: string;
      valueEur?: number;
    }>) {
      // ⚠️ `kind` OR `role`, and NEVER the row's own `role` as a fallback. The stored vintage
      // keys these `role` and the re-based arm keys them `kind` (see OfficialLinkRow), so
      // reading one alone yields undefined on half the databases — and substituting the
      // OFFICE role there would publish „държавно предприятие" as a company relationship.
      const kind = rel?.kind ?? rel?.role;
      if (!kind) continue;
      arr.push({
        role: kind,
        confidence: "high",
        ...(rel?.shareSize ? { shareSize: rel.shareSize } : {}),
        ...(typeof rel?.valueEur === "number"
          ? { valueEur: rel.valueEur }
          : {}),
      });
    }
    // No synthetic relation when the array is empty: an entry with no stated relationship is
    // one this join cannot describe, and inventing „officer" would assert a registry role
    // nobody filed. It still counts as a link — the official IS tied to the company — so the
    // entry stands with an empty `relations`.
    g.perEik.set(eik, arr);
    byOfficial.set(r.slug, g);
  }

  for (const { row: official, perEik } of byOfficial.values()) {
    for (const [eik, relations] of perEik) {
      const c = getContractor(eik);
      if (!c) continue; // not a procurement contractor
      officials.add(official.slug);
      entries.push({
        slug: official.slug,
        name: official.name,
        tier: official.tier,
        role: official.role,
        contractorEik: c.eik,
        contractorName: c.name,
        totalEur: c.totalEur,
        totalOther: c.totalOther,
        contractCount: c.contractCount,
        awardCount: c.awardCount,
        relations,
        byYear: c.byYear,
        topAwarders: c.byAwarder.slice(0, 5),
      });
    }
  }

  entries.sort((a, b) =>
    byEurDesc(
      a.totalEur,
      b.totalEur,
      `${a.slug}:${a.contractorEik}`,
      `${b.slug}:${b.contractorEik}`,
    ),
  );
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    officialCount: officials.size,
    entries,
  };
};

export const buildPepConnected = async (
  contractorsDir: string,
): Promise<PepConnectedFile> => {
  // ⚠️ THE SOFT SKIP IS LOAD-BEARING AND IT NEARLY DIED IN THE RE-BASE. Five procurement CLIs
  // call this AFTER writing the contracts corpus, and the file it used to read was optional —
  // `!fs.existsSync(companyLinksPath)` returned an empty payload rather than throwing. Its
  // replacement lives in Postgres, so without this probe a machine with no database aborts
  // the ingest at the very end, having already written every shard.
  //
  // Absent and empty stay different, as everywhere else here: UNREACHABLE (a fresh clone, no
  // Postgres, or company_politicians never created) yields the empty payload; PRESENT and
  // empty is a broken load and readOfficialLinkRows throws.
  if (!fs.existsSync(contractorsDir) || !(await mpLinkageAvailable())) {
    return {
      generatedAt: new Date().toISOString(),
      total: 0,
      officialCount: 0,
      entries: [],
    };
  }
  const links = await readOfficialLinkRows(
    "pep_connected.json would be rewritten empty and every surface built on it would " +
      "report that no public official is tied to a procurement contractor.",
  );
  return buildPepConnectedFrom(links, (eik) => {
    const f = path.join(contractorsDir, `${eik}.json`);
    return fs.existsSync(f)
      ? (JSON.parse(fs.readFileSync(f, "utf8")) as ContractorRollup)
      : null;
  });
};

export const writePepConnected = (
  derivedDir: string,
  data: PepConnectedFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  writeStableJson(path.join(derivedDir, "pep_connected.json"), data);
  writePepByEikShards(derivedDir, data);
  writePepBySlugShards(derivedDir, data);
};

// Forward-lookup shards: official slug → the contractors they're tied to. The
// /officials/{slug} profile reads the small manifest first; if the slug isn't
// listed, no shard fetch fires. Sibling of writePepByEikShards (reverse) — this
// powers the per-official procurement section + the people-scanner drill-down.
const writePepBySlugShards = (
  derivedDir: string,
  data: PepConnectedFile,
): void => {
  const shardDir = path.join(derivedDir, "pep-by-slug");
  fs.mkdirSync(shardDir, { recursive: true });

  const bySlug = new Map<string, PepConnectedEntry[]>();
  for (const e of data.entries) {
    const arr = bySlug.get(e.slug) ?? [];
    arr.push(e);
    bySlug.set(e.slug, arr);
  }

  const wanted = new Set<string>();
  for (const [slug, list] of bySlug) {
    const f = `${slug}.json`;
    wanted.add(f);
    const content = canonicalJson({ slug, entries: list });
    const full = path.join(shardDir, f);
    if (fs.existsSync(full)) {
      try {
        if (fs.readFileSync(full, "utf8") === content) continue;
      } catch {
        // overwrite
      }
    }
    fs.writeFileSync(full, content);
  }

  const slugs = [...bySlug.keys()].sort();
  const manifest = JSON.stringify({ slugs }, null, 2) + "\n";
  const manifestPath = path.join(shardDir, "index.json");
  let existing = "";
  if (fs.existsSync(manifestPath)) {
    try {
      existing = fs.readFileSync(manifestPath, "utf8");
    } catch {
      // overwrite
    }
  }
  if (existing !== manifest) fs.writeFileSync(manifestPath, manifest);

  for (const f of fs.readdirSync(shardDir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    if (!wanted.has(f)) fs.unlinkSync(path.join(shardDir, f));
  }
};

// Reverse-lookup shards: contractorEik → officials connected to it. /company/
// {eik} reads the small manifest first; if the EIK isn't listed, no shard
// fetch fires. Mirrors cross_reference.writeMpConnectedByEikShards.
const writePepByEikShards = (
  derivedDir: string,
  data: PepConnectedFile,
): void => {
  const shardDir = path.join(derivedDir, "pep-by-eik");
  fs.mkdirSync(shardDir, { recursive: true });

  const byEik = new Map<string, PepConnectedEntry[]>();
  for (const e of data.entries) {
    const arr = byEik.get(e.contractorEik) ?? [];
    arr.push(e);
    byEik.set(e.contractorEik, arr);
  }

  const wanted = new Set<string>();
  for (const [eik, list] of byEik) {
    const f = `${eik}.json`;
    wanted.add(f);
    const content = canonicalJson({ eik, entries: list });
    const full = path.join(shardDir, f);
    if (fs.existsSync(full)) {
      try {
        if (fs.readFileSync(full, "utf8") === content) continue;
      } catch {
        // overwrite
      }
    }
    fs.writeFileSync(full, content);
  }

  const eiks = [...byEik.keys()].sort();
  const manifest = JSON.stringify({ eiks }, null, 2) + "\n";
  const manifestPath = path.join(shardDir, "index.json");
  let existing = "";
  if (fs.existsSync(manifestPath)) {
    try {
      existing = fs.readFileSync(manifestPath, "utf8");
    } catch {
      // overwrite
    }
  }
  if (existing !== manifest) fs.writeFileSync(manifestPath, manifest);

  for (const f of fs.readdirSync(shardDir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    if (!wanted.has(f)) fs.unlinkSync(path.join(shardDir, f));
  }
};
