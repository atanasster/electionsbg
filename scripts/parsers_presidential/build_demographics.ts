// Which places voted which way — Pearson correlations between a TICKET's municipal vote share
// and each Census 2021 indicator, per cycle and per round.
//
//   npx tsx scripts/parsers_presidential/build_demographics.ts <cycle> [--write]
//   npx tsx scripts/parsers_presidential/build_demographics.ts all --write
//
// ⚠⚠ AN ECOLOGICAL CORRELATION, AND THE CAVEAT TRAVELS IN THE FILE. „r = +0.72 against
// ethnicTurkish" says municipalities with more Turkish residents gave this pair a larger share
// — it does NOT say Turkish voters voted for them. Inferring individual behaviour from
// aggregates is the ecological fallacy, and it is the one thing a dot on a −1…+1 track invites
// a reader to do. `basis` carries the sentence into the artifact so no surface can draw the
// plot without it, exactly as `runoff_transfer.json` does for the transition matrix.
//
// ⚠⚠ IT READS THE SECTION SHARDS, NOT `municipality_votes.json`, AND THAT IS THE WHOLE REASON
// THIS FILE EXISTS RATHER THAN A CLIENT-SIDE FOLD. The municipality roll-up is built through
// the ЕКАТТЕ join, which `data/settlements.json` cannot serve for София or the absorbed
// quarters — measured on 2021 round 1 it holds **1,927,234 of 2,394,489 domestic ticket votes
// (80.5%) across 272 keys, and SOFIA CITY IS NOT AMONG THEM**: its largest municipality is
// Варна. A correlation over a municipality set missing the capital is not a partial answer, it
// is a wrong one in precisely the dimensions this plot draws — education, religion and
// ethnicity are exactly where София moves every coefficient.
//
// The section CODE carries the municipality with no catalogue at all: `234602001` is МИР 23,
// municipality 46 (Столична), rayon 02. Per cycle, round 1:
//
//     cycle   municipalities   domestic votes   unmapped
//     2001         263            2,825,803         0
//     2006         264            2,733,260         0
//     2011         264            3,315,503         0
//     2016         265            3,509,099         0
//     2021         265            2,394,489         0
//
// The residue against each round's published national total is exactly `abroad.json`'s sum.
// ⚠ THE COUNT VARIES BECAUSE THE GEOGRAPHY DID. Сърница (PAZ39) was created in 2015 and Куклен
// (PDV43) in 2003, so on an older cycle their sections still carry the parent's digits and the
// census entity that did not yet exist receives no votes and drops out of `n`. Cross-checked
// against each section's own ЕКАТТЕ-resolved `obshtina`, that is **45 sections corpus-wide**
// — 2001: 28 (7,469 votes, 0.26%), 2006: 9, 2011: 6, 2016: 0, 2021: 2 — so the pooling is real
// and small, and the alternative is not available: the `obshtina` route is NULL for 100% of
// Sofia-city sections.
//
// ⚠⚠ THE PLACEMENT-REFUSED SHARD IS RECOVERED, NOT DROPPED, AND THAT IS THE WHOLE OF 2011.
// `_unplaced` holds sections whose OBLAST the ingest refused to establish — 1,354 of them in
// 2011 round 1 (441,328 votes) and 1,355 in round 2 (422,726), every one of them София. Dropped,
// `SOF46` still enters the correlation from the S23/S24/S25 shards that DID place — but those
// hold only Столична's rural rayons, so the capital's y value would be computed on **7% of its
// votes** and plotted against the census x for all of it: Плевнелиев +7.48pp, Калфин −3.63pp.
// That is worse than an absent municipality, which at least shrinks a visible `n`.
//
// The oblast is the only thing missing — those codes are `2246…`, i.e. the SAME МИР and the SAME
// municipality digits their placed siblings carry — so it is learned from the placed shards of
// the same round rather than from any catalogue. Measured: **1,354/1,354 and 1,355/1,355
// recovered, all to SOF46, with zero ambiguous (МИР+municipality) keys anywhere in the five
// cycles**, and `unmappedVotes` is therefore 0 corpus-wide.
//
// ⚠ MUNICIPALITIES, NOT OBLASTS, and `scripts/parties/build_demographics.ts` says why: 265
// units against 31 is what turns these relationships from suggestive into solid, and the census
// publishes the ethnocultural / education / employment dimensions at that grain anyway.
//
// ⚠ EVERY RULE IS IMPORTED FROM THE PARLIAMENTARY PRODUCER — the metric list, the share
// extractor, Pearson, the rounding. A second implementation would be a second answer to „how
// correlated is this", plotted on the same −1…+1 track a reader has already learnt to read.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERCENT_METRICS,
  SOFIA_CITY_CENSUS_CODE,
  censusMetricShare,
  pearson,
  round2,
  round3,
} from "../parties/build_demographics";
import { presidentialCyclesIn } from "../lib/electionFolders";
import { UNPLACED_SHARD } from "./aggregate";
import type { CensusMetric } from "../../src/data/census/censusTypes";
import type {
  CensusMunicipalityEntity,
  CensusPayload,
} from "../../src/data/census/censusTypes";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

