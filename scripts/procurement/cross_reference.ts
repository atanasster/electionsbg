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
import type {
  ContractorRollup,
  MpCompanyRelation,
  MpCompanyRelationKind,
  MpConnectedContractor,
  MpConnectedFile,
} from "./types";
import { canonicalJson } from "./validate";

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
      valueBgn?: number;
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
        valueBgn: s.stake.valueBgn,
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
        totalByCurrency: contractor.totalByCurrency,
        contractCount: contractor.contractCount,
        awardCount: contractor.awardCount,
        byYear: contractor.byYear,
        topAwarders: contractor.byAwarder.slice(0, 5),
      });
    }
  }
  // Sort: largest total first (raw sum across currencies — same caveat as the
  // top-contractors list. Currency mix shifts ordering by <5 ranks).
  entries.sort(
    (a, b) => sumTotals(b.totalByCurrency) - sumTotals(a.totalByCurrency),
  );
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
  };
};

const sumTotals = (bag: Record<string, number>): number =>
  Object.values(bag).reduce((s, n) => s + n, 0);

export const writeMpConnected = (
  outDir: string,
  data: MpConnectedFile,
): void => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "mp_connected.json"), canonicalJson(data));
};
