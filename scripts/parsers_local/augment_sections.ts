// Section-level aggregation for the council (ОС) ballot of a local cycle.
//
// Reads the ОС race folder from the extracted CSV bundle and produces, per
// OIK:
//   - council party vote totals (summed over every polling section) — this is
//     what backfills the per-município bundle's council `totalVotes` (the 2015
//     bundles ship 0 because the HTML summary page has no votes column), and
//     completes the council with parties that won votes but no seats.
//   - the per-section result rows (turnout + per-party votes) that become the
//     `data/<cycle>/sections/<obshtinaCode>.json` shards.
//
// Council valid-vote total per OIK = sum of every party's section votes, which
// equals the protocol "действителни гласове" (verified). That sum is the
// pctOfValid denominator.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { parseLocalVotes, parseVotesFile } from "./parse_local_votes";
import { parseLocalSections } from "./parse_local_sections";
import {
  parseLocalProtocolRows,
  calibrateRegOffset,
  resolveTurnout,
} from "./parse_local_protocols";
import { parseLocalParties } from "./parse_local_parties";
import { LocalSectionResult } from "./types";

export type PartyLegendEntry = {
  localPartyNum: number;
  localPartyName: string;
  primaryCanonicalId: string | null;
  memberCanonicalIds: string[];
  isIndependent: boolean;
};

export type SectionAggregation = {
  /** oikCode → (localPartyNum → summed council valid votes). */
  councilVotesByOik: Map<string, Map<number, number>>;
  /** oikCode → total council valid votes (Σ all parties = действителни). */
  validTotalByOik: Map<string, number>;
  /** oikCode → summed protocol turnout. */
  protocolByOik: Map<
    string,
    { numRegisteredVoters: number; totalActualVoters: number }
  >;
  /** oikCode → party legend (name + canonical) for the council ballot. */
  partyLegendByOik: Map<string, Map<number, PartyLegendEntry>>;
  /** oikCode → per-section council results. */
  sectionsByOik: Map<string, LocalSectionResult[]>;
  /** sectionCode → КО (município/city mayor) votes, descending. */
  mayorVotesBySection: Map<string, { localPartyNum: number; votes: number }[]>;
  /** sectionCode → КР (район mayor) votes, descending. */
  rayonMayorVotesBySection: Map<
    string,
    { localPartyNum: number; votes: number }[]
  >;
};

const emptyAggregation = (): SectionAggregation => ({
  councilVotesByOik: new Map(),
  validTotalByOik: new Map(),
  protocolByOik: new Map(),
  partyLegendByOik: new Map(),
  sectionsByOik: new Map(),
  mayorVotesBySection: new Map(),
  rayonMayorVotesBySection: new Map(),
});

