// Tier 3 (Postgres-native) — `contractor_search.own_eur` / `primary_name`, the two columns
// that let a search row tell its OWN money from its EIK's.
//
//   npm run test:data
//
// WHY THE COLUMNS EXIST. `search_contractors()` takes the NAME from a per-(eik, name) row
// and the MONEY from a per-EIK aggregate. So a buyer who files one company's name against
// another company's ЕИК mints a searchable row advertising a stranger's whole history.
// Measured 2026-09-02: EIK 103795327 is „БИТ И ТЕХНИКА" ООД and exactly ONE of its 1,101
// contract rows (€6,035.60) carries the name „Клет българия" ООД — so the dropdown
// published БИТ И ТЕХНИКА's entire €2,214,873 under Клет България's name, beside the real
// Клет България (130878827, €22,424,885).
//
// WHY IT NEEDS A GATE. These tables are rebuilt ONLY by `db:load:pg`, so a regression here
// never raises: it shows up as a quiet change in a dropdown's numbers — which is precisely
// the failure the columns were added to end. Nothing else asserts on them (`search.data`
// checks `name`/`eik`/`contracts` only, `reload_visibility_map` checks the vacuum).
//
// ⚠️ THE SKIP HAS ITS OWN REASON, and that is load-bearing. A corpus loaded before these
// columns existed carries NULL throughout; „the corpus predates the column" must never be
// able to read as „the rule is enforced".

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const skip = !(await dbReachable());
afterAll(async () => end());

const one = async <T>(sql: string): Promise<T> => (await allRows<T>(sql))[0];

test.skipIf(skip)(
  "own_eur partitions each EIK's money, and primary_name is its argmax",
  async () => {
    const { n } = await one<{ n: number }>(
      "SELECT count(own_eur)::int AS n FROM contractor_search",
    );
    if (n === 0)
      return reportSkip(
        import.meta.url,
        "own_eur is NULL corpus-wide — this database predates the column; run db:load:pg",
      );

    // ── The partition is exhaustive. The contractor block applies NO name filter, so
    // every one of an EIK's contract rows belongs to exactly one (eik, name) bucket and
    // the buckets must sum to the EIK's own total. ⚠️ Compared with a tolerance, never
    // with `=`: both sides are `double precision` summed in different orders (load-time
    // vs query-time), measured drift 6.2e-06.
    const { bad } = await one<{ bad: number }>(`
      WITH s AS (SELECT eik, sum(own_eur) AS o FROM contractor_search GROUP BY 1),
           c AS (SELECT contractor_eik AS eik,
                        coalesce(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS t
                   FROM contracts WHERE contractor_eik <> '' GROUP BY 1)
      SELECT count(*)::int AS bad FROM s JOIN c USING (eik)
       WHERE abs(s.o - c.t) > 0.01`);
    assert.equal(
      bad,
      0,
      "Σ own_eur over an EIK's aliases must equal its contract total",
    );

    // ── primary_name names one of the EIK's OWN spellings. Getting this wrong is the
    // damaging direction: a row shown under a name belonging to a DIFFERENT company is
    // the very defect being fixed, one layer down.
    const { wrong } = await one<{ wrong: number }>(`
      SELECT count(*)::int AS wrong FROM contractor_search s
       WHERE s.primary_name IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM contractor_search p
                          WHERE p.eik = s.eik AND p.name = s.primary_name)`);
    assert.equal(wrong, 0, "primary_name must be one of that EIK's own names");

    // ── …and it is the ARGMAX, not just any of them. Checked only where a real maximum
    // exists: 1,226 EIKs have every alias at €0 (rebuild_consortium() zeroes joint-award
    // members; an amendment-only EIK sums to 0), and there the tiebreak decides, which is
    // a documented non-claim rather than a defect.
    const { notMax } = await one<{ notMax: number }>(`
      WITH mx AS (SELECT eik, max(own_eur) AS m FROM contractor_search GROUP BY 1
                   HAVING max(own_eur) > 0)
      SELECT count(*)::int AS "notMax"
        FROM (SELECT DISTINCT eik, primary_name FROM contractor_search) d
        JOIN mx USING (eik)
        JOIN contractor_search p ON p.eik = d.eik AND p.name = d.primary_name
       WHERE p.own_eur < mx.m - 0.01`);
    assert.equal(notMax, 0, "primary_name must be the highest-earning alias");
  },
);

test.skipIf(skip)(
  "the argmax discriminates — it is not MIN(name) wearing a different label",
  async () => {
    const { n } = await one<{ n: number }>(
      "SELECT count(own_eur)::int AS n FROM contractor_search",
    );
    if (n === 0)
      return reportSkip(
        import.meta.url,
        "own_eur is NULL corpus-wide — run db:load:pg",
      );

    // MUTATION CHECK. Without this, every assertion above is satisfied by an
    // implementation that picks a name ALPHABETICALLY — which is what the column would
    // silently become if the `own_eur DESC` key were dropped from the ORDER BY.
    // Measured 2026-09-02: the two disagree on 5,126 of 8,808 multi-alias EIKs (58.2%).
    const { differs, multi } = await one<{ differs: number; multi: number }>(`
      WITH m AS (SELECT eik, min(name) AS mn FROM contractor_search
                  GROUP BY 1 HAVING count(*) > 1),
           p AS (SELECT DISTINCT eik, primary_name FROM contractor_search)
      SELECT count(*) FILTER (WHERE m.mn IS DISTINCT FROM p.primary_name)::int AS differs,
             count(*)::int AS multi
        FROM m JOIN p USING (eik)`);
    assert.ok(
      multi > 100,
      `too few multi-alias EIKs (${multi}) to test against`,
    );
    assert.ok(
      differs > multi / 4,
      `primary_name agrees with MIN(name) on ${multi - differs}/${multi} EIKs — ` +
        "the money key has stopped discriminating",
    );
  },
);

test.skipIf(skip)(
  "a minority alias is visible as one — the Клет България / БИТ И ТЕХНИКА case",
  async () => {
    const { n } = await one<{ n: number }>(
      "SELECT count(own_eur)::int AS n FROM contractor_search",
    );
    if (n === 0)
      return reportSkip(
        import.meta.url,
        "own_eur is NULL corpus-wide — run db:load:pg",
      );

    // The named case, pinned so the class cannot silently stop being detectable. A
    // consumer must be able to see that this row earned a fraction of a percent of the
    // money the EIK holds, and that the corpus calls that EIK something else entirely.
    const row = await one<{
      own: number | null;
      total: number;
      primary: string | null;
    }>(`
      SELECT s.own_eur AS own,
             (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
               WHERE k.contractor_eik = s.eik AND k.tag = 'contract') AS total,
             s.primary_name AS primary
        FROM contractor_search s
       WHERE s.eik = '103795327' AND s.name ILIKE '%лет%ългария%'
       LIMIT 1`);
    if (!row)
      return reportSkip(
        import.meta.url,
        "the reference alias is not in this corpus",
      );

    assert.ok(row.own != null && row.own > 0, "the alias earned something");
    assert.ok(
      row.own < 0.01 * row.total,
      `the alias holds ${row.own} of ${row.total} — expected well under 1%`,
    );
    assert.ok(
      row.primary != null && !/лет/i.test(row.primary),
      `primary_name should name the EIK's real identity, got ${row.primary}`,
    );
  },
);
