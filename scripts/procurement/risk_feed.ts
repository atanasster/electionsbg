// Slim national red-flag feed for the /procurement/flags page + the
// procurementRedFlags AI tool. Pre-selects the top-N rows of each signal from
// the already-built derived files so the page loads ~8 KB instead of the full
// awarder_concentration.json (≈1 MB) + mp_connected.json. Debarred stays on its
// own tiny file (4 KB, shared with the risk scorer).

import fs from "fs";
import path from "path";
import type { AwarderConcentrationFile, MpConnectedFile } from "./types";
import type { PepConnectedFile } from "./pep_connected";
import { canonicalJson } from "./validate";
import { ekatteToNuts3 } from "./resolve_ekatte";

const TOP_N = 50;

export interface RiskFeedConcentration {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  sharePct: number;
  pairTotalEur: number;
}

export interface RiskFeedMpTied {
  mpId: number;
  mpName: string;
  contractorEik: string;
  contractorName: string;
  totalEur: number;
}

export interface RiskFeedFile {
  generatedAt: string;
  topConcentration: RiskFeedConcentration[];
  topMpTied: RiskFeedMpTied[];
  /** Full count of flagged single-supplier pairs (page shows only the top N) —
   *  so the UI can say "top 20 of 2,378" instead of implying these are all. */
  concentrationTotal: number;
  /** Of concentrationTotal, how many are at 100% share (one supplier took the
   *  buyer's entire lifetime spend). Headline severity number. */
  concentration100Total: number;
  /** Full count of MP↔contractor pairs behind the top-N list. */
  mpTiedTotal: number;
  /** Distinct political-class people (MPs + non-MP officials) with at least one
   *  procurement-connected company — the universe the /procurement/people
   *  scanner lets the reader search. */
  connectedPeopleTotal: number;
  /** Concentration flags per buyer oblast (NUTS3), sorted desc — drives the
   *  flags-by-region tile-map. Keyed on the buyer's resolved seat. */
  concentrationByOblast: Array<{ nuts: string; count: number }>;
  /** Concentration flags whose buyer has no single resolved oblast (central
   *  ministries/agencies, or unresolved geo) — shown as a separate bucket so
   *  the map doesn't silently drop ~half the universe. */
  concentrationNationalCount: number;
}

// Buyer EIK → NUTS3 of its seat. Two sources, fill-missing in this order:
//   1. buyer_oblast_map.json — the tenders-feed modal oblast (built by
//      build_tender_oblast_map.ts). Place-of-performance, always wins.
//   2. the awarder rollup's resolved geo (geo.ekatte → NUTS3) — the geo
//      fallback for LOCAL buyers (schools, kindergartens, hospitals, regional
//      directorates, …) that never surface in the tenders feed and would
//      otherwise be dumped into the "national" bucket despite having a concrete
//      seat. Gated on geo.isLocalHQ so central ministries/agencies — whose HQ
//      resolves to Sofia but whose procurement is genuinely national — correctly
//      stay national.
// Both feeds read the same files for buildRiskFeed + buildConcentrationFull, so
// the merged map is memoised per derivedDir.
const oblastMapCache = new Map<string, Map<string, string>>();
const loadOblastByEik = (derivedDir: string): Map<string, string> => {
  const memo = oblastMapCache.get(derivedDir);
  if (memo) return memo;
  const out = new Map<string, string>();

  const p = path.join(derivedDir, "buyer_oblast_map.json");
  if (fs.existsSync(p)) {
    const m = JSON.parse(fs.readFileSync(p, "utf8")) as {
      awarders?: Record<string, { nuts?: string }>;
    };
    for (const [eik, v] of Object.entries(m.awarders ?? {})) {
      if (v?.nuts) out.set(eik, v.nuts);
    }
  }

  // Geo fallback — only fills buyers the tenders feed missed.
  const awardersDir = path.join(path.dirname(derivedDir), "awarders");
  if (fs.existsSync(awardersDir)) {
    for (const f of fs.readdirSync(awardersDir)) {
      if (!f.endsWith(".json")) continue;
      const eik = f.slice(0, -5);
      if (out.has(eik)) continue;
      let geo: { ekatte?: string; isLocalHQ?: boolean } | undefined;
      try {
        geo = (
          JSON.parse(fs.readFileSync(path.join(awardersDir, f), "utf8")) as {
            geo?: { ekatte?: string; isLocalHQ?: boolean };
          }
        ).geo;
      } catch {
        continue;
      }
      if (geo?.isLocalHQ && geo.ekatte) {
        const nuts = ekatteToNuts3(geo.ekatte);
        if (nuts) out.set(eik, nuts);
      }
    }
  }

  oblastMapCache.set(derivedDir, out);
  return out;
};

