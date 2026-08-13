// place_mp_companies (migration 151 + tr_company_place.person_link_n in 133) — the live
// replacement for parliament/companies-by-{ekatte,obshtina}/.
// Plan: docs/plans/mp-tr-edges-pg-v1.md §4 Tier 2, revised by data-hub-lateral-edges-v1 §11.10.
//
//   npm run test:data
//
// What this gates:
//   1. the denormalized person_link_n has not drifted from the person layer it copies;
//   2. coverage strictly DOMINATES the shard family it replaces (no place loses its page);
//   3. every person named on a row is a servable public figure — this page names people;
//   4. paging is consistent and the counts do not move as the reader pages.
//
// Auto-skips only when Postgres is unreachable.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SHARDS = {
  ekatte: path.join(ROOT, "data/parliament/companies-by-ekatte"),
  obshtina: path.join(ROOT, "data/parliament/companies-by-obshtina"),
};

const one = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> => (await allRows<T>(sql, params))[0];

const reachable = await allRows("SELECT 1")
  .then(() => true)
  .catch(() => false);
const skip = reachable ? false : "Postgres unreachable";

afterAll(async () => {
  await end();
});

/** Place ids the committed shard family serves, or null once it is retired. */
const shardPlaces = (dir: string): string[] | null =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith("-summary.json"))
        .map((f) => f.replace("-summary.json", ""))
    : null;

test.skipIf(skip)(
  "person_link_n is populated and has not drifted",
  async () => {
    // The column is DENORMALIZED from person_role, so it can silently go stale in a way no row
    // count sees — the failure class CLAUDE.md documents for money_eur/political_n on this same
    // table. Re-derive and compare rather than trusting it.
    const r = await one<{ n: string; drift: string }>(
      `WITH live AS (
       SELECT r.ref AS uic, count(DISTINCT r.person_id)::int AS n
         FROM person_role r
         JOIN person pe ON pe.person_id = r.person_id
        WHERE r.source IN ('tr','ngo')
          AND r.confidence IN ('exact_id','high','manual')
          AND pe.status = 'active' AND pe.is_public_figure
        GROUP BY r.ref
     )
     SELECT (SELECT count(*) FROM tr_company_place WHERE person_link_n > 0) AS n,
            (SELECT count(*) FROM tr_company_place p
               LEFT JOIN live l ON l.uic = p.uic
              WHERE p.person_link_n IS DISTINCT FROM COALESCE(l.n, 0)) AS drift`,
    );
    assert.ok(
      Number(r.n) > 1_000,
      `only ${r.n} companies carry person_link_n > 0 — run db:load:tr-company-place:pg AFTER ` +
        `db:resolve:persons. Empty, every place page serves zero companies at a 200.`,
    );
    assert.equal(
      Number(r.drift),
      0,
      `${r.drift} companies' person_link_n disagrees with the live person layer. The loader ` +
        `runs before db:resolve:persons, or has not run since it.`,
    );
  },
);

test.skipIf(skip)(
  "coverage grows by an order of magnitude, and the places that drop out are explained",
  async () => {
    // The justification for not porting the builders — but "no place ever loses its page" is
    // the WRONG assertion, and measuring it is what showed why.
    //
    // ⚠️ SOME SHARD PLACES CORRECTLY LOSE THEIR PAGE. Measured: 23 of the 176 ekatte places
    // the shards serve have no company held by a public figure under the guard — their shard
    // entries rested entirely on name matches the registry says belong to more than one human
    // (21 of the 23 still have companies placed there; they are simply not held by anyone in
    // public life). Refusing those IS the migration. Asserting they survive would be asserting
    // the guard does nothing.
    //
    // So the two real claims: the net coverage is far larger, and the drop-out is a small
    // minority rather than the common case. Per-company drift is test 1's job.
    for (const [kind, dir] of Object.entries(SHARDS)) {
      const places = shardPlaces(dir);
      if (places === null) continue; // retired (step 5) — nothing to compare
      const col = kind === "ekatte" ? "ekatte" : "obshtina";
      const r = await one<{ served: string; kept: string; total: string }>(
        `SELECT (SELECT count(DISTINCT ${col}) FROM tr_company_place
                  WHERE person_link_n > 0 AND ${col} IS NOT NULL)          AS served,
                (SELECT count(*) FROM unnest($1::text[]) AS id
                  WHERE EXISTS (SELECT 1 FROM tr_company_place p
                                 WHERE p.${col} = id AND p.person_link_n > 0)) AS kept,
                array_length($1::text[], 1)                                AS total`,
        [places],
      );
      assert.ok(
        Number(r.served) >= places.length * 1.5,
        `${kind}: ${r.served} places served against ${places.length} in the shards — the ` +
          `whole argument for this design is that it covers far MORE places, not fewer.`,
      );
      const keptShare = Number(r.kept) / Number(r.total);
      assert.ok(
        keptShare > 0.7,
        `${kind}: only ${(keptShare * 100).toFixed(1)}% of shard places survive ` +
          `(${r.kept}/${r.total}). A drop this large is the guard misfiring, not namesakes.`,
      );
      console.info(
        `[place_mp_companies] ${kind}: ${r.served} places served · ` +
          `${r.kept}/${r.total} shard places kept`,
      );
    }
  },
  120_000,
);

