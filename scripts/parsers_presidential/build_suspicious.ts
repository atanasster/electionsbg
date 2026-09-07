// „Подозрителни населени места" for a presidential round — the three protocol flags the
// parliamentary dashboard raises, computed over the presidential section shards.
//
//   npx tsx scripts/parsers_presidential/build_suspicious.ts <cycle> [--write]
//   npx tsx scripts/parsers_presidential/build_suspicious.ts all --write
//
// ⚠ THE THRESHOLDS ARE THE PARLIAMENTARY ONES, IMPORTED. „Подозрително" must mean the same
// thing on both dashboards, so `SUSPICIOUS_THRESHOLDS` is read from
// `scripts/reports/suspiciousSections.ts` rather than restated — a second set of numbers would
// be a second definition of the word, on pages a reader reaches from the same header.
//
// ⚠⚠ AND THE CONCENTRATION FLAG BARELY TRANSFERS AT ALL, WHICH IS STRUCTURAL RATHER THAN A
// PROPERTY OF ANY CYCLE. „One contestant took ≥80% of a settlement's valid votes" is a signal
// where the national leader takes a quarter; on a presidential RUNOFF there are two names on
// the ballot and the winner routinely clears 80% of a village for entirely ordinary reasons.
// Measured, the share of settlements it flags: **59.6% on 2006 round 2** (national top share
// 75.4%), 21.4% on 2021 round 2, and 36.8% even on 2006 ROUND ONE, where Първанов took 65%
// nationally. A shared absolute threshold would name villages for voting the way the country
// voted. It is kept — the signal is real where the field is wide — and `discriminating` is what
// stops a top-3 being drawn from a flag that separated nothing.
//
// ⚠⚠ AN ABSOLUTE THRESHOLD ALSO STOPS DISCRIMINATING ON THE INVALID RULE, WHICH IS THE OTHER
// REASON THIS FILE CARRIES A BASELINE. Measured over the five committed cycles at round 1:
//
//     cycle   national invalid %   settlements flagged   share of those measurable
//     2001           0.44 %                 3                    0.1 %
//     2006           2.72 %               138                    3.2 %
//     2011           6.44 %             1,506                   35.5 %   ← not a signal
//     2016           3.05 %               139                    3.3 %
//     2021           2.93 %                87                    3.6 %
//
// In 2011 the whole country sat two thirds of the way to the mark, so „1,506 settlements have
// suspiciously many invalid ballots" is a statement about the YEAR wearing the grammar of a
// statement about 1,506 named places. Every category therefore carries its own `nationalPct`
// and `flaggedShare`, and `discriminating` is false above `NOT_DISCRIMINATING_SHARE` — so a
// surface can say „this cycle's ballots were unusually invalid everywhere" instead of drawing
// three villages as outliers.
//
// ⚠⚠ THE DENOMINATOR ITSELF IS PARTIAL ON 2021, AND THAT IS MACHINE VOTING. Only 3,137 of
// 12,488 sections report `numPaperBallotsFound` at all — most counted no paper — so the flag is
// computed over **2,405 of 4,184 settlements (57%)**. `measurableSettlements` states it; a count
// published without it is a claim about the country drawn from a self-selected half of it.
//
// ⚠ SETTLEMENTS, VIA ЕКАТТЕ, AND THE RESIDUE IS DECLARED. These flags are about small places —
// a village at 95% concentration is the finding, and a municipality average washes it out — so
// the grain is the settlement, which means the ЕКАТТЕ join. That join does not cover София (see
// `build_demographics.ts`), so ~1,600 sections and ~460k votes per cycle are outside every
// figure here. Counted in `coverage`, never silently dropped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUSPICIOUS_THRESHOLDS,
  type SuspiciousTopSettlement,
} from "../reports/suspiciousSections";
import { presidentialCyclesIn } from "../lib/electionFolders";
import { UNPLACED_SHARD } from "./aggregate";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

const TOP_N = 3;

