/**
 * Municipality-grain rollup of "Companies HQ'd here (MP-linked)" — groups
 * every company in companies-index.json by the obshtina that contains its
 * settlement, so the tile can show "X companies HQ'd anywhere in this
 * муниципалитет" on муни pages (`/settlement/{obshtinaId}` for non-Sofia).
 *
 * Identical output shape to companies-by-ekatte (so the same data hook +
 * tile component handle both), just keyed by obshtina code instead of EKATTE:
 *
 *   data/parliament/companies-by-obshtina/
 *     index.json
 *     {obshtinaId}-summary.json   — top-5 companies + count + mpCount
 *     {obshtinaId}-page-NNN.json  — paginated full list, 50 / page
 *
 * Sofia is intentionally not aggregated under a single SOF00 row — the city
 * already has its own /sofia tile keyed on the synthetic EKATTE 68134. The
 * 24 Sofia rayon obshtinas (S23xx/S24xx/S25xx) DO get their own muni shards
 * if any satellite-village companies land there; in practice this is rare
 * because Sofia HQs collapse to the city EKATTE before the lookup runs.
 */

import fs from "fs";
import path from "path";
import type {
  CompanyIndexEntry,
  CompanyIndexEntryMpRole,
  CompaniesIndexFile,
} from "../declarations/build_company_index";
import { SOFIA_EKATTE } from "../lib/oblast_names";

const PAGE_SIZE = 50;
const SUMMARY_TOP_N = 5;

type Settlement = {
  ekatte: string;
  obshtina?: string;
};

export type CompaniesByObshtinaIndexEntry = {
  count: number;
  mpCount: number;
  topMpIds: number[];
};

export type CompaniesByObshtinaIndexFile = {
  generatedAt: string;
  total: number;
  obshtinas: Record<string, CompaniesByObshtinaIndexEntry>;
};

export type CompaniesByObshtinaCompanyRow = {
  slug: string;
  displayName: string;
  registeredOffice: string | null;
  mps: Array<{
    mpId: number;
    mpName: string;
    role: string;
    isCurrent: boolean;
  }>;
};

export type CompaniesByObshtinaSummary = {
  obshtina: string;
  count: number;
  mpCount: number;
  totalPages: number;
  topCompanies: CompaniesByObshtinaCompanyRow[];
};

export type CompaniesByObshtinaPage = {
  obshtina: string;
  page: number;
  totalPages: number;
  count: number;
  companies: CompaniesByObshtinaCompanyRow[];
};

