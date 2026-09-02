// The methodology gate (Phase 0, §7).
//
// `docs/methodology/election-surfaces.md` §5 is the PUBLISHED thresholds and
// `standoutThresholds.ts` is the executable copy. §7's rule is that a change to either requires
// a change to the other in the same commit — so this file reads the doc and fails when they
// disagree.
//
// ⚠ EVERY ASSERTION HERE MUST BE ABLE TO FAIL ON THE CHANGE IT NAMES. Three shapes are banned:
//
//   1. `expect(CONST).toBe(<the same literal>)` — passes unless the export is deleted, so it is
//      an import tripwire and nothing more. Where a constant's meaning is what matters, bind it
//      to the DOC instead, so neither side can move alone.
//   2. A length or shape check standing in for a value — `measured.length > 20` passes for any
//      21-character string, including one contradicting the published measurement.
//   3. Re-deriving a number the doc also states. The inherited review thresholds are read from
//      their PRODUCERS, so the doc cannot quietly disagree with the flags it publishes.

import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASIS_LABEL_KEYS,
  COUNCIL_MAJORITY_IS_NOT_A_SIGNAL,
  REVIEW_THRESHOLDS_ARE_READ_FROM_THE_PRODUCER,
  REVIEW_THRESHOLD_SOURCES,
  SECTION_SIGNAL_MEASURED,
  SECTION_SIGNAL_MIN_SECTIONS,
  SIGNALS_WITHOUT_OWN_THRESHOLD,
  STANDOUT_THRESHOLDS,
  TURNOUT_DEPARTURE_EXCLUDED_OBLAST,
  thresholdCopyKeys,
  type StandoutThreshold,
} from "./standoutThresholds";
import type { ElectionStandoutSignal } from "./surfaceTypes";

// Resolved from the module, so a directory move fails loudly rather than silently reading
// nothing — the repo convention for source-scanning gates.
const DOC_PATH = path.resolve(
  __dirname,
  "../../../docs/methodology/election-surfaces.md",
);
const doc = () => readFileSync(DOC_PATH, "utf8");

/** 0.07 * 100 is 7.000000000000001 in IEEE754. Without this a correctly co-ordinated move to
 *  7% fails with a message inviting someone to loosen the assertion — i.e. to remove the
 *  coupling this file exists for. */
const asPct = (p: number) => +(p * 100).toFixed(4);

const PRODUCER_THRESHOLDS = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../../data/2026_04_19/dashboard/suspicious_settlements.json",
    ),
    "utf8",
  ),
).thresholds as Record<string, number>;

describe("standout thresholds — the doc and the constants agree", () => {
  it("the methodology document exists and is the one §7 names", () => {
    // If this file moves, the gate must fail rather than silently stop checking.
    const src = doc();
    expect(src).toContain("Election surfaces — methodology & editorial gate");
    expect(src).toContain("## 5. The thresholds");
    // …and it must name the module holding its executable copy, or a reader of one has no
    // route to the other.
    expect(src).toContain("standoutThresholds.ts");
  });

  it("publishes the close-contest percentile, its tail and its sample floor", () => {
    const src = doc();
    const t = STANDOUT_THRESHOLDS.close_contest;
    expect(src).toContain(`bottom **${asPct(t.percentile)}%**`);
    expect(src).toContain(`${t.minSample} valid votes`);
  });

  it("publishes the turnout percentile as a VALUE, not only as a method", () => {
    // ⚠ THE ONE THAT COULD MOVE SILENTLY. The value row used to say "at a percentile of that
    // residual" without naming it, and nothing bound the constant — so 0.95 → 0.80, which
    // roughly quadruples how many places are called a departure, left the suite green and the
    // doc literally true.
    //
    // Anchored on "top **N%**" and NOT on a bare "95": the doc legitimately contains "p95"
    // twice for other reasons (this rule's own basis measurement, and the council p95), so a
    // substring check on the number would pass vacuously.
    const src = doc();
    const t = STANDOUT_THRESHOLDS.turnout_departure;
    expect(t.tail, "an upper-tail rule publishes its complement").toBe("upper");
    const topPct = asPct(1 - t.percentile);
    expect(src).toContain(`top **${topPct}%**`);
    expect(src).toContain(`${t.minSample} registered voters`);
  });

  it("publishes the turnout residual rule and the abroad exclusion", () => {
    const src = doc();
    // The rule is the RESIDUAL: a reader who takes it as a raw change reads the national swing
    // as a local finding.
    expect(src).toContain("minus the national change");
    // Binds the constant to the doc, so the МИР code cannot be renamed on one side only.
    expect(src).toContain(`МИР ${TURNOUT_DEPARTURE_EXCLUDED_OBLAST}`);
    expect(src).toMatch(/abroad is excluded/i);
  });

  it("publishes the council threshold AND the barred sibling", () => {
    const src = doc();
    const t = STANDOUT_THRESHOLDS.fragmented_council;
    expect(src).toContain(`**≥ ${t.minParties} parties**`);
    expect(src).toContain(`at least ${t.minSample} seats`);
    expect(src).toMatch(/must never be emitted/);
    expect(src).toContain("179 (62%) do not");
    // …and that split control, which passes the same test at 13.1%, is kept.
    expect(src).toContain("13.1%");
    // ⚠ NOT ENFORCEMENT. That the barred signal is never EMITTED is `standouts.ts`'s gate in
    // Phase 1; this constant only makes the bar impossible to miss when reading the module.
    expect(COUNCIL_MAJORITY_IS_NOT_A_SIGNAL).toBe(true);
  });

  it("publishes the section floor with its coverage cost", () => {
    const src = doc();
    expect(src).toContain(
      `**≥ ${SECTION_SIGNAL_MIN_SECTIONS} polling sections**`,
    );
    expect(src).toContain("99.5% of all sections");
  });
});

