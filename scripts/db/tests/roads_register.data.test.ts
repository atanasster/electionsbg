// The roads register (src/lib/roadsReferenceData.ts) against the CORPUS.
//
// A sector is a set of EIKs, and a body missing from it is missing from every
// total at once with every count still reconciling — so membership is checked
// against what the register's own files cannot see: a name sweep of BOTH
// procurement corpora (sector-dashboard skill §1). Every buyer a roads stem
// matches above the money floor must sit in exactly one declared list.
//
// The stems are the trap list from docs/plans/roads-hub-v1.md §2 R3: „пътн" is
// inside „железоПЪТНа" (НКЖИ, €3.47bn) and „ПЪТНически", „ОПУ" inside a school
// name — which is why the excluded list exists and why one test proves it
// still discriminates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  ROADS_ADJACENT,
  ROADS_EXCLUDED,
  ROADS_INHOUSE_CONTRACTORS,
  ROADS_ROLLUP,
  ROADS_SECTOR_EIKS,
  ROADS_VERIFY,
} from "@/lib/roadsReferenceData";
import { PROCUREMENT_BUYER_SECTORS } from "@/lib/procurementBuyerSectors";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const STEMS =
  "(пътн|пътищ|магистрал|областно пътно|(^|[^а-я])опу([^а-я]|$)|(^|[^а-я])тол([^а-я]|$)|винет|нксип|стратегически инфраструктурни)";
const FLOOR_EUR = 1_000_000;

/** Buyers the stems match, over contracts (awarded €) ∪ tenders (estimate €). */
const sweep = async (): Promise<Map<string, { name: string; eur: number }>> => {
  const rows = await allRows<{ eik: string | null; name: string; eur: string }>(
    `SELECT eik, max(name) name, sum(eur) eur FROM (
        SELECT awarder_eik eik, awarder_name name, amount_eur eur FROM contracts
         WHERE tag = 'contract' AND awarder_name ~* $1
        UNION ALL
        SELECT buyer_eik, buyer_name, estimated_value_eur FROM tenders
         WHERE buyer_name ~* $1
      ) x GROUP BY eik`,
    [STEMS],
  );
  const out = new Map<string, { name: string; eur: number }>();
  for (const r of rows) {
    const eur = Number(r.eur ?? 0);
    // A NULL id above the floor must fail loudly rather than group away; one
    // below it is noise the floor already ignores.
    if (!r.eik) {
      assert.ok(eur <= FLOOR_EUR, `a stem-matched buyer has no EIK: ${r.name}`);
      continue;
    }
    out.set(r.eik, { name: r.name, eur });
  }
  return out;
};

const DECLARED = [
  ...ROADS_ROLLUP,
  ...ROADS_VERIFY,
  ...ROADS_ADJACENT,
  ...ROADS_EXCLUDED,
  ...ROADS_INHOUSE_CONTRACTORS,
];

test("every body sits in exactly one list, and every entry has a name", () => {
  const seen = new Map<string, number>();
  for (const b of DECLARED) seen.set(b.eik, (seen.get(b.eik) ?? 0) + 1);
  for (const [eik, n] of seen) assert.equal(n, 1, `${eik} is in ${n} lists`);
  for (const b of DECLARED) assert.ok(b.name.bg && b.name.en, b.eik);
});

test("the in-house contractor is in no buyer list (D1/D7)", () => {
  for (const b of ROADS_INHOUSE_CONTRACTORS)
    assert.ok(!ROADS_SECTOR_EIKS.includes(b.eik), b.eik);
});

test("each adjacent body is in exactly one other sector's roll-up", () => {
  for (const b of ROADS_ADJACENT) {
    const owners = Object.values(PROCUREMENT_BUYER_SECTORS)
      .filter((s) => s.id !== "roads" && s.eiks.includes(b.eik))
      .map((s) => s.id);
    assert.deepEqual(owners, [b.rollupOf], `${b.eik} rolls up into ${owners}`);
  }
});

test.skipIf(skip)(
  "every stem-matched buyer above the floor is declared — swept from BOTH corpora",
  async () => {
    const declared = new Set(DECLARED.map((b) => b.eik));
    const unclassified = [...(await sweep())]
      .filter(([eik, v]) => v.eur > FLOOR_EUR && !declared.has(eik))
      .map(([eik, v]) => `${eik} ${v.name} €${Math.round(v.eur)}`);
    assert.deepEqual(
      unclassified,
      [],
      "classify these in roadsReferenceData.ts",
    );
  },
);

test.skipIf(skip)(
  "the excluded list still discriminates — without it the sweep is red",
  async () => {
    const s = await sweep();
    // НКЖИ is the €3.47bn reason the list exists; if the stem stops reaching
    // it, the exclusion is guarding nothing and this test should be retired.
    assert.ok((s.get("130823243")?.eur ?? 0) > 1e9, "НКЖИ no longer swept");
    const withoutExcluded = new Set(
      DECLARED.filter((b) => !ROADS_EXCLUDED.includes(b)).map((b) => b.eik),
    );
    const leaks = [...s].filter(
      ([eik, v]) => v.eur > FLOOR_EUR && !withoutExcluded.has(eik),
    );
    assert.ok(leaks.length > 0);
  },
);

test.skipIf(skip)("every roll-up member is a real buyer", async () => {
  const rows = await allRows<{ eik: string; eur: string }>(
    `SELECT awarder_eik eik, sum(amount_eur) eur FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) GROUP BY 1`,
    [[...ROADS_SECTOR_EIKS]],
  );
  const byEik = new Map(rows.map((r) => [r.eik, Number(r.eur)]));
  for (const eik of ROADS_SECTOR_EIKS)
    assert.ok((byEik.get(eik) ?? 0) > 100e6, `${eik} €${byEik.get(eik)}`);
});
