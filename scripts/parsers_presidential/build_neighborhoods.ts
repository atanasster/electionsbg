// „Рискови гласове" for a presidential round — how the flagged Roma neighbourhoods voted.
//
//   npx tsx scripts/parsers_presidential/build_neighborhoods.ts <cycle> [--write]
//   npx tsx scripts/parsers_presidential/build_neighborhoods.ts all --write
//
// ⚠⚠ THE CATALOGUE IS A CLAIM ABOUT A PLACE, NOT ABOUT AN ELECTION, and that is the whole
// licence for reading it here. `PROBLEM_NEIGHBORHOODS` is a curated list of eight districts
// named in published reporting (Антикорупционен фонд, СЕГА, Свободна Европа) as carrying a high
// risk of vote-buying and controlled voting. A neighbourhood's polling stations do not move
// because a different ballot was counted in them, so the parliamentary catalogue transfers —
// and it is IMPORTED rather than restated, because two lists would be two definitions of which
// places are being named.
//
// ⚠⚠ AND NOTHING HERE IS A CLAIM ABOUT VOTERS, LET ALONE ABOUT AN ETHNIC GROUP. Every figure is
// an aggregate over POLLING STATIONS inside a district; „Столипиново gave a ticket 74%" is a
// fact about seventy protocols and not about how any person or community voted. The ecological
// fallacy `build_demographics.ts` guards against is sharper here, because the unit has a name
// and an ethnicity attached to it in the press. `basis` carries the sentence and the hook
// refuses a file that lost it.
//
// ⚠⚠ THE JOIN IS BY SECTION CODE ONLY, and it CANNOT be anything else: the presidential shards
// carry no `address` field at all (measured: 0 of 12,488 on 2021 round 1), so the catalogue's
// `ekatte` + `addressIncludes` arm — the one the parliamentary matcher relies on — can never
// fire. What bridges them is `buildNeighborhoodSectionCodes`, which unions the codes those
// address rules resolve to across every parliamentary election from 2022 on. Sofia's entries
// are keyed `68134-2511` (a synthetic district ЕКАТТЕ), which no presidential shard carries, so
// even the ЕКАТТЕ half is unreachable.
//
// ⚠⚠ COVERAGE IS PER CYCLE, IS NOT MONOTONIC IN TIME, AND MUST BE ON THE SURFACE. Measured over
// all five committed cycles at round 1 — sections matched per neighbourhood:
//
//     neighbourhood      2001  2006  2011  2016  2021
//     stolipinovo          70    70    70    70    70
//     fakulteta            10    10     0    11    11
//     filipovci             4     4     4     4     5
//     nadezhda_sliven       8     8     0     8     8
//     pobeda_burgas         8     8     8     8     8
//     gorno_ezerovo         3     3     3     3     3
//     dolno_ezerovo         7     0     0     7     7
//     maksuda              22    22    22    22    23
//     ---------------------------------------------------
//     located (of 8)        8     7     5     8     8
//     resolved codes        62    55    33    63    65   (of 68)
//
// So 2011 locates FIVE of the eight and 2006 seven, while 2001 — twenty years older — locates
// all eight. That is section RENUMBERING rather than a trend, which is exactly why a cycle
// cannot be read against another cycle here: the 2011 aggregate is a different set of places.
// `coverage.located` / `coverage.missing` say so per round, and the surface prints it.
//
// ⚠ THE SUFFIX RULE IS SAFE ON THIS ARCHIVE, VERIFIED RATHER THAN ASSUMED. `sectionSuffixes`
// (Филиповци) matches the 9-digit code minus its 2-digit МИР prefix, which could in principle
// attach a station in another oblast to a Sofia махала. Measured across all five cycles: every
// suffix resolves to at most ONE section, never two. One of the five (`4619132`) is absent from
// four cycles, which is why Филиповци is 4 sections there and 5 in 2021.
//
// ⚠⚠ THE JOIN DEPENDS ON A GITIGNORED CORPUS, AND SIX OF THE EIGHT DISTRICTS HAVE NO OTHER
// ARM. `buildNeighborhoodSectionCodes` walks `data/<YYYY_MM_DD>/sections/by-oblast` for every
// parliamentary election from 2022 on — `/data/2*` is gitignored, so on a fresh clone it
// resolves NOTHING. Only Столипиново (a `sectionPrefix`) and Филиповци (`sectionSuffixes`)
// survive that; measured on 2016 round 1 with an empty resolved map, the payload built at 2 of
// 8 districts and 74 of 133 sections. `buildPresidentialNeighborhoods` therefore REFUSES that
// state rather than writing it — see the guard's own note for why a degraded payload is worse
// here than none.
//
// ⚠ THE MATCHED STATIONS ARE ~1% OF THE COUNTRY (0.90–1.26% of valid votes across the ten
// rounds). This is a lens on eight named districts, never a national statistic.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROBLEM_NEIGHBORHOODS,
  type ProblemNeighborhood,
} from "../reports/problem_sections/neighborhoods";
import { buildNeighborhoodSectionCodes } from "../reports/problem_sections/index";
import { presidentialCyclesIn } from "../lib/electionFolders";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

