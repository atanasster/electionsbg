// „Скрининг на секции" for a presidential round — the PROCEDURAL half of the parliamentary
// risk score, and only that half.
//
//   npx tsx scripts/parsers_presidential/build_screening.ts <cycle> [--write]
//   npx tsx scripts/parsers_presidential/build_screening.ts all --write
//
// ⚠⚠ IT IS A SCREENING, NOT A FRAUD DETERMINATION — `risk_score.ts`'s framing, inherited
// deliberately. A high score means „this section is unusual along the paperwork dimensions and
// warrants a closer look", and nothing else. Every figure is a protocol arithmetic ratio.
//
// ⚠⚠ PROCEDURAL SIGNALS ONLY, AND THE COMPOSITE IS NOT PORTED. The parliamentary `risk_score`
// fuses four procedural signals with three vote-DISTRIBUTION ones, and its own header records
// why that composite cannot answer a question about vote distribution: ranking by it still
// tracks the distribution family, measured at 2.81x apparent concentration for one party. This
// file therefore takes `PROCEDURAL_SIGNALS` and stops. „Скрининг" here can never rank a
// candidate's sections, because nothing it reads knows who won.
//
// ⚠ TWO OF THE FOUR PROCEDURAL SIGNALS ARE NOT COMPUTABLE HERE, AND THEY ARE NAMED RATHER THAN
// SILENTLY DROPPED. `recount` needs a recount report the presidential corpus does not carry —
// no protocol field in any of the five cycles records one. `suemgMismatch` needs a PER-SECTION
// flash comparison; the projection behind `flash.json` aggregates its per-section map away, and
// re-deriving it would read the СУЕМГ trees, which are gitignored host state and exist for 2021
// alone. Adding a signal that is present on one cycle and absent on four — from an input a
// fresh clone does not have — is the exact shape `build_neighborhoods.ts` had to refuse.
//
// ⚠⚠ SO THE SCORE IS TWO SIGNALS, AND `signalsAvailable` IS ON EVERY ROW BECAUSE OFTEN IT IS
// ONE. The invalid-ballot signal needs a PAPER denominator, and 2021 counted on machines:
// measured at round 1, only **1,722 of 10,967 SCORED sections** carry both signals and 9,245
// carry one. A score built from a single signal is that signal wearing a composite's grammar,
// and a surface has to be able to say so.
//
// ⚠⚠ THE BANDS ARE ABSOLUTE AND THE PER-CYCLE RATE IS PUBLISHED BESIDE THEM, which is this
// plan's own established answer (see `build_suspicious.ts`). Measured share of SCORED sections
// above „low", round 1, read back off the committed artifacts:
//
//     2001  0.71 %     2006  2.36 %     2011  16.03 %     2016  6.80 %     2021  9.72 %
//
// A fixed cut is what lets „elevated" mean one thing across this site — the cuts are IMPORTED
// from `risk_score.ts` rather than restated — but it also means 2011 puts a SIXTH of the
// country above the bar, which is a statement about the year rather than about 1,733 named
// stations. `bands[].share` and `elevatedShare` carry that, and `discriminating` is false where
// that share says the screen has stopped separating anything.
//
// ⚠ THE INVALID SIGNAL IS NOT DEMOGRAPHICALLY NEUTRAL, and `risk_score.ts` says so at length:
// it correlates with Roma population share (r = +0.36 at municipality level), with documented
// explanations such as ballot complexity. That caveat travels in `basis` for the same reason
// the neighbourhoods one does — a surface cannot supply it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BAND_CUTS, CAPS, bandOf, type RiskBand } from "../reports/risk_score";
import { SUSPICIOUS_THRESHOLDS } from "../reports/suspiciousSections";
import { NOT_DISCRIMINATING_SHARE } from "./build_suspicious";
import { presidentialCyclesIn } from "../lib/electionFolders";
import { PROBLEM_NEIGHBORHOODS } from "../reports/problem_sections/neighborhoods";
import { matchesPresidentialSection } from "./build_neighborhoods";
import { buildNeighborhoodSectionCodes } from "../reports/problem_sections/index";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

