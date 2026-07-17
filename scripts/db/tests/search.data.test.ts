// Phase 4c/4d verification — the Postgres name-search + last-ingestion features.
// Locks in the behavior proven during the build: the Cyrillic↔Latin fold, the
// company/officer search functions (BG/EN, partial, fuzzy, any-order), and the
// last-ingestion delta invariant.
//
// Requires the Postgres store (`npm run db:pg:up` + `db:load:pg` + `db:load:tr:pg`);
// auto-skips when Postgres is unreachable or the tables/functions are absent —
// so CI (no container, no corpus) skips it, exactly like the SQLite tests.
//
// See docs/plans/postgres-migration-v1.md (Features 1 + 2).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { allRows, withClient, end } from "../lib/pg";

const rows = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => allRows<T>(sql, params);
const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await rows(sql, params))[0] ?? {})[0] as T;

// Probe once, synchronously enough for node:test's skip (top-level await).
const probe = async (): Promise<string | false> => {
  try {
    await allRows("SELECT 1");
  } catch {
    return "no Postgres — run npm run db:pg:up";
  }
  const fn = await scalar<string | null>(
    "SELECT to_regprocedure('search_companies(text,int)')::text",
  );
  if (!fn) return "search functions absent — run npm run db:load:tr:pg";
  const n = Number(await scalar<string>("SELECT count(*) FROM tr_companies"));
  if (!n) return "tr_companies empty — run npm run db:load:tr:pg";
  return false;
};

const skip = await probe();
after(async () => {
  await end();
});

test(
  "translit_bg_latin folds Cyrillic → Latin, case + diacritics",
  { skip },
  async () => {
    const f = async (s: string) =>
      scalar<string>("SELECT translit_bg_latin($1)", [s]);
    assert.equal(await f("Иван Петров"), "ivan petrov");
    assert.equal(await f("ЛУКОЙЛ"), "lukoyl");
    assert.equal(await f("Щур"), "shtur"); // щ→sht
    assert.equal(await f("Жеков"), "zhekov"); // ж→zh
    assert.equal(await f("Ючбашиев"), "yuchbashiev"); // ю→yu, ч→ch, ш→sh
    assert.equal(await f("José"), "jose"); // Latin diacritic fold (unaccent)
    // Same fold whether typed in Cyrillic or Latin — the core of BG/EN search.
    assert.equal(await f("петров"), await f("petrov"));
  },
);

test(
  "search_companies: partial, Latin→Cyrillic, procurement summary",
  { skip },
  async () => {
    interface Co {
      uic: string;
      name: string;
      contracts: string;
      contracts_eur: number;
    }
    const cyr = await rows<Co>("SELECT * FROM search_companies($1, 20)", [
      "лукойл",
    ]);
    const lat = await rows<Co>("SELECT * FROM search_companies($1, 20)", [
      "lukoyl",
    ]);
    // ЛУКОЙЛ-БЪЛГАРИЯ (uic 121699202) surfaces from either script...
    const cyrHit = cyr.find((r) => r.uic === "121699202");
    const latHit = lat.find((r) => r.uic === "121699202");
    assert.ok(cyrHit, "лукойл (Cyrillic) finds ЛУКОЙЛ-БЪЛГАРИЯ");
    assert.ok(latHit, "lukoyl (Latin) finds ЛУКОЙЛ-БЪЛГАРИЯ");
    // ...and it carries its procurement summary (contractor_eik = uic).
    assert.ok(Number(cyrHit!.contracts) > 0, "contracts count > 0");
    assert.ok(cyrHit!.contracts_eur > 0, "contracts_eur > 0");
  },
);