const toRow = (c: CompanyIndexEntry): CompaniesByObshtinaCompanyRow => {
  const allRoles: CompanyIndexEntryMpRole[] = [
    ...(c.mpRoles ?? []),
    ...(c.stakes ?? []).map<CompanyIndexEntryMpRole>((s) => ({
      mpId: s.mpId,
      mpName: s.declarantName,
      role: "declared_stake",
      isCurrent: true,
      confidence: "high",
    })),
  ];
  const seen = new Set<string>();
  const mps: CompaniesByObshtinaCompanyRow["mps"] = [];
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

const sortByImportance = (a: CompanyIndexEntry, b: CompanyIndexEntry) => {
  const am = (a.stakes?.length ?? 0) + (a.mpRoles?.length ?? 0);
  const bm = (b.stakes?.length ?? 0) + (b.mpRoles?.length ?? 0);
  if (bm !== am) return bm - am;
  return a.displayName.localeCompare(b.displayName, "bg", {
    sensitivity: "base",
  });
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

export type BuildCompaniesByObshtinaArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
};

export const buildCompaniesByObshtina = ({
  publicFolder,
  stringify,
}: BuildCompaniesByObshtinaArgs): void => {
  const indexPath = path.join(
    publicFolder,
    "parliament",
    "companies-index.json",
  );
  const settlementsPath = path.join(process.cwd(), "data", "settlements.json");
  if (!fs.existsSync(indexPath)) {
    console.warn(`[companies-by-obshtina] ${indexPath} not found — skipping`);
    return;
  }
  if (!fs.existsSync(settlementsPath)) {
    console.warn(
      `[companies-by-obshtina] ${settlementsPath} not found — skipping`,
    );
    return;
  }

  const file: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );
  const settlements: Settlement[] = JSON.parse(
    fs.readFileSync(settlementsPath, "utf-8"),
  );

  // EKATTE → obshtina. Multiple rows may share an EKATTE prefix (Sofia
  // rayons key `68134-NNNN`), but we never look those up by the bare 68134;
  // that one collapses to SOF00 via the special-case below.
  const obshtinaByEkatte = new Map<string, string>();
  for (const s of settlements) {
    if (s.obshtina) obshtinaByEkatte.set(s.ekatte, s.obshtina);
  }

  // Group entries by obshtina. A single company can have multiple ekatteHQ
  // entries (multi-office) — dedupe per-obshtina so it's not double-counted.
  const byObshtina = new Map<string, Map<string, CompanyIndexEntry>>();
  for (const c of file.companies) {
    if (
      !c.ekatteHQ ||
      c.ekatteHQ.length === 0 ||
      c.hqMatchQuality === "foreign" ||
      c.hqMatchQuality === "unresolved"
    ) {
      continue;
    }
    const obshtinas = new Set<string>();
    for (const ek of c.ekatteHQ) {
      // Sofia city collapses to /sofia and is not surfaced as a muni rollup.
      if (ek === SOFIA_EKATTE) continue;
      const obshtina = obshtinaByEkatte.get(ek);
      if (obshtina) obshtinas.add(obshtina);
    }
    for (const obshtina of obshtinas) {
      const bucket = byObshtina.get(obshtina) ?? new Map();
      bucket.set(c.slug, c);
      byObshtina.set(obshtina, bucket);
    }
  }

  const outDir = path.join(publicFolder, "parliament", "companies-by-obshtina");
  resetDir(outDir);

  const indexEntries: Record<string, CompaniesByObshtinaIndexEntry> = {};
  let totalCompaniesLinked = 0;

  for (const [obshtina, slugMap] of byObshtina) {
    const companies = [...slugMap.values()].sort(sortByImportance);

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

    const summary: CompaniesByObshtinaSummary = {
      obshtina,
      count: rows.length,
      mpCount: mpCompanyCount.size,
      totalPages,
      topCompanies: rows.slice(0, SUMMARY_TOP_N),
    };
    fs.writeFileSync(
      path.join(outDir, `${obshtina}-summary.json`),
      stringify(summary),
    );

    for (let p = 0; p < totalPages; p++) {
      const page: CompaniesByObshtinaPage = {
        obshtina,
        page: p + 1,
        totalPages,
        count: rows.length,
        companies: rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE),
      };
      const pageStr = String(p + 1).padStart(3, "0");
      fs.writeFileSync(
        path.join(outDir, `${obshtina}-page-${pageStr}.json`),
        stringify(page),
      );
    }

    indexEntries[obshtina] = {
      count: rows.length,
      mpCount: mpCompanyCount.size,
      topMpIds,
    };
    totalCompaniesLinked += rows.length;
  }

  const indexOut: CompaniesByObshtinaIndexFile = {
    generatedAt: new Date().toISOString(),
    total: totalCompaniesLinked,
    obshtinas: indexEntries,
  };
  fs.writeFileSync(path.join(outDir, "index.json"), stringify(indexOut));

  console.log(
    `[companies-by-obshtina] wrote ${Object.keys(indexEntries).length} obshtina(s), ` +
      `${totalCompaniesLinked} company-rows, ` +
      `${fs.readdirSync(outDir).length} files total`,
  );
};

// CLI entry — `tsx scripts/parliament/build_companies_by_obshtina.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  buildCompaniesByObshtina({
    publicFolder: path.join(process.cwd(), "data"),
    stringify: (o) => JSON.stringify(o, null, 2),
  });
}
