// Tier 3 (Postgres-native) — the /subsidies hub's stat cache (migration 162).
//
//   npm run test:data
//
// Plan: docs/plans/subsidies-hub-v1.md §5 and §10. The dashboard-hub skill's §0 is
// the whole reason this file is long: on a hub, the defect that survives review is
// a figure that is arithmetically correct and false as a sentence. So each figure
// is recomputed from its DECLARED basis and the rejected alternatives are asserted
// as explicit notEquals — a wrong basis is usually one word away from the right one.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";

// ../../.. — this file is scripts/db/tests/, so two levels up is `scripts/`, not the
// repo root. The sector_stats read below is relative to this, and got it wrong once.
const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const haveDb = await dbReachable();

const built = haveDb
  ? (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY(current_schemas(false))
            AND c.relkind = 'm' AND c.relname = 'agri_hub_stats_cache'`,
      )
    )[0].n !== "0"
  : false;

const corpusLoaded =
  haveDb && built
    ? (
        await allRows<{ n: string }>(
          "SELECT count(*)::text AS n FROM agri_subsidies",
        )
      )[0].n !== "0"
    : false;

const skip = !haveDb
  ? "Postgres unreachable"
  : !built
    ? "162 not applied"
    : !corpusLoaded
      ? "agri corpus not loaded"
      : false;

afterAll(async () => {
  if (haveDb) await end();
});

/** The served payload for one scope. */
const stats = async (scope: string) =>
  (
    await allRows<{ r: Record<string, unknown> | null }>(
      "SELECT agri_hub_stats($1) AS r",
      [scope],
    )
  )[0].r;

test.skipIf(skip)(
  "all three scope sets agree — payloads, ranking and hub cache",
  async () => {
    const [row] = await allRows<{
      payload: string[] | null;
      ranking: string[] | null;
      hub: string[] | null;
    }>(
      `SELECT (SELECT array_agg(DISTINCT key ORDER BY key) FROM agri_payloads
                WHERE kind = 'overview') AS payload,
              (SELECT array_agg(DISTINCT scope_key ORDER BY scope_key)
                 FROM agri_beneficiary_year) AS ranking,
              (SELECT array_agg(DISTINCT scope_key ORDER BY scope_key)
                 FROM agri_hub_stats_cache) AS hub`,
    );
    assert.ok(
      row.hub?.length,
      "agri_hub_stats_cache is empty — never REFRESHed",
    );
    assert.deepEqual(
      row.hub,
      row.payload,
      "the hub cache and the overview payloads disagree about which scopes exist — " +
        "a scope the page resolves would render a hub with no figures",
    );
    assert.deepEqual(row.hub, row.ranking, "the hub and the ranking disagree");
  },
);

test.skipIf(skip)(
  "an uncovered scope returns NULL, never a row of zeroes",
  async () => {
    // `agriScopeToKey` maps a year outside the corpus to null and the page renders
    // its named empty state. The route must not manufacture a zero here: `?pscope`
    // is shared with /procurement, whose picker runs from 2011, so 2019 arrives by
    // ordinary clicking. A `0` would be a claim that no farm money was paid.
    for (const bad of ["2019", "2014", "nonsense"])
      assert.equal(
        await stats(bad),
        null,
        `scope ${bad} is not in the corpus but returned a payload`,
      );
  },
);

test.skipIf(skip)(
  "the hub's headline equals the destination's own figures",
  async () => {
    // The skill's anti-drift rule: a tile must not announce a number the page it
    // links to disagrees with. `totalEur` is checked against the overview payload
    // the dashboard body renders, `entityEur` against the ranking the recipients
    // page walks.
    for (const scope of ["", "all", "2023"]) {
      const s = (await stats(scope)) as Record<string, number> | null;
      assert.ok(s, `no payload for scope ${scope}`);
      const [cmp] = await allRows<{
        payload_total: string | null;
        ranking_entity: string | null;
      }>(
        `SELECT (SELECT round((payload->'headline'->>'totalEur')::numeric, 2)::text
                   FROM agri_payloads WHERE kind = 'overview' AND key = $1) AS payload_total,
                (SELECT round(sum(total_eur::numeric), 2)::text
                   FROM agri_beneficiary_year WHERE scope_key = $1) AS ranking_entity`,
        [scope],
      );
      // TO THE EURO, not to the cent, and deliberately so. The payload is summed in
      // Node (IEEE doubles) and the cache in Postgres `numeric`; at €11bn those two
      // accumulators land one cent apart (11,037,181,927.18 vs .17) and no amount of
      // care on either side closes that — they are different engines. A euro is 9e-11
      // of the corpus total, so this still catches any real drift while refusing to
      // fail on arithmetic that is correct on both sides.
      assert.equal(
        Math.round(Number(s.totalEur)),
        Math.round(Number(cmp.payload_total)),
        `scope ${scope}: the hub's totalEur disagrees with the overview payload`,
      );
      assert.equal(
        Math.round(Number(s.entityEurExPayer)),
        Math.round(Number(cmp.ranking_entity)),
        `scope ${scope}: the hub's entityEurExPayer disagrees with the recipients ranking`,
      );
    }
  },
);

