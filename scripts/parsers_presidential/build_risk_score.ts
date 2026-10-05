// The presidential SECTION RISK SCORE — the parliamentary `risk_score.ts` screening, scored on the
// signals a presidential protocol supports, and the input to the presidential Election Risk Index.
//
//   npx tsx scripts/parsers_presidential/build_risk_score.ts <cycle|all> [--write]
//
// ⚠⚠ A SCREENING, NOT A FRAUD DETERMINATION — `risk_score.ts`'s framing, inherited whole. A high
// score means „this section is statistically unusual along several dimensions and warrants a
// look", and nothing else.
//
// ⚠⚠ WHY THIS IS NOT `build_screening.ts`. That file ports only the PROCEDURAL half, on purpose:
// a composite that also reads the vote distribution cannot answer „are a candidate's votes in
// unusual sections" without circularity. The Election Risk Index needs the whole score, so this
// file adds the DISTRIBUTION half — and publishes the two as separate sub-scores, which is the
// parliamentary remedy. `proceduralScore` is the one to use for any question about a candidate;
// `score` is the screening rank.
//
// Signals, with the parliamentary WEIGHTS and CAPS imported rather than restated:
//   procedural    invalidBallots    invalid ÷ paper ballots found
//                 additionalVoters  voters added on the day ÷ actual voters
//   distribution  concentrated      the section winner's share of ticket votes, floor–100% → 0–1,
//                                   the floor rising above 80% in a landslide (see below)
//                 peerOutlier       max |z| of turnout and winner share against the settlement's
//                                   other sections (≥3 of them)
//                 swing             UPWARD z of the turnout / winner-share shift against the SAME
//                                   section in the previous presidential cycle, same round
//
// ⚠ TWO PARLIAMENTARY SIGNALS ARE NOT COMPUTABLE, AND ARE NAMED IN THE FILE RATHER THAN DROPPED.
// `recount`: no presidential protocol records a recount. `suemgMismatch`: needs a PER-SECTION
// flash comparison, and the presidential flash projection keeps only national totals (the СУЕМГ
// trees are gitignored host state that exists for 2021 alone). The national flash comparison
// still reaches the composite through `flash.json`.
//
// ⚠ THE KNOWN-vs-FIRED RULE, inherited: a signal that could be computed and found nothing enters
// at 0 with its full weight; only an uncomputable one leaves the denominator.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAND_CUTS,
  CAPS,
  DISTRIBUTION_SIGNALS,
  PROCEDURAL_SIGNALS,
  WEIGHTS,
  bandOf,
  type RiskBand,
  type RiskSignalId,
} from "../reports/risk_score";
import { SUSPICIOUS_THRESHOLDS } from "../reports/suspiciousSections";
import { presidentialCyclesIn } from "../lib/electionFolders";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

export const RISK_SCORE_FILE = "risk_score.json";

/** How many sections the file names — a list of where to look first, not the corpus.
 *
 *  ⚠ NAMED FROM THE CRITICAL BAND, AND NOT SUPPRESSED BY A SHARE RULE. The screening's „name
 *  nothing above 5% flagged" device suits a single threshold; these bands are `risk_score.ts`'s,
 *  CALIBRATED so that about 15% of sections pooled sit at „elevated" or above, and measured here
 *  at 2.4–20.9% per round. The 5% rule would hide every round but 2001. The parliamentary
 *  practice is followed instead: the highest-scoring critical sections are named, with
 *  `elevatedShare` beside them so a surface can say how much of the year the bands cover. */
const TOP_N = 20;
/** `build_screening.ts`'s floor for both procedural ratios, for the same reason: one invalid
 *  ballot out of four is 25% on nothing at all. */
const MIN_DENOMINATOR = SUSPICIOUS_THRESHOLDS.additionalVotersMinActual;
/** `risk_score.ts`'s swing floor: below this a ratio delta is rounding noise. */
const SWING_MIN_VOTES = 50;
/** A settlement needs this many sections for a z-score to mean anything. */
const MIN_PEERS = 3;
const CONCENTRATED_FLOOR = 80;
const MIN_SIGNALS_NAMED = 2;

export type PresidentialSignalId = Exclude<
  RiskSignalId,
  "recount" | "suemgMismatch"
>;

export const PRESIDENTIAL_SIGNALS: readonly PresidentialSignalId[] = [
  "invalidBallots",
  "additionalVoters",
  "concentrated",
  "peerOutlier",
  "swing",
];

