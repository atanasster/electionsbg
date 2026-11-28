// Gate for the education EIK register (`src/lib/educationReferenceData.ts`).
//
// The register IS the sector: every /sector/edu figure is `awarder_eik = ANY(…)`
// over it, so a body missing from it is absent from the roll-up, the bodies page,
// the finder and the hub at once, with every total still reconciling. The T0
// audit found exactly that — ЦРЧР €9.58M and НДД €2.58M in no sector (A1), a fifth
// military higher school missing from the external list (A2), and name matches
// nobody had recorded as „not education" (A3). Membership tests over the file
// cannot find what nobody listed, so this sweeps the CORPUS: every education-like
// buyer above a money floor must be in exactly one declared list.
//
// The matcher is `src/lib/educationMatch.ts`; read its header for what it can
// and cannot find (the БАН / ССА institutes are held by the register, not by
// the sweep).
//
// Auto-skips only when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { eduNameSql } from "@/lib/educationMatch";
import {
  EDU_ADJACENT,
  EDU_ENTITIES,
  EDU_EXCLUDED,
  EDU_VERIFY,
  EDUCATION_EXTERNAL_HIGHER_SCHOOLS,
} from "@/lib/educationReferenceData";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

/** €500,000 (the plan's floor). Below it the tail is single-contract school
 *  namesakes; above it a buyer's absence moves a published number. */
const MONEY_FLOOR = 500_000;

const declared = (): string[] => [
  ...EDU_ENTITIES.map((e) => e.eik),
  ...EDU_VERIFY.map((e) => e.eik),
  ...EDU_ADJACENT.map((e) => e.eik),
  ...EDU_EXCLUDED.map((e) => e.eik),
  ...EDUCATION_EXTERNAL_HIGHER_SCHOOLS.map((e) => e.eik),
];

type Row = { eik: string; name: string; eur: string };

const fmt = (rows: Row[]) =>
  rows
    .map(
      (r) =>
        `  ${r.eik}  €${Number(r.eur).toLocaleString().padStart(14)}  ${r.name.slice(0, 70)}`,
    )
    .join("\n");

const sweepContracts = (guard = true) =>
  allRows<Row>(
    `SELECT awarder_eik AS eik, min(awarder_name) AS name,
            round(sum(amount_eur)::numeric, 0) AS eur
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik IS NOT NULL
        AND ${eduNameSql("awarder_name", guard)}
        AND NOT (awarder_eik = ANY($1))
      GROUP BY 1
     HAVING sum(amount_eur) > $2
      ORDER BY sum(amount_eur) DESC`,
    [declared(), MONEY_FLOOR],
  );

const UNCLASSIFIED =
  "Each needs a list in educationReferenceData.ts — roll-up (EDU_ENTITIES), " +
  "EDU_VERIFY (principal unsettled), EDU_ADJACENT (an education body under " +
  "another principal), EDUCATION_EXTERNAL_HIGHER_SCHOOLS, or EDU_EXCLUDED " +
  "(not an education body):\n";

test("no EIK is declared in two lists", () => {
  const seen = new Map<string, string>();
  const lists: [string, readonly { eik: string }[]][] = [
    ["EDU_ENTITIES", EDU_ENTITIES],
    ["EDU_VERIFY", EDU_VERIFY],
    ["EDU_ADJACENT", EDU_ADJACENT],
    ["EDU_EXCLUDED", EDU_EXCLUDED],
    ["EDUCATION_EXTERNAL_HIGHER_SCHOOLS", EDUCATION_EXTERNAL_HIGHER_SCHOOLS],
  ];
  for (const [name, list] of lists)
    for (const { eik } of list) {
      const prev = seen.get(eik);
      assert.equal(prev, undefined, `${eik} is in both ${prev} and ${name}`);
      seen.set(eik, name);
    }
});

test.skipIf(skip)(
  "every education buyer in CONTRACTS above the floor is classified",
  async () => {
    const rows = await sweepContracts();
    assert.equal(
      rows.length,
      0,
      `${rows.length} education-named awarder(s) over €${MONEY_FLOOR.toLocaleString()} ` +
        `are in no list. ${UNCLASSIFIED}${fmt(rows)}`,
    );
  },
);

test.skipIf(skip)(
  "every education buyer in TENDERS above the floor is classified",
  async () => {
    // A contracts-only sweep is blind to a buyer with published procedures and no
    // award. Floored on the estimated value, never on a procedure count.
    const rows = await allRows<Row>(
      `SELECT buyer_eik AS eik, min(buyer_name) AS name,
              round(sum(estimated_value_eur)::numeric, 0) AS eur
         FROM tenders
        WHERE buyer_eik IS NOT NULL
          AND ${eduNameSql("buyer_name")}
          AND NOT (buyer_eik = ANY($1))
        GROUP BY 1
       HAVING sum(estimated_value_eur) > $2
        ORDER BY sum(estimated_value_eur) DESC`,
      [declared(), MONEY_FLOOR],
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length} education-named buyer(s) in tenders over ` +
        `€${MONEY_FLOOR.toLocaleString()} are in no list. ${UNCLASSIFIED}${fmt(rows)}`,
    );
  },
);

test.skipIf(skip)("a NULL EIK cannot hide from either sweep", async () => {
  // The sweep groups by awarder_eik, so a NULL one would be skipped silently.
  const [r] = await allRows<{ n: number }>(
    `SELECT count(*)::int n FROM contracts
        WHERE tag = 'contract' AND awarder_eik IS NULL
          AND ${eduNameSql("awarder_name")}`,
  );
  assert.equal(r.n, 0, `${r.n} education-named contract(s) carry no EIK`);
  const [t] = await allRows<{ n: number }>(
    `SELECT count(*)::int n FROM tenders
        WHERE buyer_eik IS NULL AND ${eduNameSql("buyer_name")}`,
  );
  assert.equal(t.n, 0, `${t.n} education-named tender(s) carry no EIK`);
});

test.skipIf(skip)(
  "the matcher AGREES with the register on the populations it claims to find",
  async () => {
    // The only check that catches a too-NARROW matcher (§2 rule 5): every curated
    // higher school and support centre with a contract must be admitted by name.
    // A sweep that cannot see them could never have found the next one.
    const claimed = [
      ...EDU_ENTITIES.filter((e) => e.universe === "higher_education"),
      ...EDU_VERIFY.filter((v) => v.kind !== "other"),
    ].map((e) => e.eik);
    const rows = await allRows<{ eik: string; name: string }>(
      `SELECT awarder_eik eik, min(awarder_name) name FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY 1
       HAVING NOT bool_or(${eduNameSql("awarder_name")})`,
      [claimed],
    );
    assert.deepEqual(
      rows.map((r) => `${r.eik} ${r.name}`),
      [],
      "curated bodies the name matcher cannot see — widen a stem in educationMatch.ts",
    );
    // Non-vacuity: the population is real.
    const [n] = await allRows<{ n: number }>(
      `SELECT count(DISTINCT awarder_eik)::int n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [claimed],
    );
    assert.ok(n.n >= 50, `only ${n.n} claimed bodies have contracts`);
  },
);

test.skipIf(skip)(
  "the hospital guard CHANGES the sweep (§2 rule 4)",
  async () => {
    // Without the guard „Университетска … болница" floods the sweep; a guard that
    // moves nothing is a guard someone deletes.
    const unguarded = await sweepContracts(false);
    assert.ok(
      unguarded.length >= 10,
      `only ${unguarded.length} hospital(s) reach the unguarded sweep — is the guard still needed?`,
    );
    assert.ok(unguarded.every((r) => /болниц/i.test(r.name)));
  },
);