test(
  "search_officers: any-order tokens, Latin query, officer→company",
  { skip },
  async () => {
    interface Off {
      officer: string;
      uic: string;
      company: string | null;
    }
    // Reversed order (last first), skipping the middle name.
    const hit = (
      await rows<Off>("SELECT * FROM search_officers($1, 20)", [
        "Чангалова Соня",
      ])
    ).find((r) => r.uic === "201673172");
    assert.ok(hit, "any-order officer name resolves");
    assert.equal(hit!.officer, "СОНЯ ИЛИЕВА ЧАНГАЛОВА");
    assert.ok(hit!.company, "officer row carries its company");
    // Latin query finds Cyrillic-stored officer.
    const lat = await rows<Off>("SELECT * FROM search_officers($1, 20)", [
      "aleksey petrov",
    ]);
    assert.ok(
      lat.some((r) => /петров/i.test(r.officer)),
      "aleksey petrov (Latin) matches Cyrillic Петров officers",
    );
  },
);

test(
  "last_ingested_contracts = the latest batch's first-seen delta",
  { skip },
  async () => {
    const maxBatch = await scalar<number>(
      "SELECT max(id) FROM ingest_batches WHERE source = 'shards'",
    );
    assert.ok(maxBatch, "at least one shards batch loaded");
    // Every returned contract was first seen in the latest batch.
    const allInLatest = await scalar<boolean>(
      `SELECT bool_and(f.batch_id = $1)
       FROM last_ingested_contracts(1000000) l
       JOIN contract_first_seen f USING (key)`,
      [maxBatch],
    );
    assert.notEqual(allInLatest, false, "a row leaked from an older batch");
    // Count matches first-seen rows of that batch that still exist in contracts.
    const funcCount = Number(
      await scalar<string>(
        "SELECT count(*) FROM last_ingested_contracts(1000000)",
      ),
    );
    const expected = Number(
      await scalar<string>(
        `SELECT count(*) FROM contract_first_seen f
         JOIN contracts c USING (key) WHERE f.batch_id = $1`,
        [maxBatch],
      ),
    );
    assert.equal(
      funcCount,
      expected,
      "last_ingested count vs first-seen delta",
    );
  },
);

test(
  "search_contractors: finds contractors absent from TR (foreign firms)",
  { skip },
  async () => {
    interface Ct {
      eik: string;
      name: string;
      contracts: string;
    }
    // Elsevier / Pesa are contractors in the corpus with no TR record — they
    // must still be findable by name via the contract-derived index.
    const elsevier = await rows<Ct>(
      "SELECT * FROM search_contractors($1, 10)",
      ["elsevier"],
    );
    assert.ok(
      elsevier.some((r) => /elsevier/i.test(r.name)),
      "elsevier (non-TR contractor) is findable",
    );
    const pesa = await rows<Ct>("SELECT * FROM search_contractors($1, 10)", [
      "pesa bydgoszcz",
    ]);
    assert.ok(
      pesa.some((r) => /pesa/i.test(r.name)),
      "pesa bydgoszcz (non-TR contractor) is findable",
    );
    // And Cyrillic corpus names too, with a procurement volume attached.
    const lukoyl = await rows<Ct>("SELECT * FROM search_contractors($1, 10)", [
      "лукойл",
    ]);
    assert.ok(
      lukoyl.some((r) => r.eik === "121699202" && Number(r.contracts) > 0),
      "лукойл resolves with contracts",
    );
  },
);

test(
  "search_all: one ranked feed spanning companies + officers + contractors",
  { skip },
  async () => {
    interface Hit {
      kind: string;
      eik: string;
      name: string;
    }
    // A common surname must surface hits from more than one table.
    const kinds = new Set(
      (await rows<Hit>("SELECT * FROM search_all($1, 200)", ["петров"])).map(
        (r) => r.kind,
      ),
    );
    assert.ok(kinds.has("officer"), "search_all returns officer hits");
    assert.ok(
      kinds.has("company") || kinds.has("contractor"),
      "search_all returns company/contractor hits too",
    );
    // A non-TR contractor is reachable through the unified feed.
    const elsevier = await rows<Hit>("SELECT * FROM search_all($1, 20)", [
      "elsevier",
    ]);
    assert.ok(
      elsevier.some((r) => r.kind === "contractor" && /elsevier/i.test(r.name)),
      "search_all surfaces the non-TR contractor branch",
    );
  },
);