/**
 * The share a ticket must reach nationally to earn a dot.
 *
 * ⚠ IT IS A READABILITY CUT AND NOTHING ELSE — a presidential ballot has no legal threshold,
 * so the parliamentary producer's 4% would be borrowing a number that means something there
 * and nothing here. At 3% the round-1 plots carry 3-7 dots (2001: 5, 2006: 3, 2011: 4, 2016: 7,
 * 2021: 5), which is what the −1…+1 track can hold before the dots stop being separable; at 4%
 * 2021 loses Мареshki and Василев, two of the four pairs whose geography is actually distinct.
 */
const MIN_PCT = 3;

/** ⚠ THE THREE SOFIA-CITY МИР FOLD TO ONE CENSUS MUNICIPALITY. NSI keeps Столична община whole
 *  (`SOF46`); the electoral geography splits it across МИР 23, 24 and 25. Folding them is the
 *  same decision `scripts/parties/build_demographics.ts` takes one level up, where the split is
 *  by rayon code rather than by shard name. */
const SOFIA_SHARDS = new Set(["S23", "S24", "S25"]);

/** One ticket's dot. */
export type PresidentialCleavageTicket = {
  number: number;
  /** ⚠ BULGARIAN IN BOTH LANGUAGES. A person's name is not translated — every other
   *  presidential surface prints the same Cyrillic string, and a reader is matching it against
   *  a ballot. */
  president: string;
  color?: string;
  /** The ticket's PUBLISHED national share of valid votes, from `national_summary.json`.
   *
   *  ⚠⚠ NOT THE SHARE OF THE CORRELATED BASE, and the difference is visible. Computed over the
   *  domestic, census-mapped ticket votes this file correlates on, Карадайъ's 2021 round-1 dot
   *  would read **9.30%** while every other surface on the site publishes **11.57%** for the
   *  same candidate in the same round — a 20% relative understatement, driven mostly by the
   *  abroad vote (8.4% of that round). A legend that disagrees with the ranking above it reads
   *  as an error in one of the two, and a reader cannot tell which. */
  pctNational: number;
};

export type PresidentialCleavageRow = {
  metric: CensusMetric;
  /** One r per ticket, in `tickets` order. */
  rs: number[];
  /** max(rs) − min(rs): how far apart this indicator pulls the field. */
  spread: number;
};