// Per-section vote map for a mayor race folder (КО município mayor / КР район
// mayor), keyed by 9-digit section code, each candidate-list's votes summed and
// sorted descending. Reuses the same row decoding as the council ballot.
//
// A race folder can carry MULTIPLE dated votes files — an original tabulation
// (`votes_29.10.2023.txt`, full coverage) plus a later partial re-count
// (`votes_16.03.2024.txt`, one re-tabulated município). We merge all of them in
// date order, a later file OVERRIDING a section it re-counts, so coverage stays
// complete and the official correction wins. (resolveRaceFile picks only one
// file — and sorts the 1-município re-count first — which is why a naive read
// dropped every other place's mayor votes.)
//
// Empty when the folder/votes files are absent (HTML-only cycles, older bundles
// without that race) — callers treat that as "no data".
const dateKey = (file: string): string => {
  const m = file.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}${m[2]}${m[1]}` : "00000000";
};

const aggregateMayorVotesBySection = async (
  folder: string,
): Promise<Map<string, { localPartyNum: number; votes: number }[]>> => {
  if (!fs.existsSync(folder)) return new Map();
  const files = fs
    .readdirSync(folder)
    .filter((f) => /^votes(_.*)?\.txt$/i.test(f))
    .sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  const bySection = new Map<string, Map<number, number>>();
  for (const file of files) {
    const rows = await parseVotesFile(path.join(folder, file));
    // Group this file's rows by section, then overwrite the merged map per
    // section (a re-count replaces, never adds to, the earlier tabulation).
    const fileSections = new Map<string, Map<number, number>>();
    for (const v of rows) {
      let m = fileSections.get(v.sectionCode);
      if (!m) {
        m = new Map();
        fileSections.set(v.sectionCode, m);
      }
      m.set(v.localPartyNum, (m.get(v.localPartyNum) ?? 0) + v.validVotes);
    }
    for (const [sectionCode, perParty] of fileSections.entries()) {
      bySection.set(sectionCode, perParty);
    }
  }
  const out = new Map<string, { localPartyNum: number; votes: number }[]>();
  for (const [sectionCode, perParty] of bySection.entries()) {
    out.set(
      sectionCode,
      Array.from(perParty.entries())
        .map(([localPartyNum, votes]) => ({ localPartyNum, votes }))
        .sort((a, b) => b.votes - a.votes),
    );
  }
  return out;
};

export const aggregateSections = async (opts: {
  rawFolder: string;
  canonical: CanonicalPartiesIndex | undefined;
}): Promise<SectionAggregation | null> => {
  const osFolder = path.join(opts.rawFolder, "ТУР1", "ОС");
  const koFolder = path.join(opts.rawFolder, "ТУР1", "КО");
  const krFolder = path.join(opts.rawFolder, "ТУР1", "КР");
  const [votes, sections, protocolRows, partiesResult, mayorBySec, rayonBySec] =
    await Promise.all([
      parseLocalVotes(osFolder),
      parseLocalSections(osFolder),
      parseLocalProtocolRows(osFolder),
      parseLocalParties(osFolder, opts.canonical),
      aggregateMayorVotesBySection(koFolder),
      aggregateMayorVotesBySection(krFolder),
    ]);
  if (votes.length === 0) return null;

  const agg = emptyAggregation();
  agg.mayorVotesBySection = mayorBySec;
  agg.rayonMayorVotesBySection = rayonBySec;

  // 1. Per-section party votes + per-OIK rollups.
  const sectionPartyVotes = new Map<string, Map<number, number>>();
  const sectionOik = new Map<string, string>();
  for (const v of votes) {
    sectionOik.set(v.sectionCode, v.oikCode);
    let perSection = sectionPartyVotes.get(v.sectionCode);
    if (!perSection) {
      perSection = new Map();
      sectionPartyVotes.set(v.sectionCode, perSection);
    }
    perSection.set(
      v.localPartyNum,
      (perSection.get(v.localPartyNum) ?? 0) + v.validVotes,
    );

    let perOik = agg.councilVotesByOik.get(v.oikCode);
    if (!perOik) {
      perOik = new Map();
      agg.councilVotesByOik.set(v.oikCode, perOik);
    }
    perOik.set(
      v.localPartyNum,
      (perOik.get(v.localPartyNum) ?? 0) + v.validVotes,
    );
    agg.validTotalByOik.set(
      v.oikCode,
      (agg.validTotalByOik.get(v.oikCode) ?? 0) + v.validVotes,
    );
  }

  // Valid (действителни) votes per section = Σ party votes — the ground-truth
  // arbiter for resolving the ambiguous protocol turnout columns below.
  const validBySection = new Map<string, number>();
  for (const [sectionCode, partyVotes] of sectionPartyVotes.entries()) {
    let v = 0;
    for (const n of partyVotes.values()) v += n;
    validBySection.set(sectionCode, v);
  }

  // 2. Party legend per OIK.
  for (const p of partiesResult.parties) {
    let legend = agg.partyLegendByOik.get(p.oikCode);
    if (!legend) {
      legend = new Map();
      agg.partyLegendByOik.set(p.oikCode, legend);
    }
    if (!legend.has(p.localPartyNum)) {
      legend.set(p.localPartyNum, {
        localPartyNum: p.localPartyNum,
        localPartyName: p.localPartyName,
        primaryCanonicalId: p.primaryCanonicalId,
        memberCanonicalIds: p.memberCanonicalIds,
        isIndependent: p.isIndependent,
      });
    }
  }

  // 3. Protocol turnout per section (registered + actual voters), resolved
  // against the section's valid total, then rolled up per OIK.
  const protocolBySection = new Map<
    string,
    { numRegisteredVoters: number; totalActualVoters: number }
  >();
  const regOff = calibrateRegOffset(protocolRows, validBySection);
  for (const pr of protocolRows) {
    const resolved = resolveTurnout(
      pr.fields,
      pr.serialsIdx,
      validBySection.get(pr.sectionCode) ?? 0,
      regOff,
    );
    protocolBySection.set(pr.sectionCode, resolved);
    const cur = agg.protocolByOik.get(pr.oikCode) ?? {
      numRegisteredVoters: 0,
      totalActualVoters: 0,
    };
    cur.numRegisteredVoters += resolved.numRegisteredVoters;
    cur.totalActualVoters += resolved.totalActualVoters;
    agg.protocolByOik.set(pr.oikCode, cur);
  }

  // 4. Per-section result rows.
  const sectionMeta = new Map(sections.map((s) => [s.sectionCode, s]));
  for (const [sectionCode, partyVotes] of sectionPartyVotes.entries()) {
    const oikCode = sectionOik.get(sectionCode) ?? "";
    const meta = sectionMeta.get(sectionCode);
    const proto = protocolBySection.get(sectionCode);
    const numValidVotes = Array.from(partyVotes.values()).reduce(
      (a, b) => a + b,
      0,
    );
    const mayorVotes = agg.mayorVotesBySection.get(sectionCode);
    const rayonMayorVotes = agg.rayonMayorVotesBySection.get(sectionCode);
    const row: LocalSectionResult = {
      sectionCode,
      settlement: meta?.settlement ?? "",
      ekatte: meta?.ekatte ?? "",
      isMobile: meta?.isMobile ?? false,
      numRegisteredVoters: proto?.numRegisteredVoters ?? 0,
      totalActualVoters: proto?.totalActualVoters ?? 0,
      numValidVotes,
      partyVotes: Array.from(partyVotes.entries())
        .map(([localPartyNum, votes]) => ({ localPartyNum, votes }))
        .sort((a, b) => b.votes - a.votes),
      ...(mayorVotes && mayorVotes.length > 0
        ? {
            mayorVotes,
            mayorValid: mayorVotes.reduce((a, v) => a + v.votes, 0),
          }
        : {}),
      ...(rayonMayorVotes && rayonMayorVotes.length > 0
        ? {
            rayonMayorVotes,
            rayonMayorValid: rayonMayorVotes.reduce((a, v) => a + v.votes, 0),
          }
        : {}),
    };
    let list = agg.sectionsByOik.get(oikCode);
    if (!list) {
      list = [];
      agg.sectionsByOik.set(oikCode, list);
    }
    list.push(row);
  }
  for (const list of agg.sectionsByOik.values()) {
    list.sort((a, b) => a.sectionCode.localeCompare(b.sectionCode));
  }

  return agg;
};
