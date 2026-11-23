// Load the Commerce Registry's ANNOUNCED-ACTS index (обявени актове — ГФО, доклад за
// дейността, чл. 38 декларация, устав …) into Postgres, migration 205.
// docs/plans/tr-gfo-ingest-v1.md, Phase 0.
//
//   pnpm run db:load:tr-announced-acts:pg          # local (last step of tr:daily-refresh)
//   pnpm run db:load:tr-announced-acts:pg:cloud    # the serving database
//   … --force                                       # rescan every feed file + the CR store
//
// Two passes, both over gitignored host state, both UPSERT-ONLY:
//   1. the TR daily feed archive (raw_data/tr/daily). Incremental: a file is scanned
//      once per (day, size) and recorded in tr_announced_act_feed_file, whose gfo_acts
//      column is the cutover canary — 0 from 2026-10-12 on, when ДВ бр. 92/2026 moved
//      ГФО into a separate stream and the feed stopped listing it.
//   2. the CR Deeds captures (raw_data/tr/cr_deeds.sqlite) — the same lists per company,
//      with the announcement date, and the only source for acts after the cutover.
//      mtime-gated like db:load:cr-nkid:pg.
//
// Nothing is ever deleted: a daily file pruned from disk or an act missing from a later
// capture does not unpublish a document. A NULL from one source never overwrites a value
// another supplied. Corpus-level changelog only (summary mode) — the per-act first-seen
// lives on the table itself, so no ingest_first_seen rows are written.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { CrDeedsStore } from "../declarations/tr/cr_deeds_store";
import { CR_DEEDS_DB } from "../declarations/tr/fetch_cr_deeds";
import {
  type AnnouncedAct,
  extractCrActs,
  extractFeedActs,
  fiscalYearOf,
  isGfoFamily,
} from "../declarations/tr/announced_acts";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { upsertChangelogDay } from "./lib/ingest_changelog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = ["005_ingest_tracking.sql", "205_tr_announced_act.sql"].map(
  (f) => path.join(__dirname, "schema/pg", f),
);
const DAILY_DIR = path.resolve(__dirname, "../../raw_data/tr/daily");
const CR_MARKER = `${CR_DEEDS_DB}.acts`;
const SOURCE = "tr_announced_act";
const FILES_PER_TX = 25;

type Row = AnnouncedAct & {
  fiscalYear: number | null;
  inFeed: boolean;
  inCr: boolean;
  feedDay: string | null;
};

const STAGE_COLS = [
  "act_id",
  "uic",
  "act_mode",
  "act_mode_text",
  "field_ident",
  "description",
  "act_year",
  "fiscal_year",
  "announced_local",
  "erased_personal_data",
  "in_feed",
  "in_cr",
  "first_seen_feed_day",
];

const stageTuple = (r: Row): unknown[] => [
  r.actId,
  r.uic,
  r.actMode,
  r.actModeText,
  r.fieldIdent,
  r.description,
  r.actYear,
  r.fiscalYear,
  r.announcedLocal,
  r.erasedPersonalData,
  r.inFeed,
  r.inCr,
  r.feedDay,
];

/** Merge one act into a batch map: the same ActID is re-listed across days and deeds. */
const fold = (into: Map<string, Row>, r: Row): void => {
  const p = into.get(r.actId);
  if (!p) {
    into.set(r.actId, r);
    return;
  }
  p.actMode ??= r.actMode;
  p.fieldIdent ??= r.fieldIdent;
  p.description ??= r.description;
  p.actYear ??= r.actYear;
  p.fiscalYear ??= r.fiscalYear;
  p.announcedLocal ??= r.announcedLocal;
  if (r.erasedPersonalData != null) p.erasedPersonalData = r.erasedPersonalData;
  p.inFeed ||= r.inFeed;
  p.inCr ||= r.inCr;
  if (r.feedDay && (!p.feedDay || r.feedDay < p.feedDay)) p.feedDay = r.feedDay;
};