export const buildRiskFeed = (derivedDir: string): RiskFeedFile => {
  const concPath = path.join(derivedDir, "awarder_concentration.json");
  const mpPath = path.join(derivedDir, "mp_connected.json");
  const pepPath = path.join(derivedDir, "pep_connected.json");

  const conc: AwarderConcentrationFile = fs.existsSync(concPath)
    ? JSON.parse(fs.readFileSync(concPath, "utf8"))
    : { entries: [] as AwarderConcentrationFile["entries"] };
  const mp: MpConnectedFile = fs.existsSync(mpPath)
    ? JSON.parse(fs.readFileSync(mpPath, "utf8"))
    : { entries: [] as MpConnectedFile["entries"] };
  const pep: PepConnectedFile | null = fs.existsSync(pepPath)
    ? JSON.parse(fs.readFileSync(pepPath, "utf8"))
    : null;

  const topConcentration: RiskFeedConcentration[] = [...conc.entries]
    .sort((a, b) => b.sharePct - a.sharePct)
    .slice(0, TOP_N)
    .map((e) => ({
      awarderEik: e.awarderEik,
      awarderName: e.awarderName,
      contractorEik: e.contractorEik,
      contractorName: e.contractorName,
      sharePct: e.sharePct,
      pairTotalEur: e.pairTotalEur,
    }));

  const topMpTied: RiskFeedMpTied[] = [...mp.entries]
    .filter((e) => e.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, TOP_N)
    .map((e) => ({
      mpId: e.mpId,
      mpName: e.mpName,
      contractorEik: e.contractorEik,
      contractorName: e.contractorName,
      totalEur: e.totalEur,
    }));

  // Distinct people behind the connected-contractor universe: MP ids from
  // mp_connected + official slugs from pep_connected (HIGH-confidence only).
  const peopleKeys = new Set<string>();
  for (const e of mp.entries) peopleKeys.add(`mp:${e.mpId}`);
  for (const e of pep?.entries ?? []) peopleKeys.add(`of:${e.slug}`);

  // Per-oblast concentration tally for the flags-by-region tile-map.
  const oblastByEik = loadOblastByEik(derivedDir);
  const byOblast = new Map<string, number>();
  let nationalCount = 0;
  let at100 = 0;
  for (const e of conc.entries) {
    if (e.sharePct >= 0.9999) at100 += 1;
    const nuts = oblastByEik.get(e.awarderEik);
    if (nuts) byOblast.set(nuts, (byOblast.get(nuts) ?? 0) + 1);
    else nationalCount += 1;
  }
  const concentrationByOblast = [...byOblast.entries()]
    .map(([nuts, count]) => ({ nuts, count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    topConcentration,
    topMpTied,
    concentrationTotal: conc.total ?? conc.entries.length,
    concentration100Total: at100,
    mpTiedTotal: mp.total ?? mp.entries.length,
    connectedPeopleTotal: peopleKeys.size,
    concentrationByOblast,
    concentrationNationalCount: nationalCount,
  };
};

export const writeRiskFeed = (derivedDir: string, data: RiskFeedFile): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "risk_feed.json"),
    canonicalJson(data),
  );
};

// Full single-supplier concentration list for the /procurement/concentration
// explorer — every flagged pair (not just the top-N feed), each tagged with the
// buyer's oblast (NUTS3) so the page can filter by region. Slimmed from
// awarder_concentration.json (drops nothing the table needs).
export interface ConcentrationFullRow {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  sharePct: number;
  pairTotalEur: number;
  awarderTotalEur: number;
  contractCount: number;
  /** Buyer seat NUTS3, or null for central/unresolved buyers. */
  oblast: string | null;
}

export interface ConcentrationFullFile {
  generatedAt: string;
  thresholdPct: number;
  minAwarderTotalEur: number;
  total: number;
  rows: ConcentrationFullRow[];
}