export const UNAVAILABLE_SIGNALS: {
  id: RiskSignalId;
  reason: string;
  reasonEn: string;
}[] = [
  {
    id: "recount",
    reason: "Президентските протоколи не отразяват повторно преброяване.",
    reasonEn: "Presidential protocols record no recount.",
  },
  {
    id: "suemgMismatch",
    reason:
      "Няма сравнение с флаш паметта по секции — само национално, и то само за 2021 г.",
    reasonEn:
      "No per-section flash-memory comparison — national totals only, and only for 2021.",
  },
];

export interface RiskScoreComponent {
  id: PresidentialSignalId;
  /** The measured value before the cap: a percentage for the ratios, a z for the z-scores. */
  raw: number;
  /** 0–1 after the shared cap. */
  normalized: number;
}

export interface RiskScoreSection {
  code: string;
  oblast: string;
  ekatte?: string;
  placeName?: string;
  /** Ballot number of the section's winning ticket and its share of ticket votes, 0–100. */
  winner?: { number: number; pct: number };
  totalActualVoters: number;
  score: number;
  /** Over the procedural signals only — the one to use for a question about a candidate. */
  proceduralScore: number | null;
  distributionScore: number | null;
  band: RiskBand;
  signalsAvailable: number;
  components: RiskScoreComponent[];
}

export interface PresidentialRiskScore {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  signals: {
    used: PresidentialSignalId[];
    unavailable: { id: RiskSignalId; reason: string; reasonEn: string }[];
    /** The cycle the swing signal compares against; null when there is none. */
    swingAgainst: string | null;
    /** The winner share (0–100) above which `concentrated` fires this round: 80, or the round's
     *  95th percentile of section winner shares when that is higher. */
    concentratedFloor: number;
  };
  coverage: {
    sections: number;
    scored: number;
    /** Sum of the scored sections' actual voters — the denominator of `votesByBand`. */
    totalActualVoters: number;
    /** Actual voters over EVERY section, scored or not — the composite's denominator for the
     *  settlement-level components, whose numerators are not limited to scored sections. */
    allSectionsActualVoters: number;
  };
  cuts: typeof BAND_CUTS;
  counts: Record<RiskBand, number>;
  /** Actual voters in sections of each band — the composite's section component. */
  votesByBand: Record<RiskBand, number>;
  /** Share of scored sections at „elevated" or above, 0–1. */
  elevatedShare: number;
  /** The highest-scoring CRITICAL sections carrying at least two signals, at most TOP_N. */
  top: RiskScoreSection[];
}

const BASIS_BG =
  "Скрининг, не присъда: висок резултат значи само, че секцията се отличава статистически по " +
  "няколко признака и заслужава поглед. Оценката съчетава процедурни сигнали (недействителни " +
  "бюлетини, дописани в изборния ден) и сигнали за разпределението на гласовете (концентрация, " +
  "отклонение от съседните секции, рязка промяна спрямо предишните президентски избори). Само " +
  "процедурната подоценка не зависи от това кой печели секцията. ⚠ Делът на недействителните " +
  "бюлетини корелира с дела на ромското население (r = +0,36 на общинско ниво).";
const BASIS_EN =
  "A screening, not a verdict: a high score means only that the section stands out statistically " +
  "on several measures and is worth a look. It combines procedural signals (invalid ballots, " +
  "voters added on the day) with vote-distribution signals (concentration, deviation from " +
  "neighbouring sections, an abrupt shift since the previous presidential election). Only the " +
  "procedural sub-score is independent of who won the section. ⚠ The invalid-ballot share " +
  "correlates with Roma population share (r = +0.36 at municipality level).";

type ShardSection = {
  code: string;
  oblast?: string;
  ekatte?: string;
  placeName?: string;
  protocol?: Record<string, number>;
  votes?: { partyNum: number; totalVotes: number }[];
};

type SectionFacts = {
  s: ShardSection;
  oblast: string;
  actual: number;
  ticketVotes: number;
  turnout: number | null;
  winner?: { number: number; votes: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const share4 = (numerator: number, denominator: number): number =>
  Math.round((10000 * numerator) / denominator) / 10000;
const clip01 = (x: number) => Math.max(0, Math.min(1, x));

const readSections = (
  root: string,
  cycle: string,
  round: 1 | 2,
): SectionFacts[] | null => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return null;
  const out: SectionFacts[] = [];
  // ⚠ SORTED — `readdirSync` order is filesystem order, and a rebuild must name the same sections.
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const shard = file.replace(/\.json$/, "");
    for (const s of JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as ShardSection[]) {
      const p = s.protocol ?? {};
      const votes = s.votes ?? [];
      const ticketVotes = votes.reduce((a, v) => a + v.totalVotes, 0);
      let winner: SectionFacts["winner"];
      for (const v of votes)
        if (v.totalVotes > (winner?.votes ?? 0))
          winner = { number: v.partyNum, votes: v.totalVotes };
      const reg = p.numRegisteredVoters ?? 0;
      const actual = p.totalActualVoters ?? 0;
      out.push({
        s,
        // ⚠ `_unplaced` IS A REAL SHARD, never a place name — `build_screening.ts`'s rule.
        oblast: s.oblast ?? (shard.startsWith("_") ? "" : shard),
        actual,
        ticketVotes,
        // Clamped at 1: mobile and care-home sections exceed their roll, and a +200pp „surge"
        // from a near-empty list is the artefact `risk_score.ts` clamps for the same reason.
        turnout: reg > 0 && actual > 0 ? Math.min(1, actual / reg) : null,
        winner,
      });
    }
  }
  return out;
};

