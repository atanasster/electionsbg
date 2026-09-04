// The wiring `sameCandidacyParty` rests on, pinned STATICALLY over the resolver's source.
// Plan: docs/plans/person-search-duplicate-rows-v1.md §4.
//
// WHY A STATIC GATE, AND WHY THAT IS NOT LAZINESS — the same argument
// `resolve_persons_bridge_columns.test.ts` makes one file over, with one addition of its own.
//
// The rule merges two candidacies into ONE PUBLISHED PERSON. Its whole licence is name +
// canonical party + different election, and two of those three arrive through this wiring:
//
//   - DROP the `candidacyElection` derivation and the rule goes silently INERT. No error, no
//     row-count change; the merges simply stop and the duplicate person records come back.
//     Nothing in `cluster.test.ts` can see it, because those tests build Mentions by hand.
//   - Pass `partyNum` where `cParty` expects the CANONICAL id and the rule goes silently
//     WRONG in both directions: the ballot number changes every election (28, then 1, then 28
//     in the reported case), so real continuity is refused — and two unrelated parties that
//     drew the same number in different years are asserted to be one. That is a wrong public
//     merge, which cluster.ts's header calls an accusation.
//
// Neither is reachable from a unit test of the rule, and the corpus-level gates that WOULD
// see them (`person_resolve.data.test.ts`) need a loaded Postgres and auto-skip without one —
// so on a machine with no container they report green while asserting nothing. This file
// needs no database: it reads the resolver's own source.
//
// ⚠️ IT CANNOT PROVE THE VALUES ARE RIGHT, only that the wiring still says what it said.
// Correctness belongs to the data gates. A static gate pretending otherwise would be worse
// than none.
//
//   npm run test:unit

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { stripComments } from "../lib/strip_comments";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = fs.readFileSync(path.join(DIR, "resolve_persons.ts"), "utf8");
// Comments discuss `partyNum`, `candidacyElection` and the candidate ref shape at length in
// this very file, so prose that MENTIONS a pattern would otherwise read as an occurrence of
// it — the trap the shared stripper's own header documents in both directions.
const SRC = stripComments(RAW);

/** Whitespace-insensitive, so a prettier reflow is not a failure but a rewrite is. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

describe("resolve_persons — the candidacy-continuity wiring", () => {
  it("strips comments before matching — the prose here mentions every pattern below", () => {
    // Without this the gate is theatre: the file's own comments contain
    // `source === "candidate"`, `cParty`, and the ref shape, so every assertion would pass
    // against a source in which the CODE had been deleted and only the explanation remained.
    expect(RAW).toContain("LOUD, not last-wins");
    expect(SRC).not.toContain("LOUD, not last-wins");
  });

  it("derives the election through the ONE shared helper, spelled exactly", () => {
    // An exact normalised equality rather than substring tests: it catches a WIDENED
    // predicate (`|| r.source === "donor"`), a narrowed one, an index change and a `split`
    // variant in a single assertion, and reports the actual text on failure. Substring
    // assertions passed the widened form — measured.
    const m = /const candidateElectionOf =[^;]*;/.exec(SRC);
    expect(m, "candidateElectionOf is gone").not.toBeNull();
    expect(norm(m![0])).toBe(
      "const candidateElectionOf = (source: string, ref: string): string | null => " +
        'source === "candidate" ? ref.split(":")[0] : null;',
    );
  });

  it("uses that helper at BOTH identity sites, not a re-spelled copy", () => {
    // `candidacyElection` feeds sameCandidacyParty (an automatic public merge);
    // `electionDate` feeds applyOverrides (a hand-adjudicated one). They are expected to
    // partition candidacies identically, and were two independent spellings until 2026-09-04.
    expect(SRC).toContain(
      "candidacyElection: candidateElectionOf(r.source, r.ref)",
    );
    expect(SRC).toContain(
      "electionDate: candidateElectionOf(m.source, m.raw.ref)",
    );
    // No THIRD site may re-derive it inline. Exactly one `<x>.ref.split(":")` survives —
    // `localCycle`, which is a different rule over a different source (the helper's own body
    // reads the bare parameter `ref`, so it is not counted here).
    expect(SRC.match(/\w\.ref\.split\(":"/g) ?? []).toHaveLength(1);
  });

  it('mints `source: "candidate"` EXACTLY ONCE, with the `<election>:<slug>` ref', () => {
    // ⚠️ THE UNIQUENESS IS THE LOAD-BEARING HALF, and pinning the ref shape alone does not
    // give it. A SECOND candidate-source site with a colon-free ref would leave every other
    // assertion here green while handing the rule a mention whose "election" is the whole
    // ref — unique per mention, which defeats `contested.ballots`, `provenMultiPerson` AND
    // the different-election check at once, leaving the merge on the namesake cap alone.
    // That cap is the one the plan measured as insufficient.
    expect(SRC.match(/source: "candidate"/g) ?? []).toHaveLength(1);
    expect(SRC).toContain("ref: `${election}:${c.slug}`");
    expect(SRC).toContain("id: `candidate:${election}:${c.slug}`");
  });

  it("passes the CANONICAL party for a candidacy, never the ballot number", () => {
    // ⚠️ BOUNDED BY TWO LINES OF CODE, never by a comment. The first cut ended the slice at
    // `"// Donors"` — which `stripComments` has already removed, so `indexOf` returned -1,
    // `slice(start, -1)` ran to the end of the file, and the assertion passed on a DIFFERENT
    // `cParty: canon` forty lines further down. Caught by mutation: substituting the ballot
    // number left the gate green.
    const start = SRC.indexOf("hardId: c.mpId != null");
    const end = SRC.indexOf("cPlace: oblast", start);
    expect(start, "the candidate add() call moved").toBeGreaterThan(-1);
    expect(end, "the candidate add() call moved").toBeGreaterThan(start);
    expect(SRC.slice(start, end)).toContain("cParty: canon");
    // …and `canon` is the canonical lookup, not a rename of the ballot number.
    expect(SRC).toMatch(
      /const canon =\s*\n?\s*c\.partyNum != null\s*\n?\s*\?\s*\(partyMap\.get\(`\$\{election\}#\$\{c\.partyNum\}`\)/,
    );
  });

  it("refuses a canonical-party map that gives one ballot number to two parties", () => {
    // That map is the whole non-name half of the merge licence, so a duplicate key deciding
    // by file order would silently choose which party two candidacies "share".
    const fn = SRC.slice(
      SRC.indexOf("function buildPartyMap"),
      SRC.indexOf("const candidateElectionOf"),
    );
    expect(fn).toContain("prior !== party.id");
    expect(fn).toMatch(/throw new Error\(/);
  });

  it("keeps localCycle beside it — the two derivations must not drift apart", () => {
    // Same shape for the same reason (a ref whose first segment is the cycle), and
    // `sameLocalSeat` / `sameCandidacyParty` are structural twins. A change to one that skips
    // the other is the "someone missed one" shape this repo documents elsewhere.
    expect(SRC).toContain(
      'localCycle: r.source === "local" ? r.ref.split(":")[0] : null,',
    );
  });
});