test.skipIf(skip)(
  "every named person is a servable public figure",
  async () => {
    // This page NAMES PEOPLE and links their profiles, so a row naming someone /person/:slug
    // will not serve is both a dead link and an attribution we are not standing behind.
    const r = await one<{ bad: string; named: string }>(
      `WITH sample AS (
       SELECT place_mp_companies(ekatte, NULL, 1, 50) AS r
         FROM (SELECT DISTINCT ekatte FROM tr_company_place
                WHERE person_link_n > 0 ORDER BY ekatte LIMIT 40) x
     ), people AS (
       SELECT jsonb_array_elements(
                jsonb_array_elements(s.r -> 'companies') -> 'people') ->> 'slug' AS slug
         FROM sample s
     )
     SELECT count(*) FILTER (
              WHERE NOT EXISTS (SELECT 1 FROM person pe
                                 WHERE pe.slug = people.slug
                                   AND pe.status = 'active' AND pe.is_public_figure)) AS bad,
            count(*) AS named
       FROM people`,
    );
    assert.ok(
      Number(r.named) > 50,
      `only ${r.named} people named across 40 places — the assertion below would be vacuous`,
    );
    assert.equal(
      Number(r.bad),
      0,
      `${r.bad} rows name a person who is not an active public figure — a dead /person link ` +
        `and an attribution the person layer refuses.`,
    );
  },
);

test.skipIf(skip)(
  "paging is consistent and the counts do not move",
  async () => {
    // The shards' two payload shapes could disagree about `count`; one function cannot — but it
    // still has to page correctly. Sofia is the only place with real pagination.
    const a = await one<{ r: Record<string, unknown> }>(
      `SELECT place_mp_companies('68134', NULL, 1, 10) AS r`,
    );
    const b = await one<{ r: Record<string, unknown> }>(
      `SELECT place_mp_companies('68134', NULL, 2, 10) AS r`,
    );
    const p1 = a.r as {
      count: number;
      totalPages: number;
      companies: { uic: string }[];
    };
    const p2 = b.r as {
      count: number;
      totalPages: number;
      companies: { uic: string }[];
    };
    assert.equal(p1.count, p2.count, "count moved between pages");
    assert.equal(
      p1.totalPages,
      p2.totalPages,
      "totalPages moved between pages",
    );
    assert.ok(
      p1.companies.length > 0 && p2.companies.length > 0,
      "a page came back empty",
    );
    assert.equal(
      p1.companies.filter((c) => p2.companies.some((d) => d.uic === c.uic))
        .length,
      0,
      "pages 1 and 2 overlap — the ORDER BY is not total, so OFFSET is not stable",
    );
    assert.ok(
      p1.totalPages >= Math.ceil(p1.count / 10),
      `totalPages ${p1.totalPages} cannot hold ${p1.count} rows at 10/page`,
    );
  },
);

test.skipIf(skip)("an unknown place answers empty, not wrong", async () => {
  const r = await one<{ r: { count: number; companies: unknown[] } }>(
    `SELECT place_mp_companies('99999', NULL, 1, 50) AS r`,
  );
  assert.equal(r.r.count, 0);
  assert.deepEqual(r.r.companies, []);
});

test.skipIf(skip)("Sofia stays inside its measured budget", async () => {
  // 28,257 buffers measured 2026-08-12 — above the tile budget on purpose (this is a page,
  // not a dashboard tile), so the ceiling guards against a REGRESSION rather than enforcing
  // the 2,000-buffer rule.
  //
  // ⚠️ THE CEILING IS 32,000, NOT 45,000, AND THE DIFFERENCE IS WHETHER IT CAN FAIL AT ALL.
  // 45,000 was chosen against the 46,608 the pre-restructure body cost — but that figure is
  // BOTH restructures undone at once. Measured individually: idx_person_role_tr_ref_person
  // dropped = 33,497; the personCount dedupe undone = 41,601; the tr_company_place partial
  // index dropped = 36,034. Every one of those passed a 45,000 ceiling, so the test bounded
  // nothing a single regression could reach. 32,000 sits above the 28,257 baseline and below
  // the cheapest single regression.
  const plan = await allRows<{ "QUERY PLAN": string }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT place_mp_companies('68134', NULL, 1, 50)`,
  );
  const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
  const worst = Math.max(
    ...[...text.matchAll(/shared (?:hit=(\d+))?\s*(?:read=(\d+))?/g)].map(
      (m) => Number(m[1] ?? 0) + Number(m[2] ?? 0),
    ),
    0,
  );
  assert.ok(
    worst > 0,
    "no buffer counts parsed — the EXPLAIN format or regex changed",
  );
  assert.ok(
    worst < 32_000,
    `Sofia touched ${worst} buffers (ceiling 32,000; baseline 28,257). Likely causes: ` +
      `idx_tr_company_place_ekatte_person missing (36,034), ` +
      `idx_person_role_tr_ref_person missing (seq scan on person_role), or personCount ` +
      `joining person before deduping person_id.`,
  );
});
