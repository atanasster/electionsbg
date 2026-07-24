// Which YEAR a declared net worth is published against — the axis of the wealth
// series (090_person_wealth.sql) and of byRecency (src/lib/declarations.ts).
//
// THE SEMANTICS THESE TESTS PIN. A filing carries two years and they disagree by
// design: `declaration_year` is the year it was LODGED (resolveDeclarationYear
// derives it as an annual's fiscal_year + 1, and as fiscal_year itself for
// Entry/Vacate), `fiscal_year` is the period it COVERS. The published figure is
// keyed on the period — `period_year = COALESCE(fiscal_year, declaration_year)` —
// because every question a wealth figure answers is about the period: what someone
// was worth in a year, what changed between two snapshots, which of two filings
// describes the later state of affairs.
//
// WHAT KEYING ON THE FILING YEAR DID. An annual for fiscal N is lodged the
// following May, so it shares a declaration_year with any exit filing lodged in
// that year — and then WINS on filed_at while covering the EARLIER period:
//
//   Лучия Александрова Добрева (luchiya-aleksandrova-dobreva-d06438)
//     Vacate  · covers 2025 · filed 2025-02-18 · 12 valued rows · net +€382,272
//     Annualy · covers 2024 · filed 2025-06-13 ·  3 valued rows · net −€274,784
//
// Both declaration_year 2025, so the fiscal-2024 annual represented "2025" and her
// published 2025 net worth was −€274,784 — a figure describing 2024, on a card
// headlined 2025, for a named public figure. 877 person-years were represented by a
// filing covering an earlier period than one available for the same year. This is a
// defamation-sensitive number, so the year it is published against has to name the
// period it describes.
//
// Auto-skips when Postgres is down or the matview is empty, like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_wealth_year') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_wealth_year",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / wealth matview empty";

afterAll(async () => {
  await end();
});

// THE AXIS. Every published year names the period its representative filing covers.
// A revert to the filing year fails this on all 34k annuals at once.
test.skipIf(skip)(
  "period_year is the period the representative filing covers",
  async () => {
    const bad = await allRows<{
      person_id: string;
      period_year: number;
      covers: number;
      declaration_year: number;
    }>(
      `SELECT w.person_id, w.period_year,
              COALESCE(d.fiscal_year, d.declaration_year) AS covers,
              d.declaration_year
         FROM person_wealth_year w
         JOIN declaration d ON d.declaration_id = w.declaration_id
        WHERE w.period_year <> COALESCE(d.fiscal_year, d.declaration_year)
        LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `a wealth year is labelled with something other than the period its filing ` +
        `covers — the series is back on the filing year: ${JSON.stringify(bad)}`,
    );
  },
);

// NO SNAPSHOT IS SILENTLY DROPPED. Every period a person filed an asset picture for
// must appear in the series. Keying on the lodging year loses one whenever a period
// is only covered by an annual — the annual is filed against N+1, so period N has no
// point unless some other filing happens to supply one. That left 16,024 declared
// snapshots published nowhere, including the 31-Dec-2024 estate of the worked case
// below, and made the trajectory chart's gaps an artefact of the axis.
test.skipIf(skip)("every declared snapshot is published", async () => {
  const bad = await allRows<{ person_id: string; period: number }>(
    `SELECT p.person_id, p.period FROM (
       SELECT d.person_id, COALESCE(d.fiscal_year, d.declaration_year) AS period
         FROM declaration d
        WHERE d.person_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM declaration_asset a
                       WHERE a.declaration_id = d.declaration_id)
        GROUP BY 1, 2) p
      WHERE NOT EXISTS (SELECT 1 FROM person_wealth_year w
                         WHERE w.person_id = p.person_id
                           AND w.period_year = p.period)
      LIMIT 5`,
  );
  assert.equal(
    bad.length,
    0,
    `a period with an asset-bearing filing has no point in the series — the snapshot ` +
      `is declared but published nowhere: ${JSON.stringify(bad)}`,
  );
});

// The partition must not collapse two periods into one point. An annual and an exit
// filing lodged in the same calendar year cover DIFFERENT periods and are two
// snapshots; keying on the filing year discarded one of them (180 person-years).
test.skipIf(skip)(
  "an annual and an exit filing lodged in one year yield two points",
  async () => {
    const rows = await allRows<{ n: string }>(
      `WITH pairs AS (
         -- people with two asset-bearing filings sharing a LODGING year but
         -- covering different periods
         SELECT d.person_id, d.declaration_year,
                min(COALESCE(d.fiscal_year, d.declaration_year)) AS lo,
                max(COALESCE(d.fiscal_year, d.declaration_year)) AS hi
           FROM declaration d
          WHERE d.person_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur > 0)
          GROUP BY 1, 2
         HAVING count(DISTINCT COALESCE(d.fiscal_year, d.declaration_year)) > 1
       )
       SELECT count(*) n FROM pairs p
        WHERE EXISTS (SELECT 1 FROM person_wealth_year w
                       WHERE w.person_id = p.person_id AND w.period_year = p.lo)
          AND EXISTS (SELECT 1 FROM person_wealth_year w
                       WHERE w.person_id = p.person_id AND w.period_year = p.hi)`,
    );
    const [total] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT d.person_id, d.declaration_year
           FROM declaration d
          WHERE d.person_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur > 0)
          GROUP BY 1, 2
         HAVING count(DISTINCT COALESCE(d.fiscal_year, d.declaration_year)) > 1) x`,
    );
    assert.ok(
      Number(total.n) > 0,
      "no mixed-period lodging years in the corpus — the fixture this gate needs is gone",
    );
    assert.equal(
      Number(rows[0].n),
      Number(total.n),
      `${Number(total.n) - Number(rows[0].n)} of ${total.n} mixed-period lodging ` +
        `years publish only one of their two snapshots — the partition has ` +
        `collapsed back onto the filing year`,
    );
  },
);

