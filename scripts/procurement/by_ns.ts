// Per-election (per-NS) pre-aggregates. Each election in elections.json
// gets one output file at data/procurement/by_ns/<electionDate>.json
// containing:
//
//   - totals (corpus stats for the NS's date range)
//   - topContractors  (top N by EUR-converted total)
//   - topAwarders     (top N by EUR-converted total)
//   - topMps          (top N MPs by EUR-converted total of all their
//                       connected contracts during the period)
//
// "NS date range" = [electionDate, nextElectionDate) — start inclusive, end
// exclusive. The latest election has no upper bound (open-ended).
//
// Why pre-aggregate? Filtering 245k+ Contract rows client-side every time
// the operator switches elections would be wasteful + janky. The per-NS
// files are small (~30-60 KB each, 13 elections = <1 MB total) and load
// once via React Query.

import fs from "fs";
import path from "path";
import type {
  Contract,
  FlowFile,
  MpCompanyRelation,
  MpConnectedFile,
  SettlementProcurementIndex,
} from "./types";
import type { PepConnectedFile } from "./pep_connected";
import type {
  ConcentrationFullFile,
  RiskFeedFile,
  RiskFeedMpTied,
} from "./risk_feed";
import {
  assertFlowIntegrity,
  byCountDesc,
  byEurDesc,
  canonicalJson,
} from "./validate";
import { ekatteToNuts3 } from "./resolve_ekatte";
import { toEur } from "@/lib/currency";

// Top-N cap per category in each per-NS file. Keeps file size predictable
// (top 50 × ~150 bytes/row ≈ 7.5 KB per category).
const TOP_N = 50;

// Single-supplier concentration thresholds — mirror scripts/procurement/
// derived.ts (buildAwarderConcentration) so the per-NS concentration page reads
// the same bar as the corpus one: ≥30% of a buyer's in-range spend on one
// supplier, buyer in-range total ≥ €100k (below that any share is noise).
const CONCENTRATION_THRESHOLD = 0.3;
const CONCENTRATION_MIN_AWARDER_EUR = 100_000;

interface ElectionEntry {
  name: string; // "2026_04_19"
}

export interface NsRange {
  electionDate: string; // "2026_04_19"
  start: string; // ISO YYYY-MM-DD (inclusive)
  end: string | null; // ISO YYYY-MM-DD (exclusive), null = open-ended
}

const electionDate = (name: string): string =>
  // "2026_04_19" → "2026-04-19"
  name.replace(/_/g, "-");

// Derive the [start, end) range for each election. Input is the elections
// list newest-first (as it lives in src/data/json/elections.json); we walk
// it so each election's end is the next-newer election's start.
export const buildNsRanges = (elections: ElectionEntry[]): NsRange[] => {
  const sorted = [...elections].sort((a, b) => b.name.localeCompare(a.name));
  return sorted.map((e, i) => ({
    electionDate: e.name,
    start: electionDate(e.name),
    end: i === 0 ? null : electionDate(sorted[i - 1].name),
  }));
};

export interface NsTopContractor {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  mpTied: boolean;
  mpIds: number[];
}
export interface NsTopAwarder {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
}
export interface NsTopMp {
  mpId: number;
  mpName: string;
  totalEur: number;
  contractCount: number;
  contractorCount: number;
  // Top 3 contractor names — enough to identify "what this MP is connected
  // to" without fetching the per-MP file.
  topContractorNames: string[];
  // Worst confidence across the MP's contributing (mpId, EIK) links. "high"
  // only if every contributing link is high; otherwise "medium". Lets the UI
  // flag rows that rest on a name-match-only TR link so a reader can judge
  // whether the row needs verification.
  confidence: "high" | "medium";
}
export interface NsTopOfficial {
  slug: string;
  name: string;
  // Tier + canonical role from the officials declarations tree (e.g.
  // tier "municipal", role "mayor"). The UI maps role → a localized label.
  tier: string;
  role: string;
  totalEur: number;
  contractCount: number;
  contractorCount: number;
  // Top 3 contractor names for the preview label (same as NsTopMp).
  topContractorNames: string[];
}

// A stake relation is self-declared by the MP (sourced from register.cacbg.bg
// declarations), so it's the strongest possible signal — implicitly "high".
// TR-derived roles carry an explicit confidence from integrate.ts. Combine.
const computeLinkConfidence = (
  relations: MpCompanyRelation[],
): "high" | "medium" => {
  let best: "high" | "medium" = "medium";
  for (const r of relations) {
    if (r.kind === "stake") return "high";
    if (r.confidence === "high") best = "high";
  }
  return best;
};