export const SCREENING_FILE = "section_screening.json";

export const screeningFileFor = (round: 1 | 2): string =>
  path.join(`tur${round}`, SCREENING_FILE);

/** How many sections the artifact names. ⚠ A LIST, NOT A CORPUS — the whole ranking is 12k rows
 *  and no surface reads it; what a reader needs is where to look first. */
const TOP_N = 20;

/**
 * Above this share of scored sections above „low", the screen has stopped separating anything
 * and a named list must not be drawn from it.
 *
 * ⚠ IMPORTED, NOT RESTATED. It is the SAME device and the same number as the
 * suspicious-settlement flags', for the same reason — 2011 puts 16.0% of sections above „low",
 * and „1,733 sections are unusual" is a statement about the year wearing the grammar of a
 * statement about 1,733 named stations. This file already imports `CAPS`, `BAND_CUTS` and
 * `SUSPICIOUS_THRESHOLDS` precisely so a calibration has one home; a local copy of a fourth
 * one would be the same defect with a comment claiming it was not. Re-exported so a consumer
 * need not know which file declares it.
 */
export { NOT_DISCRIMINATING_SHARE } from "./build_suspicious";

/**
 * ⚠ THE SIBLING RATIO'S FLOOR, REUSED FOR BOTH SIGNALS. `SUSPICIOUS_THRESHOLDS` has no
 * paper-ballot floor — the parliamentary invalid-ballot report applies none — and one invalid
 * ballot out of four is 25%, which normalizes to 0.83 on nothing at all. Same magnitude, same
 * argument, one number: a second constant here would be a second calibration nobody would keep
 * in step, and this is stricter than the parliamentary side rather than looser.
 */
const MIN_DENOMINATOR = SUSPICIOUS_THRESHOLDS.additionalVotersMinActual;

export type ScreeningSignalId = "invalidBallots" | "additionalVoters";

/** ⚠ EQUAL WEIGHTS, AND THAT IS THE PARLIAMENTARY FILE'S OWN CHOICE — both procedural ratios
 *  carry 0.15 there. Restating them would be a second calibration; with two signals the score
 *  reduces to their mean either way, and this makes that visible rather than implicit. */
export const SCREENING_WEIGHTS: Record<ScreeningSignalId, number> = {
  invalidBallots: 0.15,
  additionalVoters: 0.15,
};

export interface ScreeningComponent {
  id: ScreeningSignalId;
  /** The measured percentage, before the cap. */
  rawPct: number;
  /** 0-1 after the shared cap. */
  normalized: number;
  /** ⚠⚠ TRUE WHEN THE PROTOCOL DOES NOT ADD UP — numerator above denominator, 26 rows
   *  corpus-wide, up to 425%. The SCORE is unaffected (the cap saturates at 30%), but
   *  „Дописани 425%" is not a ratio a reader can act on: it says this protocol is internally
   *  inconsistent, which is a different and stronger claim about a named station than „this
   *  station stands out on a ratio". The basis sentence promises a ratio, so a surface must be
   *  able to tell the two apart. */
  implausible?: boolean;
}

export interface ScreeningSection {
  code: string;
  oblast: string;
  ekatte?: string;
  placeName?: string;
  score: number;
  band: RiskBand;
  /** ⚠ OFTEN 1. A one-signal score is that signal, and a surface must be able to say so. */
  signalsAvailable: number;
  components: ScreeningComponent[];
}

export interface ScreeningBand {
  band: RiskBand;
  count: number;
  /** Of the SCORED sections, 0-1. */
  share: number;
}