// LOCKSTEP with src/lib/declarations.ts. The representative must be the byRecency
// head among the year's asset-bearing filings, with the has_valued_assets tier
// first — re-derived here in SQL rather than taken on faith from the matview's own
// ORDER BY, so a reordered rung is caught. The partition key must equal byRecency's
// leading rung: partition on one year and rank on another and the matview's newest
// point stops being latestAssetDeclaration's answer.
test.skipIf(skip)(
  "the representative is the byRecency head of its period",
  async () => {
    const bad = await allRows<{
      person_id: string;
      period_year: number;
      picked: string;
      expected: string;
    }>(
      `WITH cand AS (
         SELECT d.person_id, d.declaration_id,
                COALESCE(d.fiscal_year, d.declaration_year) AS period_year,
                d.filed_at, d.entry_number, d.source_url,
                EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur > 0) AS valued,
                CASE d.declaration_type
                  WHEN 'Vacate' THEN 3 WHEN 'Annualy' THEN 2
                  WHEN 'Other'  THEN 1 WHEN 'Entry'   THEN 0 ELSE 1 END AS filing_order
           FROM declaration d
          WHERE d.person_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id)
       ),
       head AS (
         SELECT DISTINCT ON (person_id, period_year)
                person_id, period_year, declaration_id
           FROM cand
          ORDER BY person_id, period_year,
                   valued DESC,
                   filed_at DESC NULLS LAST,
                   filing_order DESC,
                   entry_number ASC NULLS LAST,
                   source_url ASC
       )
       SELECT w.person_id, w.period_year,
              w.declaration_id::text AS picked, h.declaration_id::text AS expected
         FROM person_wealth_year w
         JOIN head h ON h.person_id = w.person_id AND h.period_year = w.period_year
        WHERE w.declaration_id <> h.declaration_id
        LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `the matview's representative is not the byRecency head of its period — 090 and ` +
        `src/lib/declarations.ts have drifted: ${JSON.stringify(bad)}`,
    );
  },
);