/** Tickets below this national share are not listed. ⚠ A READABILITY CUT AND NOTHING ELSE — a
 *  presidential ballot has no legal threshold, and the same 3% `build_demographics.ts` uses so
 *  the two presidential surfaces name the same field of candidates. */
const MIN_PCT = 3;

/**
 * Floor on the PAPER denominator before an invalid-ballot rate is published.
 *
 * ⚠⚠ WITHOUT IT 2021 PUBLISHES A FABRICATED FINDING. Measured, the paper ballots found across
 * the matched sections: 26,995 / 41,920 (2001), 29,159 / 33,995 (2006), 34,417 / 29,888 (2011),
 * 45,979 / 40,015 (2016) — and then **228 and 78** in 2021, because these districts voted
 * almost entirely on machines (Столипиново's seventy stations report ZERO paper ballots in both
 * rounds). Eight invalid ballots out of 228 is „3.51% против 2.93% в страната", which reads as
 * „invalid ballots run high in the Roma districts" and is a statement about 228 pieces of
 * paper. The floor sits an order of magnitude below every real cycle's denominator and above
 * the machine-era residue; the smallest genuine per-district figure is Горно Езерово's 706.
 *
 * The parliamentary producer's `additionalVotersMinActual` is the same device for the same
 * reason — a rate over a handful is rounding noise wearing the grammar of a signal.
 */
export const INVALID_MIN_PAPER = 500;

/**
 * Floor on the ACTUAL-VOTER denominator before an additional-voters rate is published — the
 * parliamentary `additionalVotersMinActual`, which `INVALID_MIN_PAPER` above already cites as
 * the same device for the same reason.
 *
 * ⚠ IT IS NOT DEAD WEIGHT BECAUSE NOTHING RENDERS THE FIELD TODAY. Measured, 2021's runoff puts
 * Факултета at 126 additions over 488 voters — „a quarter of this neighbourhood's voters were
 * added to the roll on election day", against a national 4.03% — which is a controlled-voting
 * allegation in exactly the grammar the invalid floor exists to stop, over a few hundred people.
 * „Nothing draws it yet" is the weakest safety this file has, and it is not the one it relies on
 * anywhere else.
 */
export const ADDITIONAL_MIN_ACTUAL = 50;

export const NEIGHBORHOODS_FILE = "neighborhoods.json";

export const neighborhoodsFileFor = (round: 1 | 2): string =>
  path.join(`tur${round}`, NEIGHBORHOODS_FILE);

/**
 * The publications behind the catalogue, keyed by the host each district actually links to.
 *
 * ⚠⚠ DERIVED FROM THE CATALOGUE, NEVER RESTATED. The inherited parliamentary wording
 * (`problem_sections_description`) ends „Източници: Антикорупционен фонд, СЕГА, Свободна
 * Европа" — and measured against the eight `source_url`s, **no district links to
 * Антикорупционен фонд** while THREE link to `rroma.org`, which that list omits. So the caveat
 * named a source a reader would never reach and hid the one behind three of eight rows — an
 * advocacy organisation rather than a newsroom, which is exactly the distinction a reader of a
 * vote-buying-risk table wants. A hand-kept list beside per-row links is a list that drifts.
 */
