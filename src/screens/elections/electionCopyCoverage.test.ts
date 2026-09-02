// Every i18n key the election surfaces can name resolves in BOTH corpora.
//
// This is the gate `descriptorCopyKeys()` was written for, and it exists because the failure it
// catches is silent: a key in neither corpus satisfies every clause of `parity.test.ts` — which
// only compares bg against en, so a key missing from both is perfectly consistent — and renders
// as its own raw identifier at a 200.
//
// It was unwritten for the first two weeks of the matrix's life, and the cost was measurable
// the day it landed: three ballot labels (`election_ballot_parl_list`, `_muni_mayor`,
// `_council`) were enumerated by `descriptorCopyKeys()` and present in neither language,
// because the label existed twice — once as a per-slot literal on each of eighteen descriptor
// entries and once as a `Record` over `BallotKind`. Collapsing to the Record is what fixed it;
// this gate is what would have caught it.
//
// ⚠ THE RENDER SUITE CANNOT REPLACE THIS. `ElectionResultsShell.test.tsx` loads bg only, so a
// key present in Bulgarian and missing in English renders correctly there and as an identifier
// on every English page.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { SRC_DIR } from "@/../scripts/lib/module_graph";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  descriptorCopyKeys,
  SHELL_COPY_KEYS,
} from "./electionSurfaceDescriptors";

/** The descriptors' vocabulary plus the shell's own chrome — the latter is named by no
 *  descriptor, so `descriptorCopyKeys()` structurally cannot cover it. */
const ALL_KEYS = [
  ...new Set([...descriptorCopyKeys(), ...SHELL_COPY_KEYS]),
].sort();

describe("election copy coverage", () => {
  it("is not vacuous", () => {
    // Every assertion below is "the missing set is empty", which an empty key list satisfies.
    expect(ALL_KEYS.length).toBeGreaterThan(40);
    expect(ALL_KEYS).toContain("election_fact_turnout");
    expect(ALL_KEYS).toContain("election_standouts_title"); // the shell's own chrome
  });

  it.each([
    ["bg", bgCorpus],
    ["en", enCorpus],
  ])("%s carries every key the surfaces can name", (_lang, corpus) => {
    const missing = ALL_KEYS.filter((k) => !(k in corpus));
    expect(missing, `missing: ${missing.join(", ")}`).toEqual([]);
  });

  it.each([
    ["bg", bgCorpus],
    ["en", enCorpus],
  ])("%s carries no EMPTY value for one", (_lang, corpus) => {
    // A key present with an empty string passes membership and renders a blank label, which is
    // harder to notice than a raw identifier.
    const blank = ALL_KEYS.filter((k) => (corpus[k] ?? "").trim() === "");
    expect(blank, `blank: ${blank.join(", ")}`).toEqual([]);
  });

  it("names no key twice under two spellings", () => {
    // The defect this file was written after: one label, two keys, three of them unreachable.
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  it("covers every literal key the result shell actually names", () => {
    // ⚠ `SHELL_COPY_KEYS` IS HAND-WRITTEN, so on its own it is a claim rather than a fact: a
    // key added to the shell and forgotten here is covered by nothing, which is exactly the
    // state the three orphan ballot labels were in. This reads the shell back.
    const src = stripComments(
      fs.readFileSync(
        path.join(SRC_DIR, "screens/elections/ElectionResultsShell.tsx"),
        "utf8",
      ),
    );
    const named = [...src.matchAll(/\bt\(\s*"([a-z][a-z0-9_]+)"/g)].map(
      (m) => m[1],
    );
    expect(
      named.length,
      'found no t("…") literal — the scan is broken',
    ).toBeGreaterThan(5);
    const uncovered = [...new Set(named)].filter((k) => !ALL_KEYS.includes(k));
    expect(
      uncovered,
      `named by the shell, covered by nothing: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });
});