/**
 * Above this share of measurable settlements, a flag has stopped separating anything and a
 * top-3 must not be drawn from it.
 *
 * ⚠ 5% IS ARGUED FROM THE MEASURED DISTRIBUTION, not picked. Flagged share over all ten
 * round-panels of the five committed cycles:
 *
 *     concentrated  1.4  2.8  2.8 12.4 13.2 14.5 17.6 21.4 36.8 59.6 %
 *     invalid       0.0  0.1  0.7  1.1  1.2  3.2  3.3  3.6  6.7 35.5 %
 *     added         0.2  0.5  0.6  0.9  1.8  2.0  3.6  3.7  7.3  7.7 %
 *
 * A „top 3" is a claim that THESE places stand out. At 3% of settlements it does; at 15% the
 * three named are three of six hundred, and the list reads as an accusation the data does not
 * support. The two errors are asymmetric — a false „not a signal" withholds a top-3 while a
 * false signal names villages — so the cut sits low, and the count and the national rate are
 * published either way.
 */
export const NOT_DISCRIMINATING_SHARE = 0.05;

export type PresidentialSuspiciousCategory = {
  count: number;
  threshold: number;
  /** The cycle's own rate on the same measure — the baseline a reader needs to know whether
   *  `threshold` is a high bar this year or a low one. */
  nationalPct: number;
  /** Settlements the flag could be COMPUTED for. ⚠ NOT the settlement total: the invalid rule
   *  needs a paper denominator, which machine voting removes. */
  measurableSettlements: number;
  /** `count / measurableSettlements`, ROUNDED to two decimals. ⚠ `discriminating` is derived
   *  from the UNROUNDED value, so recomputing the comparison from this field can disagree at
   *  the boundary — check it against `count / measurableSettlements`, not against this. */
  flaggedShare: number;
  /** ⚠ FALSE MEANS „THIS FLAG SAYS NOTHING THIS CYCLE", not „nothing was flagged". */
  discriminating: boolean;
  top: SuspiciousTopSettlement[];
  votesAffected: number;
};

export type PresidentialSuspicious = {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  coverage: {
    /** Settlements the ЕКАТТЕ join reached. */
    settlements: number;
    sections: number;
    /** ⚠ SECTIONS WITH NO ЕКАТТЕ — София and the absorbed quarters — outside every figure. */
    sectionsWithoutEkatte: number;
    votesWithoutEkatte: number;
  };
  concentrated: PresidentialSuspiciousCategory;
  invalidBallots: PresidentialSuspiciousCategory;
  additionalVoters: PresidentialSuspiciousCategory;
};

type ShardSection = {
  code: string;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  placeName?: string;
  protocol: Record<string, number | undefined>;
  votes: { partyNum: number; totalVotes: number }[];
};

type SettlementMeta = {
  ekatte: string;
  name?: string;
  name_en?: string;
  t_v_m?: string;
};
type RegionMeta = { oblast: string; name?: string; name_en?: string };

/** ⚠ ABSENT IS `null`; MALFORMED THROWS. A catalogue that fails to parse would otherwise
 *  degrade every name in this artifact to a bare ЕКАТТЕ code — „6291" where „с.Билка" belongs,
 *  on a list of places being flagged — and nothing would report it. Absence is a different
 *  state and is handled: a run without `settlements.json` falls back to the shard's own
 *  `placeName`, which is a real name. */
const readJson = <T>(f: string): T | null =>
  fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One settlement's accumulated protocol figures for one round. */
type Agg = {
  ekatte: string;
  oblast: string;
  obshtina?: string;
  placeName?: string;
  valid: number;
  paper: number;
  invalid: number;
  actual: number;
  additional: number;
  byTicket: Map<number, number>;
};

/** Country-wide protocol totals — ⚠ OVER EVERY SECTION, including the ones with no ЕКАТТЕ.
 *  See `aggregate`'s own note: the FLAG is at settlement grain, the BASELINE is the country. */
