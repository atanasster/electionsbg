/**
 * Per-settlement shards for the "Companies HQ'd here (MP-linked)" tile and
 * its paginated detail page. Reads the already-enriched companies-index.json
 * (which carries `ekatteHQ` after `enrichWithEkatteHQ` runs) and emits:
 *
 *   public/parliament/companies-by-ekatte/
 *     index.json              — { generatedAt, total, settlements: { [ekatte]: { count, topMpIds } } }
 *     {ekatte}-summary.json   — slim tile payload: top-5 companies + rollup
 *     {ekatte}-page-001.json  — full list, 50 companies / page (always ≥1 page)
 *     {ekatte}-page-NNN.json  — additional pages when count > 50
 *
 * Sofia city (EKATTE 68134) is the only setting that meaningfully paginates;
 * everyone else gets a single page file. Page size is conservative so the
 * Sofia detail page can load incrementally on mobile.
 *
 * Companies with `hqMatchQuality: "foreign"` or "unresolved" are skipped —
 * they're still in the master index, just not surfaced on a settlement page.
 */

import fs from "fs";
import path from "path";
import type {
  CompanyIndexEntry,
  CompanyIndexEntryMpRole,
  CompaniesIndexFile,
} from "../declarations/build_company_index";

const PAGE_SIZE = 50;
const SUMMARY_TOP_N = 5;

export type CompaniesByEkatteIndexEntry = {
  /** Distinct count of companies HQ'd at this EKATTE. */
  count: number;
  /** Distinct count of MPs across all stakes and TR roles. */
  mpCount: number;
  /** Up to 5 MP IDs ordered by # of linked companies, so the tile can pre-load
   * their avatars/colours when this settlement page renders. */
  topMpIds: number[];
};

export type CompaniesByEkatteIndexFile = {
  generatedAt: string;
  total: number;
  settlements: Record<string, CompaniesByEkatteIndexEntry>;
};

/** Slim company row used by both the summary and page shards. */
export type CompaniesByEkatteCompanyRow = {
  slug: string;
  displayName: string;
  registeredOffice: string | null;
  /** All distinct MPs linked to this company (via declared stake OR TR role).
   * Roles are deduplicated to (mpId, role) so a director-and-representative
   * MP shows as 2 chips, not 4. */
  mps: Array<{
    mpId: number;
    mpName: string;
    role: string;
    isCurrent: boolean;
  }>;
};

export type CompaniesByEkatteSummary = {
  ekatte: string;
  count: number;
  mpCount: number;
  totalPages: number;
  topCompanies: CompaniesByEkatteCompanyRow[];
};

export type CompaniesByEkattePage = {
  ekatte: string;
  page: number;
  totalPages: number;
  count: number;
  companies: CompaniesByEkatteCompanyRow[];
};

const toRow = (c: CompanyIndexEntry): CompaniesByEkatteCompanyRow => {
  const allRoles: CompanyIndexEntryMpRole[] = [
    ...(c.mpRoles ?? []),
    // Synthesise pseudo-roles for declared stakes so the tile shows the
    // owning MP even when the TR pass hasn't enriched the company.
    ...(c.stakes ?? []).map<CompanyIndexEntryMpRole>((s) => ({
      mpId: s.mpId,
      mpName: s.declarantName,
      role: "declared_stake",
      isCurrent: true,
      confidence: "high",
    })),
  ];
  const seen = new Set<string>();
  const mps: CompaniesByEkatteCompanyRow["mps"] = [];
  for (const r of allRoles) {
    const k = `${r.mpId}:${r.role}`;
    if (seen.has(k)) continue;
    seen.add(k);
    mps.push({
      mpId: r.mpId,
      mpName: r.mpName,
      role: r.role,
      isCurrent: r.isCurrent,
    });
  }
  return {
    slug: c.slug,
    displayName: c.displayName,
    registeredOffice: c.registeredOffices[0] ?? null,
    mps,
  };
};

