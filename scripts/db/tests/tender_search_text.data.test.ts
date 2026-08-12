// B3 — the tender dossier search index (147_tender_search_text.sql).
//
// The properties here are the ones NO row count can see. `tender_search_text` is
// read on every global search of the `tenders` resource with no degrade path, so a
// defect is a 500 on a corpus that otherwise reconciles perfectly.
//
// Skips when Postgres is down, like every *.data.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../lib/pg";

const q = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => (await getPool().query(sql, params)).rows as T[];

let up = false;

beforeAll(async () => {
  try {
    await q("SELECT 1");
    up = true;
  } catch {
    up = false;
  }
});

afterAll(async () => {
  if (up) await getPool().end();
});

const n = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await q<{ c: string }>(sql, params))[0].c);

describe("tender_search_text", () => {
  it("EXISTS — the tenders search reads it unconditionally", async () => {
    if (!up) return;
    // ⚠️ NOT a "skip if absent" gate, on purpose. Absence is the failure this file
    // exists to catch: db_table.js emits `… FROM tender_search_text …` on every
    // tenders global search and db_routes' badRequest() rethrows a 42P01 as a 500.
    // 147 is applied by load_tenders_pg.ts precisely so this can never be missing on
    // a database that has `tenders` at all.
    const reg = await q<{ r: string | null }>(
      "SELECT to_regclass('tender_search_text')::text AS r",
    );
    expect(reg[0].r).toBe("tender_search_text");
  });

  it("is EMPTY or CONSISTENT — never partially projected", async () => {
    if (!up) return;
    const rows = await n("SELECT count(*) c FROM tender_search_text");
    if (rows === 0) return; // a database with no dossier capture; legitimate.
    // Every indexed procedure must be a procedure we actually captured.
    const orphans = await n(
      `SELECT count(*) c FROM tender_search_text s
        WHERE NOT EXISTS (SELECT 1 FROM tender_dossier d WHERE d.unp = s.t_unp)`,
    );
    expect(orphans).toBe(0);
  });

  it("stores the FOLD, never raw Cyrillic — the arm searches transliterated", async () => {
    if (!up) return;
    if ((await n("SELECT count(*) c FROM tender_search_text")) === 0) return;
    // A raw-Cyrillic body here would be silently unfindable: db_table.js matches
    // fold_prefix_tsquery(translit_bg_latin(q)), which is Latin on both sides.
    //
    // The class is the BULGARIAN alphabet specifically, not `[А-Яа-я]`. Measured, 5
    // of 1,861 rows carry `ы` / `э` — Russian-only letters a *Bulgarian*
    // transliterator has no mapping for, so it passes them through. That is correct
    // and harmless: the query side runs through the same function, so both sides
    // agree and the term still matches. Asserting the wider range would fail on
    // Russian-language specifications, which the register does publish.
    const cyr = await n(
      `SELECT count(*) c FROM tender_search_text
        WHERE fold ~ '[абвгдежзийклмнопрстуфхцчшщъьюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ]'`,
    );
    expect(cyr).toBe(0);
  });

  it("has no row with an empty fold — an empty one inflates the coverage claim", async () => {
    if (!up) return;
    const empty = await n(
      "SELECT count(*) c FROM tender_search_text WHERE coalesce(fold,'') = ''",
    );
    expect(empty).toBe(0);
  });

  it("carries the FTS index and NO gin_trgm index", async () => {
    if (!up) return;
    const idx = await q<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'tender_search_text'",
    );
    const defs = idx.map((i) => i.indexdef).join("\n");
    expect(defs).toMatch(/USING gin \(to_tsvector/);
    // ⚠️ Measured 0.073 ms (FTS) vs 13,490 ms (`%>`) on 1,861 rows: word_similarity
    // recomputes trigram sets over a whole document per row. A gin_trgm index here
    // means someone re-added that arm, which at corpus scale is minutes, i.e. a 500.
    expect(defs).not.toMatch(/gin_trgm_ops/);
  });

  it("tenders carries the text_pattern_ops index the УНП search needs", async () => {
    if (!up) return;
    // Without it `unp LIKE 'q%'` cannot use a btree at all (the DB is not in the C
    // collation): measured 125 ms scanning 237k rows, vs 0.058 ms as a range scan.
    const idx = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'tenders' AND indexdef LIKE '%text_pattern_ops%'`,
    );
    expect(idx.length).toBeGreaterThan(0);
  });

  it("the search arm ADDS hits and never suppresses them", async () => {
    if (!up) return;
    if ((await n("SELECT count(*) c FROM tender_search_text")) === 0) return;
    const term = "кафе";
    const baseline = await n(
      `SELECT count(*) c FROM tenders
        WHERE to_tsvector('simple', subject_fold) @@ fold_prefix_tsquery($1)
           OR subject_fold %> translit_bg_latin($1)`,
      [term],
    );
    const withDossier = await n(
      `SELECT count(*) c FROM tenders
        WHERE to_tsvector('simple', subject_fold) @@ fold_prefix_tsquery($1)
           OR subject_fold %> translit_bg_latin($1)
           OR unp = ANY(ARRAY(
                SELECT t_unp FROM tender_search_text
                 WHERE to_tsvector('simple', fold) @@ fold_prefix_tsquery($1)
                 ORDER BY t_unp LIMIT 5000))`,
      [term],
    );
    // Strictly a superset — this is the safety property that makes a 0.78%-covered
    // index publishable at all.
    expect(withDossier).toBeGreaterThanOrEqual(baseline);
    // …and NOT a tautology. If the arm ever matched every tender (the correlated
    // `WHERE unp = unp` shape 147's header warns about), this is the assertion that
    // catches it — the count would be the whole corpus.
    const corpus = await n("SELECT count(*) c FROM tenders");
    expect(withDossier).toBeLessThan(corpus);
  });

  it("tender_search_coverage() reports two live numbers", async () => {
    if (!up) return;
    const [c] = await q<{ covered: string; corpus: string }>(
      "SELECT covered, corpus FROM tender_search_coverage()",
    );
    expect(Number(c.corpus)).toBeGreaterThan(0);
    expect(Number(c.covered)).toBeLessThanOrEqual(Number(c.corpus));
  });
});
