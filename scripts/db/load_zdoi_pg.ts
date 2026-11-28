// Load the pitay.government.bg ЗДОИ crawl (raw_data/zdoi/pitay.sqlite, gitignored)
// into `zdoi_request` + `zdoi_event` + `zdoi_forward` (migration 207).
//
//   pnpm run db:load:zdoi:pg
//   pnpm run db:load:zdoi:pg:cloud
//
// Re-parses every stored page, so a parser fix needs no re-crawl. Skips and warns
// when the store is absent (a fresh clone): `pnpm run zdoi:fetch` builds it.
//
// UPSERT-ONLY — see 207's header. Events and forwards are replaced only for the
// requests this run re-parsed.

import fs from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { compactAfterReload, end, exec, withTx } from "./lib/pg";
import { copyRows, pgTextArray } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  addStagePrimaryKey,
  createStageTable,
  stageUpsertSql,
  type StageMergeSpec,
} from "./lib/stage_merge";
import {
  parseApplication,
  redactRequester,
  type ZdoiApplication,
} from "../zdoi/pitay_parse";
import { PitayStore } from "../zdoi/pitay_store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "schema/pg");
const STORE_FILE = path.resolve(__dirname, "../../raw_data/zdoi/pitay.sqlite");

const REQUEST_COLS = [
  "app_id",
  "reg_no",
  "body",
  "status",
  "applicant_type",
  "submitted_on",
  "deadline",
  "subject",
  "decision_date",
  "decision_text",
  "attachment_ids",
  "views",
  "fetched_at",
  "last_seen_at",
];
const REQUEST_SPEC: StageMergeSpec = {
  table: "zdoi_request",
  source: "zdoi_request_stage",
  keys: ["app_id"],
  cols: REQUEST_COLS,
};

/** Above this share of stored pages failing to parse, assume the page layout
 *  changed and refuse rather than publish a partial corpus. */
const MAX_PARSE_FAILURE = 0.02;

const count = async (c: PoolClient, sql: string): Promise<number> =>
  Number((await c.query<{ n: string }>(sql)).rows[0].n);

/** Parse every stored page. Pages the platform no longer serves as applications
 *  are skipped; pages that throw are counted against MAX_PARSE_FAILURE. */
export const parseStore = (
  pages: Iterable<{ id: number; html: string; fetchedAt: string }>,
): {
  apps: (ZdoiApplication & { fetchedAt: string })[];
  failures: { id: number; error: string }[];
  total: number;
} => {
  const apps: (ZdoiApplication & { fetchedAt: string })[] = [];
  const failures: { id: number; error: string }[] = [];
  let total = 0;
  for (const p of pages) {
    total++;
    try {
      // Redacted again here, not only at the store's write path: pages written
      // before a redaction rule existed must not reach a table either.
      const a = parseApplication(redactRequester(p.html), p.id);
      if (a) apps.push({ ...a, fetchedAt: p.fetchedAt });
    } catch (e) {
      failures.push({
        id: p.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { apps, failures, total };
};

const main = async (): Promise<void> => {
  for (const f of [
    "000_search_fns.sql",
    "005_ingest_tracking.sql",
    "207_zdoi_requests.sql",
  ])
    await exec(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  if (!existsSync(STORE_FILE)) {
    console.warn(
      `→ schema applied; no ${path.relative(process.cwd(), STORE_FILE)} — run ` +
        "`pnpm run zdoi:fetch` first.",
    );
    await end();
    return;
  }

  const store = new PitayStore(STORE_FILE);
  const { apps, failures, total } = parseStore(store.pages());
  store.close();
  if (failures.length > total * MAX_PARSE_FAILURE)
    throw new Error(
      `${failures.length}/${total} stored pages failed to parse (first: #${failures[0].id} ` +
        `${failures[0].error}) — the page layout likely changed; refusing to load.`,
    );
  if (apps.length === 0)
    throw new Error("the pitay store holds no applications — refusing to load");

  const now = new Date();
  let rowsNew = 0;
  await withTx(async (c) => {
    await createStageTable(c, REQUEST_SPEC);
    await copyRows(
      c,
      REQUEST_SPEC.source,
      REQUEST_COLS,
      apps.map((a) => [
        a.id,
        a.regNo,
        a.body,
        a.status,
        a.applicantType,
        a.submittedOn,
        a.deadline,
        a.subject,
        a.decisionDate,
        a.decisionText,
        pgTextArray(a.attachments.map((x) => String(x.downloadId))),
        a.views,
        a.fetchedAt,
        now.toISOString(),
      ]),
    );
    await addStagePrimaryKey(c, REQUEST_SPEC);
    await c.query(stageUpsertSql(REQUEST_SPEC));

    // History and forwards: authoritative for the requests re-parsed this run.
    await c.query(
      "DELETE FROM zdoi_event WHERE app_id IN (SELECT app_id FROM zdoi_request_stage)",
    );
    await c.query(
      "DELETE FROM zdoi_forward WHERE app_id IN (SELECT app_id FROM zdoi_request_stage)",
    );
    await copyRows(
      c,
      "zdoi_event",
      ["app_id", "seq", "at", "process"],
      apps.flatMap((a) => a.events.map((e, i) => [a.id, i, e.at, e.process])),
    );
    await copyRows(
      c,
      "zdoi_forward",
      ["app_id", "seq", "to_app_id", "reg_no", "body", "created_at", "status"],
      apps.flatMap((a) =>
        a.forwards.map((f, i) => [
          a.id,
          i,
          f.id,
          f.regNo,
          f.body,
          f.createdAt,
          f.status,
        ]),
      ),
    );
    await c.query("DROP TABLE zdoi_request_stage");

    const n = await count(c, "SELECT count(*) AS n FROM zdoi_request");
    const r = await recordIngestBatch(c, {
      source: "zdoi_request",
      table: "zdoi_request",
      keyExpr: "t.app_id::text",
      nameExpr: "t.body",
      detailExpr: "left(t.subject, 200)",
      rowsTotal: n,
    });
    rowsNew = r.rowsNew;
  });

  // `last_seen_at` moves on every row every run, so the upsert rewrites the whole
  // table — compact, not just vacuum (see CLAUDE.md, visibility-map section).
  await compactAfterReload("zdoi_request", "zdoi_event", "zdoi_forward");

  console.log(
    `✓ zdoi_request: ${apps.length} parsed of ${total} stored pages · ${rowsNew} new` +
      (failures.length
        ? ` · ${failures.length} unparseable (first #${failures[0].id})`
        : ""),
  );
  await end();
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await end().catch(() => {});
    process.exit(1);
  });
