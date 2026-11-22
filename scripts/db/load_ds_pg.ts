// Load the COMMITTED comdos.bg decision corpus (data/comdos/) into `ds_decision` +
// `ds_announcement` (migration 203, docs/plans/comdos-ds-ingest-v1.md).
//
//   pnpm run db:load:ds:pg
//   pnpm run db:load:ds:pg:cloud
//
// Pure-load: the corpus is committed, so a fresh clone loads it with no network.
// `pnpm run comdos:crawl --refresh && pnpm run comdos:parse` is what refreshes it.
//
// UPSERT-ONLY — see 203's header. Decisions are never deleted. Announcements are
// deleted only within decisions this run staged (a re-parsed decision's person list
// is authoritative), and even that refuses a run that would remove more than 5% of
// the stored announcements, which is what a parser regression looks like.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { compactAfterReload, end, exec, withTx } from "./lib/pg";
import { copyRows, pgTextArray } from "./lib/copy";
import {
  addStagePrimaryKey,
  createStageTable,
  stageUpsertSql,
  type StageMergeSpec,
} from "./lib/stage_merge";
import type { DsDecisionRow, DsPersonRow } from "../comdos/parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "schema/pg");
const DATA = path.resolve(__dirname, "../../data/comdos");
const DECISIONS = path.join(DATA, "decisions.json");
const PERSONS = path.join(DATA, "persons.jsonl");

const DECISION_COLS = [
  "decision_id",
  "number",
  "decision_date",
  "title",
  "has_document",
  "total",
  "checked",
  "deceased",
  "person_count",
  "last_seen_at",
];
const ANNOUNCEMENT_COLS = [
  "decision_id",
  "seq",
  "name",
  "birth_date",
  "birth_place",
  "section",
  "quality_raw",
  "categories",
  "pseudonyms",
  "structures",
  "recruit_year",
  "after_nov_1989",
  "office",
  "party",
  "mir",
  "prior_decisions",
  "last_seen_at",
];

const DECISION_SPEC: StageMergeSpec = {
  table: "ds_decision",
  source: "ds_decision_stage",
  keys: ["decision_id"],
  cols: DECISION_COLS,
};
const ANNOUNCEMENT_SPEC: StageMergeSpec = {
  table: "ds_announcement",
  source: "ds_announcement_stage",
  keys: ["decision_id", "seq"],
  cols: ANNOUNCEMENT_COLS,
};

/** Of the announcements stored under re-parsed decisions, the share this run would
 *  delete before the loader refuses. */
const MAX_SCOPED_DELETE = 0.05;

const count = async (c: PoolClient, sql: string): Promise<number> =>
  Number((await c.query<{ n: string }>(sql)).rows[0].n);

const main = async (): Promise<void> => {
  // 203's GENERATED name_fold calls translit_bg_latin, which 000 defines — a
  // generated expression is resolved at CREATE time.
  for (const f of ["000_search_fns.sql", "203_ds_decisions.sql"])
    await exec(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  if (!fs.existsSync(DECISIONS) || !fs.existsSync(PERSONS)) {
    console.warn(
      `→ schema applied; no data/comdos/ corpus — run \`pnpm run comdos:crawl\` ` +
        `then \`pnpm run comdos:parse\` first.`,
    );
    await end();
    return;
  }

  const decisions = JSON.parse(
    fs.readFileSync(DECISIONS, "utf8"),
  ) as DsDecisionRow[];
  const persons = fs
    .readFileSync(PERSONS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DsPersonRow);
  if (decisions.length === 0 || persons.length === 0)
    throw new Error(
      "data/comdos/ is empty — refusing to publish an empty corpus over a populated one",
    );

  const now = new Date();
  await withTx(async (c) => {
    await createStageTable(c, DECISION_SPEC);
    await createStageTable(c, ANNOUNCEMENT_SPEC);
    await copyRows(
      c,
      DECISION_SPEC.source,
      DECISION_COLS,
      decisions.map((d) => [
        d.decisionId,
        d.number,
        d.date,
        d.title,
        d.hasDocument,
        d.total,
        d.checked,
        // no document → the counts are UNKNOWN, never zero (203's CHECK)
        d.hasDocument ? d.deceased : null,
        d.hasDocument ? d.persons : null,
        now,
      ]),
    );
    await copyRows(
      c,
      ANNOUNCEMENT_SPEC.source,
      ANNOUNCEMENT_COLS,
      persons.map((p) => [
        p.decisionId,
        p.seq,
        p.name,
        p.birthDate,
        p.birthPlace,
        p.section,
        p.qualityRaw,
        pgTextArray(p.categories),
        p.pseudonyms,
        p.structures,
        p.recruitYear,
        p.afterNov1989,
        p.office,
        p.party,
        p.mir,
        pgTextArray(p.priorDecisions),
        now,
      ]),
    );
    await addStagePrimaryKey(c, DECISION_SPEC);
    await addStagePrimaryKey(c, ANNOUNCEMENT_SPEC);

    // has_document comes from the local document cache, which is not committed.
    // A decision stored WITH one and re-parsed without it would have its counts
    // overwritten by unknowns while its announcements stayed — upsert-only says
    // a public record never regresses, so refuse instead.
    const lostDoc = await count(
      c,
      `SELECT count(*) AS n FROM ds_decision d JOIN ds_decision_stage s USING (decision_id)
        WHERE d.has_document AND NOT s.has_document`,
    );
    if (lostDoc > 0)
      throw new Error(
        `[ds] ${lostDoc} decision(s) stored with a document were parsed without one — ` +
          `the document cache is incomplete (pnpm run comdos:crawl). Refusing.`,
      );

    // Re-parsed decisions are the ones with a document: a decision whose page
    // links none contributes no blocks, so it must not scope a deletion.
    const scope = `decision_id IN (SELECT decision_id FROM ds_decision_stage WHERE has_document)`;
    const stored = await count(
      c,
      `SELECT count(*) AS n FROM ds_announcement WHERE ${scope}`,
    );
    const orphans = await count(
      c,
      `SELECT count(*) AS n FROM ds_announcement a WHERE a.${scope}
         AND NOT EXISTS (SELECT 1 FROM ds_announcement_stage s
                          WHERE s.decision_id = a.decision_id AND s.seq = a.seq)`,
    );
    if (stored > 0 && orphans > stored * MAX_SCOPED_DELETE)
      throw new Error(
        `[ds] this run would delete ${orphans} of ${stored} stored announcements — ` +
          `a parser regression, not a corpus change. Refusing.`,
      );

    // Parent before child, so the FK always has its referent.
    await c.query(stageUpsertSql(DECISION_SPEC));
    await c.query(stageUpsertSql(ANNOUNCEMENT_SPEC));
    await c.query(
      `DELETE FROM ds_announcement a WHERE a.${scope}
         AND NOT EXISTS (SELECT 1 FROM ds_announcement_stage s
                          WHERE s.decision_id = a.decision_id AND s.seq = a.seq)`,
    );

    await c.query("DROP TABLE ds_announcement_stage");
    await c.query("DROP TABLE ds_decision_stage");
    console.log(
      `✓ ds: ${decisions.length} decisions, ${persons.length} announcements` +
        (orphans ? ` (${orphans} superseded blocks removed)` : ""),
    );
  });
  // Compact, not just vacuum: `last_seen_at` moves every run, so the upsert's
  // IS DISTINCT FROM never short-circuits and every row is rewritten — plain
  // VACUUM would leave the heap at ~2x live size for good (see the council loader).
  await compactAfterReload("ds_decision", "ds_announcement");
  await end();
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