export type NationalTotals = {
  valid: number;
  paper: number;
  invalid: number;
  actual: number;
  additional: number;
  /** Each ticket's national votes, so the concentration baseline can be the LEADER's share
   *  rather than a mixture of different candidates' local wins. */
  byTicket: Map<number, number>;
};

const aggregate = (
  cycle: string,
  round: 1 | 2,
  root: string,
): {
  byEkatte: Map<string, Agg>;
  national: NationalTotals;
  noEkatteSections: number;
  noEkatteVotes: number;
  sections: number;
} | null => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return null;
  const byEkatte = new Map<string, Agg>();
  const national: NationalTotals = {
    valid: 0,
    paper: 0,
    invalid: 0,
    actual: 0,
    additional: 0,
    byTicket: new Map(),
  };
  let noEkatteSections = 0;
  let noEkatteVotes = 0;
  let sections = 0;
  // ⚠ SORTED. `readdirSync` returns filesystem order — roughly sorted on APFS, hash order on
  // ext4 — and that order decides which of several settlements tied at the same percentage
  // reaches the top-3. A rebuild on another machine would name different villages.
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const shard = file.replace(/\.json$/, "");
    // ⚠ THE PLACEMENT-REFUSED SHARD IS SKIPPED, and its sections are counted as ЕКАТТЕ-less
    // below like any other: „nowhere" is not a settlement.
    const rows = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as ShardSection[];
    for (const s of rows) {
      sections += 1;
      const votes = s.votes.reduce((a, v) => a + v.totalVotes, 0);
      // ⚠⚠ THE BASELINE COVERS THE COUNTRY, THE FLAG DOES NOT — and this line is the whole
      // difference. `nationalPct` answers „is 10% a high bar THIS YEAR", which is a question
      // about Bulgaria; computing it over the ЕКАТТЕ-joined settlements alone silently asks it
      // of a country without София. Measured on 2011 round 1: 7.12% scoped, **6.44% whole** —
      // and 6.44 is the figure this file's own header table documents, so the two disagreed in
      // every cycle until 2026-09-07.
      const np = s.protocol ?? {};
      national.valid +=
        (np.numValidVotes ?? 0) + (np.numValidMachineVotes ?? 0);
      national.paper += np.numPaperBallotsFound ?? 0;
      national.invalid += np.numInvalidBallotsFound ?? 0;
      national.actual += np.totalActualVoters ?? 0;
      national.additional += np.numAdditionalVoters ?? 0;
      for (const v of s.votes)
        national.byTicket.set(
          v.partyNum,
          (national.byTicket.get(v.partyNum) ?? 0) + v.totalVotes,
        );
      if (!s.ekatte || shard === UNPLACED_SHARD) {
        noEkatteSections += 1;
        noEkatteVotes += votes;
        continue;
      }
      let a = byEkatte.get(s.ekatte);
      if (!a) {
        a = {
          ekatte: s.ekatte,
          oblast: s.oblast ?? shard,
          obshtina: s.obshtina,
          placeName: s.placeName,
          valid: 0,
          paper: 0,
          invalid: 0,
          actual: 0,
          additional: 0,
          byTicket: new Map(),
        };
        byEkatte.set(s.ekatte, a);
      }
      const p = s.protocol ?? {};
      // ⚠ BOTH HALVES OF „VALID", the same sum the parliamentary producer takes. A section that
      // counted on machines reports its valid votes in the machine field and nothing in the
      // paper one, so reading either alone under-counts the denominator by the whole channel.
      a.valid += (p.numValidVotes ?? 0) + (p.numValidMachineVotes ?? 0);
      a.paper += p.numPaperBallotsFound ?? 0;
      a.invalid += p.numInvalidBallotsFound ?? 0;
      a.actual += p.totalActualVoters ?? 0;
      a.additional += p.numAdditionalVoters ?? 0;
      for (const v of s.votes)
        a.byTicket.set(
          v.partyNum,
          (a.byTicket.get(v.partyNum) ?? 0) + v.totalVotes,
        );
    }
  }
  return { byEkatte, national, noEkatteSections, noEkatteVotes, sections };
};