describe("standout thresholds — each measurement is stated once and checked twice", () => {
  // The note is the SOURCE and the doc is the target, so one edit fails two ways instead of
  // zero. Previously the note was checked only for length and the doc for hard-coded literals
  // unconnected to it — two halves of the same measurement, free to disagree.
  const DISTINCTIVE: Record<string, readonly string[]> = {
    close_contest: ["0.47", "4.88 pp"],
    turnout_departure: ["4.89", "12.81 pp", "12.05 pp"],
    fragmented_council: ["p50 = 4", "max = 16"],
  };

  it("every threshold's measured evidence appears in the published doc", () => {
    const src = doc();
    for (const [signal, t] of Object.entries(STANDOUT_THRESHOLDS)) {
      for (const figure of DISTINCTIVE[signal] ?? []) {
        expect(t.measured, `${signal} note omits ${figure}`).toContain(figure);
        expect(src, `doc omits ${signal}'s ${figure}`).toContain(figure);
      }
    }
  });

  it("carries all four of §7's fields on every threshold", () => {
    // Typed as the declared shape: `as const satisfies` keeps literal types, so
    // `Object.entries` narrows to a union on which the OPTIONAL members are absent.
    const entries = Object.entries(STANDOUT_THRESHOLDS) as [
      string,
      StandoutThreshold,
    ][];
    for (const [signal, t] of entries) {
      // value: a percentile OR a fixed count, never neither.
      expect(
        t.percentile !== undefined || t.minParties !== undefined,
        `${signal} has no value`,
      ).toBe(true);
      expect(t.minSample, `${signal} minSample`).toBeGreaterThan(0);
      expect(t.sampleUnit, `${signal} sampleUnit`).toBeTruthy();
      expect(t.basis, `${signal} basis`).toBeTruthy();
      expect(t.measured.length, `${signal} measured`).toBeGreaterThan(20);
      // "what it excludes" — the field that makes a later widening a decision, not a bug fix.
      expect(t.excludes.length, `${signal} excludes`).toBeGreaterThan(20);
    }
    expect(SECTION_SIGNAL_MEASURED).toContain("99.5%");
  });

  it("keeps the cycle-relative thresholds as PERCENTILES with an explicit tail", () => {
    // ⚠ The whole finding: a percentile is a fraction in (0,1); a pp value would be ≥ 1 and is
    // what an implementer reaches for. And the two select OPPOSITE tails — reading one as the
    // other would report the places whose turnout moved LEAST as departures.
    for (const signal of ["close_contest", "turnout_departure"] as const) {
      const t = STANDOUT_THRESHOLDS[signal];
      expect(t.percentile, signal).toBeGreaterThan(0);
      expect(t.percentile, signal).toBeLessThan(1);
      expect(["lower", "upper"], signal).toContain(t.tail);
    }
    expect(STANDOUT_THRESHOLDS.close_contest.tail).toBe("lower");
    expect(STANDOUT_THRESHOLDS.turnout_departure.tail).toBe("upper");
  });
});

