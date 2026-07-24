// Correctness gate for the register listing (094).
//
// The headline control is that NOTHING here is published as a compliance signal. T3.5 was
// designed on the premise that the register's `Sent != True` means "не е подал декларация";
// it does not — a Sent=False row fetches a complete 33KB declaration — so the column is
// stored uninterpreted and these tests pin that it stays that way.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_obligation') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_obligation",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no obligations loaded";

afterAll(async () => {
  await end();
});

// THE PARSING BUG THIS CAUGHT. Category and Institution carry their names as XML
// ATTRIBUTES; reading them with find("Name") descends into the first Person's <Name> and
// labels every institution with a person's name. An institution that exactly equals a
// declarant's name is the signature.
test.skipIf(skip)(
  "institutions are institutions, not person names",
  async () => {
    const bad = await allRows<{ institution: string }>(
      `SELECT DISTINCT o.institution FROM declaration_obligation o
      WHERE o.institution IS NOT NULL
        AND EXISTS (SELECT 1 FROM declaration_obligation p
                     WHERE p.declarant_name = o.institution)
      LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `institution equals a declarant name — attribute parsing regressed: ${JSON.stringify(bad)}`,
    );
  },
);

// The listing must include the rows every ingest drops, or it is just a second copy of
// what we already hold and tells us nothing about our coverage.
test.skipIf(skip)("rows the ingests skip are captured", async () => {
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration_obligation WHERE NOT sent_flag",
  );
  assert.ok(
    Number(n) > 0,
    "no Sent != True rows — the listing is dropping what the ingests drop",
  );
});

// THE FALSIFIED PREMISE. Most Sent != True rows name a real, fetchable declaration, which
// is why the flag must never be read as "did not file". If this ever went to zero the
// compliance reading would look defensible again — it is not.
test.skipIf(skip)("most Sent != True rows name a real filing", async () => {
  const [{ n, withXml }] = await allRows<{ n: string; withXml: string }>(
    `SELECT count(*) n, count(*) FILTER (WHERE xml_file IS NOT NULL) "withXml"
       FROM declaration_obligation WHERE NOT sent_flag`,
  );
  assert.ok(
    Number(withXml) / Number(n) > 0.5,
    `only ${withXml}/${n} Sent!=True rows name an xmlFile — re-check whether the flag ` +
      "has acquired a filed/not-filed meaning",
  );
});

// The folder→year parse must never bucket a whole register folder under a bogus year —
// "2021_nc" and "2021_nonc" are both 2021.
test.skipIf(skip)("suffixed folders resolve to their real year", async () => {
  const rows = await allRows<{ folder: string; register_year: number }>(
    `SELECT DISTINCT folder, register_year FROM declaration_obligation
      WHERE folder LIKE '2021%'`,
  );
  assert.ok(rows.length > 0, "expected 2021 folders");
  for (const r of rows) {
    assert.equal(
      Number(r.register_year),
      2021,
      `${r.folder} resolved to ${r.register_year}`,
    );
  }
});

// Every folder must parse to a real year; "2021_nc" → 2021. A 0 would silently bucket a
// whole register year under a nonexistent one.
test.skipIf(skip)(
  "every obligation carries a plausible register year",
  async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration_obligation
      WHERE register_year < 2005 OR register_year > 2100`,
    );
    assert.equal(
      Number(n),
      0,
      "an obligation has an implausible register_year",
    );
  },
);