export type PresidentialCleavages = {
  cycle: string;
  round: 1 | 2;
  /** ⚠ THE ECOLOGICAL CAVEAT, IN THE DATA. A consumer rendering the dots without it is
   *  publishing individual behaviour inferred from aggregates. */
  basis: string;
  basisEn: string;
  /** How many census municipalities the correlation is over — the n behind every r. */
  municipalities: number;
  /** Domestic ticket votes the correlation covers, and the abroad votes outside it. ⚠ ABROAD
   *  IS OUTSIDE BY CONSTRUCTION: a section abroad belongs to no Bulgarian municipality and the
   *  census has nothing to say about it. */
  votes: number;
  abroadVotes: number;
  /** ⚠ VOTES IN SECTIONS WHOSE MUNICIPALITY COULD NOT BE DERIVED — outside every r, and
   *  REPORTED rather than merely warned about. Zero on four of the five cycles; 2011 refuses
   *  **441,328 round-1 votes (13.3%)**, all of them София, because that cycle's ingest could
   *  not place 1,355 sections in an oblast at all. A correlation missing an eighth of the
   *  country's most distinctive municipality is not a partial answer in the dimensions this
   *  plot draws, and a reader owes nothing to a console warning. */
  unmappedVotes: number;
  tickets: PresidentialCleavageTicket[];
  /** Sorted by spread, descending — the sharpest dividing line first. */
  rows: PresidentialCleavageRow[];
};

type ShardSection = {
  code: string;
  votes: { partyNum: number; totalVotes: number }[];
};

type Ticket = {
  number: number;
  president: string;
  color?: string;
  rounds?: number[];
};

type NationalSummary = {
  rounds?: {
    round: number;
    ranking?: { number: number; shareOfValid?: number }[];
  }[];
};

/** For inputs whose ABSENCE is an ordinary state — the census, `tickets.json`, `abroad.json`. */
const readJson = <T>(f: string): T | null => {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/** For a shard the directory listing just produced.
 *
 *  ⚠ A PARSE ERROR IS NOT AN ABSENCE. Swallowed, a truncated oblast contributes zero rows and
 *  its votes land in NEITHER `votes` NOR `unmappedVotes` — so the payload's accounting
 *  reconciles against a corpus it never read, and the only symptom is `municipalities` quietly
 *  dropping. This file refuses that shape everywhere else; it must refuse it here too. */
const readShardStrict = (f: string): ShardSection[] =>
  JSON.parse(fs.readFileSync(f, "utf8")) as ShardSection[];

/**
 * The census municipality a section belongs to, from its CODE.
 *
 * @param oblastShard - The shard's file name (`BGS`, `S23`, `PDV-00`).
 * @param code - The 9-digit section code; digits 3-4 are the municipality within the МИР.
 * @returns The NSI municipality code, or `null` for the placement-refused shard.
 *
 * ⚠ THE SHARD NAME MAY CARRY A SUFFIX (`PDV-00`), and the census code does not. Splitting on
 * the hyphen is what keeps Пловдив's second shard mapping to `PDV##` rather than to nothing.
 */
export const censusMunicipalityOf = (
  oblastShard: string,
  code: string,
): string | null => {
  if (oblastShard === UNPLACED_SHARD) return null;
  if (SOFIA_SHARDS.has(oblastShard)) return SOFIA_CITY_CENSUS_CODE;
  const oblast = oblastShard.split("-")[0];
  const muni = code.slice(2, 4);
  return /^\d{2}$/.test(muni) ? `${oblast}${muni}` : null;
};

/**
 * `(МИР + municipality digits) → census code`, learned from the round's PLACED shards.
 *
 * ⚠ THE `_unplaced` SHARD STILL CARRIES THE MUNICIPALITY — only the OBLAST is missing, and the
 * oblast is what the shard NAME normally supplies. 2011's refused sections are `2246…`: МИР 22,
 * municipality 46, the same key its own S23/S24/S25 siblings carry. Learned this way no
 * catalogue and no ЕКАТТЕ join is involved, so the file's own principle is unchanged.
 *
 * ⚠ AN AMBIGUOUS KEY IS REFUSED, NOT RESOLVED. A `(МИР, municipality)` two oblasts both claim
 * names no municipality, and guessing one would put a city's votes into another region's census
 * profile. Measured: zero ambiguous keys in any of the five cycles.
 */
export const learnMirMuni = (
  rowsByShard: Map<string, ShardSection[]>,
): Map<string, string> => {
  const seen = new Map<string, Set<string>>();
  for (const [shard, rows] of rowsByShard) {
    if (shard === UNPLACED_SHARD) continue;
    for (const s of rows) {
      const code = censusMunicipalityOf(shard, s.code);
      if (!code) continue;
      const key = s.code.slice(0, 4);
      let set = seen.get(key);
      if (!set) {
        set = new Set();
        seen.set(key, set);
      }
      set.add(code);
    }
  }
  return new Map(
    [...seen]
      .filter(([, v]) => v.size === 1)
      .map(([k, v]) => [k, [...v][0]] as const),
  );
};

const oblastShardsOf = (
  cycle: string,
  round: 1 | 2,
  root: string,
): string[] => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
};