export interface PresidentialScreening {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  coverage: {
    sections: number;
    /** Sections at least one signal could be computed for. */
    scored: number;
    /** Sections carrying BOTH signals — the only ones whose score is a composite. */
    bothSignals: number;
    /** Neither signal computable: no paper denominator and too few voters. */
    unscored: number;
    /** ⚠⚠ HOW MANY OF THE NAMED SECTIONS SIT IN A FLAGGED DISTRICT — a FLOOR on the confound
     *  the caveat describes, never its extent. The catalogue is eight curated districts, so 0
     *  means „none of the named twenty is in those eight" and never „no demographic confound".
     *  It is `null` when the parliamentary section codes the catalogue resolves through are not
     *  on this machine — an unmeasured overlap must not render as a measured zero. */
    flaggedDistrictOverlap: number | null;
  };
  cuts: typeof BAND_CUTS;
  bands: ScreeningBand[];
  /** Share of SCORED sections at „elevated" or above, 0-1 — the number `discriminating` is
   *  decided from. ⚠ PUBLISHED so a surface prints the producer's own figure rather than a
   *  second derivation of it; two producers of one number on the serving path is how a headline
   *  and the rows beneath it come to disagree. */
  elevatedShare: number;
  /** ⚠ FALSE MEANS „THIS SCREEN SAYS NOTHING THIS CYCLE", and `top` is EMPTY in that state. */
  discriminating: boolean;
  top: ScreeningSection[];
}

const BASIS_BG =
  "Скрининг, не присъда: висок резултат значи само, че протоколът на тази секция се отличава " +
  "по две аритметични съотношения и заслужава поглед. Използват се само процедурни сигнали — " +
  "недействителни бюлетини и дописани в изборния ден — които не знаят нищо за това кой е " +
  "спечелил секцията. ⚠ Делът на недействителните бюлетини корелира с дела на ромското " +
  "население (r = +0,36 на общинско ниво) и има обяснения като сложност на бюлетината, " +
  "а не непременно манипулация.";
const BASIS_EN =
  "A screening, not a verdict: a high score means only that this section's protocol stands out " +
  "on two arithmetic ratios and is worth a look. Only procedural signals are used — invalid " +
  "ballots and voters added on the day — and neither knows who won the section. ⚠ The invalid " +
  "ballot share correlates with Roma population share (r = +0.36 at municipality level), with " +
  "documented explanations such as ballot complexity rather than necessarily manipulation.";

