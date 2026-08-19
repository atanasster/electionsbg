// Project subcontractor declarations out of `tender_notice` into
// `tender_subcontracting` (migration 171, plan P8).
//
//   npm run db:load:subcontractors:pg
//   npm run db:load:subcontractors:pg:cloud
//
// Reads nothing but Postgres — its source is the ЦАИС dossier capture, so run it
// after `db:load:tender-dossier:pg` and never on its own schedule.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  isInconsistent,
  parseSubcontractorFacts,
} from "../procurement/subcontractors/parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, "schema/pg/171_subcontractors.sql");

const main = async (): Promise<void> => {
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  // ⚠️ PROBE, DO NOT COUNT. `tender_notice` is created by migration 146, whose
  // ONLY applier is `db:load:tender-dossier:pg` — a REFRESH_EXCLUSIONS member
  // reading a gitignored ~26 h crawl. On a fresh clone the relation does not
  // exist, so a bare `count(*)` raises 42P01, this loader exits 1, and the
  // &&-chained db:refresh dies at step 9 of 69 — taking `test:data`, the
  // chain's only verification, with it. That is the 077/2BP01 failure class
  // CLAUDE.md documents: nothing red anywhere, sixty steps unrun.
  const [reg] = await allRows<{ present: boolean }>(
    "SELECT to_regclass('public.tender_notice') IS NOT NULL AS present",
  );
  if (!reg?.present) {
    console.warn(
      "⚠ tender_notice does not exist — schema applied, nothing projected. It " +
        "is created by migration 146, whose only applier is " +
        "`npm run db:load:tender-dossier:pg` (a REFRESH_EXCLUSIONS member that " +
        "reads the gitignored ЦАИС capture). This is the EXPECTED state on a " +
        "fresh clone.",
    );
    return;
  }
  const [{ n } = { n: "0" }] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM tender_notice",
  );
  if (Number(n) === 0) {
    // Distinct from the branch above on purpose: „the table exists and is
    // empty" and „the table does not exist" send an operator to different fixes.
    console.warn(
      "⚠ tender_notice exists but is empty — schema applied, nothing projected. " +
        "Run `npm run db:load:tender-dossier:pg` (it needs the ЦАИС capture).",
    );
    return;
  }

  // Only notices that carry the phrase at all. The parser still refuses the ones
  // where it appears as prose — see its header — so this is a cheap prefilter,
  // never the decision.
  // ⚠️ THE PREFILTER MUST NOT BE NARROWER THAN THE PARSER. The parser runs
  // `flat()` first, collapsing every whitespace run and NBSP; a literal
  // single-space LIKE therefore never fetches a notice rendered
  // „участват\nподизпълнители" or with a U+00A0, and the parser never gets to
  // refuse it — the row is just silently absent. PG's `[[:space:]]` does NOT
  // match U+00A0, so it is listed explicitly.
  const rows = await allRows<{
    publication_id: string;
    unp: string;
    text: string;
  }>(
    `SELECT publication_id::text, unp, text FROM tender_notice
      WHERE text ~ 'участват[[:space:] ]+подизпълнители'`,
  );

  let answered = 0;
  let yes = 0;
  let inconsistent = 0;
  const out: unknown[][] = [];
  for (const r of rows) {
    const f = parseSubcontractorFacts(r.text);
    if (f.hasSubcontractors === null) continue; // prose-only, not a declaration
    answered++;
    if (f.hasSubcontractors) yes++;
    if (isInconsistent(f)) inconsistent++;
    out.push([
      r.publication_id,
      r.unp,
      f.hasSubcontractors,
      f.subcontractorCount,
      f.wasAmended,
      f.amendmentCount,
    ]);
  }

  if (!out.length)
    throw new Error(
      `${rows.length} notices mention подизпълнители and NONE parsed to a ` +
        `declaration — the ЗОП form's wording has changed. Refusing to write an ` +
        `empty projection over a non-empty source.`,
    );

  // ⚠️ ALL-OR-NOTHING IS NOT ENOUGH. A wording change that affects only NEW
  // notices leaves the old ones parsing fine, so `out.length` stays large and
  // the empty-check never fires — while every new declaration goes unseen. A
  // shrink against what is already loaded is the signal, and this table only
  // grows: the dossier capture never un-publishes a notice.
  const [prevRow] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM tender_subcontracting",
  );
  const prev = Number(prevRow?.n ?? 0);
  if (prev > 0 && out.length < prev * 0.95)
    throw new Error(
      `parsed ${out.length} declarations against ${prev} already loaded ` +
        `(>5% shrink). The ЗОП form's wording has probably changed — check ` +
        `parseSubcontractorFacts before overwriting a good projection.`,
    );

  await withTx(async (c) => {
    await c.query("TRUNCATE tender_subcontracting");
    await copyRows(
      c,
      "tender_subcontracting",
      [
        "publication_id",
        "unp",
        "has_subcontractors",
        "subcontractor_count",
        "was_amended",
        "amendment_count",
      ],
      out,
    );
  });
  await vacuumAfterReload("tender_subcontracting");

  console.log(
    `✓ tender_subcontracting: ${answered.toLocaleString()} declarations ` +
      `(${yes.toLocaleString()} with subcontractors, ` +
      `${(rows.length - answered).toLocaleString()} prose-only mentions skipped)`,
  );
  if (inconsistent)
    console.log(
      `  ⚠ ${inconsistent} internally inconsistent (Не with a count > 0, or Да ` +
        `with 0) — stored as declared, never normalised: which half is wrong is ` +
        `not knowable from the notice.`,
    );
  const [cov] = await allRows<{ answered: string; total: string }>(
    `SELECT (SELECT count(*)::text FROM tender_subcontracting) answered,
            (SELECT count(*)::text FROM tender_notice) total`,
  );
  console.log(
    `  coverage: ${Number(cov.answered).toLocaleString()} of ` +
      `${Number(cov.total).toLocaleString()} notices carry the question at all`,
  );
};

main()
  .then(() => end())
  .catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