export const buildConcentrationFull = (
  derivedDir: string,
): ConcentrationFullFile => {
  const concPath = path.join(derivedDir, "awarder_concentration.json");
  const conc: AwarderConcentrationFile = fs.existsSync(concPath)
    ? JSON.parse(fs.readFileSync(concPath, "utf8"))
    : {
        generatedAt: new Date().toISOString(),
        thresholdPct: 0,
        minAwarderTotalEur: 0,
        total: 0,
        entries: [] as AwarderConcentrationFile["entries"],
      };
  const oblastByEik = loadOblastByEik(derivedDir);
  const rows: ConcentrationFullRow[] = [...conc.entries]
    .sort((a, b) => b.sharePct - a.sharePct || b.pairTotalEur - a.pairTotalEur)
    .map((e) => ({
      awarderEik: e.awarderEik,
      awarderName: e.awarderName,
      contractorEik: e.contractorEik,
      contractorName: e.contractorName,
      sharePct: e.sharePct,
      pairTotalEur: e.pairTotalEur,
      awarderTotalEur: e.awarderTotalEur,
      contractCount: e.contractCount,
      oblast: oblastByEik.get(e.awarderEik) ?? null,
    }));
  return {
    generatedAt: new Date().toISOString(),
    thresholdPct: conc.thresholdPct,
    minAwarderTotalEur: conc.minAwarderTotalEur,
    total: rows.length,
    rows,
  };
};

export const writeConcentrationFull = (
  derivedDir: string,
  data: ConcentrationFullFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "concentration_full.json"),
    canonicalJson(data),
  );
};

// Slim per-person procurement index for the /procurement/people scanner: one
// row per political-class person (MPs from mp_connected.json + non-MP officials
// from pep_connected.json) with the euro total + supplier/contract counts, so
// the scanner loads ~20 KB instead of the two full cross-reference files. Each
// row carries a `kind` discriminator + the fields needed to render + link:
// MPs drill into /candidate/mp-<id>/procurement, officials into /officials/<slug>.
export type PersonIndexRow = {
  kind: "mp" | "official";
  name: string;
  totalEur: number;
  contractorCount: number;
  contractCount: number;
  /** present when kind === "mp" */
  mpId?: number;
  /** present when kind === "official" */
  slug?: string;
  tier?: string;
  role?: string;
};

export interface PersonIndexFile {
  generatedAt: string;
  total: number;
  rows: PersonIndexRow[];
}

export const buildPersonIndex = (derivedDir: string): PersonIndexFile => {
  const mpPath = path.join(derivedDir, "mp_connected.json");
  const mp: MpConnectedFile = fs.existsSync(mpPath)
    ? JSON.parse(fs.readFileSync(mpPath, "utf8"))
    : { entries: [] as MpConnectedFile["entries"] };

  const rows: PersonIndexRow[] = [];

  // MPs — one row per mpId, summed across their connected contractors.
  const byMp = new Map<number, PersonIndexRow>();
  for (const e of mp.entries) {
    const row = byMp.get(e.mpId) ?? {
      kind: "mp",
      mpId: e.mpId,
      name: e.mpName,
      totalEur: 0,
      contractorCount: 0,
      contractCount: 0,
    };
    row.totalEur += e.totalEur;
    row.contractorCount += 1;
    row.contractCount += e.contractCount;
    byMp.set(e.mpId, row);
  }
  rows.push(...byMp.values());

  // Non-MP officials — one row per slug, summed across their connected
  // contractors (distinct contractor EIKs for the supplier count). pep_connected
  // is already gated to HIGH-confidence links only (see pep_connected.ts).
  const pepPath = path.join(derivedDir, "pep_connected.json");
  const pep: PepConnectedFile | null = fs.existsSync(pepPath)
    ? JSON.parse(fs.readFileSync(pepPath, "utf8"))
    : null;
  if (pep) {
    const bySlug = new Map<
      string,
      { row: PersonIndexRow; eiks: Set<string> }
    >();
    for (const e of pep.entries) {
      let acc = bySlug.get(e.slug);
      if (!acc) {
        acc = {
          row: {
            kind: "official",
            slug: e.slug,
            name: e.name,
            tier: e.tier,
            role: e.role,
            totalEur: 0,
            contractorCount: 0,
            contractCount: 0,
          },
          eiks: new Set<string>(),
        };
        bySlug.set(e.slug, acc);
      }
      acc.row.totalEur += e.totalEur;
      acc.row.contractCount += e.contractCount;
      acc.eiks.add(e.contractorEik);
    }
    for (const { row, eiks } of bySlug.values()) {
      row.contractorCount = eiks.size;
      rows.push(row);
    }
  }

  rows.sort((a, b) => b.totalEur - a.totalEur);
  return { generatedAt: new Date().toISOString(), total: rows.length, rows };
};

export const writePersonIndex = (
  derivedDir: string,
  data: PersonIndexFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "person_procurement_index.json"),
    canonicalJson(data),
  );
};
