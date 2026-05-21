// Join EU-funds beneficiaries against the MP-companies graph (built by the
// /update-connections skill from declarations + Commerce Registry filings).
//
// The join key is the 9-digit canonical EIK: the beneficiary side carries it
// in FundsBeneficiary.eik; the companies side stores it at companies[i].tr.uic.
//
// Editorial guardrail: a connection is only flagged when it is recorded in the
// official Court-of-Audit declarations (a declared stake) or the Commerce
// Registry (a management role). There is no name-match guessing — the
// EIK-keyed join enforces this.

import fs from "fs";
import path from "path";
import type {
  FundsBeneficiary,
  FundsMpConnected,
  FundsMpConnectedFile,
  FundsMpRelation,
} from "./types";

interface CompaniesIndex {
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
    stake: { shareSize?: string; valueEur?: number };
  }>;
  tr?: { uic: string };
  mpRoles?: Array<{
    mpId: number;
    mpName: string;
    role: string;
    isCurrent: boolean;
    confidence: "high" | "medium" | "low";
  }>;
}

export interface MpLinkage {
  mpId: number;
  mpName: string;
  relations: FundsMpRelation[];
}

export interface EikLinkageMap {
  byEik: Map<string, MpLinkage[]>;
  totalCompanies: number;
  companiesWithUic: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Read companies-index.json into an EIK → MP-linkage map. One linkage per
// (EIK, mpId); an MP with several roles in the same company gets one linkage
// carrying multiple relations.
export const buildEikLinkageMap = (
  companiesIndexPath: string,
): EikLinkageMap => {
  const idx = JSON.parse(
    fs.readFileSync(companiesIndexPath, "utf8"),
  ) as CompaniesIndex;

  // Hard-fail if TR enrichment is missing on almost every entry: without
  // tr.uic the join key is gone and the cross-reference would silently
  // collapse to empty — the "TR refresh wasn't run" failure mode.
  const withUic = idx.companies.filter((c) => c.tr?.uic).length;
  if (withUic < idx.companies.length * 0.1) {
    throw new Error(
      `companies-index.json has only ${withUic}/${idx.companies.length} entries ` +
        `with tr.uic — Commerce Registry enrichment looks missing; run ` +
        `/update-connections before re-running the funds cross-reference`,
    );
  }

  const byEik = new Map<string, MpLinkage[]>();
  for (const company of idx.companies) {
    const uic = company.tr?.uic;
    if (!uic) continue;
    const perMp = new Map<number, MpLinkage>();

    for (const role of company.mpRoles ?? []) {
      let linkage = perMp.get(role.mpId);
      if (!linkage) {
        linkage = { mpId: role.mpId, mpName: role.mpName, relations: [] };
        perMp.set(role.mpId, linkage);
      }
      linkage.relations.push({
        kind: role.role,
        isCurrent: role.isCurrent,
        confidence: role.confidence,
      });
    }

    // Keep only the latest stake filing per MP — older years are year-by-year
    // re-declarations of the same ownership.
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
        linkage = { mpId, mpName: s.declarantName, relations: [] };
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

    if (perMp.size > 0) byEik.set(uic, [...perMp.values()]);
  }

  return {
    byEik,
    totalCompanies: idx.companies.length,
    companiesWithUic: withUic,
  };
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
};