test.skipIf(skip)(
  "concentration is over LEGAL-ENTITY money — the over-total reading is different and also true",
  async () => {
    // 2 dp, matching what the ingest's round2 stores in agri_payloads.concentration —
    // which is where this figure now comes from. Recomputing at 1 dp compared 12.6
    // against a stored 12.62 and failed on the rounding rather than on the basis.
    const s = (await stats("all")) as Record<string, number>;
    const [row] = await allRows<{ over_entity: string; over_total: string }>(
      `WITH e AS (
         SELECT eik, sum(total_eur::numeric) v FROM agri_subsidies
          WHERE eik IS NOT NULL AND eik <> '121100421' GROUP BY eik),
       r AS (SELECT v, row_number() OVER (ORDER BY v DESC) rn, sum(v) OVER () tot FROM e)
       SELECT round((SELECT sum(v) FROM r WHERE rn <= 100) / max(tot) * 100, 2)::text AS over_entity,
              round((SELECT sum(v) FROM r WHERE rn <= 100)
                    / (SELECT sum(total_eur::numeric) FROM agri_subsidies) * 100, 2)::text AS over_total
         FROM r`,
    );
    assert.equal(
      String(s.top100PctOfEntityEur),
      row.over_entity,
      "top100PctOfEntityEur is not the share of legal-entity money its key declares",
    );
    // The rejected basis, asserted so the key cannot silently start meaning it.
    // Both sentences are true and they are ~5 points apart.
    assert.notEqual(
      String(s.top100PctOfEntityEur),
      row.over_total,
      "top100PctOfEntityEur equals the share of ALL money — the denominator has " +
        "silently widened to include the ~40% that sits on rows with no ЕИК",
    );
  },
);