describe("standout thresholds — the signal union is fully accounted for", () => {
  it("every signal has either a threshold or a recorded reason for having none", () => {
    // `ElectionStandoutSignal`'s header promises "a new signal cannot appear without copy and a
    // threshold". This is the threshold half, and it is only enforceable if the union is
    // covered exactly — a naming convention proves nothing.
    const SIGNALS: ElectionStandoutSignal[] = [
      "close_contest",
      "lead_change",
      "threshold_crossed",
      "split_control",
      "runoff_pending",
      "turnout_departure",
      "fragmented_council",
      "concentrated_support",
      "invalid_ballots",
      "additional_voters",
    ];
    const covered = new Set<string>([
      ...Object.keys(STANDOUT_THRESHOLDS),
      ...Object.keys(SIGNALS_WITHOUT_OWN_THRESHOLD),
    ]);
    for (const s of SIGNALS)
      expect(covered.has(s), `${s} has neither a threshold nor a reason`).toBe(
        true,
      );
    // …and nothing is accounted for twice, or accounted for and not in the union.
    expect([...covered].sort()).toEqual([...SIGNALS].sort());
  });

  it("gives every threshold-less signal a real reason", () => {
    for (const [signal, reason] of Object.entries(
      SIGNALS_WITHOUT_OWN_THRESHOLD,
    ))
      expect(reason.length, `${signal} reason`).toBeGreaterThan(15);
  });
});

describe("standout thresholds — review signals are inherited, not restated", () => {
  it("states the INHERITED values as the PRODUCER actually holds them", () => {
    // ⚠ The doc publishes these numbers (a reader cannot judge a flag without them), so the
    // gate reads the producer rather than a second hard-coded copy. Change `concentratedPct`
    // in the producer and the published methodology now asserts a false threshold for the one
    // signal class that names settlements — this is what catches it.
    const src = doc();
    expect(src).toContain(
      `\`concentratedPct\` = ${PRODUCER_THRESHOLDS.concentratedPct}`,
    );
    expect(src).toContain(
      `\`invalidBallotsPct\` = ${PRODUCER_THRESHOLDS.invalidBallotsPct}`,
    );
    expect(src).toContain(
      `\`additionalVotersPct\` = ${PRODUCER_THRESHOLDS.additionalVotersPct}, min ${PRODUCER_THRESHOLDS.additionalVotersMinActual}`,
    );
  });

  it("names BOTH producers, not just the dashboard one", () => {
    // Benford's pair is written to `reports/`, not `dashboard/`. A generator following only
    // the first source would find four of the five inherited thresholds.
    const src = doc();
    expect(REVIEW_THRESHOLDS_ARE_READ_FROM_THE_PRODUCER).toBe(true);
    expect(Object.keys(REVIEW_THRESHOLD_SOURCES).length).toBe(2);
    for (const source of Object.values(REVIEW_THRESHOLD_SOURCES))
      expect(src, `doc omits ${source}`).toContain(
        source.split("#")[0].split("/").pop(),
      );
    expect(src).toContain("scripts/reports/benford.ts");
    expect(src).toMatch(/inherited, never chosen/i);
  });

  it("does not carry Benford as an emittable signal", () => {
    // §4 says Benford is not a standout signal in v1 — `ElectionStandoutSignal` has no member
    // for it — so neither bucket may claim one.
    const covered = [
      ...Object.keys(STANDOUT_THRESHOLDS),
      ...Object.keys(SIGNALS_WITHOUT_OWN_THRESHOLD),
    ];
    expect(covered.join(" ")).not.toMatch(/benford/i);
    expect(doc()).toContain("Benford is not a standout signal in v1");
  });
});

describe("standout thresholds — the basis keys are enumerable", () => {
  it("closes the basis vocabulary against ElectionBaselineKind", () => {
    // `Record<Union, string>` makes a missing member a compile error; this pins that no value
    // is empty and none collides.
    const keys = thresholdCopyKeys();
    expect(keys.length).toBe(Object.keys(BASIS_LABEL_KEYS).length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^election_basis_[a-z_]+$/);
  });

  it("uses only declared basis kinds on the thresholds themselves", () => {
    for (const [signal, t] of Object.entries(STANDOUT_THRESHOLDS))
      expect(
        Object.keys(BASIS_LABEL_KEYS),
        `${signal} basis ${t.basis}`,
      ).toContain(t.basis);
  });
});