const abroadVotesOf = (cycle: string, round: 1 | 2, root: string): number => {
  const file = readJson<{
    entries?: { results?: { votes?: { totalVotes?: number }[] } }[];
  }>(path.join(root, cycle, `tur${round}`, "abroad.json"));
  return (file?.entries ?? []).reduce(
    (sum, e) =>
      sum +
      (e.results?.votes ?? []).reduce((a, v) => a + (v.totalVotes ?? 0), 0),
    0,
  );
};

export const CLEAVAGES_FILE = "demographic_cleavages.json";

/** One round's file, relative to the cycle folder. ⚠ THE ONE PLACE THE LAYOUT IS SPELLED on
 *  this side; the browser's path builder must agree with it. */
export const cleavagesFileFor = (round: 1 | 2): string =>
  path.join(`tur${round}`, CLEAVAGES_FILE);

/**
 * Build one round's cleavages, or `null` when the corpus cannot support them.
 *
 * @returns `null` for a missing census file, a cycle with no section shards, or a round in
 *   which fewer than two tickets clear `MIN_PCT` — a plot with one dot has no spread to sort
 *   by and states nothing a bar chart does not.
 */
export const buildPresidentialCleavages = (
  cycle: string,
  round: 1 | 2,
  root = DATA_ROOT,
): PresidentialCleavages | null => {
  const census = readJson<CensusPayload>(path.join(root, "census_2021.json"));
  if (!census?.municipalities?.length) return null;
  const muniByCode = new Map<string, CensusMunicipalityEntity>(
    census.municipalities.map((m) => [m.code, m]),
  );

  const tickets =
    readJson<{ tickets: Ticket[] }>(path.join(root, cycle, "tickets.json"))
      ?.tickets ?? [];
  if (!tickets.length) return null;

  const shards = oblastShardsOf(cycle, round, root);
  if (!shards.length) return null;

  // ⚠ READ ONCE, INTO MEMORY. The recovery below has to learn from the PLACED shards before it
  // can resolve the refused one, so a single streaming pass cannot do it. The whole tree is
  // ~12,500 sections.
  const rowsByShard = new Map<string, ShardSection[]>(
    shards.map((shard) => [
      shard,
      readShardStrict(
        path.join(root, cycle, `tur${round}`, "sections", `${shard}.json`),
      ),
    ]),
  );
  const mirMuni = learnMirMuni(rowsByShard);

  // (census municipality) → (ticket number → votes), plus its own total.
  const byMuni = new Map<
    string,
    { total: number; byTicket: Map<number, number> }
  >();
  let unmappedVotes = 0;
  for (const [shard, rows] of rowsByShard) {
    for (const s of rows) {
      // ⚠ THE SHARD NAME FIRST, THE LEARNED MAP SECOND. A placed section's own oblast is the
      // authority; the map exists only for the sections that have none.
      const code =
        censusMunicipalityOf(shard, s.code) ?? mirMuni.get(s.code.slice(0, 4));
      const sectionVotes = s.votes.reduce((a, v) => a + v.totalVotes, 0);
      // ⚠ WHATEVER STILL CANNOT BE PLACED IS COUNTED INTO `unmappedVotes`, NOT DROPPED — and
      // reported in the PAYLOAD rather than to a console nobody reads. Zero on every committed
      // cycle since the recovery above; a future one that changed the code scheme would
      // otherwise silently correlate over a smaller country.
      if (!code || !muniByCode.has(code)) {
        unmappedVotes += sectionVotes;
        continue;
      }
      let agg = byMuni.get(code);
      if (!agg) {
        agg = { total: 0, byTicket: new Map() };
        byMuni.set(code, agg);
      }
      agg.total += sectionVotes;
      for (const v of s.votes)
        agg.byTicket.set(
          v.partyNum,
          (agg.byTicket.get(v.partyNum) ?? 0) + v.totalVotes,
        );
    }
  }

  const codes = [...byMuni.keys()].filter(
    (c) => (byMuni.get(c)?.total ?? 0) > 0,
  );
  if (codes.length < 3) return null;

  // The X arrays are independent of the ticket, so they are built once.
  const xByMetric = new Map<CensusMetric, (number | undefined)[]>();
  for (const metric of PERCENT_METRICS)
    xByMetric.set(
      metric,
      codes.map((c) => {
        const v = censusMetricShare(muniByCode.get(c)!, metric);
        return v !== undefined ? v * 100 : undefined;
      }),
    );

  let national = 0;
  for (const agg of byMuni.values()) national += agg.total;
  if (national === 0) return null;

  // ⚠ THE PUBLISHED SHARE, from the same file the country page's ranking is drawn from — see
  // `pctNational`'s own header for the 9.30-vs-11.57 measurement. It also decides `MIN_PCT`, so
  // the cut is on the number a reader can check rather than on this file's private base.
  const summary = readJson<NationalSummary>(
    path.join(root, cycle, "national_summary.json"),
  );
  const published = new Map(
    (summary?.rounds ?? [])
      .find((r) => r.round === round)
      ?.ranking?.map((r) => [r.number, 100 * (r.shareOfValid ?? 0)]) ?? [],
  );
  // ⚠ REQUIRED, NOT OPTIONAL. Without it every dot would be labelled with a share the rest of
  // the site contradicts; a cycle whose section shards exist always has this file, since it is
  // what `/presidential/:cycle` itself renders from.
  if (published.size === 0) return null;

  const shown = tickets
    .map((t) => ({ t, pct: published.get(t.number) ?? 0 }))
    .filter((x) => x.pct >= MIN_PCT)
    .sort((a, b) => b.pct - a.pct);
  // ⚠ TWO DOTS IS THE FLOOR. `spread` is `max − min` across the field, so with one ticket every
  // row's spread is 0, the sort is arbitrary and the plot claims a cleavage nobody can see.
  if (shown.length < 2) return null;

  const rsByTicket = new Map<number, Map<CensusMetric, number>>();
  for (const { t } of shown) {
    const ys = codes.map((c) => {
      const agg = byMuni.get(c)!;
      return (100 * (agg.byTicket.get(t.number) ?? 0)) / agg.total;
    });
    const per = new Map<CensusMetric, number>();
    for (const metric of PERCENT_METRICS) {
      const xsRaw = xByMetric.get(metric)!;
      const xs: number[] = [];
      const ysKept: number[] = [];
      for (let i = 0; i < xsRaw.length; i++) {
        if (xsRaw[i] === undefined) continue;
        xs.push(xsRaw[i] as number);
        ysKept.push(ys[i]);
      }
      per.set(metric, round3(pearson(xs, ysKept)));
    }
    rsByTicket.set(t.number, per);
  }

  const rows: PresidentialCleavageRow[] = PERCENT_METRICS.map((metric) => {
    // ⚠ NON-NULL, NOT `?? 0`. The loop above sets every metric for every shown ticket, so a
    // fallback cannot fire — and 0 is a REAL coefficient („no relationship"), so if it ever did
    // it would fabricate a finding instead of failing.
    const rs = shown.map(({ t }) => rsByTicket.get(t.number)!.get(metric)!);
    return {
      metric,
      rs,
      spread: round3(Math.max(...rs) - Math.min(...rs)),
    };
  }).sort((a, b) => b.spread - a.spread);

  return {
    cycle,
    round,
    basis:
      "Свързаност между места, не между хора. Числото казва, че в общините с повече от даден " +
      "признак двойката е получила по-голям дял — не че тези избиратели са гласували за нея. " +
      "Изводът за отделния човек от такива данни е екологична грешка. Пресмятането е по " +
      "общини, от Преброяване 2021.",
    basisEn:
      "A relationship between PLACES, not between people. The figure says that municipalities " +
      "with more of a given characteristic gave this pair a larger share — not that those " +
      "voters chose them. Reading an individual out of such data is the ecological fallacy. " +
      "Computed across municipalities, against Census 2021.",
    municipalities: codes.length,
    votes: national,
    abroadVotes: abroadVotesOf(cycle, round, root),
    unmappedVotes,
    tickets: shown.map(({ t, pct }) => ({
      number: t.number,
      president: t.president,
      color: t.color,
      pctNational: round2(pct),
    })),
    rows,
  };
};