/** Build one category from a per-settlement measure. */
const category = (
  aggs: Agg[],
  threshold: number,
  /** `null` when the settlement cannot be measured at all — a missing denominator, or a floor
   *  the parliamentary rule applies. ⚠ NOT 0: „not measurable" and „measured at zero" are
   *  different, and folding them understates every share below. */
  measure: (a: Agg) => { pct: number; affected: number } | null,
  nationals: { numerator: number; denominator: number },
  label: (a: Agg) => SuspiciousTopSettlement,
): PresidentialSuspiciousCategory => {
  const measurable: { a: Agg; pct: number; affected: number }[] = [];
  for (const a of aggs) {
    const m = measure(a);
    if (m) measurable.push({ a, ...m });
  }
  const flagged = measurable.filter((m) => m.pct >= threshold);
  let votesAffected = 0;
  for (const f of flagged) votesAffected += f.affected;
  const flaggedShare = measurable.length
    ? flagged.length / measurable.length
    : 0;
  // ⚠ NOTHING MEASURABLE IS NOT „A CLEAN CYCLE". With no settlement the rule could judge, the
  // share is 0 and a naive comparison calls that discriminating — publishing „this flag found
  // nothing" about a question nobody could ask. Reachable: 2021 already loses 43% of settlements
  // to machine voting, and a fully machine-counted cycle loses all of them.
  const discriminating =
    measurable.length > 0 && flaggedShare <= NOT_DISCRIMINATING_SHARE;
  return {
    count: flagged.length,
    threshold,
    nationalPct: nationals.denominator
      ? round2((100 * nationals.numerator) / nationals.denominator)
      : 0,
    measurableSettlements: measurable.length,
    flaggedShare: round2(flaggedShare * 100) / 100,
    discriminating,
    // ⚠⚠ NO NAMES WHERE THE FLAG SEPARATED NOTHING. A „top 3" asserts that THESE places stand
    // out; on 2006's runoff the concentration rule flags 2,537 settlements of which **205 sit at
    // exactly 100%**, so any three of them is an arbitrary pick presented as a finding. The count
    // and the baseline still publish — the reader loses nothing but the accusation.
    top: discriminating
      ? [...flagged]
          // ⚠ A TOTAL ORDER. `pct` alone leaves ties to input order, which is filesystem order:
          // measured, reversing the shard list names six different villages on 2006 r2 and
          // reorders a panel this file calls a real signal (2011 r1). The artifact is
          // bucket-published, so that is which places PRODUCTION names.
          .sort((x, y) => y.pct - x.pct || x.a.ekatte.localeCompare(y.a.ekatte))
          .slice(0, TOP_N)
          .map((f) => ({ ...label(f.a), value: round2(f.pct) }))
      : [],
    votesAffected,
  };
};

export const SUSPICIOUS_FILE = "suspicious_settlements.json";

/** One round's file, relative to the cycle folder. ⚠ THE ONE PLACE THE LAYOUT IS SPELLED on
 *  this side; the browser's path builder must agree with it. */
export const suspiciousFileFor = (round: 1 | 2): string =>
  path.join(`tur${round}`, SUSPICIOUS_FILE);

