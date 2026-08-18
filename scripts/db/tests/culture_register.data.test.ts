// Gate for the culture EIK register (`src/lib/kulturaReferenceData.ts`).
//
// The register is the foundation every culture figure sits on, and it fails
// SILENTLY in both directions:
//
//   UNDER-COVERAGE — a culture buyer in none of the declared lists is simply
//   absent from the roll-up, the roster, the oblast map and the search box at
//   once, with every total still reconciling. Measured 2026-08-18, before this
//   gate existed: FIFTEEN national art schools were missing, €9.96m, and they
//   are the sector's most competition-poor tier (48.6% single-bid against a
//   40.9% national baseline) — so the omission removed exactly the buyers a
//   reader would most want to see.
//
//   MIS-CLASSIFICATION — a body in the wrong list. T0.6 split the old
//   anti-allowlist in two because it was carrying „this is not a culture body"
//   (Община Куклен, a regex false match) and „this is a culture body that
//   answers to somebody else" (Националният военноисторически музей) under one
//   name, and reading the second as the first is what made €28.6m of
//   art-academy procurement look like it had been considered and rejected.
//
// So the gate enumerates CANDIDATES from the corpus by name and requires every
// one above a money floor to be in EXACTLY ONE declared list — where „declared"
// includes the читалища name rule, since that population is defined by name
// rather than by an allowlist. A new culture buyer appearing in a future ingest
// therefore fails this test until somebody classifies it, which is the point.
//
// Auto-skips ONLY when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { cultureNameSql, chitalishteNameSql } from "@/lib/cultureMatch";
import { CURATED_AWARDER_SEATS } from "../../procurement/enrich_awarder_seats";
import {
  CULTURE_GROUP_EIKS,
  CULTURE_FUNDER_EIKS,
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
  ART_SCHOOLS,
  NFC_EIK,
  STATE_CULTURE_INSTITUTE_EIKS,
  ART_SCHOOL_EIKS,
  ADJACENT_EIKS,
  ADJACENT_EIK_LIST,
  EXCLUDED_EIKS,
  VERIFY_PRINCIPAL_EIKS,
} from "@/lib/kulturaReferenceData";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/** €200,000 of awarded contracts. Not arbitrary: below it the tail is regional
 *  museums and single-contract читалища, which the читалища name rule and Tier C
 *  already cover as populations rather than as individuals. Above it, a buyer is
 *  big enough that its absence changes a published number. */
const MONEY_FLOOR = 200_000;

const declared = (): string[] => [
  ...CULTURE_GROUP_EIKS,
  ...VERIFY_PRINCIPAL_EIKS,
  ...ADJACENT_EIK_LIST,
  ...Object.keys(EXCLUDED_EIKS),
];

// ── the lists are disjoint and internally consistent ─────────────────────────

test("no EIK is declared twice", () => {
  const seen = new Map<string, string>();
  const lists: [string, readonly string[]][] = [
    ["CULTURE_FUNDER_EIKS", CULTURE_FUNDER_EIKS],
    ["STATE_CULTURE_INSTITUTE_EIKS", STATE_CULTURE_INSTITUTE_EIKS],
    ["ART_SCHOOL_EIKS", ART_SCHOOL_EIKS],
    ["VERIFY_PRINCIPAL_EIKS", VERIFY_PRINCIPAL_EIKS],
    ["ADJACENT_EIK_LIST", ADJACENT_EIK_LIST],
    ["EXCLUDED_EIKS", Object.keys(EXCLUDED_EIKS)],
  ];
  for (const [name, list] of lists)
    for (const eik of list) {
      const prev = seen.get(eik);
      assert.equal(
        prev,
        undefined,
        `${eik} is in both ${prev} and ${name} — a body must have exactly one ` +
          `classification, or the roll-up and the exclusions disagree`,
      );
      seen.set(eik, name);
    }
});

test("T0.6 holds: no adjacent body is in the roll-up", () => {
  // The decision in one assertion. `ADJACENT_EIKS` exists so a real cultural
  // body with a non-МК principal is DECLARED rather than denied; the moment one
  // reaches the roll-up, the headline stops meaning „state culture, principal МК".
  for (const eik of ADJACENT_EIK_LIST)
    assert.ok(
      !CULTURE_GROUP_EIKS.includes(eik),
      `${eik} (${ADJACENT_EIKS[eik].bg}) is adjacent AND in the roll-up`,
    );
  assert.ok(
    ADJACENT_EIK_LIST.length > 0,
    "the adjacent list is empty — T0.6's decision has been undone",
  );
});