type ShardSection = {
  code: string;
  oblast?: string;
  ekatte?: string;
  placeName?: string;
  protocol?: Record<string, number>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A 0-1 share carrying two decimals of PERCENT.
 *
 *  ⚠ NOT `round2(fraction)` — that takes two decimals of the FRACTION, quantising to whole
 *  percent and collapsing every band under 0.5% to exactly zero, which the tile then printed as
 *  „0%" beside a non-zero count. And not `round2(100 * x) / 100` either: dividing a rounded
 *  percentage back by 100 reintroduces binary noise (`0.0070999999999999995`) into a file whose
 *  bytes should be reproducible. */
const share4 = (numerator: number, denominator: number): number =>
  Math.round((10000 * numerator) / denominator) / 10000;

/** ⚠ NULL IS „NOT COMPUTABLE", NEVER 0. A section that counted on machines has no paper
 *  denominator; scoring that as „0% invalid" would rank it as clean rather than as unmeasured,
 *  and `risk_score.ts`'s own header records what conflating the two cost there.
 *
 *  ⚠ IT RETURNS BOTH HALVES, so the ratio is computed ONCE. Recomputing `rawPct` at the call
 *  site needed a `?? 1` denominator guard that could never fire, and two expressions of one
 *  formula is how a numerator and a denominator drift apart. */
const signalOf = (
  numerator: number,
  denominator: number,
  cap: number,
): Omit<ScreeningComponent, "id"> | null => {
  if (denominator < MIN_DENOMINATOR || denominator <= 0) return null;
  const rawPct = (100 * numerator) / denominator;
  return {
    rawPct: round2(rawPct),
    normalized: Math.min(rawPct, cap) / cap,
    ...(rawPct > 100 ? { implausible: true } : {}),
  };
};

export const buildPresidentialScreening = (
  cycle: string,
  round: 1 | 2,
  root: string = DATA_ROOT,
  /** The flagged districts' resolved section codes, from `buildNeighborhoodSectionCodes`.
   *  ⚠ OPTIONAL AND EXPENSIVE — it walks every parliamentary election from 2022 on — so the CLI
   *  and the pipeline pass it once per process and everything else leaves the overlap `null`. */
  resolvedDistrictCodes?: Record<string, Set<string>>,
): PresidentialScreening | null => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return null;

  const rows: ScreeningSection[] = [];
  let sections = 0;
  let unscored = 0;
  let bothSignals = 0;

  // ⚠ SORTED, for the reason every producer in this directory gives: `readdirSync` returns
  // filesystem order, and a rebuild on another machine must name the same sections.
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const shard = file.replace(/\.json$/, "");
    const shardRows = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as ShardSection[];
    for (const s of shardRows) {
      sections += 1;
      const p = s.protocol ?? {};
      const components: ScreeningComponent[] = [];
      const invalid = signalOf(
        p.numInvalidBallotsFound ?? 0,
        p.numPaperBallotsFound ?? 0,
        CAPS.invalidPct,
      );
      if (invalid) components.push({ id: "invalidBallots", ...invalid });
      const additional = signalOf(
        p.numAdditionalVoters ?? 0,
        p.totalActualVoters ?? 0,
        CAPS.additionalPct,
      );
      if (additional)
        components.push({ id: "additionalVoters", ...additional });
      if (components.length === 0) {
        unscored += 1;
        continue;
      }
      if (components.length === 2) bothSignals += 1;
      // ⚠ THE KNOWN-vs-FIRED RULE, inherited. A signal that COULD be computed and found nothing
      // enters at 0 with its full weight; only an uncomputable one leaves the denominator.
      // Scoring „did not fire" as „unknown" is what inflated every parliamentary score.
      const num = components.reduce(
        (a, c) => a + SCREENING_WEIGHTS[c.id] * c.normalized,
        0,
      );
      const den = components.reduce((a, c) => a + SCREENING_WEIGHTS[c.id], 0);
      const score = round2((100 * num) / den);
      rows.push({
        code: s.code,
        // ⚠ THE SHARD FILENAME IS THE FALLBACK, AND `_unplaced` IS A REAL SHARD. Measured, 9 of
        // the 20 rows published for 2011 round 2 carry it — harmless only while every one of
        // them also carries a `placeName`, which is the tile's first choice. Left in, the first
        // row without a place name renders „_unplaced" as a polling station's location.
        oblast: s.oblast ?? (shard.startsWith("_") ? "" : shard),
        ekatte: s.ekatte,
        placeName: s.placeName,
        score,
        band: bandOf(score),
        signalsAvailable: components.length,
        components,
      });
    }
  }

  if (rows.length === 0) return null;

  const bandsOrder: RiskBand[] = ["low", "elevated", "high", "critical"];
  const bands: ScreeningBand[] = bandsOrder.map((band) => {
    const count = rows.filter((r) => r.band === band).length;
    // ⚠⚠ ROUND THE PERCENTAGE, THEN RESCALE. `round2` takes two decimals of its ARGUMENT, so
    // `round2(fraction)` quantises to whole percent and collapses every band under 0.5% to
    // exactly zero — which the tile then printed as „0%" beside a non-zero count, in 8 of the
    // 12 renderable cells. „Критично: 55 · 0%" is the precise inversion of what this field
    // exists for: it is the device that makes „a sixth of the country was flagged, so this is
    // a statement about the year" legible.
    return { band, count, share: share4(count, rows.length) };
  });
  const elevatedShare =
    rows.filter((r) => r.score >= BAND_CUTS.elevated).length / rows.length;
  const discriminating = elevatedShare <= NOT_DISCRIMINATING_SHARE;

  // ⚠ THE TIEBREAK IS THE SECTION CODE. Hundreds of sections share a score at two decimals, and
  // without it the named twenty depend on directory order.
  const top = discriminating
    ? [...rows]
        .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
        .slice(0, TOP_N)
    : [];

  // ⚠⚠ THE CONFOUND, MEASURED RATHER THAN ONLY QUOTED. `basis` carries a MUNICIPALITY-level
  // correlation attached to a SECTION-level list; this says how many of the sections actually
  // named here sit inside a district the press has already flagged. A high number in some round
  // is itself the finding.
  const flaggedDistrictOverlap = resolvedDistrictCodes
    ? top.filter((s) =>
        PROBLEM_NEIGHBORHOODS.some((n) =>
          matchesPresidentialSection(s.code, n, resolvedDistrictCodes[n.id]),
        ),
      ).length
    : null;

  return {
    cycle,
    round,
    basis: BASIS_BG,
    basisEn: BASIS_EN,
    coverage: {
      sections,
      scored: rows.length,
      bothSignals,
      unscored,
      flaggedDistrictOverlap,
    },
    cuts: BAND_CUTS,
    bands,
    elevatedShare: share4(
      rows.filter((r) => r.score >= BAND_CUTS.elevated).length,
      rows.length,
    ),
    discriminating,
    top,
  };
};