const winnerShare = (f: SectionFacts): number | null =>
  f.winner && f.ticketVotes > 0 ? f.winner.votes / f.ticketVotes : null;

const peerOutliers = (facts: SectionFacts[]): Map<string, number> => {
  const bySettlement = new Map<string, SectionFacts[]>();
  for (const f of facts) {
    // ⚠ THE SAME 50-VOTER FLOOR AS THE RATIOS, as subject AND as peer. Measured before it: every
    // one of the twenty sections named for 2016 and 2021 round 1 had 16–46 voters and scored 100
    // on this signal alone — a z-score over a handful of ballots is noise, not an outlier.
    if (
      !f.s.ekatte ||
      f.turnout === null ||
      winnerShare(f) === null ||
      f.actual < MIN_DENOMINATOR
    )
      continue;
    const arr = bySettlement.get(f.s.ekatte) ?? [];
    arr.push(f);
    bySettlement.set(f.s.ekatte, arr);
  }
  const out = new Map<string, number>();
  for (const arr of bySettlement.values()) {
    if (arr.length < MIN_PEERS) continue;
    const t = arr.map((f) => f.turnout as number);
    const w = arr.map((f) => winnerShare(f) as number);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = (xs: number[], mu: number) =>
      Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
    const muT = mean(t);
    const muW = mean(w);
    const sdT = sd(t, muT);
    const sdW = sd(w, muW);
    arr.forEach((f, i) => {
      const zT = sdT > 0 ? Math.abs(t[i] - muT) / sdT : 0;
      const zW = sdW > 0 ? Math.abs(w[i] - muW) / sdW : 0;
      out.set(f.s.code, Math.max(zT, zW));
    });
  }
  return out;
};

const swings = (
  current: SectionFacts[],
  prior: SectionFacts[],
): Map<string, number> => {
  const priorByCode = new Map(prior.map((f) => [f.s.code, f]));
  const deltas: { code: string; dW: number; dT: number }[] = [];
  for (const f of current) {
    const p = priorByCode.get(f.s.code);
    const w = winnerShare(f);
    const pw = p ? winnerShare(p) : null;
    if (
      !p ||
      w === null ||
      pw === null ||
      f.turnout === null ||
      p.turnout === null ||
      f.ticketVotes < SWING_MIN_VOTES ||
      p.ticketVotes < SWING_MIN_VOTES
    )
      continue;
    deltas.push({ code: f.s.code, dW: w - pw, dT: f.turnout - p.turnout });
  }
  const out = new Map<string, number>();
  if (deltas.length < MIN_PEERS) return out;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[], mu: number) =>
    Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
  const dWs = deltas.map((d) => d.dW);
  const dTs = deltas.map((d) => d.dT);
  const muW = mean(dWs);
  const muT = mean(dTs);
  const sdW = sd(dWs, muW);
  const sdT = sd(dTs, muT);
  for (const d of deltas) {
    const zW = sdW > 0 ? (d.dW - muW) / sdW : 0;
    const zT = sdT > 0 ? (d.dT - muT) / sdT : 0;
    // Upward only: a section that became less concentrated, or lost turnout, is not a signal.
    out.set(d.code, Math.max(0, zW, zT));
  }
  return out;
};

const ratio = (
  numerator: number,
  denominator: number,
  cap: number,
): { raw: number; normalized: number } | null =>
  denominator < MIN_DENOMINATOR || denominator <= 0
    ? null
    : {
        raw: round2((100 * numerator) / denominator),
        normalized: Math.min((100 * numerator) / denominator, cap) / cap,
      };