// LOCKSTEP with the /person declaration block. It reads person_declarations in
// server order and takes the newest period's best asset-bearing row as the
// headline; that MUST be the newest point of the chart above it, or one page quotes
// two net worths. This ran at 75 declarants on the filing-year axis.
test.skipIf(skip)(
  "the declaration block's headline is the chart's newest point",
  async () => {
    const bad = await allRows<{
      person_id: string;
      block: string;
      chart: string;
    }>(
      `WITH lst AS (   -- person_declarations' own ORDER BY, asset-bearing rows only
         SELECT d.person_id, d.declaration_id,
                COALESCE(d.fiscal_year, d.declaration_year) AS period_year,
                d.filed_at, d.entry_number, d.source_url,
                EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur > 0) AS valued,
                CASE d.declaration_type
                  WHEN 'Vacate' THEN 3 WHEN 'Annualy' THEN 2
                  WHEN 'Other'  THEN 1 WHEN 'Entry'   THEN 0 ELSE 1 END AS filing_order
           FROM declaration d
          WHERE d.person_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id)
       ),
       block AS (   -- newest period first, then the component's valued tier
         SELECT DISTINCT ON (person_id) person_id, declaration_id
           FROM lst
          ORDER BY person_id, period_year DESC,
                   valued DESC,
                   filed_at DESC NULLS LAST,
                   filing_order DESC,
                   entry_number ASC NULLS LAST,
                   source_url ASC
       ),
       chart AS (
         SELECT DISTINCT ON (person_id) person_id, declaration_id
           FROM person_wealth_year ORDER BY person_id, period_year DESC
       )
       SELECT b.person_id, b.declaration_id::text AS block, c.declaration_id::text AS chart
         FROM block b JOIN chart c USING (person_id)
        WHERE b.declaration_id <> c.declaration_id
        LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `the declaration block and the wealth chart would headline different filings — ` +
        `the same person-year with two net worths: ${JSON.stringify(bad)}`,
    );
  },
);

// THE WORKED CASE, pinned. Her two 2025-lodged filings cover different periods, so
// each speaks for its own year and the exit filing — not the fiscal-2024 annual —
// is what 2025 publishes. The euro figures are not asserted (a re-parse may move
// them); which filing represents which year is the invariant.
test.skipIf(skip)(
  "an exit filing represents the year it covers, not the annual lodged after it",
  async () => {
    const SLUG = "luchiya-aleksandrova-dobreva-d06438";
    const filings = await allRows<{
      declaration_type: string;
      period_year: number;
      filed_at: string | null;
    }>(
      `SELECT d.declaration_type, COALESCE(d.fiscal_year, d.declaration_year) AS period_year,
              d.filed_at::text
         FROM declaration d JOIN person p ON p.person_id = d.person_id
        WHERE p.slug = $1 AND d.declaration_year = 2025
          AND EXISTS (SELECT 1 FROM declaration_asset a
                       WHERE a.declaration_id = d.declaration_id AND a.value_eur > 0)`,
      [SLUG],
    );
    // The shape this pins must still be in the corpus, or the gate proves nothing.
    assert.ok(
      filings.some((f) => f.declaration_type === "Vacate" && f.period_year === 2025) &&
        filings.some(
          (f) => f.declaration_type === "Annualy" && f.period_year === 2024,
        ),
      `${SLUG} no longer has the 2025-lodged Vacate + fiscal-2024 annual this gate ` +
        `pins; re-point it at another declarant with the same shape: ${JSON.stringify(filings)}`,
    );

    const [row] = await allRows<{
      s: { series: { year: number; netEur: number }[] } | null;
    }>("SELECT person_wealth_series($1) AS s", [SLUG]);
    const byYear = new Map(
      (row?.s?.series ?? []).map((p) => [p.year, p.netEur]),
    );
    assert.ok(
      byYear.has(2024) && byYear.has(2025),
      `both periods must be published, not collapsed into one point: ${JSON.stringify([
        ...byYear,
      ])}`,
    );
    // The exit filing covering 2025 values 12 rows against the annual's 3, so 2025
    // is the larger, positive figure and 2024 the negative one. If 2025 ever went
    // negative here the annual has recaptured the year.
    assert.ok(
      byYear.get(2025)! > 0,
      `2025 must come from the exit filing that covers 2025, not the fiscal-2024 ` +
        `annual lodged in June: got ${byYear.get(2025)}`,
    );
    assert.ok(
      byYear.get(2024)! < byYear.get(2025)!,
      `2024 must come from the fiscal-2024 annual: got ${byYear.get(2024)} vs ` +
        `${byYear.get(2025)} for 2025`,
    );

    const [decl] = await allRows<{ declaration_type: string }>(
      `SELECT d.declaration_type
         FROM person_wealth_year w
         JOIN declaration d ON d.declaration_id = w.declaration_id
         JOIN person p ON p.person_id = w.person_id
        WHERE p.slug = $1 AND w.period_year = 2025`,
      [SLUG],
    );
    assert.equal(
      decl?.declaration_type,
      "Vacate",
      "2025's representative must be the exit filing that covers 2025",
    );
  },
);