test(
  "recent_updates: multi-table window, newest first, respects the day arg",
  { skip },
  async () => {
    interface Upd {
      kind: string;
      changed_at: string;
    }
    const wide = await rows<Upd>(
      "SELECT * FROM recent_updates($1, $2)",
      [3650, 5000],
    );
    assert.ok(
      wide.length > 0,
      "recent_updates returns rows over a wide window",
    );
    // Sorted newest-first.
    for (let i = 1; i < wide.length; i++)
      assert.ok(
        wide[i - 1].changed_at >= wide[i].changed_at,
        "recent_updates is ordered by changed_at DESC",
      );
    // A 10-year window sees more than a 1-day window (monotonic in `days`).
    const day = Number(
      await scalar<string>("SELECT count(*) FROM recent_updates(1, 100000000)"),
    );
    const decade = Number(
      await scalar<string>(
        "SELECT count(*) FROM recent_updates(3650, 100000000)",
      ),
    );
    assert.ok(decade >= day, "wider window returns at least as many rows");
    // Over a decade the feed spans TR too, not only contracts.
    const kinds = new Set(
      (
        await rows<Upd>(
          "SELECT DISTINCT kind FROM recent_updates(3650, 100000000)",
        )
      ).map((r) => r.kind),
    );
    assert.ok(
      kinds.has("company"),
      "recent_updates includes TR company updates",
    );
  },
);

// A loader may force its source to summarise by passing its own threshold
// (ingest_changelog's `threshold`), independent of the day's row count. TR does:
// its rows are already itemised per-row by the company/officer branches off the
// registry's own timestamps, so itemising its ingest delta too would report every
// new company twice. That rule lives in recent_updates' `summarised` CTE and only
// bites on a SMALL day — the 500-row threshold masks it on a big one — so it is
// exercised here on a synthetic source, inside a rolled-back txn.
test(
  "recent_updates: a summary-mode batch summarises even below the 500 threshold",
  { skip },
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const src = "__test_mode_src";
        const b = await c.query(
          `INSERT INTO ingest_batches (source, rows_total, rows_new, mode)
           VALUES ($1, 100, 3, 'summary') RETURNING id`,
          [src],
        );
        const batchId = b.rows[0].id as number;
        // 3 new rows — far below 500, so the day-total rule alone would itemise.
        await c.query(
          `INSERT INTO ingest_first_seen (source, key, batch_id)
           SELECT $1, 'k' || g, $2 FROM generate_series(1, 3) g`,
          [src, batchId],
        );
        await c.query(
          `INSERT INTO changelog_days (source, day, rows_new, rows_total, load_count)
           VALUES ($1, current_date, 3, 100, 1)`,
          [src],
        );

        // Rows this source contributes: per-row entries (kind = source) vs its
        // one coalesced summary line (kind = 'dataset', name = source).
        const shape = async (): Promise<Record<string, number>> => {
          const r = await c.query(
            `SELECT kind, count(*)::int AS n FROM recent_updates(1, 1000000)
             WHERE kind = $1 OR (kind = 'dataset' AND name = $1)
             GROUP BY kind`,
            [src],
          );
          return Object.fromEntries(
            r.rows.map((x: { kind: string; n: number }) => [x.kind, x.n]),
          );
        };

        const summary = await shape();
        assert.equal(
          summary.dataset,
          1,
          "a summary-mode batch renders one coalesced dataset line",
        );
        assert.equal(
          summary[src],
          undefined,
          "a summary-mode batch is never itemised per-row",
        );

        // Counterfactual: mode is what drives it, not the row count.
        await c.query(
          "UPDATE ingest_batches SET mode = 'detail' WHERE id = $1",
          [batchId],
        );
        const detail = await shape();
        assert.equal(
          detail[src],
          3,
          "a detail-mode batch itemises its new rows",
        );
        assert.equal(
          detail.dataset,
          undefined,
          "a detail-mode batch emits no summary line",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);