const SOURCE_NAMES: Record<string, { bg: string; en: string }> = {
  "www.segabg.com": { bg: "СЕГА", en: "Sega" },
  "www.svobodnaevropa.bg": { bg: "Свободна Европа", en: "Svobodna Evropa" },
  "rroma.org": { bg: "Ромски фонд „Рома“", en: "Roma Rights Fund" },
};

/** ⚠ AN UNKNOWN HOST RENDERS AS THE HOST. Naming nothing would silently shorten the list; a
 *  bare domain is honest and visibly wants a line above. */
const sourceList = (lang: "bg" | "en"): string =>
  [...new Set(PROBLEM_NEIGHBORHOODS.map((n) => new URL(n.source_url).hostname))]
    .map((host) => SOURCE_NAMES[host]?.[lang] ?? host)
    .sort((a, b) => a.localeCompare(b, lang))
    .join(", ");

const BASIS_BG =
  "Секции в ромски квартали, широко отчитани като рискови за купуване и контролиран вот. " +
  "Числата са сборове от протоколите на тези секции — твърдение за секции, не за хората, " +
  `които са гласували в тях. Източници: ${sourceList("bg")}.`;
const BASIS_EN =
  "Polling sections in Roma neighbourhoods widely reported as vote-buying and controlled-vote " +
  "risk areas. The figures are sums over those sections' protocols — a statement about polling " +
  `stations, not about the people who voted in them. Sources: ${sourceList("en")}.`;

export interface NeighborhoodTicket {
  number: number;
  /** ⚠ THE BULGARIAN NAME, in both languages — a reader is matching it against a ballot. */
  president: string;
  votes: number;
  /** Share of the matched sections' valid votes, 0-100. */
  pct: number;
  /** The ticket's PUBLISHED national share, from `national_summary.json`, 0-100. */
  pctNational: number;
}

export interface NeighborhoodRates {
  /** ⚠ DOMESTIC SECTIONS ONLY, on BOTH sides of every comparison — `sections/` is 31 oblast
   *  shards and abroad lives in `abroad.json`, which this producer never reads. The PUBLISHED
   *  national turnout includes abroad and is higher (2021 r1: 40.30% against 37.20% here),
   *  because abroad sections cast votes on a near-empty roll — +228,300 on +58,261 registered
   *  in that round. Comparing eight domestic districts against a domestic baseline is the right
   *  comparison; what would be wrong is letting it render unqualified beside the published
   *  figure on the same page, so the copy names the basis. 2006 is the one cycle whose own
   *  published basis is already domestic-only, and it matches this to the digit. */
  turnoutPct: number | null;
  invalidPct: number | null;
  additionalPct: number | null;
  paperBallots: number;
  actualVoters: number;
}

/**
 * Which places a district's matched stations sit in — ARRAYS, because a district is a
 * neighbourhood and not an administrative unit, so nothing guarantees it falls inside one
 * ЕКАТТЕ.
 *
 * ⚠⚠ ALL THREE CAN BE EMPTY, AND THAT IS NOT „NOWHERE". This producer reads the
 * placement-REFUSED shard deliberately — see the loop's own note, where skipping it cost four
 * of eight districts on 2011 — and those rows carry no `ekatte`, no `obshtina` and, on 2011,
 * no `oblast` either. Measured over the five committed cycles at round 1:
 *
 *     cycle   fully placed   oblast only   nothing
 *     2001         10,457          1,600         0
 *     2006         10,138          1,527         0
 *     2011         10,208             61     1,354
 *     2016         10,557          1,458         0
 *     2021         10,887          1,601         0
 *
 * So Sofia's Филиповци and Факултета carry an oblast and no município in four cycles and
 * NOTHING in 2011. A place page reads an empty list as „not here"; dropping the district
 * instead would be worse, because the country page would lose a row the protocols do answer
 * for.
 */
