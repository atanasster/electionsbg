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
  /**
   * What the per-place `ProtocolSum` blocks cover, when the file carries them.
   *
   * ⚠ IT IS THE SAME POPULATION AS `sections`, AND THAT IS THE POINT OF SAYING SO. The
   * protocols are summed over exactly the sections that qualified for this file, so a level
   * that under-covers the round under-covers its protocols by the same margin — 2011's
   * municipality and settlement roll-ups reach only the sections whose ЕКАТТЕ
   * `data/settlements.json` carries, which is 15% short of the round. A consumer adding the
   * per-place figures to get a national one would be 15% low, and nothing else in the file
   * says so.
   */
  protocolBasis?: string;
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

/**
 * The protocol figures a place's sections add up to.
 *
 * ⚠ IT EXISTS BECAUSE VOTES ALONE CANNOT ANSWER THE PAGE. A place surface states turnout
 * and invalid ballots beside the ranking, and neither is derivable from a ticket tally
 * (the VALID total is — it is the sum of the ticket rows, which is also the only figure a
 * ranking can add up to — but „valid" is not what a reader compares an invalid count against
 * without a denominator this block carries) — so without this the levels below the country could declare those
 * facts and never fill them, which is a slot the renderer silently drops rather than an
 * error anyone sees.
 *
 * ⚠ EVERY FIELD IS A SUM OVER THE SECTIONS THIS PLACE HOLDS, so it inherits their gaps
 * rather than hiding them — see `sectionsWithoutSignatures`.
 */
export interface ProtocolSum {
  /** Sections folded into this place. */
  sections: number;
  /** Точка 1 — the printed roll. */
  registeredVoters: number;
  /**
   * Voters added to the list ON THE DAY — по настоящ адрес, mobile boxes, ships.
   *
   * ⚠ CARRIED, NOT PRESCRIBED. The parliamentary builder adds these to the denominator
   * because 530 domestic sections there report more voters than registered; the presidential
   * COUNTRY figure this repo publishes does not, because art. 93 (3) is argued on the roll
   * alone (§2.5-11), and the two differ by up to 1.64 points (2021: 40.30% against 38.67%).
   * Both are true of different questions, so this field states the quantity and `turnoutBasis`
   * states whether a rate may be taken at all — neither says which denominator a surface
   * should pick.
   */
  additionalVoters: number;
  /** Точка 3 — signatures in the roll, the turnout numerator. */
  signatures: number;
  /**
   * Sections that cast votes and report NO signature count.
   *
   * ⚠ THE ZERO IS NOT A COUNT, AND THIS IS WHAT SAYS SO. All 144 of 2006's abroad sections
   * publish точка 3 = 0 while casting 46,113 valid votes, so a place folding them sums real
   * zeros into a real total and a consumer dividing by the roll publishes 0% turnout against
   * ballots that exist. A surface must withhold the rate where this is non-zero.
   *
   * ⚠⚠ DERIVED FROM THE DATA, NEVER FROM `signaturesUnreported` ALONE. That flag is set by
   * `era2006` and by no other reader, and its `undefined` means „this reader does not
   * distinguish" rather than „reported" — so counting only flagged sections reports „nothing
   * to withhold" for the 25 sections of 2011/2016/2021 that report точка 3 = 0 while casting
   * real votes. Eleven of those are ALL of Бобошево (KNL05) in 2011 round 1, which would
   * publish 0.00% turnout for a municipality that cast 1,812 votes with the guard saying
   * all-clear — the exact 2006 harm this field exists to prevent, on a different era.
   */
  sectionsWithoutSignatures: number;
  /** ⚠ „Точка 5" from 2016 on and точка 6 before it — the number moved, and точка 6 is the
   *  INVALID line on the current form, i.e. the field right below this one. Named by what it
   *  counts: ballots found in the boxes and on the machines. */
  ballotsFound: number;
  /** ⚠ PAPER ONLY, IN EVERY ERA — a machine does not accept an invalid ballot. Rendering it
   *  over the valid total understates the rate by the machine share. */
  invalidBallots: number;
  /** „не подкрепям никого". ⚠ ABSENT before 2016 — the form did not ask, and a stored 0
   *  would claim nobody chose an option nobody was offered. */
  noneOfTheAbove?: number;
  /**
   * The only honest turnout denominator for this place, or `null` where there is none.
   *
   * ⚠⚠ `null` ABROAD, BY DEFINITION rather than by arithmetic (decision 6, §2.5-3). Almost
   * everyone abroad joins the list at the section on the day, so signatures over the roll
   * measures a registration regime rather than participation — and it does not look absurd:
   * fed through this repo's own `turnoutPctOf` the presidential abroad rollup renders 98.3%
   * (2001), 87.6% (2016) and 90.2% (2021), for 68 of 68 countries, with the `cast > denom`
   * guard never firing. The parliamentary path discriminates on the literal oblast key „32";
   * this rollup is keyed by COUNTRY, so that discriminator does not exist here and the basis
   * has to travel in the data.
   */
  turnoutBasis: "registered-voters" | null;
}