export const buildPresidentialSuspicious = (
  cycle: string,
  round: 1 | 2,
  root = DATA_ROOT,
): PresidentialSuspicious | null => {
  const agg = aggregate(cycle, round, root);
  if (!agg || agg.byEkatte.size === 0) return null;
  const aggs = [...agg.byEkatte.values()];

  const settlements = readJson<SettlementMeta[]>(
    path.join(root, "settlements.json"),
  );
  const byEkatte = new Map((settlements ?? []).map((s) => [s.ekatte, s]));
  // ⚠ THE `root` OVERRIDE APPLIES TO BOTH CATALOGUES OR TO NEITHER. `settlements.json` is read
  // from `root` so a test fixture can supply one; reading the region names from PROJECT_ROOT
  // regardless made a temp-root build half-fixtured, which is the kind of asymmetry that makes
  // a passing test prove less than it appears to. The project copy remains the fallback,
  // because `src/` is not part of a data root.
  const regionsFile = path.join(root, "regions.json");
  const regions = readJson<RegionMeta[]>(
    fs.existsSync(regionsFile)
      ? regionsFile
      : path.join(PROJECT_ROOT, "src", "data", "json", "regions.json"),
  );
  const byOblast = new Map((regions ?? []).map((r) => [r.oblast, r]));

  const label = (a: Agg): SuspiciousTopSettlement => {
    const meta = byEkatte.get(a.ekatte);
    const region = byOblast.get(a.oblast);
    return {
      ekatte: a.ekatte,
      oblast: a.oblast,
      obshtina: a.obshtina,
      // ⚠ THE CATALOGUE'S NAME FIRST, the shard's `placeName` second. The shard prints
      // „гр.София" style already prefixed; the catalogue carries the `t_v_m` prefix separately,
      // which is what every other settlement label in this repo composes.
      settlement: meta
        ? `${meta.t_v_m ?? ""}${meta.name ?? ""}`
        : (a.placeName ?? a.ekatte),
      settlement_en: meta?.name_en,
      region_name: region?.name,
      region_name_en: region?.name_en,
      value: 0,
    };
  };

  const nat = agg.national;
  // ⚠⚠ THE LEADING CANDIDATE'S OWN NATIONAL SHARE, not a mixture. Summing each settlement's own
  // winner adds Радев's votes in one village to Цачева's in another and divides by the same
  // denominator, which is ≥ any candidate's real share and materially so when the field is
  // wide: on 2016 round 1 that mixture is **33.77%** while no candidate exceeded **27.24%**.
  // It would be rendered as „националното ниво" beside a named village.
  const nationalTop = nat.byTicket.size
    ? Math.max(...nat.byTicket.values())
    : 0;

  return {
    cycle,
    round,
    basis:
      "Червен флаг, не присъда. Всеки праг е сигнал, който заслужава поглед — струпване на " +
      "гласове, необичайно много недействителни бюлетини или много дописани в изборния ден. " +
      "Нито един от тях сам по себе си не доказва нарушение, а в година, в която цялата " +
      "страна е близо до прага, той не отличава нищо: затова до всяко число стои и " +
      "националното ниво.",
    basisEn:
      "A red flag, not a verdict. Each threshold marks something worth a look — a " +
      "concentration of votes, an unusual number of invalid ballots, or many voters added on " +
      "the day. None of them proves wrongdoing on its own, and in a year when the whole " +
      "country sits near the mark it separates nothing: which is why the national rate is " +
      "printed beside every figure.",
    coverage: {
      settlements: agg.byEkatte.size,
      sections: agg.sections,
      sectionsWithoutEkatte: agg.noEkatteSections,
      votesWithoutEkatte: agg.noEkatteVotes,
    },
    concentrated: category(
      aggs,
      SUSPICIOUS_THRESHOLDS.concentratedPct,
      (a) => {
        if (!a.valid || a.byTicket.size === 0) return null;
        const top = Math.max(...a.byTicket.values());
        if (!top) return null;
        return { pct: (100 * top) / a.valid, affected: top };
      },
      { numerator: nationalTop, denominator: nat.valid },
      label,
    ),
    invalidBallots: category(
      aggs,
      SUSPICIOUS_THRESHOLDS.invalidBallotsPct,
      (a) =>
        a.paper
          ? { pct: (100 * a.invalid) / a.paper, affected: a.invalid }
          : null,
      { numerator: nat.invalid, denominator: nat.paper },
      label,
    ),
    additionalVoters: category(
      aggs,
      SUSPICIOUS_THRESHOLDS.additionalVotersPct,
      (a) =>
        // ⚠ THE PARLIAMENTARY FLOOR, IMPORTED WITH THE THRESHOLD. A hamlet where four people
        // were added to a roll of thirty is 13% and is rounding noise, not a finding.
        //
        // ⚠⚠ AND A PROTOCOL THAT CONTRADICTS ITSELF IS REFUSED, NOT RANKED. More voters added
        // on the day than voted at all is not a large number, it is an impossible one — and
        // these rank FIRST, so „с.Звезделина — 282% дописани" was the headline name on three
        // panels this file marks as real signals. The source defect is identifiable
        // (`numAdditionalVoters` carrying the main roll: с.Билка files 680 against a roll of
        // 680, and 52 sections corpus-wide do the same) and INHERITED — the parliamentary
        // artifacts publish up to 414% today — but this file added `discriminating`,
        // `nationalPct` and `coverage` precisely so a named village is never published
        // unfairly, and that has to extend to a value that cannot be true. `null` drops it from
        // `measurableSettlements` too, so the share stays a ratio over settlements the rule
        // could actually judge.
        a.actual >= SUSPICIOUS_THRESHOLDS.additionalVotersMinActual &&
        a.additional <= a.actual
          ? {
              pct: (100 * a.additional) / a.actual,
              affected: a.additional,
            }
          : null,
      { numerator: nat.additional, denominator: nat.actual },
      label,
    ),
  };
};

