// data/water/flood_maintenance.json — the /water riverbed tile, the AI
// riverbedCleaning tool and the prerendered /water title — is a COMMITTED
// selection over `contracts`. It sat unregenerated from 2026-07-12 to 2026-10-12
// and served €324.4M / 688 contracts against a corpus holding €427.9M / 985
// (docs/plans/water-hub-v1.md D1), with every self-consistency check passing:
// Σ byYear still equalled its own total. So this gate compares against the
// DATABASE, not against the file itself.
//
// When it trips after an ordinary ingest, re-run `npm run db:gen-water-flood` —
// do not widen the band. Auto-skips only when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { FLOOD_EXCLUDE, FLOOD_WHERE } from "../../water/flood_predicate";
import { NAPOITELNI_EIK } from "@/lib/vikReferenceData";
import type { FloodMaintenanceFile } from "@/data/water/useFloodMaintenance";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const REL = "data/water/flood_maintenance.json";
assertCommitted(REL);

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const file = (): FloodMaintenanceFile =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), REL), "utf8"),
  ) as FloodMaintenanceFile;

// An ordinary day's ingest moves the selection by a few contracts; the D1 gap
// was 30%+. 2% separates the two without flapping.
const TOLERANCE = 0.02;
const near = (actual: number, stored: number, what: string) =>
  assert.ok(
    Math.abs(actual - stored) <= Math.max(1, Math.abs(stored) * TOLERANCE),
    `${what}: database ${actual} vs file ${stored} — re-run npm run db:gen-water-flood`,
  );

// How far the file may trail the newest contract in the corpus. The generator
// runs in db:refresh; a gap beyond this means it stopped being run.
const MAX_LAG_DAYS = 45;

test("the band rejects a gap the size of the one it was written for", () => {
  // D1: the file said €324,443,293 while the corpus held €427,932,633. If the
  // tolerance ever widens enough to admit that, the totals test is decorative.
  assert.throws(() => near(427_932_633, 324_443_293, "D1 total"));
  assert.throws(() => near(985, 688, "D1 count"));
  // …while an ordinary day's drift (a handful of contracts) still passes.
  assert.doesNotThrow(() => near(990, 985, "one day's drift"));
});

test.skipIf(skip)("the file's totals match a live recompute", async () => {
  const [live] = await allRows<{
    n: string;
    eur: string;
    awarders: string;
    nap_n: string;
    nap_eur: string;
  }>(`
    SELECT count(*)::text AS n, round(sum(amount_eur))::bigint::text AS eur,
           count(DISTINCT awarder_eik)::text AS awarders,
           count(*) FILTER (WHERE awarder_eik = '${NAPOITELNI_EIK}')::text AS nap_n,
           coalesce(round(sum(amount_eur) FILTER (WHERE awarder_eik = '${NAPOITELNI_EIK}')), 0)::bigint::text AS nap_eur
    FROM contracts WHERE ${FLOOD_WHERE}`);
  const f = file();
  // Non-vacuity: an empty corpus would make every comparison below trivially near.
  assert.ok(Number(live.n) > 100, `only ${live.n} riverbed contracts in PG`);
  near(Number(live.n), f.contractCount, "contract count");
  near(Number(live.eur), f.totalEur, "total €");
  near(Number(live.awarders), f.awarderCount, "awarder count");
  near(Number(live.nap_n), f.napoitelniCount, "Напоителни contracts");
  near(Number(live.nap_eur), f.napoitelniEur, "Напоителни €");
});

test.skipIf(skip)(
  "the per-row values are the corpus's CURRENT values, not a frozen copy",
  async () => {
    // D1a: the file's own 688 rows had drifted €16M from their live values
    // (consortium carrier moves, annex current-value) while every row still
    // existed — a count check cannot see that.
    const f = file();
    const keys = f.contracts.map((c) => c.key);
    const [live] = await allRows<{ eur: string; n: string }>(
      `SELECT round(sum(amount_eur))::bigint::text AS eur, count(*)::text AS n
         FROM contracts WHERE key = ANY($1::text[])`,
      [keys],
    );
    assert.equal(
      Number(live.n),
      keys.length,
      "rows in the file no longer exist in contracts",
    );
    near(
      Number(live.eur),
      f.contracts.reduce((s, c) => s + c.eur, 0),
      "Σ of the file's own rows",
    );
  },
);

test("the file is internally consistent", () => {
  const f = file();
  assert.equal(f.contracts.length, f.contractCount);
  const byYear = f.byYear.reduce((s, y) => s + y.eur, 0);
  // Each year is rounded separately: at most €1 of drift per year.
  assert.ok(
    Math.abs(byYear - f.totalEur) <= f.byYear.length,
    `Σ byYear ${byYear} vs total ${f.totalEur}`,
  );
});