test("every EIK is nine or thirteen digits", () => {
  for (const eik of declared())
    assert.match(eik, /^\d{9}$|^\d{13}$/, `${eik} is not a Bulgarian EIK`);
});

// ── the corpus sweep ─────────────────────────────────────────────────────────

test.skipIf(skip)(
  "every culture buyer above the money floor is classified",
  async () => {
    const rows = await allRows<{ eik: string; name: string; eur: string }>(
      `SELECT awarder_eik AS eik, min(awarder_name) AS name,
              round(sum(amount_eur)::numeric, 0) AS eur
         FROM contracts
        WHERE tag = 'contract'
          AND awarder_eik IS NOT NULL
          AND ${cultureNameSql("awarder_name")}
          AND NOT (awarder_eik = ANY($1))
          -- народните читалища are a population, not an allowlist: ~3,000 of
          -- them, all carrying „читалище" in the name. Classified by rule.
          AND NOT ${chitalishteNameSql("awarder_name")}
        GROUP BY 1
       HAVING sum(amount_eur) > $2
        ORDER BY sum(amount_eur) DESC`,
      [declared(), MONEY_FLOOR],
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length} culture buyer(s) over €${MONEY_FLOOR.toLocaleString()} are in no ` +
        `declared list. Each needs a classification in kulturaReferenceData.ts — ` +
        `roll-up, verify-principal, adjacent (non-МК principal) or excluded:\n` +
        rows
          .map(
            (r) =>
              `  ${r.eik}  €${Number(r.eur).toLocaleString().padStart(12)}  ${r.name.slice(0, 60)}`,
          )
          .join("\n"),
    );
  },
);

test.skipIf(skip)(
  "a buyer with a NULL eik cannot hide from the sweep",
  async () => {
    // The sweep groups by awarder_eik, so a NULL one would be silently skipped.
    // Zero today; this fails the day an ingest starts emitting them, rather than
    // letting the classification gate quietly stop covering part of the corpus.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM contracts
      WHERE tag = 'contract' AND awarder_eik IS NULL
        AND ${cultureNameSql("awarder_name")}`,
    );
    assert.equal(
      Number(r?.n ?? 0),
      0,
      `${r?.n} culture contract(s) carry no awarder_eik — the classification ` +
        `sweep groups by that column, so these can never fail it`,
    );
  },
);

test.skipIf(skip)(
  "every culture buyer in TENDERS is classified too",
  async () => {
    // A contracts-only sweep is blind to a buyer that has published procedures
    // but never been AWARDED a contract. Measured when this arm was added: two
    // more state puppet theatres (Бургас, and one naming no city) belong in the
    // roll-up and were invisible to the contracts arm entirely.
    //
    // Same €200k floor, but on `estimated_value_eur` rather than an awarded
    // amount — a procedure COUNT is not a proxy for size, and thresholding on
    // one turns the gate into an enumeration of every regional museum in the
    // country. Below the floor the tail is the municipal/regional population
    // Tier C and the exclusions already describe as populations rather than as
    // individuals, exactly as on the contracts side.
    const rows = await allRows<{ eik: string; name: string; eur: string }>(
      `SELECT buyer_eik AS eik, min(buyer_name) AS name,
              round(sum(estimated_value_eur)::numeric, 0) AS eur
         FROM tenders
        WHERE buyer_eik IS NOT NULL
          AND ${cultureNameSql("buyer_name")}
          AND NOT (buyer_eik = ANY($1))
          AND NOT ${chitalishteNameSql("buyer_name")}
        GROUP BY 1
       HAVING sum(estimated_value_eur) > $2
        ORDER BY sum(estimated_value_eur) DESC`,
      [declared(), MONEY_FLOOR],
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length} culture buyer(s) in tenders are in no declared list:\n` +
        rows
          .map(
            (r) =>
              `  ${r.eik}  €${Number(r.eur).toLocaleString().padStart(12)}  ${r.name.slice(0, 55)}`,
          )
          .join("\n"),
    );
  },
);

test.skipIf(skip)("the sweep is not vacuous", async () => {
  // If the name matcher stopped matching awarder_name — a plausible refactor,
  // since it is calibrated on BENEFICIARY names — the test above would pass by
  // finding nothing at all. Prove it still sees the corpus.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT awarder_eik) n FROM contracts
      WHERE tag = 'contract' AND ${cultureNameSql("awarder_name")}`,
  );
  assert.ok(
    Number(r?.n ?? 0) > 100,
    `the culture name matcher finds only ${r?.n} awarders — it has stopped ` +
      `matching buyer names, and the classification sweep above proves nothing`,
  );
});

