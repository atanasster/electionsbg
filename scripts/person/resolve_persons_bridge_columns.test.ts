// The `bridge` / `bridge_footprint` columns must stay in resolve_persons.ts's person_role
// COPY list, and every writer of them must supply BOTH.
// Plan: docs/plans/person-role-unlicensed-bridge-v1.md (step 3).
//
// WHY THIS IS A STATIC GATE OVER THE SOURCE, AND WHY THAT IS NOT LAZINESS.
//
// The failure it guards is invisible to every other check in this family:
//
//   - `person_role` is DELETEd and re-COPYd on every resolve, so a column dropped from the
//     COPY list comes back NULL for every row. Nothing errors; the row counts are identical.
//   - 081 ships NO BACKFILL for these two, by design — the corpus vintage the resolver saw is
//     unrecoverable — so unlike `date_basis` there is no second writer to carry a warm
//     database across the gap. The value is simply gone until the NEXT resolve, which is a
//     ~37-minute job plus a documented repair chain.
//   - The CHECK constraints accept NULL (that is what NULL MEANS here: "attached before the
//     columns existed"), so the database cannot refuse it either.
//
// And it is the ONE gate in this family that runs in CI. Every other check —
// `person_role_bridge.data.test.ts`, `person_company_basis.data.test.ts`,
// `person_resolve.data.test.ts` — needs a loaded Postgres and auto-skips without one, so on
// a machine with no container they all report green while asserting nothing. This file needs
// no database at all: it reads the resolver's own source.
//
// ⚠️ IT CANNOT PROVE THE VALUES ARE RIGHT, only that the writers still name both columns.
// Correctness of the stamped values is the data gate's job (and, until step 4, nobody's).
// A static gate that pretended otherwise would be worse than none.
//
//   npm run test:unit

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { stripComments } from "../lib/strip_comments";

const RAW = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "resolve_persons.ts"),
  "utf8",
);

// The tuple below is documented line-by-line, so a naive comma count reads the prose. The
// shared stripper removes line-owning comments only — the safe form; see its header for the
// two gates that were burned by an unanchored one, in opposite directions.
const SRC = stripComments(RAW);

/** The `copyRows(c, "person_role", [ … ], roleRows)` column list, as source text. */
const personRoleCopyList = (): string => {
  const at = SRC.indexOf('"person_role",');
  expect(
    at,
    'resolve_persons.ts no longer COPYs into "person_role"',
  ).toBeGreaterThan(-1);
  const open = SRC.indexOf("[", at);
  const close = SRC.indexOf("]", open);
  return SRC.slice(open, close);
};

