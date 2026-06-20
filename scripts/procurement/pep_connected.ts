// Officials → procurement cross-reference. Mirrors cross_reference.ts (the
// MP-companies join) but for the rest of the political class: cabinet members,
// deputy ministers, agency heads, regional governors, mayors, deputy-mayors,
// council chairs, councillors and chief architects. The join key is the 9-digit
// EIK on the official's declared / Commerce-Registry company links
// (data/officials/derived/company_links.json, built by the connections feature).
//
// EDITORIAL GUARDRAIL: only HIGH-confidence links are used — a declared stake or
// a unique-name TR officer/owner match. Medium/low links are name-only matches
// that, for officials (unlike MPs, who are a tiny bounded set), collapse into a
// "most common Bulgarian name" list. Dropping them keeps the signal clean — the
// same rule the connections graph applies. See [[project-connections-expansion]].

import fs from "fs";
import path from "path";
import type { ContractorRollup } from "./types";
import { canonicalEik } from "./eik";
import { canonicalJson } from "./validate";

type OfficialLink = {
  uic: string;
  companyName: string;
  source: "tr" | "declared" | string;
  trRole?: string | null;
  shareSize?: string | null;
  valueEur?: number | null;
  confidence: "high" | "medium" | "low";
  namesakeCount?: number;
};

type OfficialEntry = {
  slug: string;
  name: string;
  tier: string;
  role: string;
  municipality?: string | null;
  links: OfficialLink[];
};

type CompanyLinksFile = {
  byOfficial: Record<string, OfficialEntry>;
};

export type PepRelation = {
  role: string;
  confidence: "high" | "medium" | "low";
  shareSize?: string;
  valueEur?: number;
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
};

export type PepConnectedFile = {
  generatedAt: string;
  total: number;
  /** Distinct officials with at least one procurement-winning company. */
  officialCount: number;
  entries: PepConnectedEntry[];
};

export const buildPepConnected = (
  companyLinksPath: string,
  contractorsDir: string,
): PepConnectedFile => {
  if (!fs.existsSync(companyLinksPath) || !fs.existsSync(contractorsDir)) {
    return {
      generatedAt: new Date().toISOString(),
      total: 0,
      officialCount: 0,
      entries: [],
    };
  }
  const links = JSON.parse(
    fs.readFileSync(companyLinksPath, "utf8"),
  ) as CompanyLinksFile;

  const entries: PepConnectedEntry[] = [];
  const officials = new Set<string>();

  for (const official of Object.values(links.byOfficial ?? {})) {
    // High-confidence links only, grouped per company EIK (an official can hold
    // several roles in the same firm — manager + partner is common).
    const perEik = new Map<string, PepRelation[]>();
    for (const l of official.links ?? []) {
      if (l.confidence !== "high") continue;
      if (!/^\d{9,13}$/.test(l.uic)) continue;
      // Canonicalise exactly as the contractor rollup filenames are keyed
      // (13-digit branch → 9-digit; 10/11/12-digit BULSTAT kept as-is), so the
      // contractors/{eik}.json lookup can't miss on a length mismatch.
      const eik = canonicalEik(l.uic);
      const arr = perEik.get(eik) ?? [];
      arr.push({
        role: l.source === "declared" ? "stake" : (l.trRole ?? "officer"),
        confidence: l.confidence,
        ...(l.shareSize ? { shareSize: l.shareSize } : {}),
        ...(typeof l.valueEur === "number" ? { valueEur: l.valueEur } : {}),
      });
      perEik.set(eik, arr);
    }
    for (const [eik, relations] of perEik) {
      const file = path.join(contractorsDir, `${eik}.json`);
      if (!fs.existsSync(file)) continue; // not a procurement contractor
      const c = JSON.parse(fs.readFileSync(file, "utf8")) as ContractorRollup;
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
      });
    }
  }

  entries.sort((a, b) => b.totalEur - a.totalEur);
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    officialCount: officials.size,
    entries,
  };
};

export const writePepConnected = (
  derivedDir: string,
  data: PepConnectedFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "pep_connected.json"),
    canonicalJson(data),
  );
  writePepByEikShards(derivedDir, data);
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