/**
 * Build and write both rounds of a cycle. Returns the paths RELATIVE TO `root` — the shape
 * `ingestPresidentialCycle` puts in its `files` list — or an EMPTY ARRAY when the corpus
 * carries no section shards.
 */
export const writePresidentialSuspicious = (
  cycle: string,
  {
    indent = 2,
    root = DATA_ROOT,
    built: prebuilt,
  }: {
    indent?: number;
    root?: string;
    built?: Partial<Record<1 | 2, PresidentialSuspicious | null>>;
  } = {},
): string[] => {
  const written: string[] = [];
  for (const round of [1, 2] as const) {
    // ⚠ `in`, NOT `??`. An explicit `{ 1: null }` means „already built, and there is nothing
    // for this round" — `??` reads it as „not supplied" and pays for the whole build again,
    // which on a CLI that has just reported on it is a second pass whose bytes could disagree
    // with the line it printed.
    const built =
      prebuilt && round in prebuilt
        ? prebuilt[round]
        : buildPresidentialSuspicious(cycle, round, root);
    if (!built) continue;
    const rel = path.join(cycle, suspiciousFileFor(round));
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
      "usage: build_suspicious.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  const cycles = target === "all" ? presidentialCyclesIn(DATA_ROOT) : [target];
  for (const cycle of cycles) {
    const byRound: Partial<Record<1 | 2, PresidentialSuspicious | null>> = {};
    for (const round of [1, 2] as const) {
      const built = buildPresidentialSuspicious(cycle, round);
      byRound[round] = built;
      if (!built) {
        console.log(`${cycle} tur${round}: nothing to build`);
        continue;
      }
      const line = (name: string, c: PresidentialSuspiciousCategory) =>
        `${name} ${c.count}/${c.measurableSettlements}` +
        ` (nat ${c.nationalPct}%${c.discriminating ? "" : ", NOT DISCRIMINATING"})`;
      console.log(
        `${cycle} tur${round}: ${built.coverage.settlements} settlements — ` +
          `${line("concentrated", built.concentrated)}, ` +
          `${line("invalid", built.invalidBallots)}, ` +
          `${line("added", built.additionalVoters)} — ` +
          `${built.coverage.sectionsWithoutEkatte} sections / ` +
          `${built.coverage.votesWithoutEkatte} votes without ЕКАТТЕ`,
      );
    }
    if (!write) continue;
    for (const rel of writePresidentialSuspicious(cycle, { built: byRound }))
      console.log(`  wrote data/${rel}`);
  }
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