export interface ProcurementByNs {
  electionDate: string; // "2026_04_19"
  start: string;
  end: string | null;
  generatedAt: string;
  totals: {
    contracts: number;
    amendments: number;
    awards: number;
    contractorCount: number;
    awarderCount: number;
    totalEur: number;
    // MP-connected slice.
    mpCount: number;
    mpConnectedContractorCount: number;
    mpConnectedTotalEur: number;
    // Officials-connected slice (cabinet, governors, mayors, councillors, …).
    officialCount: number;
    officialConnectedContractorCount: number;
    officialConnectedTotalEur: number;
    // Combined (MPs ∪ officials), de-duplicated by contractor EIK so a company
    // tied to both an MP and an official is counted once in the headline.
    connectedContractorCount: number;
    connectedTotalEur: number;
  };
  topContractors: NsTopContractor[];
  topAwarders: NsTopAwarder[];
  topMps: NsTopMp[];
  topOfficials: NsTopOfficial[];
}

interface BuildOpts {
  contractsDir: string; // data/procurement/contracts
  mpConnected: MpConnectedFile;
  pepConnected: PepConnectedFile;
  outDir: string; // data/procurement/by_ns
  elections: ElectionEntry[];
}

const inRange = (date: string, start: string, end: string | null): boolean => {
  if (date < start) return false;
  if (end !== null && date >= end) return false;
  return true;
};

interface Accum {
  contracts: number;
  amendments: number;
  awards: number;
  byContractor: Map<string, { name: string; eur: number; count: number }>;
  byAwarder: Map<string, { name: string; eur: number; count: number }>;
  // Per-MP totals computed from the same Contract walk as topContractors so
  // the two views agree exactly at NS boundaries. Aggregated by mpId via the
  // EIK→[mpId] map derived from mp_connected.json — one contract row can
  // contribute to multiple MPs if the contractor links to several.
  byMp: Map<
    number,
    {
      mpName: string;
      eur: number;
      count: number;
      contractorEiks: Set<string>;
      byContractor: Map<string, { name: string; eur: number }>;
    }
  >;
  // Per-official totals (slug → in-range euros + contributing contractors).
  // Mirrors byMp so the headline count and the topOfficials ranking are both
  // date-correct. name/tier/role are joined from officialMeta at materialise
  // time, so the accumulator stays keyed on slug only.
  byOfficial: Map<
    string,
    {
      eur: number;
      count: number;
      contractorEiks: Set<string>;
      byContractor: Map<string, { name: string; eur: number }>;
    }
  >;
  // awarder→contractor edges, kept ONLY for connected (MP- or official-tied)
  // contractors. Feeds the per-NS sankey's first column; restricting to
  // connected contractors keeps this tiny (a few hundred edges) vs. the full
  // awarder×contractor matrix. Keyed `${awarderEik}|${contractorEik}`.
  byConnectedEdge: Map<
    string,
    { awarderName: string; contractorName: string; eur: number }
  >;
  // Per-(awarder, contractor) in-range totals — the base for per-NS
  // single-supplier concentration. Tracks ALL pairs (not just connected), so it
  // is bounded by the in-range contract count (ranges are disjoint, so the
  // total across ranges ≈ the corpus contract count). awarderEik →
  // contractorEik → {name, eur, count}.
  byAwarderContractor: Map<
    string,
    Map<string, { name: string; eur: number; count: number }>
  >;
}

const newAccum = (): Accum => ({
  contracts: 0,
  amendments: 0,
  awards: 0,
  byContractor: new Map(),
  byAwarder: new Map(),
  byMp: new Map(),
  byOfficial: new Map(),
  byConnectedEdge: new Map(),
  byAwarderContractor: new Map(),
});

interface MpLink {
  mpId: number;
  mpName: string;
}