/** Sort: most-MPs-first (most interesting tile rows). Ties by name asc. */
const sortByImportance = (a: CompanyIndexEntry, b: CompanyIndexEntry) => {
  const am = (a.stakes?.length ?? 0) + (a.mpRoles?.length ?? 0);
  const bm = (b.stakes?.length ?? 0) + (b.mpRoles?.length ?? 0);
  if (bm !== am) return bm - am;
  return a.displayName.localeCompare(b.displayName, "bg", {
    sensitivity: "base",
  });
};

export type BuildCompaniesBySettlementArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
};

const resetDir = (dir: string) => {
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, f));
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
};

export const buildCompaniesBySettlement = ({
  publicFolder,
  stringify,
}: BuildCompaniesBySettlementArgs): void => {
  const indexPath = path.join(
    publicFolder,
    "parliament",
    "companies-index.json",
  );
  if (!fs.existsSync(indexPath)) {
    console.warn(`[companies-by-ekatte] ${indexPath} not found — skipping`);
    return;
  }
  const file: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );

  const byEkatte = new Map<string, CompanyIndexEntry[]>();
  for (const c of file.companies) {
    if (
      !c.ekatteHQ ||
      c.ekatteHQ.length === 0 ||
      c.hqMatchQuality === "foreign" ||
      c.hqMatchQuality === "unresolved"
    ) {
      continue;
    }
    for (const ek of c.ekatteHQ) {
      const arr = byEkatte.get(ek) ?? [];
      arr.push(c);
      byEkatte.set(ek, arr);
    }
  }

  const outDir = path.join(publicFolder, "parliament", "companies-by-ekatte");
  resetDir(outDir);

  const indexEntries: Record<string, CompaniesByEkatteIndexEntry> = {};
  let totalCompaniesLinked = 0;

  for (const [ekatte, companies] of byEkatte) {
    companies.sort(sortByImportance);

    // Compute MP counts and topMpIds.
    const mpCompanyCount = new Map<number, number>();
    for (const c of companies) {
      const mpIds = new Set<number>();
      for (const r of c.mpRoles ?? []) mpIds.add(r.mpId);
      for (const s of c.stakes ?? []) mpIds.add(s.mpId);
      for (const id of mpIds) {
        mpCompanyCount.set(id, (mpCompanyCount.get(id) ?? 0) + 1);
      }
    }
    const topMpIds = [...mpCompanyCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const rows = companies.map(toRow);
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

    // Summary
    const summary: CompaniesByEkatteSummary = {
      ekatte,
      count: rows.length,
      mpCount: mpCompanyCount.size,
      totalPages,
      topCompanies: rows.slice(0, SUMMARY_TOP_N),
    };
    fs.writeFileSync(
      path.join(outDir, `${ekatte}-summary.json`),
      stringify(summary),
    );

    // Page shards
    for (let p = 0; p < totalPages; p++) {
      const page: CompaniesByEkattePage = {
        ekatte,
        page: p + 1,
        totalPages,
        count: rows.length,
        companies: rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE),
      };
      const pageStr = String(p + 1).padStart(3, "0");
      fs.writeFileSync(
        path.join(outDir, `${ekatte}-page-${pageStr}.json`),
        stringify(page),
      );
    }

    indexEntries[ekatte] = {
      count: rows.length,
      mpCount: mpCompanyCount.size,
      topMpIds,
    };
    totalCompaniesLinked += rows.length;
  }

  const indexOut: CompaniesByEkatteIndexFile = {
    generatedAt: new Date().toISOString(),
    total: totalCompaniesLinked,
    settlements: indexEntries,
  };
  fs.writeFileSync(path.join(outDir, "index.json"), stringify(indexOut));

  console.log(
    `[companies-by-ekatte] wrote ${Object.keys(indexEntries).length} settlement(s), ` +
      `${totalCompaniesLinked} company-rows, ` +
      `${fs.readdirSync(outDir).length} files total`,
  );
};

// CLI entry — `tsx scripts/parliament/build_companies_by_settlement.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  buildCompaniesBySettlement({
    publicFolder: path.join(process.cwd(), "public"),
    stringify: (o) => JSON.stringify(o, null, 2),
  });
}
