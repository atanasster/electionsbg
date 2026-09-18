// Corpus-integrity gate for the Jev regression suite. PURE: no network, no API
// key, no Postgres — so CI can guard the suite for free while the billed run
// (jevRegression.run.ts) stays an explicit operator action.
//
// What this protects against is the failure mode that already bit once: an
// UNANSWERABLE case scoring the model wrong. The oblast generator used to
// include regions.json's `-NN` seat-city rows (`PDV-00` "Пловдив") alongside
// the province (`PDV` "обл. Пловдив") while asking "which REGION does the
// question name" — Jev answered the province, which was right, and the corpus
// called it a miss. Every assertion below exists because a corpus defect is
// indistinguishable from a model regression in the final number.

import { describe, expect, it } from "vitest";
import {
  closedVocabCases,
  duplicateLetter,
  dropLetter,
  loadDisambigFixture,
  NONE_OF_THESE,
  transposeLetters,
  TYPO_KINDS,
} from "./jevRegression.cases";

describe("closed-vocabulary corpus", () => {
  const cases = closedVocabCases();

  it("is non-trivially sized and covers every parameter", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(cases.map((c) => c.param))).toEqual(
      new Set(["election", "oblast", "party", "scope"]),
    );
  });

  it("gives every case a unique id", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only asks questions whose expected answer is actually on offer", () => {
    for (const c of cases)
      expect(
        Object.keys(c.candidates),
        `${c.id}: expected "${c.expected}" is not a candidate`,
      ).toContain(c.expected);
  });

  // The PDV/PDV-00 defect: two candidates that render as the same label make a
  // case unanswerable, because nothing in the question can separate them.
  it("never offers two candidates with the same display label", () => {
    for (const c of cases) {
      const labels = Object.entries(c.candidates).map(([k, v]) =>
        (v ?? k).toString().toLowerCase().trim(),
      );
      const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
      expect(
        dupes,
        `${c.id}: duplicate candidate labels ${dupes.join(", ")}`,
      ).toHaveLength(0);
    }
  });

  it("asks both languages for every case, and never leaves one empty", () => {
    for (const c of cases) {
      expect(c.question.en.trim().length, `${c.id} en`).toBeGreaterThan(0);
      expect(c.question.bg.trim().length, `${c.id} bg`).toBeGreaterThan(0);
      expect(c.instructions.en.trim().length).toBeGreaterThan(0);
      expect(c.instructions.bg.trim().length).toBeGreaterThan(0);
    }
  });

  // A false-positive half is what keeps "always answer something" from scoring
  // well; without it the suite cannot see a model that never abstains.
  it("carries negative cases that name no value", () => {
    const negatives = cases.filter(
      (c) => c.expected === "none" || c.expected === "unspecified",
    );
    expect(negatives.length).toBeGreaterThanOrEqual(3);
  });

  it("names the region as a province, never a seat city", () => {
    // Guards the fix directly: no `-NN` suffixed code may reach the corpus.
    for (const c of cases.filter((x) => x.param === "oblast"))
      for (const key of Object.keys(c.candidates))
        expect(
          key,
          `${c.id}: seat-city code leaked into the region vocabulary`,
        ).not.toMatch(/-\d+$/);
  });
});

describe("typo generators", () => {
  const sample = "Николай Георгиев Иванов";

  it("actually changes the name", () => {
    for (const { kind, fn } of TYPO_KINDS)
      expect(fn(sample), kind).not.toBe(sample);
  });

  it("is deterministic", () => {
    for (const { fn } of TYPO_KINDS) expect(fn(sample)).toBe(fn(sample));
  });

  it("produces the three distinct shapes measured in the plan", () => {
    expect(
      new Set([
        dropLetter(sample),
        transposeLetters(sample),
        duplicateLetter(sample),
      ]).size,
    ).toBe(3);
    expect(dropLetter(sample).length).toBe(sample.length - 1);
    expect(duplicateLetter(sample).length).toBe(sample.length + 1);
    expect(transposeLetters(sample).length).toBe(sample.length);
  });
});

describe("frozen disambiguation fixture", () => {
  const fixture = loadDisambigFixture();

  it("exists (capture it with jevRegression.capture.ts)", () => {
    expect(fixture, "no fixture on disk").not.toBeNull();
  });

  if (!fixture) return;

  it("is non-trivially sized and carries both classes", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(100);
    const klasses = new Set(fixture.cases.map((c) => c.klass));
    expect(klasses).toEqual(new Set(["present", "absent"]));
  });

  it("labels each case consistently with its own candidate list", () => {
    // `klass` is the whole basis of the split-scoring, so it must be derivable
    // from the frozen data rather than trusted: present ⇔ expected is a real
    // candidate; absent ⇔ expected is the refusal sentinel.
    for (const c of fixture.cases) {
      const keys = Object.keys(c.candidates);
      expect(keys, `${c.id}: expected not on offer`).toContain(c.expected);
      if (c.klass === "present") {
        expect(c.expected, `${c.id}: present case expects a refusal`).not.toBe(
          NONE_OF_THESE,
        );
      } else {
        expect(c.expected, `${c.id}: absent case expects a real key`).toBe(
          NONE_OF_THESE,
        );
      }
    }
  });

  it("always offers the refusal option", () => {
    for (const c of fixture.cases)
      expect(Object.keys(c.candidates), `${c.id}`).toContain(NONE_OF_THESE);
  });

  it("names the misspelled query in both language questions", () => {
    for (const c of fixture.cases) {
      expect(c.question.en, `${c.id} en`).toContain(c.typoQuery);
      expect(c.question.bg, `${c.id} bg`).toContain(c.typoQuery);
    }
  });

  it("only uses queries that are genuinely misspelled", () => {
    for (const c of fixture.cases)
      expect(c.typoQuery, `${c.id}`).not.toBe(c.anchorName);
  });

  it("gives every case a unique id", () => {
    const ids = fixture.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