export interface NeighborhoodPlaceCodes {
  /** Oblast codes, e.g. `PDV-00`, `S25`. */
  oblasts: string[];
  /** Municipality codes, e.g. `PDV22`. */
  obshtini: string[];
  /** Settlement ЕКАТТЕ, e.g. `56784`. */
  ekattes: string[];
}

/** ⚠ IT EXTENDS THE RATES rather than restating three of the four. The literal spreads
 *  `...ratesOf(acc)`, and TypeScript applies no excess-property check to a spread — so a
 *  hand-kept copy of the field list compiles while describing an artifact that carries more
 *  than it says, which is what a producer-side reader would then trust. */
export interface NeighborhoodPlace
  extends NeighborhoodRates, NeighborhoodPlaceCodes {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  sourceUrl: string;
  sections: number;
  /** ⚠ THE PUBLISHED BASE — tickets plus „не подкрепям никого", per `denomOf`. */
  valid: number;
  /** ⚠ THE SAME TICKET SET AS THE TOP-LEVEL ARRAY, per district — so a page scoped to one
   *  oblast can re-aggregate „кой води в рисковите квартали ТУК" from the districts that sit in
   *  it, rather than showing the country's answer under a place's name. `pct` divides by THIS
   *  district's `valid`. */
  tickets: NeighborhoodTicket[];
  /** ⚠ `votes` BESIDE `pct`, because the share alone cannot be re-derived into a count: `pct`
   *  is rounded to two places, so `pct * valid` is off by up to a few votes on a table that
   *  publishes exact counts everywhere else. */
  leader: {
    number: number;
    president: string;
    votes: number;
    pct: number;
  } | null;
}

export interface PresidentialNeighborhoods {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  coverage: {
    /** Districts in the curated catalogue. */
    catalogue: number;
    /** Districts with at least one section in THIS cycle's numbering. */
    located: number;
    /** The ones that could not be located, by name — never a silent drop. */
    missing: { id: string; name_bg: string; name_en: string }[];
    sections: number;
    sectionsInCycle: number;
    validVotes: number;
    /** The matched sections' share of the cycle's valid votes, 0-100. */
    pctOfValid: number;
  };
  /** The same three protocol rates over EVERY section in the country — the baseline that says
   *  whether the district figures are unusual. */
  national: NeighborhoodRates;
  totals: NeighborhoodRates;
  tickets: NeighborhoodTicket[];
  places: NeighborhoodPlace[];
}

type ShardSection = {
  code: string;
  /** ⚠ PRESENT ON 10,887 OF 12,488 SECTIONS (2021 r1) — the placement-refused shard carries
   *  none. `oblast` / `obshtina` are on every row. */
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  protocol?: Record<string, number>;
  votes: { partyNum: number; totalVotes: number }[];
};

type Ticket = { number: number; president: string };

type NationalSummary = {
  rounds?: {
    round: number;
    ranking?: { number: number; shareOfValid?: number }[];
  }[];
};