test.skipIf(skip)(
  "the no-ЕИК figure is named for what it measures, and is NOT individuals",
  async () => {
    const s = (await stats("all")) as Record<string, unknown>;
    // The key must not claim these are natural persons. Measured: €385.5m of this
    // money carries an unmistakable company name (Напоителни системи ЕАД at €47.8m,
    // Община Баните) — the register simply filed them without an ЕИК. See plan §4.3.
    for (const banned of [
      "individualEur",
      "individualCount",
      "individuals",
      "noEikRecords",
    ])
      assert.ok(
        !(banned in s),
        `agri_hub_stats exposes \`${banned}\` — "no ЕИК" is not "физическо лице", ` +
          "and a tile reading that key would publish a false sentence off a correct sum",
      );
    assert.ok("noEikEur" in s && "noEikBeneficiaries" in s && "noEikRows" in s);
    // The two counts are 12.5x apart and sit beside `paymentRows`, which IS a row
    // count — so each has to say which it is. 168,043 distinct (name, oblast) pairs
    // against 2,094,249 rows.
    assert.notEqual(
      s.noEikBeneficiaries,
      s.noEikRows,
      "noEikBeneficiaries and noEikRows are equal — one of them is measuring the other",
    );

    const [row] = await allRows<{ no_eik: string; companyish: string }>(
      `SELECT round(sum(total_eur::numeric), 2)::text AS no_eik,
              round(sum(total_eur::numeric) FILTER (
                WHERE name ~* 'ЕООД|ООД|ЕАД|КООПЕРАЦИЯ|ОБЩИНА'), 2)::text AS companyish
         FROM agri_subsidies WHERE eik IS NULL`,
    );
    assert.equal(
      Math.round(Number(s.noEikEur)),
      Math.round(Number(row.no_eik)),
    );
    // The premise, pinned: a material share of the no-ЕИК money is company-shaped.
    // If this ever goes to zero the register has changed and the page's framing
    // should be revisited — it is not a licence to relabel the key.
    assert.ok(
      Number(row.companyish) > 100_000_000,
      `only €${row.companyish} of the no-ЕИК money carries a company-shaped name ` +
        "(was €385.5m) — re-check /subsidies/untraceable's framing",
    );
  },
);

test.skipIf(skip)(
  "the political arm uses the canonical person_link_n gate, not company_politicians",
  async () => {
    const s = (await stats("all")) as Record<string, number>;
    const [row] = await allRows<{
      canonical: string;
      canonical_eur: string;
      money_restricted: string;
    }>(
      // The SAME predicate 133's loader and 151's place_mp_companies use.
      `WITH gated AS (
         SELECT DISTINCT r.ref AS eik FROM person_role r
           JOIN person pe ON pe.person_id = r.person_id
          WHERE r.source IN ('tr','ngo')
            AND r.confidence IN ('exact_id','high','manual')
            AND pe.status = 'active' AND pe.is_public_figure)
       SELECT (SELECT count(DISTINCT a.eik) FROM agri_subsidies a
                WHERE a.eik IN (SELECT eik FROM gated))::text AS canonical,
              (SELECT round(sum(a.total_eur::numeric), 2) FROM agri_subsidies a
                WHERE a.eik IN (SELECT eik FROM gated))::text AS canonical_eur,
              -- to_regclass-guarded: company_politicians is written only by
              -- db:load:tr:pg, a REFRESH_EXCLUSIONS member, so a legitimate database
              -- may not have it. Unguarded this test FAILS there rather than skipping
              -- the one clause it cannot evaluate.
              (SELECT CASE WHEN to_regclass('public.company_politicians') IS NULL THEN NULL
                      ELSE (SELECT count(DISTINCT a.eik) FROM agri_subsidies a
                             WHERE a.eik IN (SELECT eik FROM company_politicians)) END)::text
                AS money_restricted`,
    );
    assert.equal(
      String(s.politicalEiks),
      row.canonical,
      "the political arm is not the canonical gated set",
    );
    assert.equal(
      Math.round(Number(s.politicalEur)),
      Math.round(Number(row.canonical_eur)),
    );
    // company_politicians (008) is money-restricted and PROCUREMENT-derived: 11 EIKs
    // against 568 here, a factor of 10 on money. Using it would tell a reader that
    // 0.11% of farm money touches a public figure when the person layer knows 1.67%.
    if (row.money_restricted !== null)
      assert.notEqual(
        String(s.politicalEiks),
        row.money_restricted,
        "the political arm collapsed onto company_politicians — that set is " +
          "procurement-derived and money-restricted, and an order of magnitude narrower",
      );
  },
);