const subScore = (
  components: RiskScoreComponent[],
  ids: readonly RiskSignalId[],
): number | null => {
  const inSet = components.filter((c) => ids.includes(c.id));
  if (!inSet.length) return null;
  const num = inSet.reduce((a, c) => a + WEIGHTS[c.id] * c.normalized, 0);
  const den = inSet.reduce((a, c) => a + WEIGHTS[c.id], 0);
  return round2((100 * num) / den);
};

/** The cycle the swing compares against: the previous presidential cycle that has this round. */
const priorCycleOf = (
  cycle: string,
  round: 1 | 2,
  root: string,
): string | null => {
  const earlier = presidentialCyclesIn(root).filter((c) => c < cycle);
  for (let i = earlier.length - 1; i >= 0; i -= 1)
    if (fs.existsSync(path.join(root, earlier[i], `tur${round}`, "sections")))
      return earlier[i];
  return null;
};

/** Every scored section of a round, plus what the file reports about the scoring. Exported so a
 *  gate can check per-section invariants the published top list cannot show. */
export const scorePresidentialSections = (
  cycle: string,
  round: 1 | 2,
  root: string = DATA_ROOT,
): {
  rows: RiskScoreSection[];
  sections: number;
  allSectionsActualVoters: number;
  swingAgainst: string | null;
  concentratedFloor: number;
} | null => {
  const facts = readSections(root, cycle, round);
  if (!facts?.length) return null;
  const priorCycle = priorCycleOf(cycle, round, root);
  const prior = priorCycle ? readSections(root, priorCycle, round) : null;
  // ⚠⚠ THE CONCENTRATION BAR RISES IN A LANDSLIDE. In a two-ticket runoff, or a round one with
  // a dominant winner, sections at 80%+ for one ticket are ordinary — measured, at the fixed 80%
  // bar the signal was the strongest component in 1,050 of 2006 round one's 1,779 elevated
  // sections, and 33% of 2006 round two's sections cleared it. So the floor is the HIGHER of
  // `risk_score.ts`'s 80% and the round's 95th percentile of section winner shares: only the
  // most lopsided 5% can fire, which is the share rule the settlement flags use.
  //
  // ⚠ WITHDRAWING THE SIGNAL INSTEAD IS WRONG, and was measured: under the known-vs-fired rule a
  // computable-but-silent signal sits in the denominator at 0, so dropping it let the remaining
  // signals run hot — 2021 round one went from 25 critical sections to 113. Raising the bar keeps
  // the denominator the parliamentary shape.
  const shares = facts
    .filter((f) => winnerShare(f) !== null && f.ticketVotes >= MIN_DENOMINATOR)
    .map((f) => 100 * (winnerShare(f) as number))
    .sort((x, y) => x - y);
  const p95 = shares.length
    ? shares[Math.min(shares.length - 1, Math.floor(0.95 * shares.length))]
    : CONCENTRATED_FLOOR;
  const concentratedFloor = round2(Math.max(CONCENTRATED_FLOOR, p95));
  const peer = peerOutliers(facts);
  const swing = prior ? swings(facts, prior) : new Map<string, number>();

  const rows: RiskScoreSection[] = [];
  for (const f of facts) {
    const p = f.s.protocol ?? {};
    const components: RiskScoreComponent[] = [];
    const invalid = ratio(
      p.numInvalidBallotsFound ?? 0,
      p.numPaperBallotsFound ?? 0,
      CAPS.invalidPct,
    );
    if (invalid) components.push({ id: "invalidBallots", ...invalid });
    const additional = ratio(
      p.numAdditionalVoters ?? 0,
      f.actual,
      CAPS.additionalPct,
    );
    if (additional) components.push({ id: "additionalVoters", ...additional });
    const w = winnerShare(f);
    if (w !== null && f.ticketVotes >= MIN_DENOMINATOR)
      components.push({
        id: "concentrated",
        raw: round2(100 * w),
        // ⚠ A FLOOR AT THE CAP KEEPS THE SIGNAL KNOWN AT 0 — never withdrawn, for the reason
        // the floor's own comment gives — and avoids dividing by zero.
        normalized:
          concentratedFloor >= CAPS.concentratedPct
            ? 0
            : clip01(
                (100 * w - concentratedFloor) /
                  (CAPS.concentratedPct - concentratedFloor),
              ),
      });
    const z = peer.get(f.s.code);
    if (z !== undefined)
      components.push({
        id: "peerOutlier",
        raw: round2(z),
        normalized: Math.min(z, CAPS.peerZ) / CAPS.peerZ,
      });
    const sw = swing.get(f.s.code);
    if (sw !== undefined)
      components.push({
        id: "swing",
        raw: round2(sw),
        normalized: Math.min(sw, CAPS.swingZ) / CAPS.swingZ,
      });
    if (!components.length) continue;
    const score = subScore(components, PRESIDENTIAL_SIGNALS) ?? 0;
    rows.push({
      code: f.s.code,
      oblast: f.oblast,
      ekatte: f.s.ekatte,
      placeName: f.s.placeName,
      ...(f.winner && f.ticketVotes > 0
        ? {
            winner: {
              number: f.winner.number,
              pct: round2((100 * f.winner.votes) / f.ticketVotes),
            },
          }
        : {}),
      totalActualVoters: f.actual,
      score,
      proceduralScore: subScore(components, PROCEDURAL_SIGNALS),
      distributionScore: subScore(components, DISTRIBUTION_SIGNALS),
      band: bandOf(score),
      signalsAvailable: components.length,
      components,
    });
  }
  return {
    rows,
    sections: facts.length,
    allSectionsActualVoters: facts.reduce((a, f) => a + f.actual, 0),
    swingAgainst: swing.size ? priorCycle : null,
    concentratedFloor,
  };
};

