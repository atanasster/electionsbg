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
import type { Contract, MpCompanyRelation, MpConnectedFile } from "./types";
import { canonicalJson } from "./validate";

// Same fixed-rate table as src/screens/components/candidates/procurement/
// formatAmount.ts — duplicated here because the pipeline does aggregation
// in absolute EUR before serialization, while the SPA does only display
// conversion. Keep these two tables in sync.
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1,
  BGN: 1 / 1.95583,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.05,
};

const toEur = (amount: number, currency: string | undefined): number => {
  if (!amount || amount <= 0 || !currency) return 0;
  const rate = EUR_PER_UNIT[currency];
  if (rate === undefined) return 0;
  return amount * rate;
};

// Top-N cap per category in each per-NS file. Keeps file size predictable
// (top 50 × ~150 bytes/row ≈ 7.5 KB per category).
const TOP_N = 50;

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
    // MP-connected slice
    mpCount: number;
    mpConnectedContractorCount: number;
    mpConnectedTotalEur: number;
  };
  topContractors: NsTopContractor[];
  topAwarders: NsTopAwarder[];
  topMps: NsTopMp[];
}

interface BuildOpts {
  contractsDir: string; // data/procurement/contracts
  mpConnected: MpConnectedFile;
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
}

const newAccum = (): Accum => ({
  contracts: 0,
  amendments: 0,
  awards: 0,
  byContractor: new Map(),
  byAwarder: new Map(),
  byMp: new Map(),
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
        const eur = toEur(r.amount ?? 0, r.currency);
        if (eur <= 0) continue;
        for (const range of ranges) {
          if (!inRange(r.date, range.start, range.end)) continue;
          const acc = out.get(range.electionDate);
          if (!acc) continue;
          if (r.tag === "contract") acc.contracts++;
          else if (r.tag === "contractAmendment") acc.amendments++;
          else if (r.tag === "award") acc.awards++;
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
        .sort((a, b) => b.eur - a.eur)
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
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, TOP_N);

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
  const accums = accumulate(opts.contractsDir, ranges, eikToMps);
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
      .sort((a, b) => b.totalEur - a.totalEur)
      .slice(0, TOP_N);
    const topAwarders: NsTopAwarder[] = [...acc.byAwarder.entries()]
      .map(([eik, v]) => ({
        eik,
        name: v.name,
        totalEur: v.eur,
        contractCount: v.count,
      }))
      .sort((a, b) => b.totalEur - a.totalEur)
      .slice(0, TOP_N);
    const topMps = materialiseTopMps(acc, linkConfidence);
    const totalEur = [...acc.byContractor.values()].reduce(
      (s, v) => s + v.eur,
      0,
    );
    // MP-connected totals derived from the accumulator (date-correct), not
    // from the top-N slice (which can miss MP-tied contractors outside the
    // top-50). Walk byContractor for every EIK that has an MP linkage.
    let mpConnectedTotalEur = 0;
    let mpConnectedContractorCount = 0;
    for (const [eik, v] of acc.byContractor) {
      if (!mpTiedEiks.has(eik)) continue;
      mpConnectedTotalEur += v.eur;
      mpConnectedContractorCount += 1;
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
      },
      topContractors,
      topAwarders,
      topMps,
    };
    fs.writeFileSync(
      path.join(opts.outDir, `${range.electionDate}.json`),
      canonicalJson(file),
    );
    filesWritten++;
  }
  return { files: filesWritten, ranges };
};