test.skipIf(skip)(
  "the cross-stream block is the live municipal figure, not a literal",
  async () => {
    const s = (await stats("")) as { crossStream: Record<string, number> };
    const [row] = await allRows<{ y: string | null; eur: string; n: string }>(
      `SELECT fiscal_year::text AS y, round(sum(total_eur::numeric), 2)::text AS eur,
              count(*)::text AS n
         FROM budget_muni_transfer
        WHERE fiscal_year = (SELECT max(fiscal_year) FROM budget_muni_transfer)
        GROUP BY fiscal_year`,
    );
    // budget_muni_transfer is filled by db:load:budget-muni:pg; on a database where
    // that has not run the tile correctly renders nothing and there is nothing to
    // compare. Absent is that loader's problem, not this gate's.
    if (!row) return;
    assert.equal(String(s.crossStream.muniTransferYear), row.y);
    assert.equal(
      Math.round(Number(s.crossStream.muniTransferEur)),
      Math.round(Number(row.eur)),
      "the municipal-transfer tile figure has drifted from budget_muni_transfer — " +
        "it must READ the table, because a literal goes stale at a 200 the next " +
        "time update-budget runs",
    );
    assert.equal(String(s.crossStream.muniCount), row.n);
  },
);

test.skipIf(skip)(
  "the hub's 'all' is deliberately NOT the sectors hub's all.agri",
  async () => {
    // Both are correct and they are ~7x apart: sector_stats' `all` scope carries the
    // LATEST YEAR's payout (its headline is an annual figure), while this hub's `all`
    // is the whole €11.04bn corpus. Same word, two windows. Asserted so a future
    // "reconciliation" cannot quietly make them equal and break one of the two pages.
    const sectorStats = JSON.parse(
      readFileSync(
        path.join(REPO, "data/procurement/derived/sector_stats.json"),
        "utf8",
      ),
    ) as Record<string, Record<string, { value: number; basis: string }>>;
    const agri = sectorStats.all?.agri;
    assert.ok(agri, "sector_stats.json has no all.agri entry");
    assert.equal(
      agri.basis,
      "payout",
      "the sectors hub's agri basis changed — re-check what its `all` scope means",
    );
    // The comparison this test is NAMED for, which it did not previously make.
    // sector_stats' `all` carries the LATEST YEAR's payout; this hub's `all` is the
    // whole corpus. Both correct, ~7x apart, same word.
    const hubAll = (await stats("all")) as Record<string, number>;
    const hubDefault = (await stats("")) as Record<string, number>;
    assert.notEqual(
      Math.round(Number(hubAll.totalEur)),
      Math.round(agri.value),
      "the hub's `all` scope now equals the sectors hub's all.agri — one of the two " +
        "pages has silently changed what `all` means",
    );
    assert.equal(
      Math.round(Number(hubDefault.totalEur)),
      Math.round(agri.value),
      "sector_stats' all.agri should equal THIS hub's DEFAULT scope (both are the " +
        "latest financial year's payout) — if it no longer does, the two are reading " +
        "different vintages of agri_payloads",
    );
  },
);

test.skipIf(skip)(
  "the served call stays cheap enough for every view",
  async () => {
    const plan = await allRows<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT agri_hub_stats('')",
    );
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    const execText = text.split(/^Planning:/m)[0] ?? text;
    const buffers = [
      ...execText.matchAll(/shared(?: hit=(\d+))?(?: read=(\d+))?/g),
    ].reduce(
      (max, m) => Math.max(max, Number(m[1] ?? 0) + Number(m[2] ?? 0)),
      0,
    );
    assert.ok(buffers > 0, `no execution buffers parsed from:\n${text}`);
    // Measured 2026-08-17: 303 execution buffers. The dashboard-hub skill's ceiling for anything served
    // live is ~2,000, and this call runs on EVERY /subsidies view — the live aggregate
    // it replaced was 233,274 buffers for the political arm alone.
    assert.ok(
      buffers < 2000,
      `agri_hub_stats('') touched ${buffers} buffers (was 303) — the matview seek has ` +
        `stopped being a seek:\n${text}`,
    );
  },
);