describe("resolve_persons person_role COPY", () => {
  it("still carries bridge and bridge_footprint", () => {
    const list = personRoleCopyList();
    for (const col of ["bridge", "bridge_footprint"]) {
      expect(
        list.includes(`"${col}"`),
        `"${col}" is missing from the person_role COPY column list. The resolver DELETEs and ` +
          `re-COPYs person_role, 081 ships no backfill for these columns, and their CHECK ` +
          `accepts NULL — so the next resolve would silently blank the licence on every ` +
          `tr/ngo role in the corpus, recoverable only by another ~37-minute resolve.`,
      ).toBe(true);
    }
  });

  it("places both columns between confidence and source_row, in that order", () => {
    // NOT an arity count. A wrong COUNT is caught loudly by Postgres at COPY time (verified),
    // so the silent risk is a SHIFT — two values swapped, or a column inserted on one side
    // and not the other, which would put a `confidence` into `bridge`. What pins that is
    // relative ORDER on both sides, and it is robust in a way comma-counting is not: the
    // tuple is documented line-by-line and two of those comments are TRAILING ones that
    // contain commas, so a naive count reads the prose. (The shared stripper removes only
    // line-owning comments by default — its header explains why the unanchored form is
    // opt-in, and this scan would not qualify for it.)
    const cols = [...personRoleCopyList().matchAll(/"([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(cols[0]).toBe("person_id"); // sanity: we parsed the right bracket
    expect(
      cols.slice(cols.indexOf("confidence")),
      "the person_role COPY column list changed shape around the bridge columns",
    ).toEqual(["confidence", "bridge", "bridge_footprint", "source_row"]);

    // The tuple's tail, in the same order. `b.confidence` and `m.raw.sourceRow` are the two
    // neighbours; the licence and its (always-null) Bridge-A footprint sit between them.
    const push = SRC.indexOf("roleRows.push([");
    expect(push, "roleRows.push([ … ]) not found").toBeGreaterThan(-1);
    const tail = SRC.slice(push, SRC.indexOf("aliasSeen", push));
    const iConfidence = tail.indexOf("b.confidence");
    const iBridge = tail.indexOf('? "A" : null');
    const iSourceRow = tail.indexOf("m.raw.sourceRow");
    expect(
      iConfidence > -1 && iBridge > -1 && iSourceRow > -1,
      "the person_role tuple no longer carries confidence, the bridge stamp and source_row",
    ).toBe(true);
    expect(
      iConfidence < iBridge && iBridge < iSourceRow,
      "the bridge stamp is no longer between confidence and source_row in the pushed tuple, " +
        "so it no longer lines up with the column list. A same-arity swap here writes a " +
        "confidence value into person_role.bridge — which 081's CHECK would reject, but only " +
        "after a ~37-minute rebuild has reached the COPY.",
    ).toBe(true);
  });
});

describe("every bridge writer supplies both columns", () => {
  // Three writers, each independently responsible for the pair. One supplying a footprint
  // without a licence produces (NULL, N) — the shape 081's CHECK was tightened with `IS TRUE`
  // to refuse — and one supplying a licence without a footprint produces ('B', NULL), which
  // the CHECK ACCEPTS, so nothing but this would notice.
  const writers = [
    { name: "Bridge B INSERT", marker: "'B', f.n_uic" },
    { name: "Tier-V INSERT", marker: "'V', v.n_uic" },
  ];

  for (const w of writers) {
    it(`${w.name} stamps a licence and a footprint together`, () => {
      expect(
        SRC.includes(w.marker),
        `${w.name} no longer stamps \`${w.marker}\`. If the licence is written without its ` +
          `footprint, 081's CHECK accepts the row and the freshness measurement loses its ` +
          `baseline silently.`,
      ).toBe(true);
    });
  }

  it("the Bridge-A arm stamps a licence and NO footprint", () => {
    // Bridge A is not footprint-capped — a curated link is licensed by the register that made
    // it, however many companies the name matches — and 081's CHECK actively refuses a
    // footprint on an 'A' row. So the correct spelling here is a literal null.
    expect(
      SRC.includes('m.source === "tr" || m.source === "ngo" ? "A" : null'),
      "the roleRows tuple no longer stamps 'A' for tr/ngo mentions. That COPY is the ONLY " +
        "path a curated (magistrate_company ∪ company_politicians) link takes into " +
        "person_role, so without it every Bridge-A row reads as unlicensed.",
    ).toBe(true);
  });

  it("declares both INSERT column lists", () => {
    const inserts = [
      ...SRC.matchAll(/INSERT INTO person_role \(([^)]*)\)/g),
    ].map((m) => m[1].replace(/\s+/g, " "));
    expect(
      inserts.length,
      "expected the Bridge-B and Tier-V INSERTs into person_role",
    ).toBeGreaterThanOrEqual(2);
    for (const cols of inserts) {
      expect(
        cols.includes("bridge") && cols.includes("bridge_footprint"),
        `an INSERT INTO person_role omits a bridge column: (${cols}). Every writer must ` +
          `supply both, or the rows it creates are indistinguishable from pre-column ones.`,
      ).toBe(true);
    }
  });
});