// Single-pass walk over all month-shards. For every Contract row we test it
// against every NS range and add to the matching accumulator. With 13 NS
// ranges × ~245k rows × 5 fields/row, this finishes in a couple of seconds.
const accumulate = (
  contractsDir: string,
  ranges: NsRange[],
  eikToMps: Map<string, MpLink[]>,
  eikToOfficials: Map<string, string[]>,
): Map<string, Accum> => {
  const out = new Map<string, Accum>();
  for (const r of ranges) out.set(r.electionDate, newAccum());
  if (!fs.existsSync(contractsDir)) return out;
  for (const year of fs.readdirSync(contractsDir).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(contractsDir, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const rows = JSON.parse(
        fs.readFileSync(path.join(yearDir, file), "utf8"),
      ) as Contract[];
      for (const r of rows) {
        // USD/GBP/CHF rows (toEur -> null) are excluded from these MP-focused
        // aggregates — negligible volume, not worth approximate-rate noise.
        const eur = toEur(r.amount, r.currency);
        if (eur == null || eur <= 0) continue;
        for (const range of ranges) {
          if (!inRange(r.date, range.start, range.end)) continue;
          const acc = out.get(range.electionDate);
          if (!acc) continue;
          if (r.tag === "contract") acc.contracts++;
          else if (r.tag === "contractAmendment") acc.amendments++;
          else if (r.tag === "award") acc.awards++;
          // Amendments re-state an existing contract's value — exclude from the
          // money/count aggregates so they don't double-count (see rollups.ts).
          if (r.tag === "contractAmendment") continue;
          const ce = acc.byContractor.get(r.contractorEik) ?? {
            name: r.contractorName,
            eur: 0,
            count: 0,
          };
          ce.name = r.contractorName || ce.name;
          ce.eur += eur;
          ce.count += 1;
          acc.byContractor.set(r.contractorEik, ce);
          const ae = acc.byAwarder.get(r.awarderEik) ?? {
            name: r.awarderName,
            eur: 0,
            count: 0,
          };
          ae.name = r.awarderName || ae.name;
          ae.eur += eur;
          ae.count += 1;
          acc.byAwarder.set(r.awarderEik, ae);
          // Per-(awarder, contractor) total for the per-NS concentration flag.
          let acMap = acc.byAwarderContractor.get(r.awarderEik);
          if (!acMap) {
            acMap = new Map();
            acc.byAwarderContractor.set(r.awarderEik, acMap);
          }
          const ac = acMap.get(r.contractorEik) ?? {
            name: r.contractorName,
            eur: 0,
            count: 0,
          };
          ac.name = r.contractorName || ac.name;
          ac.eur += eur;
          ac.count += 1;
          acMap.set(r.contractorEik, ac);
          // awarder→contractor edge for the per-NS sankey — only when the
          // contractor is connected to an MP or an official (the only edges
          // the flow page renders).
          if (
            eikToMps.has(r.contractorEik) ||
            eikToOfficials.has(r.contractorEik)
          ) {
            const ekey = `${r.awarderEik}|${r.contractorEik}`;
            const ed = acc.byConnectedEdge.get(ekey) ?? {
              awarderName: r.awarderName,
              contractorName: r.contractorName,
              eur: 0,
            };
            ed.awarderName = r.awarderName || ed.awarderName;
            ed.contractorName = r.contractorName || ed.contractorName;
            ed.eur += eur;
            acc.byConnectedEdge.set(ekey, ed);
          }
          // Per-MP attribution: this contract row contributes to every MP
          // who has a linkage to this contractor.
          const mps = eikToMps.get(r.contractorEik);
          if (mps && mps.length > 0) {
            for (const mp of mps) {
              const mpAcc = acc.byMp.get(mp.mpId) ?? {
                mpName: mp.mpName,
                eur: 0,
                count: 0,
                contractorEiks: new Set<string>(),
                byContractor: new Map<string, { name: string; eur: number }>(),
              };
              mpAcc.mpName = mp.mpName || mpAcc.mpName;
              mpAcc.eur += eur;
              mpAcc.count += 1;
              mpAcc.contractorEiks.add(r.contractorEik);
              const bc = mpAcc.byContractor.get(r.contractorEik) ?? {
                name: r.contractorName,
                eur: 0,
              };
              bc.name = r.contractorName || bc.name;
              bc.eur += eur;
              mpAcc.byContractor.set(r.contractorEik, bc);
              acc.byMp.set(mp.mpId, mpAcc);
            }
          }
          // Per-official attribution: this contract row contributes to every
          // official tied to this contractor (same shape as the MP branch).
          const offs = eikToOfficials.get(r.contractorEik);
          if (offs && offs.length > 0) {
            for (const slug of offs) {
              const offAcc = acc.byOfficial.get(slug) ?? {
                eur: 0,
                count: 0,
                contractorEiks: new Set<string>(),
                byContractor: new Map<string, { name: string; eur: number }>(),
              };
              offAcc.eur += eur;
              offAcc.count += 1;
              offAcc.contractorEiks.add(r.contractorEik);
              const bc = offAcc.byContractor.get(r.contractorEik) ?? {
                name: r.contractorName,
                eur: 0,
              };
              bc.name = r.contractorName || bc.name;
              bc.eur += eur;
              offAcc.byContractor.set(r.contractorEik, bc);
              acc.byOfficial.set(slug, offAcc);
            }
          }
        }
      }
    }
  }
  return out;
};

// Materialise the per-MP totals from the date-filtered accumulator. Picks
// each MP's top 3 contractors (by EUR) for the preview label so the SPA can
// render "MP X · top: COMPANY A, COMPANY B" without a second fetch.
const materialiseTopMps = (
  acc: Accum,
  linkConfidence: Map<string, "high" | "medium">,
): NsTopMp[] =>
  [...acc.byMp.entries()]
    .map(([mpId, v]) => {
      const topContractorNames = [...v.byContractor.values()]
        .sort((a, b) => byEurDesc(a.eur, b.eur, a.name, b.name))
        .slice(0, 3)
        .map((c) => c.name);
      const eiks = [...v.byContractor.keys()];
      const allHigh = eiks.every(
        (eik) => linkConfidence.get(`${mpId}|${eik}`) === "high",
      );
      return {
        mpId,
        mpName: v.mpName,
        totalEur: v.eur,
        contractCount: v.count,
        contractorCount: v.contractorEiks.size,
        topContractorNames,
        confidence: (allHigh ? "high" : "medium") as "high" | "medium",
      };
    })
    .sort((a, b) =>
      byEurDesc(a.totalEur, b.totalEur, String(a.mpId), String(b.mpId)),
    )
    .slice(0, TOP_N);