test.skipIf(skip)(
  "every declared roll-up member exists in the corpus",
  async () => {
    // The other direction: an EIK typo'd into the register silently contributes
    // nothing and never fails anything. НФЦ is the one legitimate exception — a
    // Bulstat entity with zero procurement, kept for a stable roster.
    const rows = await allRows<{ eik: string }>(
      // BOTH corpora: two roll-up members (state puppet theatres) have published
      // procedures and have never been awarded a contract, so a contracts-only
      // check would report them as typos.
      `SELECT unnest($1::text[]) AS eik
      EXCEPT SELECT DISTINCT awarder_eik FROM contracts WHERE awarder_eik IS NOT NULL
      EXCEPT SELECT DISTINCT buyer_eik FROM tenders WHERE buyer_eik IS NOT NULL`,
      [[...CULTURE_GROUP_EIKS]],
    );
    const unknown = rows.map((r) => r.eik).filter((e) => e !== NFC_EIK);
    assert.equal(
      unknown.length,
      0,
      `declared in the roll-up but absent from the whole contracts corpus ` +
        `(typo, or a body that never procured): ${unknown.join(", ")}`,
    );
  },
);

test("every roll-up member is reachable from the roster and the search box", () => {
  // Being in CULTURE_GROUP_EIKS is not the same as being REACHABLE. The art
  // schools were added to the roll-up and the oblast map first, which fixed
  // every total and left all fifteen absent from the two surfaces a reader
  // actually clicks. Both surfaces build their rows from CULTURE_BODIES ∪
  // STATE_CULTURE_INSTITUTES ∪ ART_SCHOOLS, so that union must cover the
  // roll-up — with НФЦ the one exception, deliberately not a search
  // destination (zero procurement footprint, so /awarder/:eik cannot render it).
  const rendered = new Set([
    ...CULTURE_BODIES.map((b) => b.eik),
    ...STATE_CULTURE_INSTITUTES.map((i) => i.eik),
    ...ART_SCHOOLS.map((a) => a.eik),
  ]);
  const missing = CULTURE_GROUP_EIKS.filter(
    (e) => !rendered.has(e) && e !== NFC_EIK,
  );
  assert.deepEqual(
    missing,
    [],
    `in the roll-up but on no rendered surface — a reader can reach these only ` +
      `by knowing the EIK: ${missing.join(", ")}`,
  );
});

test.skipIf(skip)(
  "every curated seat resolves, and to the place it claims",
  async () => {
    // CURATED_AWARDER_SEATS is the one map in this chain that can assert a WRONG
    // PLACE about a real body — the parsed fallback cannot, because it only ever
    // repeats a settlement already written in the buyer's own name. So each entry
    // is checked against what actually landed in awarder_seats: present, stamped
    // `curated` (not silently downgraded to `name`), and naming the settlement the
    // map asked for.
    const eiks = Object.keys(CURATED_AWARDER_SEATS);
    assert.ok(eiks.length > 0, "the curated map is empty");
    const rows = await allRows<{
      eik: string;
      settlement: string;
      source: string;
    }>(
      `SELECT eik, settlement, source FROM awarder_seats WHERE eik = ANY($1)`,
      [eiks],
    );
    const got = new Map(rows.map((r) => [r.eik, r]));
    for (const [eik, want] of Object.entries(CURATED_AWARDER_SEATS)) {
      const row = got.get(eik);
      assert.ok(
        row,
        `${eik} is curated to „${want}" but has no awarder_seats row — either the ` +
          `settlement name does not resolve, or db:load:awarder-seats:pg has not ` +
          `been re-run since the entry was added`,
      );
      assert.equal(
        row.settlement,
        want,
        `${eik} is curated to „${want}" but resolved to „${row.settlement}"`,
      );
      assert.equal(
        row.source,
        "curated",
        `${eik} landed as source="${row.source}" — a curated seat must not be ` +
          `reported as parsed from the buyer's name`,
      );
    }
  },
);

test.skipIf(skip)("the art-school tier is present and procuring", async () => {
  // Tier B is the reason this gate exists; assert it is actually wired into the
  // roll-up rather than merely defined beside it.
  const [r] = await allRows<{ n: string; eur: string }>(
    `SELECT count(*) n, round(sum(amount_eur)::numeric, 0) eur
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [[...ART_SCHOOL_EIKS]],
  );
  assert.ok(
    Number(r?.n ?? 0) > 100,
    "the art-school tier has almost no contracts",
  );
  for (const eik of ART_SCHOOL_EIKS)
    assert.ok(
      CULTURE_GROUP_EIKS.includes(eik),
      `${eik} is an art school but not in CULTURE_GROUP_EIKS`,
    );
});