/**
 * Build and write both rounds of a cycle. Returns the paths RELATIVE TO `root` — the shape
 * `ingestPresidentialCycle` puts in its `files` list — or an EMPTY ARRAY when the corpus
 * cannot support any.
 */
export const writePresidentialCleavages = (
  cycle: string,
  {
    indent = 2,
    root = DATA_ROOT,
    built: prebuilt,
  }: {
    indent?: number;
    root?: string;
    /** Already-built payloads, by round — so a CLI that has reported on them does not pay for a
     *  second pass, and the console figures and the bytes on disk describe ONE build. */
    built?: Partial<Record<1 | 2, PresidentialCleavages | null>>;
  } = {},
): string[] => {
  // ⚠ THE ONE DEPENDENCY OUTSIDE THE PRESIDENTIAL TREE, AND THE ONE ABSENCE WORTH SAYING OUT
  // LOUD. Every other `null` path here is an ordinary corpus state; a missing census makes the
  // ingest write nothing at all, which is indistinguishable from „these cycles produce nothing"
  // in a `--pvr all` run. The parliamentary sibling warns for exactly this reason.
  if (!fs.existsSync(path.join(root, "census_2021.json")))
    console.warn(
      `[presidential demographics] ${cycle}: skipping — ${path.join(root, "census_2021.json")} not found (run scripts/census/build_census.ts first).`,
    );
  const written: string[] = [];
  for (const round of [1, 2] as const) {
    // ⚠ `in`, NOT `??`. An explicit `{ 1: null }` means „already built, and there is nothing
    // for this round" — `??` reads it as „not supplied" and pays for the whole build again,
    // which on a CLI that has just reported on it is a second pass whose bytes could disagree
    // with the line it printed.
    const built =
      prebuilt && round in prebuilt
        ? prebuilt[round]
        : buildPresidentialCleavages(cycle, round, root);
    if (!built) continue;
    const rel = path.join(cycle, cleavagesFileFor(round));
    fs.writeFileSync(
      path.join(root, rel),
      `${JSON.stringify(built, null, indent)}\n`,
    );
    written.push(rel);
  }
  return written;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error(
      "usage: build_demographics.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  const cycles = target === "all" ? presidentialCyclesIn(DATA_ROOT) : [target];
  for (const cycle of cycles) {
    // ⚠ BUILT ONCE. The reporting loop below and the write beneath it must describe ONE build —
    // two passes over the same inputs is a console line that could disagree with the bytes.
    const byRound: Partial<Record<1 | 2, PresidentialCleavages | null>> = {};
    for (const round of [1, 2] as const) {
      const built = buildPresidentialCleavages(cycle, round);
      byRound[round] = built;
      if (!built) {
        console.log(`${cycle} tur${round}: nothing to build`);
        continue;
      }
      const top = built.rows[0];
      console.log(
        `${cycle} tur${round}: ${built.tickets.length} tickets x ${built.rows.length} metrics ` +
          `over ${built.municipalities} municipalities (${built.votes} votes, ` +
          `${built.abroadVotes} abroad, ${built.unmappedVotes} unplaceable) — ` +
          `sharpest ${top.metric} spread ${top.spread}`,
      );
    }
    if (!write) continue;
    for (const rel of writePresidentialCleavages(cycle, { built: byRound }))
      console.log(`  wrote data/${rel}`);
  }
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
