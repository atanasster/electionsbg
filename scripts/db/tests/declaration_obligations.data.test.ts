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

// The listing must include the rows the ingests could drop, or it is just a second copy
// of what we already hold and tells us nothing about our coverage.
test.skipIf(skip)("rows with a non-True Sent flag are captured", async () => {
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration_obligation WHERE NOT sent_flag",
  );
  assert.ok(
    Number(n) > 0,
    "no Sent != True rows — the listing is no longer capturing the whole register",
  );
});

// THE INGEST GATE. Every cacbg ingest once required Sent === "True" and so discarded 3,614
// real filings. The flag is a register processing state, not "no declaration to fetch" —
// see the evidence above extractDeclarationXmlFiles in scripts/lib/cacbg_register.ts. This
// pins the fix: if anyone re-adds the guard to any of the four listing walks, the corpus
// stops holding non-True filings and this fails.
test.skipIf(skip)(
  "filings the register does not flag Sent=True are held",
  async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n
       FROM declaration d
       JOIN declaration_obligation o
         ON o.xml_file = regexp_replace(d.source_url, '^.*/', '')
      WHERE NOT o.sent_flag`,
    );
    assert.ok(
      Number(n) > 0,
      "the corpus holds no Sent != True filing — the ingest guard has been reinstated, " +
        "silently discarding thousands of real declarations",
    );
  },
);

// THE DOUBLE-COUNT GATE — the invariant that makes admitting non-True rows safe. Not one
// of them re-lists a filing we already held: across the WHOLE corpus there is no declarant
// with the same ControlHash on both a Sent=True and a non-True filing. The register does
// publish superseded revisions, but a revision is a different document with its own hash,
// so it lands as an additional filing rather than a second copy of an existing one.
//
// This deliberately does NOT assert that a declarant's hashes are globally unique. They are
// not, and that is a SEPARATE, PRE-EXISTING defect: the register republishes one filing
// under two xmlFiles when a person is listed under two institutions — "Процедури по ЗОП"
// alongside their real employer — and the loader dedups on source_url, which differs. 64
// such groups exist, 61 of them entirely within the Sent=True corpus that shipped long
// before this flag was touched. Asserting zero here would fail on that older bug and
// wrongly implicate the ingest change; the cross-flag test below is what this change is
// actually answerable for.
//
// Restricted to real hashes: the register writes the literal string "Неуспешна Валидация"
// into ControlHash when its own validation failed, and every such row would collide with
// every other.
test.skipIf(skip)(
  "no filing the register left unflagged duplicates one we already held",
  async () => {
    const dup = await allRows<{ declarant_name: string; control_hash: string }>(
      `WITH t AS (
         SELECT d.person_id, d.declarant_name, d.control_hash,
                COALESCE(o.sent_flag, true) AS sent
           FROM declaration d
           LEFT JOIN declaration_obligation o
             ON o.xml_file = regexp_replace(d.source_url, '^.*/', '')
          WHERE d.person_id IS NOT NULL AND d.control_hash ~ '^[0-9A-F]{8}$')
       SELECT min(declarant_name) AS declarant_name, control_hash
         FROM t GROUP BY person_id, control_hash
        HAVING bool_or(sent) AND bool_or(NOT sent)
        LIMIT 5`,
    );
    assert.equal(
      dup.length,
      0,
      `a non-Sent filing carries the same ControlHash as a Sent one for the same person — ` +
        `it is the same document ingested twice, and that person's assets are double-` +
        `counted in every per-filing list: ${JSON.stringify(dup)}`,
    );
  },
);

// The wealth series must stay a PICK-ONE. person_wealth_year (090) chooses a single
// representative filing per person-year (period_year) ordered by filed_at DESC, which is exactly what
// makes a superseded revision harmless: it can never displace the current filing. If that
// ever became a sum over a year's filings, admitting revisions would inflate published net
// worth for named individuals.
test.skipIf(skip)("wealth is one row per person-year", async () => {
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT person_id, period_year FROM person_wealth_year
        GROUP BY 1, 2 HAVING count(*) > 1) x`,
  );
  assert.equal(
    Number(n),
    0,
    "person_wealth_year has more than one row for a person-year — the representative-" +
      "filing pick has regressed into an aggregate",
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