const readJson = <T>(f: string): T | null => {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ⚠ NULL, NOT 0, ON A MISSING DENOMINATOR. A rate of „0%" asserts that nothing was invalid;
 *  „—" says the protocols do not answer. That distinction is the whole difference between the
 *  two states 2021's machine voting produces. */
const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? round2((100 * numerator) / denominator) : null;

/**
 * Whether one presidential section belongs to a catalogued district.
 *
 * ⚠ CODE ARMS ONLY. The `ekatte` + `addressIncludes` arm the parliamentary matcher also has is
 * DELIBERATELY absent rather than accidentally omitted: presidential shards carry no `address`,
 * so it can only ever return false — and writing it out would suggest a fallback that does not
 * exist. See this file's header.
 */
export const matchesPresidentialSection = (
  code: string,
  n: ProblemNeighborhood,
  resolvedCodes: Set<string> | undefined,
): boolean => {
  if (resolvedCodes?.has(code)) return true;
  if (n.sectionCodes?.includes(code)) return true;
  if (n.sectionPrefix && code.startsWith(n.sectionPrefix)) return true;
  // ⚠ THE МИР-AGNOSTIC SUFFIX, and only on a full 9-digit code. `slice(2)` on a shorter string
  // would silently compare a fragment against a 7-digit suffix.
  if (code.length === 9 && n.sectionSuffixes?.includes(code.slice(2)))
    return true;
  return false;
};

type Acc = {
  sections: number;
  /** ⚠ TICKET VOTES ONLY — see `add`. Never a denominator on its own. */
  valid: number;
  /** „Не подкрепям никого", the other half of the published denominator. */
  noOne: number;
  paper: number;
  invalid: number;
  actual: number;
  registered: number;
  additional: number;
  byTicket: Map<number, number>;
  /** ⚠ SETS, and read only per DISTRICT — the national accumulator collects them too and
   *  nothing reads that, which is the price of one `add` for both. */
  oblasts: Set<string>;
  obshtini: Set<string>;
  ekattes: Set<string>;
};

const emptyAcc = (): Acc => ({
  sections: 0,
  valid: 0,
  noOne: 0,
  paper: 0,
  invalid: 0,
  actual: 0,
  registered: 0,
  additional: 0,
  byTicket: new Map(),
  oblasts: new Set(),
  obshtini: new Set(),
  ekattes: new Set(),
});

const add = (a: Acc, s: ShardSection): void => {
  const p = s.protocol ?? {};
  a.sections += 1;
  // ⚠ BOTH CHANNELS. A section that counted on machines reports its valid votes in the machine
  // field and nothing in the paper one, so reading either alone drops a whole channel.
  a.valid += (p.numValidVotes ?? 0) + (p.numValidMachineVotes ?? 0);
  // ⚠⚠ AND „НЕ ПОДКРЕПЯМ НИКОГО" IS THE OTHER HALF OF THE DENOMINATOR — the two fields above
  // are TICKET votes only. `pctNational` is taken verbatim from `national_summary.json`'s
  // `shareOfValid`, whose base is tickets + „не подкрепям никого", and the ranking on the same
  // page carries a footnote saying exactly that. Dividing „Тук" by tickets alone put the two
  // columns of one table on two bases, and the bias only ever ran one way: measured on 2016's
  // runoff, Цачева's gap over the country read +5.24pp against a true +3.21pp, and on round 1
  // Калфин's sign FLIPPED — the artifact said he did better in the flagged districts than
  // nationally when on the published basis he did worse. Absent before 2016; a no-op there.
  a.noOne +=
    (p.numValidNoOnePaperVotes ?? 0) + (p.numValidNoOneMachineVotes ?? 0);
  a.paper += p.numPaperBallotsFound ?? 0;
  a.invalid += p.numInvalidBallotsFound ?? 0;
  a.actual += p.totalActualVoters ?? 0;
  a.registered += p.numRegisteredVoters ?? 0;
  a.additional += p.numAdditionalVoters ?? 0;
  // ⚠ ONLY WHAT THE ROW CARRIES. An absent `ekatte` is the placement-refused shard, and adding
  // an empty string would put a code nothing matches into the published list.
  if (s.oblast) a.oblasts.add(s.oblast);
  if (s.obshtina) a.obshtini.add(s.obshtina);
  if (s.ekatte) a.ekattes.add(s.ekatte);
  for (const v of s.votes)
    a.byTicket.set(
      v.partyNum,
      (a.byTicket.get(v.partyNum) ?? 0) + v.totalVotes,
    );
};

/** ⚠ THE PUBLISHED BASE — tickets PLUS „не подкрепям никого". Every percentage on this artifact
 *  divides by it, so the tile's three kinds of share cannot disagree with each other or with
 *  the ranking above them on the page. */
const denomOf = (a: Acc): number => a.valid + a.noOne;

const ratesOf = (a: Acc) => ({
  turnoutPct: rate(a.actual, a.registered),
  // ⚠ THE FLOOR, NOT A BARE RATE — see `INVALID_MIN_PAPER`.
  invalidPct: a.paper >= INVALID_MIN_PAPER ? rate(a.invalid, a.paper) : null,
  // ⚠ FLOORED FOR THE SAME REASON AS THE LINE ABOVE — see `ADDITIONAL_MIN_ACTUAL`.
  additionalPct:
    a.actual >= ADDITIONAL_MIN_ACTUAL ? rate(a.additional, a.actual) : null,
  /** ⚠ PUBLISHED BESIDE THE RATE so a reader can see what it was computed over, and so a
   *  suppressed rate is distinguishable from a missing one. */
  paperBallots: a.paper,
  actualVoters: a.actual,
});

export const buildPresidentialNeighborhoods = (
  cycle: string,
  round: 1 | 2,
  root: string = DATA_ROOT,
  /** Injected by the CLI and by `writePresidentialNeighborhoods` so the parliamentary corpus is
   *  walked ONCE per process rather than once per cycle-round — it reads every election from
   *  2022 on. */
  resolved?: Record<string, Set<string>>,
): PresidentialNeighborhoods | null => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return null;

  const codes = resolved ?? buildNeighborhoodSectionCodes(root);
  // ⚠⚠ AN EMPTY RESOLVED SET IS A MISSING INPUT, NOT A CORPUS FACT. Six of the eight districts
  // reach this archive ONLY through those parliamentary codes — Столипиново resolves none and
  // rides its prefix, Филиповци its suffixes — and `data/2*` is gitignored, so a machine with
  // the presidential tree and no `<YYYY_MM_DD>/sections/by-oblast` from 2022 on resolves
  // nothing at all. Measured on 2016 round 1 in that state: the payload still BUILDS, at 2 of 8
  // districts and 74 of 133 sections, moving Орешарски by +3.25pp — and the tile then renders
  // „не са намерени … секциите се преномерират между вотовете", which asserts a CAUSE that is
  // false. Refusing is the only answer that cannot publish a story about Bulgarian electoral
  // administration to explain a build input nobody put on the machine.
  if (Object.values(codes).every((set) => set.size === 0)) {
    console.warn(
      `[presidential neighbourhoods] ${cycle} tur${round}: no parliamentary section codes ` +
        `resolved — the join needs data/<YYYY_MM_DD>/sections/by-oblast from 2022 on. ` +
        `Refusing to write a 2-of-8 payload that would read as section renumbering.`,
    );
    return null;
  }
  const perPlace = new Map<string, Acc>();
  const national = emptyAcc();
  let sectionsInCycle = 0;

  // ⚠ SORTED, for the reason `build_suspicious.ts` gives: `readdirSync` returns filesystem
  // order, and a rebuild on another machine must produce the same bytes.
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const rows = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as ShardSection[];
    for (const s of rows) {
      sectionsInCycle += 1;
      // ⚠⚠ THE BASELINE COVERS THE COUNTRY, THE DISTRICTS DO NOT. `national` accumulates over
      // EVERY section including the placement-refused shard — the question „is 12% invalid a
      // lot" is a question about Bulgaria, and computing it over a subset silently asks it of a
      // different country. Same rule, and the same past defect, as `build_suspicious.ts`.
      add(national, s);
      // ⚠⚠ THE PLACEMENT-REFUSED SHARD IS READ, NOT SKIPPED — the opposite of
      // `build_suspicious.ts`, and the difference is the GRAIN. That file aggregates by ЕКАТТЕ,
      // where „nowhere" is not a settlement; this one joins by SECTION CODE, and a station
      // whose settlement could not be resolved is still a station the catalogue names. Skipping
      // it cost FOUR of the eight districts on 2011, whose `_unplaced` holds 1,354 София
      // sections — Филиповци and Факултета among them — reported as „not located" when they
      // were sitting in the file. Same trap §2.2a of the plan records for the municipality
      // roll-up.
      for (const n of PROBLEM_NEIGHBORHOODS) {
        if (!matchesPresidentialSection(s.code, n, codes[n.id])) continue;
        let acc = perPlace.get(n.id);
        if (!acc) {
          acc = emptyAcc();
          perPlace.set(n.id, acc);
        }
        add(acc, s);
        // ⚠ ONE DISTRICT PER SECTION. The catalogue's rules can overlap (a prefix and a
        // resolved code), and counting a station twice would inflate both the district and the
        // total it is a share of.
        break;
      }
    }
  }

  const matched = emptyAcc();
  for (const acc of perPlace.values()) {
    matched.sections += acc.sections;
    matched.valid += acc.valid;
    matched.noOne += acc.noOne;
    matched.paper += acc.paper;
    matched.invalid += acc.invalid;
    matched.actual += acc.actual;
    matched.registered += acc.registered;
    matched.additional += acc.additional;
    for (const [num, v] of acc.byTicket)
      matched.byTicket.set(num, (matched.byTicket.get(num) ?? 0) + v);
    for (const c of acc.oblasts) matched.oblasts.add(c);
    for (const c of acc.obshtini) matched.obshtini.add(c);
    for (const c of acc.ekattes) matched.ekattes.add(c);
  }
  // ⚠ NOTHING LOCATED IS NOT AN EMPTY REPORT, it is NO report. A payload with eight „missing"
  // districts and no figures would render a heading over an accusation-shaped blank.
  if (matched.sections === 0 || denomOf(matched) === 0) return null;

  const summary = readJson<NationalSummary>(
    path.join(root, cycle, "national_summary.json"),
  );
  const published = new Map(
    (summary?.rounds ?? [])
      .find((r) => r.round === round)
      ?.ranking?.map((r) => [r.number, 100 * (r.shareOfValid ?? 0)]) ?? [],
  );
  // ⚠ REQUIRED. Without the published shares every row would carry a national comparison this
  // site's own ranking contradicts — see `build_demographics.ts`'s note on the 9.30-vs-11.57
  // gap between a section-summed share and the published one.
  if (published.size === 0) return null;

  // ⚠ THE FILE IS AN OBJECT WITH A `tickets` ARRAY, not a bare array — the same shape
  // `build_demographics.ts` reads.
  const catalogue = readJson<{ tickets?: Ticket[] }>(
    path.join(root, cycle, "tickets.json"),
  );
  const nameOf = new Map(
    (catalogue?.tickets ?? []).map((t) => [t.number, t.president]),
  );

  /** The ticket rows for ONE accumulator — the country's matched sections, or one district.
   *
   *  ⚠ ONE BUILDER FOR BOTH, so a district's rows cannot come to be filtered, named or divided
   *  differently from the country's. The two were written separately in the first cut and the
   *  district arm silently used its own denominator convention. */
  const ticketRows = (acc: Acc): NeighborhoodTicket[] => {
    const denom = denomOf(acc);
    // ⚠ NO ROWS RATHER THAN ZEROES. A district whose protocols carry no valid vote at all has
    // no shares; publishing „0%" for every ticket asserts a result nobody cast.
    if (denom === 0) return [];
    const out: NeighborhoodTicket[] = [];
    for (const [number, pctNational] of published) {
      if (pctNational < MIN_PCT) continue;
      const president = nameOf.get(number);
      // ⚠ A NUMBER IS NOT A NAME. A row reading „№ 6 — 74%" on a list of flagged districts
      // names nobody a reader can check, so an unnamed ticket is dropped rather than rendered
      // bare.
      if (!president) continue;
      const votes = acc.byTicket.get(number) ?? 0;
      out.push({
        number,
        president,
        votes,
        pct: round2((100 * votes) / denom),
        pctNational: round2(pctNational),
      });
    }
    out.sort((a, b) => b.votes - a.votes || a.number - b.number);
    return out;
  };

  const rows = ticketRows(matched);

  const places: NeighborhoodPlace[] = [];
  for (const n of PROBLEM_NEIGHBORHOODS) {
    const acc = perPlace.get(n.id);
    if (!acc) continue;
    let leader: NeighborhoodPlace["leader"] = null;
    for (const [number, votes] of [...acc.byTicket].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )) {
      const president = nameOf.get(number);
      if (!president || votes === 0) continue;
      leader = {
        number,
        president,
        votes,
        pct: round2((100 * votes) / denomOf(acc)),
      };
      break;
    }
    places.push({
      id: n.id,
      name_bg: n.name_bg,
      name_en: n.name_en,
      city_bg: n.city_bg,
      city_en: n.city_en,
      sourceUrl: n.source_url,
      sections: acc.sections,
      valid: denomOf(acc),
      ...ratesOf(acc),
      // ⚠ SORTED, for the reason the shard walk above is: a `Set`'s order is insertion order,
      // i.e. filesystem order, and a rebuild on another machine must produce the same bytes.
      oblasts: [...acc.oblasts].sort(),
      obshtini: [...acc.obshtini].sort(),
      ekattes: [...acc.ekattes].sort(),
      tickets: ticketRows(acc),
      leader,
    });
  }
  places.sort((a, b) => b.valid - a.valid || a.id.localeCompare(b.id));

  const missing = PROBLEM_NEIGHBORHOODS.filter((n) => !perPlace.has(n.id)).map(
    (n) => ({ id: n.id, name_bg: n.name_bg, name_en: n.name_en }),
  );

  return {
    cycle,
    round,
    basis: BASIS_BG,
    basisEn: BASIS_EN,
    coverage: {
      catalogue: PROBLEM_NEIGHBORHOODS.length,
      located: perPlace.size,
      missing,
      sections: matched.sections,
      sectionsInCycle,
      validVotes: denomOf(matched),
      pctOfValid: round2((100 * denomOf(matched)) / denomOf(national)),
    },
    national: ratesOf(national),
    totals: ratesOf(matched),
    tickets: rows,
    places,
  };
};

