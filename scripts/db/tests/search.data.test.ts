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
import { allRows, end } from "../lib/pg";

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