test.skipIf(skip)(
  "the company-shaped figure is a FLOOR, and its word boundaries are load-bearing",
  async () => {
    const s = (await stats("all")) as Record<string, number>;
    const [row] = await allRows<{
      anchored: string;
      unanchored: string;
      no_eik: string;
    }>(
      // The SAME pattern with and without \m…\M on the two-letter forms. Unanchored,
      // АД matches inside ordinary Bulgarian names (…-ад) and ЕТ inside many more, so
      // the „floor" balloons and stops being a floor at all. This asserts the gap is
      // real — i.e. that the anchors are doing work — as well as pinning the value.
      `WITH anchored AS (
         SELECT round(sum(total_eur::numeric), 2) AS v FROM agri_subsidies
          WHERE eik IS NULL
            AND name ~* '(ЕООД|ООД|ЕАД|КООПЕРАЦИЯ|ОБЩИНА|СДРУЖЕНИЕ|ФОНДАЦИЯ|ЧИТАЛИЩЕ)|(\\mАД\\M)|(\\mЕТ\\M)'
       ), unanchored AS (
         SELECT round(sum(total_eur::numeric), 2) AS v FROM agri_subsidies
          WHERE eik IS NULL
            AND name ~* '(ЕООД|ООД|ЕАД|КООПЕРАЦИЯ|ОБЩИНА|СДРУЖЕНИЕ|ФОНДАЦИЯ|ЧИТАЛИЩЕ|АД|ЕТ)'
       ), all_no_eik AS (
         SELECT round(sum(total_eur::numeric), 2) AS v FROM agri_subsidies WHERE eik IS NULL
       )
       SELECT (SELECT v FROM anchored)::text   AS anchored,
              (SELECT v FROM unanchored)::text AS unanchored,
              (SELECT v FROM all_no_eik)::text AS no_eik`,
    );
    assert.equal(
      Math.round(Number(s.noEikCompanyShapedEurFloor)),
      Math.round(Number(row.anchored)),
      "the cached floor no longer matches the pattern the migration documents",
    );
    // It is a FLOOR: strictly less than the no-ЕИК money it is a subset of, and
    // strictly less than the unanchored reading. If the two ever converge the
    // anchors have stopped mattering and the figure is no longer a floor.
    assert.ok(
      Number(row.anchored) < Number(row.no_eik),
      "the floor equals the whole no-ЕИК total — it is meant to be a subset",
    );
    assert.ok(
      Number(row.unanchored) > Number(row.anchored) * 1.5,
      `unanchored (€${row.unanchored}) is not materially larger than anchored ` +
        `(€${row.anchored}) — the \\m…\\M boundaries have stopped discriminating, ` +
        "which usually means a collation or regex-engine change",
    );
  },
);

test.skipIf(skip)(
  "the company-shaped floor breaks at the source change, not gradually",
  async () => {
    // The claim /subsidies/untraceable and /subsidies/coverage both make: the rise in
    // untraceable money is at least partly a SOURCE artefact, because the older
    // register published companies with an ЕИК and the newer one often does not.
    // Pinned so the pages cannot keep asserting it after the data stops supporting it.
    const rows = await allRows<{ scope_key: string; floor: string }>(
      `SELECT scope_key, coalesce(no_eik_companyish_eur, 0)::text AS floor
         FROM agri_hub_stats_cache
        WHERE scope_key ~ '^[0-9]{4}$' ORDER BY scope_key`,
    );
    const egov = rows.filter((r) => Number(r.scope_key) <= 2023);
    const seu = rows.filter((r) => Number(r.scope_key) >= 2024);
    assert.ok(
      egov.length && seu.length,
      "expected both source eras in the corpus",
    );
    const maxEgov = Math.max(...egov.map((r) => Number(r.floor)));
    const minSeu = Math.min(...seu.map((r) => Number(r.floor)));
    assert.ok(
      maxEgov < 1_000_000,
      `an egov-era year carries €${maxEgov} of plainly-corporate no-ЕИК money — the ` +
        "pages say this is negligible before 2024",
    );
    assert.ok(
      minSeu > 100_000_000,
      `a СЕУ-era year carries only €${minSeu} — the pages say 2024-2025 are in the ` +
        "hundreds of millions",
    );
  },
);