test.skipIf(skip)(
  `the file trails the corpus by at most ${MAX_LAG_DAYS} days`,
  async () => {
    const f = file();
    assert.ok(
      f.corpusThrough,
      "no corpusThrough — the file predates the 2026-10-12 generator; re-run npm run db:gen-water-flood",
    );
    const [row] = await allRows<{ max: string }>(
      `SELECT max(date) AS max FROM contracts WHERE tag = 'contract' AND date ~ '^[12][0-9]{3}-'`,
    );
    const lagDays =
      (Date.parse(row.max.slice(0, 10)) - Date.parse(f.corpusThrough)) /
      86_400_000;
    assert.ok(
      lagDays <= MAX_LAG_DAYS,
      `the file is ${lagDays} days behind the corpus (${f.corpusThrough} vs ${row.max}) — re-run npm run db:gen-water-flood`,
    );
  },
);

test.skipIf(skip)(
  "the selection leaves out the work it once mis-counted as riverbed cleaning",
  async () => {
    // Each of these sat in the first version of the rule (€146M of €428M) and is
    // NOT riverbed work: irrigation-canal reconstruction, navigation dredging on
    // the Danube, street gullies with snow clearing. A rule that lets any of them
    // back in fails here, by name, rather than as a quietly bigger total.
    const keys = new Set(file().contracts.map((c) => c.key));
    const rows = await allRows<{ key: string; what: string }>(
      `SELECT key,
              CASE WHEN title ILIKE '%хидромелиоративни съоръжения за напояване%' THEN 'irrigation'
                   WHEN title ILIKE '%фарватер%' THEN 'navigation dredging'
                   WHEN title ILIKE '%изграждане на пешеходен мост%' THEN 'footbridge'
                   ELSE 'street gullies' END AS what
         FROM contracts
        WHERE tag = 'contract'
          AND (title ILIKE '%хидромелиоративни съоръжения за напояване%'
               OR title ILIKE '%фарватер%'
               OR title ILIKE '%дъждоприемните шахти%'
               OR title ILIKE '%изграждане на пешеходен мост%')`,
    );
    // Non-vacuity: these rows exist in the corpus — the test is not passing on
    // an empty search.
    assert.ok(rows.length > 50, `only ${rows.length} reference rows found`);
    const leaked = rows.filter((r) => keys.has(r.key)).map((r) => r.what);
    assert.deepEqual(
      leaked,
      [],
      "over-captured work is back in the riverbed file",
    );
  },
);

test.skipIf(skip)("it still keeps genuine flood-protection work", async () => {
  // The other direction: tightening must not throw out the work the topic is
  // about — Напоителни's dike repairs and the Tsarevo flood-recovery contract.
  // Both classes are required — one survivor of either is not enough.
  const rows = await allRows<{ key: string; dike: boolean }>(
    `SELECT key, title ILIKE '%дига на р.Марица%' AS dike FROM contracts
        WHERE tag = 'contract'
          AND (title ILIKE '%дига на р.Марица%' OR title ILIKE '%вредното въздействие на водите%')`,
  );
  const keys = new Set(file().contracts.map((c) => c.key));
  const kept = rows.filter((r) => keys.has(r.key));
  assert.ok(
    kept.some((r) => r.dike),
    "the Марица dike repair was dropped",
  );
  assert.ok(
    kept.some((r) => !r.dike),
    "the flood-recovery contract was dropped",
  );
  // „(почистване на) коритото на р." — the phrasing the first rule never
  // matched; dozens of genuine clean-ups hang on it.
  const [korito] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM contracts
      WHERE key = ANY($1::text[]) AND title ~* 'коритото на р'`,
    [[...keys]],
  );
  assert.ok(
    Number(korito.n) > 40,
    `only ${korito.n} „коритото на р." rows kept`,
  );
});

test.skipIf(skip)("no selected title matches the exclusion list", async () => {
  // The whole list, not three hand-picked families: dropping any pattern from
  // the NOT clause lets its rows back in, and this counts them.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM contracts
      WHERE key = ANY($1::text[]) AND title ~* '${FLOOD_EXCLUDE}'`,
    [file().contracts.map((c) => c.key)],
  );
  assert.equal(Number(r.n), 0);
  // Non-vacuity: the list matches real corpus rows.
  const [all] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM contracts WHERE tag = 'contract' AND title ~* '${FLOOD_EXCLUDE}'`,
  );
  assert.ok(Number(all.n) > 100, `exclusion list matches only ${all.n} rows`);
});
