// The canonical place dimension (migration 117).
//
// WHAT THESE PIN. place_dim exists so two denormalizations can be retired: person_role's
// materialised place_label/place_label_en, and the 940 KB data/settlements.json the
// by-settlement page shipped to the browser to localise a name. Both retirements are safe
// ONLY while this table reproduces what it replaces exactly, and every way it could stop
// doing so is SILENT — a missing row renders a blank badge, a re-derived label renders the
// wrong place name, a dropped seed blanks the capital. So each invariant gets an assertion.
//
// The DROP COLUMN is gated by the byte-identity parity test in
// person_place_label_join.data.test.ts, not here — that file owns the comparison against
// the materialised columns because it has to retire itself when they go. What this file
// pins is the dimension's own shape: the coverage, containment and seed invariants that
// have to hold for such a join to resolve at all.
//
// Auto-skips when Postgres is down or the dimension has never been loaded — like the other
// *.data.test.ts gates. The probe is TOP-LEVEL and feeds test.skipIf
// (docs/testing-standards.md): an early `return` inside each body would score as a PASS, so
// CI (which runs without a container) would report this gate green while asserting nothing.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { MIR_CODES } from "../../../src/data/parliament/nsFolders";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM place_dim",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};
const ok = await reachable();

afterAll(async () => {
  await end();
});

const count = async (where: string): Promise<number> => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM place_dim WHERE ${where}`,
  );
  return Number(r.n);
};

// NOTE: the byte-identity check against the materialised person_role.place_label /
// place_label_en lives in person_place_label_join.data.test.ts, not here — it has to retire
// itself when those columns drop, and keeping the self-retiring guard in one file avoids a
// second copy that would simply go red at the DROP.

test.skipIf(!ok)(
  "covers every mir/obshtina place_code person_role carries",
  async () => {
    // 'judicial' is excluded BY DESIGN — it resolves against judicial_body (116).
    const [r] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM person_role r
       WHERE r.place_kind IN ('mir','obshtina')
         AND NOT EXISTS (SELECT 1 FROM place_dim p
                          WHERE p.kind = r.place_kind AND p.code = r.place_code)`);
    assert.equal(r.n, "0");
  },
);

test.skipIf(!ok)(
  "covers every awarder seat, so by-settlement needs no settlements.json",
  async () => {
    const [r] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM awarder_seats a
       WHERE a.ekatte IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM place_dim p
                          WHERE p.kind = 'settlement' AND p.code = a.ekatte)`);
    assert.equal(r.n, "0");
  },
);

test.skipIf(!ok)(
  "keeps the 31 МИР distinct from the statistical oblasts",
  async () => {
    assert.equal(await count("kind = 'mir'"), MIR_CODES.length);
    assert.equal(await count("kind = 'mir'"), 31);
    const rows = await allRows<{
      code: string;
      name_bg: string;
      oblast_code: string | null;
    }>(
      `SELECT code, name_bg, oblast_code FROM place_dim
        WHERE kind='mir' AND code IN ('PDV','PDV-00','S23','S24','S25')
        ORDER BY code`,
    );
    const by = new Map(rows.map((r) => [r.code, r]));
    // These must NOT be named after their oblast — that is the whole reason place_kind is
    // 'mir': Пловдив is two constituencies and Sofia city is three.
    assert.equal(by.get("PDV-00")?.name_bg, "Пловдив-град");
    assert.equal(by.get("PDV")?.name_bg, "Пловдив-област");
    assert.equal(by.get("S23")?.name_bg, "София 23 МИР");
    // …while the statistical fold is still available on the same row.
    assert.equal(by.get("PDV-00")?.oblast_code, "PDV");
    assert.equal(by.get("S23")?.oblast_code, "SOFIA_CITY");
  },
);

test.skipIf(!ok)(
  "carries the synthetic SFO_CITY obshtina and its alias crosswalk",
  async () => {
    // Absent from data/municipalities.json — the ONE code of 295 that file cannot label.
    const [r] = await allRows<{
      name_bg: string;
      oblast_code: string | null;
      shard_code: string | null;
      governance_code: string | null;
      price_code: string | null;
    }>(
      `SELECT name_bg, oblast_code, shard_code, governance_code, price_code
         FROM place_dim WHERE kind='obshtina' AND code='SFO_CITY'`,
    );
    assert.ok(
      r,
      "SFO_CITY missing — the capital's municipal tier has no label",
    );
    assert.equal(r.name_bg, "Столична община");
    assert.equal(r.oblast_code, "SOFIA_CITY");
    assert.equal(r.shard_code, "SOF");
    assert.equal(r.governance_code, "SOF00");
    assert.equal(r.price_code, "SOF46");
    // The crosswalk describes exactly one place (also enforced by a CHECK).
    assert.equal(await count("shard_code IS NOT NULL"), 1);
  },
);

test.skipIf(!ok)(
  "seeds the two settlements the EKATTE master omits",
  async () => {
    const rows = await allRows<{ code: string; name_bg: string }>(
      `SELECT code, name_bg FROM place_dim
        WHERE kind='settlement' AND code IN ('68134','63183') ORDER BY code`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.code}:${r.name_bg}`),
      ["63183:Рудник", "68134:София"],
    );
    // The containment asymmetry is deliberate: Sofia's other settlements carry their район
    // code, so SFO_CITY contains the capital ALONE. Pinned so re-parenting is a choice.
    const inSofiaCity = await allRows<{ code: string }>(
      `SELECT code FROM place_dim
        WHERE kind='settlement' AND obshtina_code='SFO_CITY' ORDER BY code`,
    );
    assert.deepEqual(
      inSofiaCity.map((r) => r.code),
      ["68134"],
    );
  },
);

test.skipIf(!ok)(
  "carries the out-of-country pseudo-places with no containment",
  async () => {
    // 88 countries as settlements + 6 continents as obshtini, inherited from the source
    // files. Kept (not filtered) so obshtinaLabels() stays the single label producer.
    assert.equal(await count("length(code) = 2"), 94);
    assert.equal(
      await count(
        "length(code) = 2 AND (oblast_code IS NOT NULL OR mir_code IS NOT NULL)",
      ),
      0,
    );
    // The pseudo-oblast "32" must never reach a consumer as a bucket it cannot name.
    assert.equal(await count("oblast_code = '32'"), 0);
  },
);

test.skipIf(!ok)("has no dangling containment references", async () => {
  assert.equal(
    await count(
      `kind='settlement' AND obshtina_code IS NOT NULL
         AND obshtina_code NOT IN (SELECT code FROM place_dim WHERE kind='obshtina')`,
    ),
    0,
  );
  assert.equal(
    await count(
      `mir_code IS NOT NULL
         AND mir_code NOT IN (SELECT code FROM place_dim WHERE kind='mir')`,
    ),
    0,
  );
  // Every oblast_code must name a real statistical oblast (or SOFIA_CITY).
  assert.equal(await count("oblast_code = ''"), 0);
});

test.skipIf(!ok)("has the expected row count per namespace", async () => {
  const rows = await allRows<{ kind: string; n: string }>(
    "SELECT kind, count(*) n FROM place_dim GROUP BY kind ORDER BY kind",
  );
  assert.deepEqual(
    Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])),
    // 5,364 EKATTE settlements + the 2 seeds; 294 obshtini + synthetic SFO_CITY; 31 МИР.
    { mir: 31, obshtina: 295, settlement: 5366 },
  );
});
