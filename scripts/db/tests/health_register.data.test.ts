// Gate for the health EIK register (`src/lib/healthReferenceData.ts`).
//
// The register IS the sector: every /sector/health procurement figure is
// `awarder_eik = ANY(…)` over it, so a body missing from it is absent from the
// roll-up, the universes, the finder and the hub at once, with every total still
// reconciling. A6 was exactly that — 55 МЗ second-level units, €86.9M, in no
// list. Membership tests over the file cannot find what nobody listed, so this
// sweeps the CORPUS: every health-like buyer above a money floor must be a
// member or fall in a declared excluded CLASS (hospitals and every other
// лечебно заведение, the РЗОК, research consortia).
//
// The matcher is `src/lib/healthMatch.ts`. Its first run (2026-11-21) found ~40
// ДКЦ and „Център за психично здраве" ЕООД outside the hospitals class, which
// is why that class now names them.
//
// Auto-skips only when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { healthNameSql } from "@/lib/healthMatch";
import {
  HEALTH_ENTITIES,
  HEALTH_EXCLUDED,
  HEALTH_SECTOR_EIKS,
} from "@/lib/healthReferenceData";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

/** €500,000 (the plan's floor). */
const MONEY_FLOOR = 500_000;

const EXCLUDED = HEALTH_EXCLUDED.map((x) => x.namePattern).join("|");

type Row = { eik: string; name: string; eur: string };

const fmt = (rows: Row[]) =>
  rows
    .map(
      (r) =>
        `  ${r.eik}  €${Number(r.eur).toLocaleString().padStart(14)}  ${r.name.slice(0, 70)}`,
    )
    .join("\n");

const sweepContracts = (opts: { guard?: boolean; excluded?: string } = {}) =>
  allRows<Row>(
    `SELECT awarder_eik AS eik, min(awarder_name) AS name,
            round(sum(amount_eur)::numeric, 0) AS eur
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik IS NOT NULL
        AND ${healthNameSql("awarder_name", opts.guard ?? true)}
        AND NOT (awarder_eik = ANY($1))
      GROUP BY 1
     HAVING sum(amount_eur) > $2
        AND NOT bool_or(awarder_name ~* $3)
      ORDER BY sum(amount_eur) DESC`,
    [[...HEALTH_SECTOR_EIKS], MONEY_FLOOR, opts.excluded ?? EXCLUDED],
  );

const UNCLASSIFIED =
  "Each is either a sector member (HEALTH_ENTITIES / mzSecondLevelBodies.ts) " +
  "or belongs in a HEALTH_EXCLUDED class — widen the class pattern if it is a " +
  "лечебно заведение, РЗОК or a research consortium:\n";

test("the register lists no EIK twice", () => {
  const eiks = HEALTH_ENTITIES.map((e) => e.eik);
  assert.equal(new Set(eiks).size, eiks.length);
});

test.skipIf(skip)(
  "every health buyer in CONTRACTS above the floor is classified",
  async () => {
    const rows = await sweepContracts();
    assert.equal(
      rows.length,
      0,
      `${rows.length} health-named awarder(s) over €${MONEY_FLOOR.toLocaleString()} ` +
        `are in no list. ${UNCLASSIFIED}${fmt(rows)}`,
    );
  },
);