/**
 * Build and write both rounds of a cycle. Returns the paths RELATIVE TO `root` — the shape
 * `ingestPresidentialCycle` puts in its `files` list — or an EMPTY ARRAY when nothing is
 * buildable.
 */
export const writePresidentialScreening = (
  cycle: string,
  {
    indent = 2,
    root = DATA_ROOT,
    built: prebuilt,
    resolvedDistrictCodes,
  }: {
    indent?: number;
    root?: string;
    built?: Partial<Record<1 | 2, PresidentialScreening | null>>;
    resolvedDistrictCodes?: Record<string, Set<string>>;
  } = {},
): string[] => {
  const written: string[] = [];
  for (const round of [1, 2] as const) {
    // ⚠ `in`, NOT `??` — an explicit `{ 1: null }` means „already built, and there is nothing
    // for this round"; `??` reads it as „not supplied" and pays for the whole build again.
    const built =
      prebuilt && round in prebuilt
        ? prebuilt[round]
        : buildPresidentialScreening(cycle, round, root, resolvedDistrictCodes);
    if (!built) continue;
    const rel = path.join(cycle, screeningFileFor(round));
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
      "usage: build_screening.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  const cycles = target === "all" ? presidentialCyclesIn(DATA_ROOT) : [target];
  // Walked once for the whole run — it reads every parliamentary election from 2022 on.
  const resolvedDistrictCodes = buildNeighborhoodSectionCodes(DATA_ROOT);
  for (const cycle of cycles) {
    const byRound: Partial<Record<1 | 2, PresidentialScreening | null>> = {};
    for (const round of [1, 2] as const) {
      const built = buildPresidentialScreening(
        cycle,
        round,
        DATA_ROOT,
        resolvedDistrictCodes,
      );
      byRound[round] = built;
      if (!built) {
        console.log(`${cycle} tur${round}: nothing to build`);
        continue;
      }
      const c = built.coverage;
      const band = (b: RiskBand) =>
        `${b} ${built.bands.find((x) => x.band === b)?.count ?? 0}`;
      console.log(
        `${cycle} tur${round}: ${c.scored}/${c.sections} scored ` +
          `(${c.bothSignals} on both signals, ${c.unscored} unscored) — ` +
          `${band("elevated")}, ${band("high")}, ${band("critical")}` +
          (c.flaggedDistrictOverlap !== null
            ? ` — ${c.flaggedDistrictOverlap}/${built.top.length} named in a flagged district`
            : "") +
          (built.discriminating ? "" : " — NOT DISCRIMINATING"),
      );
    }
    if (!write) continue;
    for (const rel of writePresidentialScreening(cycle, {
      built: byRound,
      resolvedDistrictCodes,
    }))
      console.log(`  wrote ${rel}`);
  }
};

// ⚠ THE STRICT FORM, which is what every other CLI in this tree uses. `import.meta.url`
// percent-encodes and `process.argv[1]` does not, so the naive `file://${argv[1]}` comparison
// is FALSE from any directory containing a space — and the failure is that `main()` never runs,
// printing nothing, writing nothing and exiting 0, which is indistinguishable from „nothing to
// build".
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