export interface Rollup<K extends string> {
  coverage: Coverage;
  entries: {
    key: K;
    results: { votes: Votes[]; protocol: ProtocolSum };
  }[];
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
  // ⚠ The source's own `ekatte` is deliberately NOT spread through — see the type's
  // docblock. `omit` rather than destructuring, so the discard is a statement rather
  // than an unused binding a linter has to be told about.
  const rest: Omit<PresidentialSection, "ekatte"> = { ...section };
  delete (rest as { ekatte?: string }).ekatte;
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
  /** ⚠ A `Rollup` like the other three, NOT a narrower shape of its own. It carried an
   *  inline entry type that stopped at `votes`, so when the roll-ups gained a protocol the
   *  abroad level's was invisible to every consumer while the file on disk had it. */
  abroad: Rollup<string>;
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
  // ⚠ PARALLEL TO THE VOTE BUCKETS, KEYED THE SAME WAY. One map per level rather than a
  // field on the vote bucket, because a `Map<number, Votes>` is per TICKET and a protocol is
  // per PLACE — folding it into the ticket map would have to pick a ticket to hang it on.
  const regionProtocols = new Map<string, ProtocolSum>();
  const municipalityProtocols = new Map<string, ProtocolSum>();
  const settlementProtocols = new Map<string, ProtocolSum>();
  const abroadProtocols = new Map<string, ProtocolSum>();
  const sectionsByOblast = new Map<string, ShardSection[]>();

  const inRegions: PresidentialSection[] = [];
  const inMunicipalities: PresidentialSection[] = [];
  const inSettlements: PresidentialSection[] = [];
  const inAbroad: PresidentialSection[] = [];

  /**
   * Fold one section's protocol into its place.
   *
   * ⚠ „никого" IS SPREAD, NEVER DEFAULTED. Before 2016 the form did not ask, so the field is
   * absent on every section of those cycles — and a `?? 0` here would publish „0 chose none
   * of the above" about voters who were never offered the option. A place accumulates it only
   * once some section has answered it.
   */
  const addProtocol = (
    m: Map<string, ProtocolSum>,
    key: string,
    section: PresidentialSection,
    turnoutBasis: ProtocolSum["turnoutBasis"],
  ): void => {
    const p = section.protocol;
    let sum = m.get(key);
    if (!sum) {
      sum = {
        sections: 0,
        registeredVoters: 0,
        additionalVoters: 0,
        signatures: 0,
        sectionsWithoutSignatures: 0,
        ballotsFound: 0,
        invalidBallots: 0,
        turnoutBasis,
      };
      m.set(key, sum);
    }
    sum.sections += 1;
    sum.registeredVoters += p.numRegisteredVoters ?? 0;
    sum.additionalVoters += p.numAdditionalVoters ?? 0;
    sum.signatures += p.totalActualVoters ?? 0;
    // ⚠ THE FLAG OR THE DATA — see the field's docblock. `era2006` is the only reader that
    // sets the flag, so the inferred arm is what covers the other four eras; a section that
    // cast nothing and signed nothing is simply a section where nobody voted, which is why
    // the inference requires real votes.
    const cast = section.votes.reduce((a, v) => a + (v.totalVotes ?? 0), 0);
    if (
      section.signaturesUnreported ||
      ((p.totalActualVoters ?? 0) === 0 && cast > 0)
    )
      sum.sectionsWithoutSignatures += 1;
    sum.ballotsFound +=
      (p.numPaperBallotsFound ?? 0) + (p.numMachineBallots ?? 0);
    sum.invalidBallots += p.numInvalidBallotsFound ?? 0;
    // ⚠ ABSENT on BOTH fields means the form did not ask; one present means it did. A `??
    // 0` on each would turn „not asked" into „nobody chose it".
    const none =
      p.numValidNoOnePaperVotes === undefined &&
      p.numValidNoOneMachineVotes === undefined
        ? undefined
        : (p.numValidNoOnePaperVotes ?? 0) + (p.numValidNoOneMachineVotes ?? 0);
    if (none !== undefined)
      sum.noneOfTheAbove = (sum.noneOfTheAbove ?? 0) + none;
  };

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
    addProtocol(regionProtocols, place.oblast, section, "registered-voters");
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
      addProtocol(
        municipalityProtocols,
        place.obshtina,
        section,
        "registered-voters",
      );
      inMunicipalities.push(section);
    }
    if (place.ekatte) {
      addVotes(bucket(settlements, place.ekatte), section.votes);
      addProtocol(
        settlementProtocols,
        place.ekatte,
        section,
        "registered-voters",
      );
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
    addProtocol(abroadProtocols, where.country ?? "", section, null);
    inAbroad.push(section);
  }

  const all = round.sections;
  const allVotes = totalVotes(all);
  const coverageOf = (
    basis: string,
    covered: PresidentialSection[],
  ): Coverage => ({
    basis,
    protocolBasis:
      "summed over exactly the sections above — a level that under-covers the round " +
      "under-covers its protocols by the same margin",
    sections: covered.length,
    excludedSections: all.length - covered.length,
    votes: totalVotes(covered),
    excludedVotes: allVotes - totalVotes(covered),
  });

  const rollup = <K extends string>(
    m: Map<K, Map<number, Votes>>,
    protocols: Map<string, ProtocolSum>,
    coverage: Coverage,
  ): Rollup<K> => ({
    coverage,
    entries: [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, votes]) => ({
        key,
        results: {
          votes: sortedVotes(votes),
          // ⚠ Non-null: every key in the vote map was written by a loop that stamped the
          // protocol on the same iteration. A missing one is a code defect rather than a
          // corpus gap, so it throws here instead of publishing an empty protocol.
          protocol: protocols.get(key)!,
        },
      })),
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
      regionProtocols,
      coverageOf(
        "every section placed in an oblast, by ЕКАТТЕ or by its code prefix; " +
          "excludes abroad (see abroad.json) and refusals (see placement.json)",
        inRegions,
      ),
    ),
    municipalities: rollup(
      municipalities,
      municipalityProtocols,
      coverageOf(
        "sections whose ЕКАТТЕ data/settlements.json carries — NOT the whole round",
        inMunicipalities,
      ),
    ),
    settlements: rollup(
      settlements,
      settlementProtocols,
      coverageOf(
        "sections whose ЕКАТТЕ data/settlements.json carries — NOT the whole round",
        inSettlements,
      ),
    ),
    abroad: rollup(
      abroad,
      abroadProtocols,
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