test.skipIf(skip)(
  "every health buyer in TENDERS above the floor is classified",
  async () => {
    // A contracts-only sweep is blind to a buyer with published procedures and
    // no award. Floored on the estimated value, never on a procedure count.
    const rows = await allRows<Row>(
      `SELECT buyer_eik AS eik, min(buyer_name) AS name,
              round(sum(estimated_value_eur)::numeric, 0) AS eur
         FROM tenders
        WHERE buyer_eik IS NOT NULL
          AND ${healthNameSql("buyer_name")}
          AND NOT (buyer_eik = ANY($1))
        GROUP BY 1
       HAVING sum(estimated_value_eur) > $2
          AND NOT bool_or(buyer_name ~* $3)
        ORDER BY sum(estimated_value_eur) DESC`,
      [[...HEALTH_SECTOR_EIKS], MONEY_FLOOR, EXCLUDED],
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length} health-named buyer(s) in tenders over ` +
        `€${MONEY_FLOOR.toLocaleString()} are in no list. ${UNCLASSIFIED}${fmt(rows)}`,
    );
  },
);

test.skipIf(skip)("a NULL EIK cannot hide from the sweep", async () => {
  const [r] = await allRows<{ n: number; eur: number }>(
    `SELECT count(*)::int n, coalesce(sum(amount_eur), 0)::float8 eur
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik IS NULL
        AND ${healthNameSql("awarder_name")} AND awarder_name !~* $1`,
    [EXCLUDED],
  );
  assert.ok(
    r.eur <= MONEY_FLOOR,
    `${r.n} health-named contract(s) worth €${r.eur} carry no awarder EIK`,
  );
});

test.skipIf(skip)("no member is ALSO in an excluded class", async () => {
  // „exactly one list": a member whose corpus name matches a class would be
  // both counted and declared not-health. The РЗОК class is the exception BY
  // DEFINITION — it records that the regional funds file under НЗОК's own EIK,
  // i.e. they ARE НЗОК — so it is checked the other way round below.
  const otherBodies = HEALTH_EXCLUDED.filter((x) => x.id !== "rzok")
    .map((x) => x.namePattern)
    .join("|");
  const rows = await allRows<{ eik: string; name: string }>(
    `SELECT DISTINCT awarder_eik eik, awarder_name name FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND awarder_name ~* $2`,
    [[...HEALTH_SECTOR_EIKS], otherBodies],
  );
  assert.deepEqual(
    rows.map((r) => `${r.eik} ${r.name}`),
    [],
    "members whose corpus name matches HEALTH_EXCLUDED",
  );
  // РЗОК rows sit under НЗОК's EIK and nowhere else.
  const rzok = HEALTH_EXCLUDED.find((x) => x.id === "rzok")!.namePattern;
  const elsewhere = await allRows<{ eik: string; name: string }>(
    `SELECT DISTINCT awarder_eik eik, min(awarder_name) name FROM contracts
      WHERE tag = 'contract' AND awarder_name ~* $1 AND awarder_eik <> $2
      GROUP BY 1`,
    [rzok, HEALTH_ENTITIES.find((e) => e.universe === "nzok")!.eik],
  );
  assert.deepEqual(
    elsewhere.map((r) => `${r.eik} ${r.name}`),
    [],
    "РЗОК filed under an EIK other than НЗОК's — not covered by the roll-up",
  );
});

test.skipIf(skip)(
  "the matcher AGREES with the register (it can see every member)",
  async () => {
    // The only check that catches a too-NARROW matcher (§2 rule 5): a sweep
    // that cannot see today's members could never have found the next one.
    const rows = await allRows<{ eik: string; name: string }>(
      `SELECT awarder_eik eik, min(awarder_name) name FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY 1
       HAVING NOT bool_or(${healthNameSql("awarder_name")})`,
      [[...HEALTH_SECTOR_EIKS]],
    );
    assert.deepEqual(
      rows.map((r) => `${r.eik} ${r.name}`),
      [],
      "members the name matcher cannot see — widen a stem in healthMatch.ts",
    );
    const [n] = await allRows<{ n: number }>(
      `SELECT count(DISTINCT awarder_eik)::int n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [[...HEALTH_SECTOR_EIKS]],
    );
    assert.ok(n.n >= 40, `only ${n.n} members have contracts`);
  },
);

test.skipIf(skip)(
  "the excluded classes and the „Здравец“ guard each CHANGE the sweep (§2 rule 4)",
  async () => {
    // Without the classes the лечебни заведения flood the sweep; without the
    // guard the „Здравец" kindergartens do. A guard that moves nothing is a
    // guard someone deletes — and a sweep with no classes that still came back
    // empty would prove the matcher had gone blind.
    const noClasses = await sweepContracts({ excluded: "^$" });
    assert.ok(
      noClasses.length >= 20,
      `only ${noClasses.length} buyer(s) reach the sweep without HEALTH_EXCLUDED`,
    );
    const re = new RegExp(EXCLUDED, "iu");
    assert.ok(
      noClasses.every((r) => re.test(r.name)),
      "the classes released a buyer they do not name",
    );
    const unguarded = await sweepContracts({ guard: false });
    assert.ok(
      unguarded.length >= 3 && unguarded.every((r) => /здравец/i.test(r.name)),
      `the unguarded sweep should add only „Здравец" namesakes: ${fmt(unguarded)}`,
    );
  },
);