// ⚠️ The WHERE keeps an unchanged act from being rewritten on every run — the CR pass
// re-offers every captured act, and an unconditional DO UPDATE would churn the whole
// table into dead tuples each refresh.
const MERGE_SQL = `
WITH up AS (
  INSERT INTO tr_announced_act AS t
    (act_id, uic, act_mode, act_mode_text, field_ident, description, act_year,
     fiscal_year, announced_at, erased_personal_data, in_feed, in_cr, first_seen_feed_day)
  SELECT act_id, uic, act_mode, act_mode_text, field_ident, description, act_year,
         fiscal_year, announced_local::timestamp AT TIME ZONE 'Europe/Sofia',
         erased_personal_data, in_feed, in_cr, first_seen_feed_day
    FROM _acts
  ON CONFLICT (act_id) DO UPDATE SET
    act_mode             = COALESCE(t.act_mode, EXCLUDED.act_mode),
    field_ident          = COALESCE(t.field_ident, EXCLUDED.field_ident),
    description          = COALESCE(t.description, EXCLUDED.description),
    act_year             = COALESCE(t.act_year, EXCLUDED.act_year),
    fiscal_year          = COALESCE(t.fiscal_year, EXCLUDED.fiscal_year),
    announced_at         = COALESCE(t.announced_at, EXCLUDED.announced_at),
    erased_personal_data = COALESCE(EXCLUDED.erased_personal_data, t.erased_personal_data),
    in_feed              = t.in_feed OR EXCLUDED.in_feed,
    in_cr                = t.in_cr OR EXCLUDED.in_cr,
    first_seen_feed_day  = LEAST(t.first_seen_feed_day, EXCLUDED.first_seen_feed_day),
    updated_at           = now()
  WHERE (t.act_mode IS NULL AND EXCLUDED.act_mode IS NOT NULL)
     OR (t.field_ident IS NULL AND EXCLUDED.field_ident IS NOT NULL)
     OR (t.description IS NULL AND EXCLUDED.description IS NOT NULL)
     OR (t.act_year IS NULL AND EXCLUDED.act_year IS NOT NULL)
     OR (t.fiscal_year IS NULL AND EXCLUDED.fiscal_year IS NOT NULL)
     OR (t.announced_at IS NULL AND EXCLUDED.announced_at IS NOT NULL)
     OR (EXCLUDED.erased_personal_data IS NOT NULL
         AND EXCLUDED.erased_personal_data IS DISTINCT FROM t.erased_personal_data)
     OR (EXCLUDED.in_feed AND NOT t.in_feed)
     OR (EXCLUDED.in_cr AND NOT t.in_cr)
     OR (EXCLUDED.first_seen_feed_day IS NOT NULL
         AND (t.first_seen_feed_day IS NULL
              OR EXCLUDED.first_seen_feed_day < t.first_seen_feed_day))
  RETURNING (xmax = 0) AS inserted
)
SELECT count(*) FILTER (WHERE inserted)::int AS inserted, count(*)::int AS touched FROM up`;

const merge = async (
  c: PoolClient,
  rows: Map<string, Row>,
): Promise<{ inserted: number; touched: number }> => {
  await c.query(
    `CREATE TEMP TABLE IF NOT EXISTS _acts (
       act_id text, uic text, act_mode smallint, act_mode_text text, field_ident text,
       description text, act_year smallint, fiscal_year smallint, announced_local text,
       erased_personal_data boolean, in_feed boolean, in_cr boolean,
       first_seen_feed_day date) ON COMMIT DROP`,
  );
  await copyRows(c, "_acts", STAGE_COLS, [...rows.values()].map(stageTuple));
  const r = await c.query<{ inserted: number; touched: number }>(MERGE_SQL);
  return r.rows[0];
};

const toRow = (
  a: AnnouncedAct,
  src: { feedDay?: string; cr?: boolean },
): Row => ({
  ...a,
  fiscalYear: fiscalYearOf(a),
  inFeed: src.feedDay != null,
  inCr: src.cr === true,
  feedDay: src.feedDay ?? null,
});

/**
 * "20210104.json" | "2023-01-09.json" → "2021-01-04". ⚠️ The Agency's dataset index
 * carries at least one impossible label — „31.11.2024" (2024-11-31.json, a real 34 KB
 * file; there is no 2024-12-01 file) — so a date is normalised through the calendar
 * (→ 2024-12-01) rather than passed to Postgres, which rejects it and aborts the run.
 */
export const dayOf = (name: string): string | null => {
  const d = name.replace(/\.json$/, "").replace(/-/g, "");
  if (!/^\d{8}$/.test(d)) return null;
  const t = new Date(
    Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)),
  );
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};

