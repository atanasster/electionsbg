// Rolling a round's sections up into the per-election tree.
//
// Output, per plan §3-3 — `data/<cycle>/tur1|tur2/`:
//
//     region_votes.json        oblast → Votes[]
//     municipality_votes.json  municipality → Votes[]
//     settlement_votes.json    ЕКАТТЕ → Votes[]
//     abroad.json              country → Votes[], plus the sections with no country
//     sections/<oblast>.json   the sections themselves, sharded by oblast
//     placement.json           what placed, what did not, and why
//
// ⚠⚠ THE THREE LEVELS DO NOT COVER THE SAME VOTES, AND EACH FILE SAYS SO. The oblast
// roll-up covers every section that placed; the municipality and settlement roll-ups
// cover only the ~87% whose ЕКАТТЕ the catalogue carries. Summing a settlement file and
// calling it a national total under-states by an eighth — so every file carries a
// `coverage` block naming its own basis, its own section count and its own vote total,
// and nothing here writes a bare array a consumer could sum without seeing them.
//
// ⚠ NOTHING IS DROPPED, AND THAT IS A CLAIM ABOUT THE WRITTEN TREE. A section placement
// refused keeps its full protocol and votes in `sections/_unplaced.json` and its total in
// `placement.json`; an abroad section with no country is written under the `""` key
// rather than discarded. Measured: 2011's refusals are 441,328 votes, 13.1% of round 1 —
// with only a code and a reason on the row, those votes appeared in no file at all,
// because every roll-up excludes them by design and nothing else named them.
//
// Plan: docs/plans/presidential-elections-v1.md T3.1.

import fs from "node:fs";
import path from "node:path";
import { placeRound, type PlaceBasis, type PlacementReport } from "./places";
import type { PresidentialRound, PresidentialSection } from "./types";
import type { Votes } from "@/data/dataTypes";

/**
 * Fold one section's votes into a bucket.
 *
 * ⚠ EVERY OPTIONAL COMPONENT IS SUMMED, INCLUDING `suemgVotes`. `Votes` carries four
 * numbers beside the total and folding only two silently drops the rest — the flash-memory
 * tally is absent from the presidential corpus today, so an omission here would be
 * invisible until the first cycle that has one, on a surface nobody would think to check.
 *
 * ⚠ ABSENT STAYS ABSENT. A component undefined on every section of a bucket must not
 * become 0 in the fold: „this era did not record a machine split" and „no vote was cast on
 * a machine" are different facts, and the three pre-2016 cycles rely on the first.
 */
const VOTE_PARTS = ["paperVotes", "machineVotes", "suemgVotes"] as const;

const addVotes = (into: Map<number, Votes>, votes: Votes[]): void => {
  for (const v of votes) {
    let cur = into.get(v.partyNum);
    if (!cur) {
      cur = { partyNum: v.partyNum, totalVotes: 0 };
      into.set(v.partyNum, cur);
    }
    cur.totalVotes += v.totalVotes;
    for (const part of VOTE_PARTS) {
      const add = v[part];
      if (add === undefined) continue;
      cur[part] = (cur[part] ?? 0) + add;
    }
  }
};

/** Ticket order, so a rebuild over the same input writes the same bytes. */
const sortedVotes = (m: Map<number, Votes>): Votes[] =>
  [...m.values()].sort((a, b) => a.partyNum - b.partyNum);

/**
 * What a roll-up covers, carried in the file itself.
 *
 * ⚠ THE POINT OF THIS BLOCK IS THAT THE LEVELS DIFFER. A settlement roll-up is missing
 * the eighth of sections whose ЕКАТТЕ the catalogue has no row for, so it is not a
 * national total and must not be summed as one. Naming the basis beside the numbers is
 * what stops a surface doing that by accident.
 */
export interface Coverage {
  /** How a section qualified for this file. */
  basis: string;
  /** Sections in it. */
  sections: number;
  /** Sections of the round that are NOT in it. */
  excludedSections: number;
  /** Votes in it. */
  votes: number;
  /** Votes of the round that are NOT in it. */
  excludedVotes: number;
}

/** The shard key for sections placement refused. Not an oblast. */
export const UNPLACED_SHARD = "_unplaced";

/**
 * A section as written into a shard.
 *
 * ⚠ THE PLACEMENT IS STAMPED ON, AND A REFUSED ЕКАТТЕ IS STRIPPED. Writing the section
 * verbatim re-published exactly what `places.ts` had refused: `с.Зверино` is in Враца and
 * its recorded ЕКАТТЕ 81414 resolves to Чирпан, Стара Загора, so the shard carried a code
 * this pipeline had already decided was wrong — under a filename saying Враца. A consumer
 * reading the shard would have had no way to know.
 */