// Materialise the per-official totals. Sibling of materialiseTopMps; name/
// tier/role are joined from officialMeta (officials carry no party/confidence
// dimension — every pep_connected link is already high-confidence-only).
const materialiseTopOfficials = (
  acc: Accum,
  officialMeta: Map<string, { name: string; tier: string; role: string }>,
): NsTopOfficial[] =>
  [...acc.byOfficial.entries()]
    .map(([slug, v]) => {
      const meta = officialMeta.get(slug);
      const topContractorNames = [...v.byContractor.values()]
        .sort((a, b) => byEurDesc(a.eur, b.eur, a.name, b.name))
        .slice(0, 3)
        .map((c) => c.name);
      return {
        slug,
        name: meta?.name ?? slug,
        tier: meta?.tier ?? "",
        role: meta?.role ?? "",
        totalEur: v.eur,
        contractCount: v.count,
        contractorCount: v.contractorEiks.size,
        topContractorNames,
      };
    })
    .sort((a, b) => byEurDesc(a.totalEur, b.totalEur, a.slug, b.slug))
    .slice(0, TOP_N);

// One row of the per-NS "public money scanner" index — the date-scoped sibling
// of risk_feed.ts's buildPersonIndex. Same shape the SPA's
// usePersonProcurementIndex hook expects, so it's a drop-in when scope === ns.
interface NsPersonRow {
  kind: "mp" | "official";
  name: string;
  totalEur: number;
  contractorCount: number;
  contractCount: number;
  mpId?: number;
  slug?: string;
  tier?: string;
  role?: string;
}

interface NsPeopleFile {
  generatedAt: string;
  total: number;
  rows: NsPersonRow[];
}

// Per-NS person index: every connected MP + official with their in-range
// totals (uncapped — the scanner is searchable). Mirrors buildPersonIndex but
// from the date-filtered accumulator.
const buildNsPeople = (
  acc: Accum,
  officialMeta: Map<string, { name: string; tier: string; role: string }>,
): NsPeopleFile => {
  const rows: NsPersonRow[] = [];
  for (const [mpId, v] of acc.byMp) {
    rows.push({
      kind: "mp",
      mpId,
      name: v.mpName,
      totalEur: v.eur,
      contractorCount: v.contractorEiks.size,
      contractCount: v.count,
    });
  }
  for (const [slug, v] of acc.byOfficial) {
    const meta = officialMeta.get(slug);
    rows.push({
      kind: "official",
      slug,
      name: meta?.name ?? slug,
      tier: meta?.tier ?? "",
      role: meta?.role ?? "",
      totalEur: v.eur,
      contractorCount: v.contractorEiks.size,
      contractCount: v.count,
    });
  }
  rows.sort((a, b) =>
    byEurDesc(
      a.totalEur,
      b.totalEur,
      a.slug ?? String(a.mpId),
      b.slug ?? String(b.mpId),
    ),
  );
  return { generatedAt: new Date().toISOString(), total: rows.length, rows };
};