const feedPass = async (force: boolean) => {
  if (!fs.existsSync(DAILY_DIR)) {
    console.log(`· no daily feed archive at ${DAILY_DIR} — feed pass skipped.`);
    return { files: 0, inserted: 0 };
  }
  const seen = new Map(
    (
      await allRows<{ day: string; file_bytes: string }>(
        "SELECT day::text AS day, file_bytes::text FROM tr_announced_act_feed_file",
      )
    ).map((r) => [r.day, Number(r.file_bytes)]),
  );
  const todo = fs
    .readdirSync(DAILY_DIR)
    .map((name) => ({ name, day: dayOf(name) }))
    .filter((f): f is { name: string; day: string } => f.day != null)
    .map((f) => ({
      ...f,
      bytes: fs.statSync(path.join(DAILY_DIR, f.name)).size,
    }))
    .filter((f) => force || seen.get(f.day) !== f.bytes)
    .sort((a, b) => a.day.localeCompare(b.day));
  console.log(
    `· feed: ${todo.length} file(s) to scan (${seen.size} already scanned)`,
  );

  let inserted = 0;
  for (let i = 0; i < todo.length; i += FILES_PER_TX) {
    const batch = todo.slice(i, i + FILES_PER_TX);
    const acts = new Map<string, Row>();
    const ledger: unknown[][] = [];
    const modes = new Map<number, string>();
    for (const f of batch) {
      let json: unknown;
      try {
        json = JSON.parse(
          fs.readFileSync(path.join(DAILY_DIR, f.name), "utf8"),
        );
      } catch (e) {
        // A truncated download is re-fetched by daily_refresh; leave it unscanned.
        console.warn(`  ! ${f.name}: unreadable (${(e as Error).message})`);
        continue;
      }
      const fileActs = extractFeedActs(json);
      for (const a of fileActs) {
        fold(acts, toRow(a, { feedDay: f.day }));
        if (a.actMode != null && !modes.has(a.actMode))
          modes.set(a.actMode, a.actModeText);
      }
      ledger.push([
        f.day,
        f.name,
        f.bytes,
        fileActs.length,
        fileActs.filter(isGfoFamily).length,
      ]);
    }
    const res = await withTx(async (c) => {
      const m = await merge(c, acts);
      for (const [mode, text] of modes)
        await c.query(
          "INSERT INTO tr_act_mode (act_mode, act_mode_text) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [mode, text],
        );
      for (const l of ledger)
        await c.query(
          `INSERT INTO tr_announced_act_feed_file (day, file_name, file_bytes, acts, gfo_acts)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (day) DO UPDATE SET file_name = EXCLUDED.file_name,
             file_bytes = EXCLUDED.file_bytes, acts = EXCLUDED.acts,
             gfo_acts = EXCLUDED.gfo_acts, scanned_at = now()`,
          l,
        );
      return m;
    });
    inserted += res.inserted;
    console.log(
      `  ${batch[0].day} … ${batch[batch.length - 1].day}: ${acts.size} act(s), +${res.inserted} new`,
    );
  }
  return { files: todo.length, inserted };
};

const crPass = async (force: boolean) => {
  if (!fs.existsSync(CR_DEEDS_DB)) {
    console.log(`· no CR Deeds store at ${CR_DEEDS_DB} — CR pass skipped.`);
    return { companies: 0, inserted: 0 };
  }
  const mtime = fs.statSync(CR_DEEDS_DB).mtimeMs;
  if (!force && fs.existsSync(CR_MARKER)) {
    const last = Number(fs.readFileSync(CR_MARKER, "utf8").trim());
    if (Number.isFinite(last) && mtime <= last) {
      console.log("· CR Deeds store unchanged since the last acts pass.");
      return { companies: 0, inserted: 0 };
    }
  }
  const acts = new Map<string, Row>();
  let companies = 0;
  const store = new CrDeedsStore(CR_DEEDS_DB);
  try {
    for (const { uic, body } of store.captured()) {
      const list = extractCrActs(body, uic);
      if (list.length) companies++;
      for (const a of list) fold(acts, toRow(a, { cr: true }));
    }
  } finally {
    store.close();
  }
  const res = await withTx((c) => merge(c, acts));
  fs.writeFileSync(CR_MARKER, String(mtime));
  console.log(
    `· CR: ${companies} compan(ies), ${acts.size} act(s), +${res.inserted} new, ${res.touched - res.inserted} enriched`,
  );
  return { companies, inserted: res.inserted };
};

const main = async () => {
  const force = process.argv.includes("--force");
  for (const m of MIGRATIONS) await exec(fs.readFileSync(m, "utf8"));

  const feed = await feedPass(force);
  const cr = await crPass(force);

  // A CR-only act has a label but no mode; give it the feed's number where the label
  // maps to exactly one.
  await exec(`
    UPDATE tr_announced_act a SET act_mode = m.act_mode, updated_at = now()
      FROM (SELECT act_mode_text, min(act_mode) AS act_mode FROM tr_act_mode
             GROUP BY act_mode_text HAVING count(*) = 1) m
     WHERE a.act_mode IS NULL AND a.act_mode_text = m.act_mode_text`);

  const rowsNew = feed.inserted + cr.inserted;
  await withTx(async (c) => {
    const total = (
      await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM tr_announced_act",
      )
    ).rows[0].n;
    await c.query(
      "INSERT INTO ingest_batches (source, rows_total, rows_new, mode) VALUES ($1,$2,$3,'summary')",
      [SOURCE, total, rowsNew],
    );
    await upsertChangelogDay(c, SOURCE, rowsNew, total);
    console.log(`✓ tr_announced_act: ${total} acts (+${rowsNew} this run)`);
  });

  const canary = await allRows<{ day: string; gfo_acts: number }>(
    `SELECT day::text, gfo_acts FROM tr_announced_act_feed_file
      ORDER BY day DESC LIMIT 1`,
  );
  if (canary[0])
    console.log(
      `· feed canary: latest file ${canary[0].day} lists ${canary[0].gfo_acts} ГФО-family act(s)` +
        (canary[0].gfo_acts === 0
          ? " — expected since the 2026-10-12 cutover (CR captures are the source now)"
          : ""),
    );

  if (feed.files > 0 || cr.inserted > 0)
    await vacuumAfterReload("tr_announced_act", "tr_announced_act_feed_file");
  await end();
};

main().catch(async (e) => {
  console.error(
    "✗ load_tr_announced_acts_pg failed:",
    e instanceof Error ? e.message : e,
  );
  await end().catch(() => {});
  process.exit(1);
});