export const buildPresidentialRiskScore = (
  cycle: string,
  round: 1 | 2,
  root: string = DATA_ROOT,
): PresidentialRiskScore | null => {
  const scored = scorePresidentialSections(cycle, round, root);
  if (!scored?.rows.length) return null;
  const { rows } = scored;

  const bands: RiskBand[] = ["low", "elevated", "high", "critical"];
  const counts = Object.fromEntries(bands.map((b) => [b, 0])) as Record<
    RiskBand,
    number
  >;
  const votesByBand = { ...counts };
  for (const r of rows) {
    counts[r.band] += 1;
    votesByBand[r.band] += r.totalActualVoters;
  }
  const elevated = rows.length - counts.low;
  return {
    cycle,
    round,
    basis: BASIS_BG,
    basisEn: BASIS_EN,
    signals: {
      used: PRESIDENTIAL_SIGNALS.filter((id) =>
        rows.some((r) => r.components.some((c) => c.id === id)),
      ),
      unavailable: UNAVAILABLE_SIGNALS,
      concentratedFloor: scored.concentratedFloor,
      swingAgainst: scored.swingAgainst,
    },
    coverage: {
      sections: scored.sections,
      scored: rows.length,
      totalActualVoters: rows.reduce((a, r) => a + r.totalActualVoters, 0),
      allSectionsActualVoters: scored.allSectionsActualVoters,
    },
    cuts: BAND_CUTS,
    counts,
    votesByBand,
    elevatedShare: share4(elevated, rows.length),
    // ⚠ THE TIEBREAK IS THE SECTION CODE — hundreds of sections share a score at two decimals.
    // ⚠ AT LEAST TWO SIGNALS TO BE NAMED. A one-signal score is that signal wearing a
    // composite's grammar; it still counts in the bands, but it does not head a list of stations.
    top: rows
      .filter(
        (r) => r.band === "critical" && r.signalsAvailable >= MIN_SIGNALS_NAMED,
      )
      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
      .slice(0, TOP_N),
  };
};

/** Build and write both rounds. Returns the written paths relative to `root`. */
export const writePresidentialRiskScore = (
  cycle: string,
  { indent = 2, root = DATA_ROOT }: { indent?: number; root?: string } = {},
): string[] => {
  const written: string[] = [];
  for (const round of [1, 2] as const) {
    const built = buildPresidentialRiskScore(cycle, round, root);
    if (!built) continue;
    const rel = path.join(cycle, `tur${round}`, RISK_SCORE_FILE);
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
      "usage: build_risk_score.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  const cycles = target === "all" ? presidentialCyclesIn(DATA_ROOT) : [target];
  for (const cycle of cycles) {
    for (const round of [1, 2] as const) {
      const b = buildPresidentialRiskScore(cycle, round);
      if (!b) {
        console.log(`${cycle} tur${round}: nothing to build`);
        continue;
      }
      console.log(
        `${cycle} tur${round}: ${b.coverage.scored}/${b.coverage.sections} scored · ` +
          `elevated ${b.counts.elevated} high ${b.counts.high} critical ${b.counts.critical} ` +
          `(${(100 * b.elevatedShare).toFixed(1)}% elevated+) · signals ${b.signals.used.join(",")}` +
          ` · swing vs ${b.signals.swingAgainst ?? "—"}`,
      );
    }
    if (write)
      for (const rel of writePresidentialRiskScore(cycle))
        console.log(`  wrote ${rel}`);
  }
};

// The strict form every CLI in this tree uses — see `build_screening.ts` for why.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