export type ShardSection = Omit<PresidentialSection, "ekatte"> & {
  /** Only where placement accepted it. Absent on a prefix placement or a refusal. */
  ekatte?: string;
  /** Absent on a refusal. */
  oblast?: string;
  /** Only where the ЕКАТТЕ placed it. */
  obshtina?: string;
  /** How it was placed, or `null` when it was not. */
  placeBasis: PlaceBasis | null;
};

export interface Rollup<K extends string> {
  coverage: Coverage;
  entries: { key: K; results: { votes: Votes[] } }[];
}

/** Stamp a section with where it was placed, dropping a code placement overruled. */
const shardSection = (
  section: PresidentialSection,
  place: {
    ekatte?: string;
    obshtina?: string;
    oblast: string;
    basis: PlaceBasis;
  } | null,
): ShardSection => {
  const { ekatte: _sourceEkatte, ...rest } = section;
  return {
    ...rest,
    ...(place?.ekatte ? { ekatte: place.ekatte } : {}),
    ...(place?.obshtina ? { obshtina: place.obshtina } : {}),
    ...(place ? { oblast: place.oblast } : {}),
    placeBasis: place?.basis ?? null,
  };
};

const totalVotes = (sections: PresidentialSection[]): number =>
  sections.reduce(
    (a, s) => a + s.votes.reduce((b, v) => b + v.totalVotes, 0),
    0,
  );

export interface AggregatedRound {
  cycle: string;
  round: 1 | 2;
  date: string;
  regions: Rollup<string>;
  municipalities: Rollup<string>;
  settlements: Rollup<string>;
  abroad: {
    coverage: Coverage;
    /** Country id → votes. The `""` key holds the sections with no country. */
    entries: { key: string; results: { votes: Votes[] } }[];
  };
  /**
   * Section shards, keyed by the oblast they were placed in.
   *
   * ⚠ `UNPLACED_SHARD` is a key here too, holding the sections placement refused. They
   * are NOT in any roll-up and must never be summed into one — but their protocols and
   * votes are real and are written.
   */
  sectionsByOblast: Map<string, ShardSection[]>;
  placement: PlacementReport;
}

/**
 * Roll a round up to every level.
 *
 * @param round - A round as read by its era's reader.
 * @returns The roll-ups, the section shards and the placement report. Nothing is
 *   dropped; see the module banner.
 */
export const aggregateRound = (round: PresidentialRound): AggregatedRound => {
  const placed = placeRound(round);
  // ⚠ EVERY LOOKUP BELOW ASSUMES ONE SECTION PER CODE, and a duplicate would not throw:
  // the later row would win the map, the earlier one's votes would silently land in
  // `excludedVotes` with no `unplaced` entry naming them, and every coverage block would
  // still add up. The era readers each refuse a duplicate already; this is the assumption
  // stated where it is relied on.
  const byCode = new Map(round.sections.map((s) => [s.code, s]));
  if (byCode.size !== round.sections.length) {
    throw new Error(
      `aggregate: ${round.cycle} round ${round.round} has ` +
        `${round.sections.length - byCode.size} duplicate section code(s)`,
    );
  }

  const regions = new Map<string, Map<number, Votes>>();
  const municipalities = new Map<string, Map<number, Votes>>();
  const settlements = new Map<string, Map<number, Votes>>();
  const abroad = new Map<string, Map<number, Votes>>();
  const sectionsByOblast = new Map<string, ShardSection[]>();

  const inRegions: PresidentialSection[] = [];
  const inMunicipalities: PresidentialSection[] = [];
  const inSettlements: PresidentialSection[] = [];
  const inAbroad: PresidentialSection[] = [];

  const bucket = <K extends string>(
    m: Map<K, Map<number, Votes>>,
    key: K,
  ): Map<number, Votes> => {
    let b = m.get(key);
    if (!b) {
      b = new Map();
      m.set(key, b);
    }
    return b;
  };

  for (const [code, place] of placed.domestic) {
    const section = byCode.get(code)!;
    addVotes(bucket(regions, place.oblast), section.votes);
    inRegions.push(section);
    if (!sectionsByOblast.has(place.oblast))
      sectionsByOblast.set(place.oblast, []);
    // ⚠ The section's OWN `ekatte` is dropped and the PLACEMENT's is stamped on. They
    // differ exactly where placement overruled a code that named the wrong oblast, and
    // republishing the source's would put a code this pipeline rejected into a file named
    // after the oblast it rejected it for.
    sectionsByOblast.get(place.oblast)!.push(shardSection(section, place));
    // ⚠ ONLY AN ЕКАТТЕ PLACEMENT REACHES THESE TWO. A prefix placement knows an oblast
    // and nothing finer, so adding it to a municipality would put a village's votes in a
    // municipality on the strength of its neighbours — see `PlaceBasis`.
    if (place.obshtina) {
      addVotes(bucket(municipalities, place.obshtina), section.votes);
      inMunicipalities.push(section);
    }
    if (place.ekatte) {
      addVotes(bucket(settlements, place.ekatte), section.votes);
      inSettlements.push(section);
    }
  }

  // ⚠ REFUSED SECTIONS ARE WRITTEN, in their own shard. They are in no roll-up — that is
  // what the refusal means — so this file is the only place their protocols and votes
  // exist, and „nothing is dropped" is false without it.
  for (const u of placed.report.unplaced) {
    const section = byCode.get(u.code)!;
    if (!sectionsByOblast.has(UNPLACED_SHARD))
      sectionsByOblast.set(UNPLACED_SHARD, []);
    sectionsByOblast.get(UNPLACED_SHARD)!.push(shardSection(section, null));
  }

  for (const [code, where] of placed.abroad) {
    const section = byCode.get(code)!;
    // ⚠ `""`, not omission. A section whose country the corpus cannot name still cast
    // real votes, and dropping it would quietly shrink the abroad total; a consumer that
    // renders countries must show this bucket as „unknown" rather than skip it.
    addVotes(bucket(abroad, where.country ?? ""), section.votes);
    inAbroad.push(section);
  }

  const all = round.sections;
  const allVotes = totalVotes(all);
  const coverageOf = (
    basis: string,
    covered: PresidentialSection[],
  ): Coverage => ({
    basis,
    sections: covered.length,
    excludedSections: all.length - covered.length,
    votes: totalVotes(covered),
    excludedVotes: allVotes - totalVotes(covered),
  });

  const rollup = <K extends string>(
    m: Map<K, Map<number, Votes>>,
    coverage: Coverage,
  ): Rollup<K> => ({
    coverage,
    entries: [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, votes]) => ({ key, results: { votes: sortedVotes(votes) } })),
  });

  for (const list of sectionsByOblast.values()) {
    list.sort((a, b) => a.code.localeCompare(b.code));
  }

  return {
    cycle: round.cycle,
    round: round.round,
    date: round.date,
    regions: rollup(
      regions,
      coverageOf(
        "every section placed in an oblast, by ЕКАТТЕ or by its code prefix; " +
          "excludes abroad (see abroad.json) and refusals (see placement.json)",
        inRegions,
      ),
    ),
    municipalities: rollup(
      municipalities,
      coverageOf(
        "sections whose ЕКАТТЕ data/settlements.json carries — NOT the whole round",
        inMunicipalities,
      ),
    ),
    settlements: rollup(
      settlements,
      coverageOf(
        "sections whose ЕКАТТЕ data/settlements.json carries — NOT the whole round",
        inSettlements,
      ),
    ),
    abroad: rollup(
      abroad,
      coverageOf(
        'every section outside the country; a "" key, when present, holds those whose ' +
          "country the corpus cannot name",
        inAbroad,
      ),
    ),
    sectionsByOblast,
    placement: placed.report,
  };
};