/**
 * Build and write both rounds of a cycle. Returns the paths RELATIVE TO `root` — the shape
 * `ingestPresidentialCycle` puts in its `files` list — or an EMPTY ARRAY when nothing is
 * buildable.
 */
export const writePresidentialNeighborhoods = (
  cycle: string,
  {
    indent = 2,
    root = DATA_ROOT,
    built: prebuilt,
    resolved,
  }: {
    indent?: number;
    root?: string;
    built?: Partial<Record<1 | 2, PresidentialNeighborhoods | null>>;
    resolved?: Record<string, Set<string>>;
  } = {},
): string[] => {
  const written: string[] = [];
  // ⚠ LAZY. A caller that supplies every round through `built` reads this never, and the walk
  // is ~600 ms over every parliamentary election from 2022 on.
  let codes = resolved;
  const codesFor = (): Record<string, Set<string>> =>
    (codes ??= buildNeighborhoodSectionCodes(root));
  for (const round of [1, 2] as const) {
    // ⚠ `in`, NOT `??` — an explicit `{ 1: null }` means „already built, and there is nothing
    // for this round"; `??` reads it as „not supplied" and pays for the whole build again.
    const built =
      prebuilt && round in prebuilt
        ? prebuilt[round]
        : buildPresidentialNeighborhoods(cycle, round, root, codesFor());
    if (!built) continue;
    const rel = path.join(cycle, neighborhoodsFileFor(round));
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
      "usage: build_neighborhoods.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  const cycles = target === "all" ? presidentialCyclesIn(DATA_ROOT) : [target];
  // Walked once for the whole run — it reads every parliamentary election from 2022 on.
  const resolved = buildNeighborhoodSectionCodes(DATA_ROOT);
  for (const cycle of cycles) {
    const byRound: Partial<Record<1 | 2, PresidentialNeighborhoods | null>> =
      {};
    for (const round of [1, 2] as const) {
      const built = buildPresidentialNeighborhoods(
        cycle,
        round,
        DATA_ROOT,
        resolved,
      );
      byRound[round] = built;
      if (!built) {
        console.log(`${cycle} tur${round}: nothing to build`);
        continue;
      }
      const c = built.coverage;
      console.log(
        `${cycle} tur${round}: ${c.located}/${c.catalogue} districts, ` +
          `${c.sections} sections, ${c.validVotes} valid (${c.pctOfValid}% of the cycle) — ` +
          `turnout ${built.totals.turnoutPct}% vs ${built.national.turnoutPct}% national, ` +
          `invalid ${built.totals.invalidPct}% vs ${built.national.invalidPct}%` +
          (c.missing.length
            ? ` — NOT LOCATED: ${c.missing.map((m) => m.id).join(", ")}`
            : ""),
      );
    }
    if (!write) continue;
    for (const rel of writePresidentialNeighborhoods(cycle, {
      built: byRound,
      resolved,
    }))
      console.log(`  wrote ${rel}`);
  }
};

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