// Per-NS sankey: awarder → contractor → {mp | official}, date-scoped. Mirrors
// derived.ts's buildFlow shape (same node ids/types) so the SPA's flow tile
// renders it unchanged. Edge values are in-range euros: awarder→contractor
// from byConnectedEdge, contractor→person from the per-person byContractor
// breakdown (each person edge carries the contractor's full in-range total,
// matching the corpus flow's "not split per MP" semantics).
const buildNsFlow = (
  acc: Accum,
  officialMeta: Map<string, { name: string; tier: string; role: string }>,
): FlowFile => {
  const nodes = new Map<string, FlowFile["nodes"][number]>();
  const links: FlowFile["links"] = [];
  for (const [key, v] of acc.byConnectedEdge) {
    if (v.eur <= 0) continue;
    const [awarderEik, contractorEik] = key.split("|");
    const an = `awarder:${awarderEik}`;
    const cn = `contractor:${contractorEik}`;
    nodes.set(an, { id: an, type: "awarder", label: v.awarderName });
    nodes.set(cn, { id: cn, type: "contractor", label: v.contractorName });
    links.push({ source: an, target: cn, valueEur: v.eur });
  }
  for (const [mpId, v] of acc.byMp) {
    const mn = `mp:${mpId}`;
    nodes.set(mn, { id: mn, type: "mp", label: v.mpName });
    for (const [eik, bc] of v.byContractor) {
      if (bc.eur <= 0) continue;
      const cn = `contractor:${eik}`;
      nodes.set(cn, { id: cn, type: "contractor", label: bc.name });
      links.push({ source: cn, target: mn, valueEur: bc.eur });
    }
  }
  for (const [slug, v] of acc.byOfficial) {
    const on = `official:${slug}`;
    const meta = officialMeta.get(slug);
    nodes.set(on, { id: on, type: "official", label: meta?.name ?? slug });
    for (const [eik, bc] of v.byContractor) {
      if (bc.eur <= 0) continue;
      const cn = `contractor:${eik}`;
      nodes.set(cn, { id: cn, type: "contractor", label: bc.name });
      links.push({ source: cn, target: on, valueEur: bc.eur });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    links,
  };
};

// Buyer EIK → NUTS3 of its seat, from derived/buyer_oblast_map.json (built by
// build_tender_oblast_map.ts). Mirrors risk_feed.ts's loader so the per-NS
// concentration rows + flags-by-region tally carry the same oblast tags. The
// geo fallback for local buyers the tenders feed misses is merged in below
// (buildByNs), reusing the awarderGeo map already loaded for the settlement
// index — keeping this loader a pure read of the tenders feed.
const loadOblastByEik = (oblastMapPath: string): Map<string, string> => {
  const out = new Map<string, string>();
  if (!fs.existsSync(oblastMapPath)) return out;
  const m = JSON.parse(fs.readFileSync(oblastMapPath, "utf8")) as {
    awarders?: Record<string, { nuts?: string }>;
  };
  for (const [eik, v] of Object.entries(m.awarders ?? {})) {
    if (v?.nuts) out.set(eik, v.nuts);
  }
  return out;
};

interface NsConcEntry {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  sharePct: number;
  pairTotalEur: number;
  awarderTotalEur: number;
  contractCount: number;
}

// Single-supplier concentration for one NS range: every (buyer, supplier) pair
// where the supplier took ≥30% of the buyer's in-range spend and the buyer's
// in-range total ≥ €100k. Sorted strongest-first.
const computeNsConcentration = (acc: Accum): NsConcEntry[] => {
  const entries: NsConcEntry[] = [];
  for (const [awarderEik, contractors] of acc.byAwarderContractor) {
    const aw = acc.byAwarder.get(awarderEik);
    const awarderTotal = aw?.eur ?? 0;
    if (awarderTotal < CONCENTRATION_MIN_AWARDER_EUR) continue;
    for (const [contractorEik, v] of contractors) {
      if (v.eur <= 0) continue;
      const sharePct = v.eur / awarderTotal;
      if (sharePct < CONCENTRATION_THRESHOLD) continue;
      entries.push({
        awarderEik,
        awarderName: aw?.name ?? "",
        contractorEik,
        contractorName: v.name,
        sharePct,
        pairTotalEur: v.eur,
        awarderTotalEur: awarderTotal,
        contractCount: v.count,
      });
    }
  }
  entries.sort(
    (a, b) => b.sharePct - a.sharePct || b.pairTotalEur - a.pairTotalEur,
  );
  return entries;
};

// Per-NS concentration_full sibling (drop-in for the /procurement/concentration
// table when scope === ns). Adds the buyer's oblast tag for the region filter.
const buildNsConcentrationFull = (
  entries: NsConcEntry[],
  oblastByEik: Map<string, string>,
): ConcentrationFullFile => ({
  generatedAt: new Date().toISOString(),
  thresholdPct: CONCENTRATION_THRESHOLD,
  minAwarderTotalEur: CONCENTRATION_MIN_AWARDER_EUR,
  total: entries.length,
  rows: entries.map((e) => ({
    awarderEik: e.awarderEik,
    awarderName: e.awarderName,
    contractorEik: e.contractorEik,
    contractorName: e.contractorName,
    sharePct: e.sharePct,
    pairTotalEur: e.pairTotalEur,
    awarderTotalEur: e.awarderTotalEur,
    contractCount: e.contractCount,
    oblast: oblastByEik.get(e.awarderEik) ?? null,
  })),
});

// Per-NS risk_feed sibling (drop-in for the /procurement/flags page when scope
// === ns). Built from the date-filtered accumulator: top concentration pairs,
// top MP-tied (contractor, MP) pairs, the headline counts, and the per-oblast
// concentration tally for the region tile-map. Debarred suppliers stay corpus
// (a "currently barred" register has no date dimension) — the page fetches them
// separately.
const buildNsRiskFeed = (
  acc: Accum,
  entries: NsConcEntry[],
  oblastByEik: Map<string, string>,
): RiskFeedFile => {
  const topConcentration = entries.slice(0, TOP_N).map((e) => ({
    awarderEik: e.awarderEik,
    awarderName: e.awarderName,
    contractorEik: e.contractorEik,
    contractorName: e.contractorName,
    sharePct: e.sharePct,
    pairTotalEur: e.pairTotalEur,
  }));
  // Flatten byMp → (MP, contractor) pairs, mirroring mp_connected's grain.
  const mpPairs: RiskFeedMpTied[] = [];
  for (const [mpId, v] of acc.byMp) {
    for (const [eik, bc] of v.byContractor) {
      if (bc.eur > 0)
        mpPairs.push({
          mpId,
          mpName: v.mpName,
          contractorEik: eik,
          contractorName: bc.name,
          totalEur: bc.eur,
        });
    }
  }
  mpPairs.sort((a, b) =>
    byEurDesc(
      a.totalEur,
      b.totalEur,
      `${a.mpId}:${a.contractorEik}`,
      `${b.mpId}:${b.contractorEik}`,
    ),
  );

  let at100 = 0;
  let nationalCount = 0;
  const byOblast = new Map<string, number>();
  for (const e of entries) {
    if (e.sharePct >= 0.9999) at100 += 1;
    const nuts = oblastByEik.get(e.awarderEik);
    if (nuts) byOblast.set(nuts, (byOblast.get(nuts) ?? 0) + 1);
    else nationalCount += 1;
  }
  const concentrationByOblast = [...byOblast.entries()]
    .map(([nuts, count]) => ({ nuts, count }))
    .sort((a, b) => byCountDesc(a.count, b.count, a.nuts, b.nuts));

  return {
    generatedAt: new Date().toISOString(),
    topConcentration,
    topMpTied: mpPairs.slice(0, TOP_N),
    concentrationTotal: entries.length,
    concentration100Total: at100,
    mpTiedTotal: mpPairs.length,
    connectedPeopleTotal: acc.byMp.size + acc.byOfficial.size,
    concentrationByOblast,
    concentrationNationalCount: nationalCount,
  };
};

// eik → resolved seat ({ekatte, isLocalHQ}) from the awarder rollups. Mirrors
// by_settlement.ts's geo join so the per-NS settlement index pins buyers the
// same way; awarders without geo are omitted (dropped, as in the corpus build).
// Reads every awarder rollup but keeps only the two slim fields, so memory stays
// bounded.
const loadAwarderGeo = (
  awardersDir: string,
): Map<string, { ekatte: string; isLocalHQ: boolean }> => {
  const out = new Map<string, { ekatte: string; isLocalHQ: boolean }>();
  if (!fs.existsSync(awardersDir)) return out;
  for (const file of fs.readdirSync(awardersDir)) {
    if (!file.endsWith(".json")) continue;
    const aw = JSON.parse(
      fs.readFileSync(path.join(awardersDir, file), "utf8"),
    ) as { eik: string; geo?: { ekatte: string; isLocalHQ: boolean } };
    if (aw.geo?.ekatte)
      out.set(aw.eik, {
        ekatte: aw.geo.ekatte,
        isLocalHQ: aw.geo.isLocalHQ,
      });
  }
  return out;
};

const loadEkatteCatalog = (
  ekattePath: string,
): Map<string, { name: string; province: string; obshtina: string }> => {
  const out = new Map<
    string,
    { name: string; province: string; obshtina: string }
  >();
  if (!fs.existsSync(ekattePath)) return out;
  const arr = JSON.parse(fs.readFileSync(ekattePath, "utf8")) as Array<{
    ekatte: string;
    name: string;
    province: string;
    obshtina: string;
  }>;
  for (const e of arr)
    out.set(e.ekatte, {
      name: e.name,
      province: e.province,
      obshtina: e.obshtina,
    });
  return out;
};

// Per-NS "procurement by settlement" landing index: local-tier buyers pinned to
// their seat EKATTE, central/national buyers rolled up separately — same split
// as the corpus by_settlement, but from in-range totals. The settlement *detail*
// drill-down stays corpus (a full settlement profile, no scope toggle), so only
// the index is sliced per parliament.
const buildNsBySettlement = (
  acc: Accum,
  awarderGeo: Map<string, { ekatte: string; isLocalHQ: boolean }>,
  ekByCode: Map<string, { name: string; province: string; obshtina: string }>,
): SettlementProcurementIndex => {
  const settlements = new Map<
    string,
    { eur: number; count: number; awarderEiks: Set<string> }
  >();
  let natEur = 0;
  let natCount = 0;
  const natAwarderEiks = new Set<string>();
  for (const [eik, v] of acc.byAwarder) {
    const geo = awarderGeo.get(eik);
    if (!geo) continue; // no resolved seat → dropped (matches corpus build)
    if (geo.isLocalHQ) {
      let s = settlements.get(geo.ekatte);
      if (!s) {
        s = { eur: 0, count: 0, awarderEiks: new Set<string>() };
        settlements.set(geo.ekatte, s);
      }
      s.eur += v.eur;
      s.count += v.count;
      s.awarderEiks.add(eik);
    } else {
      natEur += v.eur;
      natCount += v.count;
      natAwarderEiks.add(eik);
    }
  }
  const settlementsOut = [...settlements.entries()]
    .map(([ekatte, s]) => {
      const ek = ekByCode.get(ekatte);
      return {
        ekatte,
        name: ek?.name ?? "?",
        province: ek?.province ?? "?",
        obshtina: ek?.obshtina ?? "?",
        contractCount: s.count,
        totalEur: s.eur,
        awarderCount: s.awarderEiks.size,
      };
    })
    .sort((a, b) => byEurDesc(a.totalEur, b.totalEur, a.ekatte, b.ekatte));
  return {
    generatedAt: new Date().toISOString(),
    totalContracts: [...settlements.values()].reduce((s, a) => s + a.count, 0),
    totalEur: [...settlements.values()].reduce((s, a) => s + a.eur, 0),
    settlementCount: settlements.size,
    // awardCount/totalOther aren't rendered by the page; the per-NS walk drops
    // non-EUR rows, so totalOther is always empty here.
    national: {
      contractCount: natCount,
      awardCount: 0,
      totalEur: natEur,
      totalOther: {},
      awarderCount: natAwarderEiks.size,
    },
    settlements: settlementsOut,
  };
};

export const buildByNs = (
  opts: BuildOpts,
): { files: number; ranges: NsRange[] } => {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const ranges = buildNsRanges(opts.elections);
  // EIK → MPs map for per-row attribution during the corpus walk.
  const eikToMps = new Map<string, MpLink[]>();
  const mpTiedEiks = new Map<string, number[]>();
  // (mpId, EIK) → confidence ("high" if any stake or high-confidence TR role,
  // else medium). Used to downgrade a top-MP row that rests on a name-match-only
  // TR link, so the procurement UI can flag it.
  const linkConfidence = new Map<string, "high" | "medium">();
  for (const e of opts.mpConnected.entries) {
    const arr = eikToMps.get(e.contractorEik) ?? [];
    if (!arr.some((m) => m.mpId === e.mpId)) {
      arr.push({ mpId: e.mpId, mpName: e.mpName });
    }
    eikToMps.set(e.contractorEik, arr);
    const ids = mpTiedEiks.get(e.contractorEik) ?? [];
    if (!ids.includes(e.mpId)) ids.push(e.mpId);
    mpTiedEiks.set(e.contractorEik, ids);
    linkConfidence.set(
      `${e.mpId}|${e.contractorEik}`,
      computeLinkConfidence(e.relations),
    );
  }
  // EIK → official slugs (high-confidence officials, non-MP political class).
  // officialTiedEiks is the de-dup set used for the per-range total walk;
  // officialMeta carries name/tier/role for the topOfficials materialiser.
  const eikToOfficials = new Map<string, string[]>();
  const officialTiedEiks = new Set<string>();
  const officialMeta = new Map<
    string,
    { name: string; tier: string; role: string }
  >();
  for (const e of opts.pepConnected.entries) {
    officialTiedEiks.add(e.contractorEik);
    const arr = eikToOfficials.get(e.contractorEik) ?? [];
    if (!arr.includes(e.slug)) arr.push(e.slug);
    eikToOfficials.set(e.contractorEik, arr);
    if (!officialMeta.has(e.slug))
      officialMeta.set(e.slug, { name: e.name, tier: e.tier, role: e.role });
  }
  const accums = accumulate(
    opts.contractsDir,
    ranges,
    eikToMps,
    eikToOfficials,
  );
  // Per-NS flow + people shards live in their own subdirs so the lean landing
  // summary (by_ns/<date>.json) stays small; only the flow / scanner pages
  // fetch them, and only for the selected election.
  const flowDir = path.join(opts.outDir, "flow");
  const peopleDir = path.join(opts.outDir, "people");
  const concDir = path.join(opts.outDir, "concentration");
  const riskDir = path.join(opts.outDir, "risk_feed");
  const settlementDir = path.join(opts.outDir, "by_settlement");
  for (const d of [flowDir, peopleDir, concDir, riskDir, settlementDir])
    fs.mkdirSync(d, { recursive: true });
  // Buyer→oblast tags for the per-NS concentration rows + flags region map.
  const oblastByEik = loadOblastByEik(
    path.join(opts.outDir, "..", "derived", "buyer_oblast_map.json"),
  );
  // Buyer→seat (ekatte/isLocalHQ) + EKATTE catalog for the per-NS settlement
  // index. Loaded once (the rollup read is the expensive part).
  const awarderGeo = loadAwarderGeo(path.join(opts.outDir, "..", "awarders"));
  const ekByCode = loadEkatteCatalog(
    path.join(opts.outDir, "..", "..", "ekatte_index.json"),
  );
  // Geo fallback for the oblast tags: local-HQ buyers (schools, kindergartens,
  // hospitals, regional directorates, …) never surface in the tenders feed, so
  // without this they'd land in the "national" bucket despite a concrete seat.
  // Fill-missing only (a tenders modal oblast wins); central tiers stay national.
  for (const [eik, geo] of awarderGeo) {
    if (oblastByEik.has(eik) || !geo.isLocalHQ) continue;
    const nuts = ekatteToNuts3(geo.ekatte);
    if (nuts) oblastByEik.set(eik, nuts);
  }
  let filesWritten = 0;
  for (const range of ranges) {
    const acc = accums.get(range.electionDate);
    if (!acc) continue;
    const topContractors: NsTopContractor[] = [...acc.byContractor.entries()]
      .map(([eik, v]) => ({
        eik,
        name: v.name,
        totalEur: v.eur,
        contractCount: v.count,
        mpTied: mpTiedEiks.has(eik),
        mpIds: mpTiedEiks.get(eik) ?? [],
      }))
      .sort((a, b) => byEurDesc(a.totalEur, b.totalEur, a.eik, b.eik))
      .slice(0, TOP_N);
    const topAwarders: NsTopAwarder[] = [...acc.byAwarder.entries()]
      .map(([eik, v]) => ({
        eik,
        name: v.name,
        totalEur: v.eur,
        contractCount: v.count,
      }))
      .sort((a, b) => byEurDesc(a.totalEur, b.totalEur, a.eik, b.eik))
      .slice(0, TOP_N);
    const topMps = materialiseTopMps(acc, linkConfidence);
    const topOfficials = materialiseTopOfficials(acc, officialMeta);
    const totalEur = [...acc.byContractor.values()].reduce(
      (s, v) => s + v.eur,
      0,
    );
    // MP-connected totals derived from the accumulator (date-correct), not
    // from the top-N slice (which can miss MP-tied contractors outside the
    // top-50). Walk byContractor for every EIK that has an MP linkage.
    let mpConnectedTotalEur = 0;
    let mpConnectedContractorCount = 0;
    let officialConnectedTotalEur = 0;
    let officialConnectedContractorCount = 0;
    let connectedTotalEur = 0;
    let connectedContractorCount = 0;
    for (const [eik, v] of acc.byContractor) {
      const mp = mpTiedEiks.has(eik);
      const off = officialTiedEiks.has(eik);
      if (mp) {
        mpConnectedTotalEur += v.eur;
        mpConnectedContractorCount += 1;
      }
      if (off) {
        officialConnectedTotalEur += v.eur;
        officialConnectedContractorCount += 1;
      }
      // De-dup: a company tied to both an MP and an official counts once.
      if (mp || off) {
        connectedTotalEur += v.eur;
        connectedContractorCount += 1;
      }
    }
    const file: ProcurementByNs = {
      electionDate: range.electionDate,
      start: range.start,
      end: range.end,
      generatedAt: new Date().toISOString(),
      totals: {
        contracts: acc.contracts,
        amendments: acc.amendments,
        awards: acc.awards,
        contractorCount: acc.byContractor.size,
        awarderCount: acc.byAwarder.size,
        totalEur,
        mpCount: acc.byMp.size,
        mpConnectedContractorCount,
        mpConnectedTotalEur,
        officialCount: acc.byOfficial.size,
        officialConnectedContractorCount,
        officialConnectedTotalEur,
        connectedContractorCount,
        connectedTotalEur,
      },
      topContractors,
      topAwarders,
      topMps,
      topOfficials,
    };
    fs.writeFileSync(
      path.join(opts.outDir, `${range.electionDate}.json`),
      canonicalJson(file),
    );
    // Per-NS flow + people sidecars (date-scoped sankey + scanner index).
    const nsFlow = buildNsFlow(acc, officialMeta);
    assertFlowIntegrity(nsFlow, `by_ns/flow/${range.electionDate}.json`);
    fs.writeFileSync(
      path.join(flowDir, `${range.electionDate}.json`),
      canonicalJson(nsFlow),
    );
    fs.writeFileSync(
      path.join(peopleDir, `${range.electionDate}.json`),
      canonicalJson(buildNsPeople(acc, officialMeta)),
    );
    // Per-NS concentration table + red-flag feed (share the concentration base).
    const concEntries = computeNsConcentration(acc);
    fs.writeFileSync(
      path.join(concDir, `${range.electionDate}.json`),
      canonicalJson(buildNsConcentrationFull(concEntries, oblastByEik)),
    );
    fs.writeFileSync(
      path.join(riskDir, `${range.electionDate}.json`),
      canonicalJson(buildNsRiskFeed(acc, concEntries, oblastByEik)),
    );
    // Per-NS "procurement by settlement" landing index.
    fs.writeFileSync(
      path.join(settlementDir, `${range.electionDate}.json`),
      canonicalJson(buildNsBySettlement(acc, awarderGeo, ekByCode)),
    );
    filesWritten++;
  }
  return { files: filesWritten, ranges };
};