/**
 * Stable JSON, so a second run over the same raw tree writes identical bytes.
 *
 * ⚠ `indent` is a PARAMETER because this tree is committed and bucket-synced. Measured
 * across the ten rounds, two-space indentation costs **+102.4 MB** against minified —
 * the pipeline's own `--prod` flag exists for exactly that, and a hard-coded literal here
 * puts this tree outside it.
 */
const writeJson = (file: string, value: unknown, indent: number): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(value, null, indent > 0 ? indent : undefined)}\n`,
  );
};

/**
 * Write a round's tree under `data/<cycle>/tur<n>/`.
 *
 * @param agg - The aggregation.
 * @param dataRoot - The `data/` directory to write under.
 * @param indent - JSON indentation; 0 minifies. See `writeJson`.
 * @returns The files written, relative to `dataRoot`, sorted.
 */
export const writeRound = (
  agg: AggregatedRound,
  dataRoot: string,
  indent = 2,
): string[] => {
  const dir = path.join(dataRoot, agg.cycle, `tur${agg.round}`);
  // ⚠ THE SHARD DIRECTORY IS CLEARED FIRST. Shards are named after the oblasts a round
  // actually placed, so a re-run over a corrected corpus can write FEWER of them — and an
  // old shard left behind is a whole oblast of a previous vintage that every consumer
  // reads as current.
  fs.rmSync(path.join(dir, "sections"), { recursive: true, force: true });
  const written: string[] = [];
  const put = (rel: string, value: unknown): void => {
    writeJson(path.join(dir, rel), value, indent);
    written.push(path.join(agg.cycle, `tur${agg.round}`, rel));
  };

  put("region_votes.json", agg.regions);
  put("municipality_votes.json", agg.municipalities);
  put("settlement_votes.json", agg.settlements);
  put("abroad.json", agg.abroad);
  // ⚠ WRITTEN, not merely returned. The placement residue is the record of which votes
  // are missing from the finer roll-ups and why; leaving it in a process's stdout would
  // make the coverage blocks unauditable the moment the run ended.
  put("placement.json", agg.placement);
  for (const [oblast, sections] of [...agg.sectionsByOblast].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    put(path.join("sections", `${oblast}.json`), sections);
  }
  return written.sort();
};
