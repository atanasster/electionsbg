// Re-derive kzk_appeals' tier-2 outcomes from the stored kzk_decisions corpus.
//
//   npm run kzk:rejoin -- --dry-run   (report, write nothing — read-only)
//   npm run kzk:rejoin -- --apply     (upsert PG + write back the JSON)
//   npm run kzk:rejoin:cloud -- --apply
//
// OFFLINE. No browser, no network, no BG egress — it reads the corpus already in
// Postgres (loaded by db:load:kzk-decisions:pg) and the appeals already in
// kzk_appeals. That is the point: fixing the matcher was worth +916 outcomes on
// the 2026-07-04 corpus with no new crawl, and it can be re-run for free every
// time the matcher improves.
//
// MEASURED on that corpus (2026-08-02): 4,407 decisions × 7,886 appeals → 2,860
// appeals matched, 42 ambiguous, 1,674 decisions matching nothing; 923 rows
// became machine-owned (916 of them carrying a classified outcome), taking
// kzk_appeals from 2,098 to 3,014 outcomes with the 2,098 hand-made rows
// untouched.
//
// ⚠️ PIN THE LOCAL DB, same hazard as every other writer in this pack. An ambient
// `DATABASE_URL` left by a `db:*:cloud` command is password-less by design and
// resolves to the CLOUD password via .pgpass, so it fails 28P01 against local PG
// — or, worse, silently writes to Cloud SQL:
//
//   DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \
//     npm run kzk:rejoin -- --apply
//
// PROVENANCE DECIDES WHAT MAY BE OVERWRITTEN (migration 131, rule in
// kzk_provenance.ts). Rows whose `decision_act_no` is set were derived here and
// are re-derivable. Rows with a NULL act number but an outcome are the ~2,098
// interactively-produced, irreplaceable ones: never written, only counted. That
// is what lets the matcher be fixed without either destroying the hand-made data
// or freezing its own mistakes for ever.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { command, flag, run } from "cmd-ts";
import { allRows, exec, isServingDatabase, withTx, end } from "../db/lib/pg";
import { recordIngestBatch } from "../db/lib/ingest_changelog";
import { matchDecisions } from "./kzk_match";
import type { MatchableDecision } from "./kzk_match";
import { refreshAppealDependents } from "./kzk_dependents";
import { partitionByProvenance, type ProvenanceRow } from "./kzk_provenance";
import { recordBaselines } from "./kzk_baselines";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROVENANCE_MIGRATION = path.join(
  ROOT,
  "scripts",
  "db",
  "schema",
  "pg",
  "131_kzk_appeal_provenance.sql",
);
const APPEALS_FILE = path.join(ROOT, "data", "procurement", "kzk_appeals.json");

type AppealRow = {
  complaintNo: string;
  complainant: string | null;
  respondent: string | null;
  complaintDate: string | null;
  outcome: string | null;
  decisionDate: string | null;
  decisionActNo: string | null;
};

type AppealsDoc = {
  generatedAt?: string;
  appeals?: Array<Record<string, unknown>>;
};

const main = async (apply: boolean): Promise<void> => {
  if (apply) {
    console.log("→ applying 131_kzk_appeal_provenance.sql…");
    await exec(fs.readFileSync(PROVENANCE_MIGRATION, "utf8"));
  } else {
    // A dry run must be read-only BY CONSTRUCTION, not by luck. Applying the
    // migration here would take an ACCESS EXCLUSIVE lock on kzk_appeals and build
    // an index — on the serving database, if the ambient-DATABASE_URL trap above
    // is live — and then print "nothing written".
    const [col] = await allRows<{ ok: boolean }>(
      `SELECT true AS ok FROM information_schema.columns
        WHERE table_name = 'kzk_appeals' AND column_name = 'decision_act_no'`,
    );
    if (!col)
      throw new Error(
        "decision_act_no is missing on this database — a dry run cannot tell " +
          "hand-seeded rows from derived ones. Apply " +
          "131_kzk_appeal_provenance.sql first, or run with --apply.",
      );
  }

  const appeals = await allRows<AppealRow>(
    `SELECT complaint_no    AS "complaintNo",
            complainant,
            respondent,
            complaint_date  AS "complaintDate",
            outcome,
            decision_date   AS "decisionDate",
            decision_act_no AS "decisionActNo"
       FROM kzk_appeals`,
  );
  // ⚠️ MERITS-ELIGIBLE ACTS ONLY. `ot=6` publishes определения — rulings on the
  // temporary measure, not on the complaint. classifyOutcome already returns null
  // for every one of their phrasings (they lack the word `жалбата`), but that is
  // not enough: a match also stamps `decision_date` and `decision_act_no`, which
  // would make those columns mean "some act" rather than "the merits ruling" —
  // and it would CLAIM the appeal, so the решение that later decides the same
  // case reads as a second claimant and the appeal is dropped as ambiguous.
  //
  // `IS DISTINCT FROM` (not `<>`) because NULL is the legacy corpus, which is
  // where every outcome served today comes from. Excluding unknown would silently
  // drop ~2,860 matches.
  const decisions = await allRows<MatchableDecision>(
    `SELECT act_no AS no, decision_date AS ddate, pronouncement AS pron,
            initiators AS init, respondent AS resp
       FROM kzk_decisions
      WHERE kind IS DISTINCT FROM 'определения'`,
  );
  if (decisions.length === 0) {
    throw new Error(
      "kzk_decisions is empty — run `npm run db:load:kzk-decisions:pg` first. " +
        "Rejoining against no corpus would report every outcome as unmatched.",
    );
  }
  console.log(
    `→ matching ${decisions.length} decisions against ${appeals.length} appeals…`,
  );

  const report = matchDecisions(appeals, decisions);
  const rows = new Map<string, ProvenanceRow>(
    appeals.map((a) => [a.complaintNo, a]),
  );
  const part = partitionByProvenance(report.matches, rows);

  console.log(
    `  matched ${report.matches.length} appeals ` +
      `(${report.ambiguous} appeals claimed by >1 act, ` +
      `${report.partyAmbiguous} parties with >1 candidate appeal, ` +
      `${report.unmatched} decisions matched nothing)`,
  );
  console.log(
    `  writable: ${part.fillNew} new + ${part.refreshDerived} re-derived; ` +
      `${part.protectedHand} hand-seeded rows left untouched`,
  );
  // уважена is the only value that reaches upheld_ocids and the contract risk
  // index, so a shift in that one number is the most useful pre-apply signal.
  const breakdown = new Map<string, number>();
  for (const m of part.writable)
    breakdown.set(
      String(m.outcome),
      (breakdown.get(String(m.outcome)) ?? 0) + 1,
    );
  console.log(
    `  would write: ${[...breakdown.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}`,
  );

  if (part.conflicts.length) {
    console.log(
      `  ⚠ ${part.conflicts.length} hand-seeded row(s) the matcher would classify ` +
        "differently (NOT written — listed so a matcher bug is investigable):",
    );
    for (const c of part.conflicts.slice(0, 20))
      console.log(
        `      ${c.complaintNo}: hand=${c.hand} vs ${c.actNo}→${c.derived}`,
      );
    if (part.conflicts.length > 20)
      console.log(`      … and ${part.conflicts.length - 20} more`);
  }

  if (!apply) {
    console.log("\n--dry-run: nothing written.");
    await end();
    return;
  }

  await withTx(async (c) => {
    for (let i = 0; i < part.writable.length; i += 500) {
      const chunk = part.writable.slice(i, i + 500);
      const values = chunk
        .map(
          (_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`,
        )
        .join(",");
      await c.query(
        `UPDATE kzk_appeals a SET
           outcome         = v.outcome,
           decision_date   = v.decision_date,
           decision_act_no = v.act_no
         FROM (VALUES ${values}) AS v(complaint_no, act_no, outcome, decision_date)
         WHERE a.complaint_no = v.complaint_no
           -- Re-state the provenance rule in SQL rather than trusting the
           -- partition above: this is the guard that actually protects the
           -- irreplaceable rows, so it must hold even if the caller is wrong.
           AND (a.decision_act_no IS NOT NULL
                OR (a.outcome IS NULL AND a.decision_date IS NULL))`,
        chunk.flatMap((m) => [
          m.complaintNo,
          m.actNo,
          m.outcome,
          m.decisionDate,
        ]),
      );
    }

    // The PG changelog, atomic with the write — a re-derivation IS an ingest of
    // this table, and it is the largest single change to kzk_appeals.outcome
    // since the corpus was seeded. See [[feedback_pg_changelog_required]]; this
    // is a different feed from data/data-changes.json ([[reference_two_changelogs]]).
    const { rows: total } = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM kzk_appeals",
    );
    await recordIngestBatch(c, {
      source: "kzk_appeals",
      table: "kzk_appeals",
      keyExpr: "t.complaint_no",
      nameExpr: "t.respondent",
      detailExpr: "t.subject",
      rowsTotal: total[0].n,
    });
  });

  console.log("→ refreshing appeal dependents…");
  await refreshAppealDependents();

  // ⚠️ NEVER MIRROR A SERVING DATABASE INTO THE LOCAL JSON. That file is the
  // LOCAL store — the crawler's merge target and the summary's input — so
  // writing Cloud SQL's state into it corrupts local with prod's.
  //
  // This is not hypothetical: running this script against the proxy once wrote
  // back a row whose outcome cloud had but whose `decision_act_no` it did not,
  // producing exactly the laundering the header warns about — a machine-derived
  // outcome re-labelled as one of the ~2,098 permanently-protected hand-made
  // ones, which a later reseed would then make immovable.
  if (isServingDatabase()) {
    console.log(
      "→ JSON write-back SKIPPED (serving database). The JSON mirrors LOCAL; " +
        "re-run this against local Postgres to refresh it.",
    );
  } else {
    await writeBackJson();
  }

  const [after] = await allRows<{ n: string; d: string | null; hand: string }>(
    `SELECT count(outcome) n, max(decision_date) d,
            count(*) FILTER (WHERE decision_act_no IS NULL AND outcome IS NOT NULL) hand
       FROM kzk_appeals`,
  );
  console.log(
    `✓ kzk_appeals: ${after.n} outcomes, tier-2 through ${after.d ?? "—"}.`,
  );

  // Gates C + D: raise the coverage ratchet. Monotonic — a run that achieved
  // less than the recorded best leaves the bar where it is, and the data gate
  // then fails, which is the point. See kzk_baselines.ts.
  // ⚠️ ONLY FROM A LOCAL DATABASE. The ratchet is a COMMITTED file asserted by
  // test:data, which runs against local Postgres. Minting it from Cloud SQL
  // (kzk:rejoin:cloud exists) would record a number local cannot reach, turning
  // every local run red with a message that forbids the only available fix.
  if (isServingDatabase()) {
    console.log(
      `→ ratchet not updated (serving database). Observed ${after.n} outcomes / ` +
        `${report.matches.length} matched; raise the ratchet from a LOCAL run.`,
    );
  } else {
    const raised = recordBaselines(
      { outcomes: Number(after.n), matched: report.matches.length },
      new Date().toISOString().slice(0, 10),
    );
    if (raised.length)
      console.log(
        `→ raised the coverage ratchet (${raised.join(", ")}) — commit ` +
          "data/procurement/derived/kzk_baselines.json",
      );
  }
  await end();
};

/**
 * Mirror the fresh outcomes back into data/procurement/kzk_appeals.json.
 *
 * `npm run kzk:summary` reads that file, so skipping this would make the next
 * summary rebuild publish the OLD totals — the committed artifact disagreeing
 * with the database it describes.
 *
 * ⚠️ `decisionActNo` MUST travel with the outcome. That JSON is the crawler's
 * tier-2 seed source on a fresh or reset database (kzk_appeals.ts re-seeds with
 * `COALESCE(a.outcome, v.outcome)`), so mirroring the outcome WITHOUT its
 * provenance would re-import every machine-derived row as a NULL-act one — i.e.
 * launder it into a permanently-protected "hand-seeded" row, silently undoing
 * exactly what migration 131 exists to enable.
 */
const writeBackJson = async (): Promise<void> => {
  if (!fs.existsSync(APPEALS_FILE)) {
    console.warn(
      `  ⚠ ${path.relative(ROOT, APPEALS_FILE)} absent — skipping JSON write-back. ` +
        "`npm run kzk:summary` will not see the new outcomes.",
    );
    return;
  }
  // No `WHERE outcome IS NOT NULL`: a re-derivation may legitimately set a
  // previously-derived outcome back to NULL, and filtering those out would leave
  // the JSON (and the committed summary built from it) carrying the stale value.
  const rows = await allRows<{
    complaint_no: string;
    outcome: string | null;
    decision_date: string | null;
    decision_act_no: string | null;
  }>(
    "SELECT complaint_no, outcome, decision_date, decision_act_no FROM kzk_appeals",
  );
  const byNo = new Map(rows.map((r) => [r.complaint_no, r]));

  const doc = JSON.parse(fs.readFileSync(APPEALS_FILE, "utf8")) as AppealsDoc;
  if (!Array.isArray(doc.appeals) || doc.appeals.length === 0)
    throw new Error(
      `${path.relative(ROOT, APPEALS_FILE)} has no \`appeals\` array — refusing to ` +
        "rewrite it (a silent no-op here would print '0 updated' and mirror nothing)",
    );

  let touched = 0;
  for (const a of doc.appeals) {
    const e = byNo.get(a.complaintNo as string);
    if (!e) continue;
    const before = `${a.outcome}|${a.decisionDate}|${a.decisionActNo}`;
    if (e.decision_act_no != null) {
      // Machine-owned: PG is authoritative in both directions, nulls included.
      a.outcome = e.outcome;
      a.decisionDate = e.decision_date;
    } else {
      // Hand-seeded: keep applyEnrichment's invariant — never null a JSON value
      // PG lacks, because for these rows the JSON may be the only surviving copy.
      a.outcome = e.outcome ?? a.outcome ?? null;
      a.decisionDate = e.decision_date ?? a.decisionDate ?? null;
    }
    a.decisionActNo = e.decision_act_no ?? null;
    if (`${a.outcome}|${a.decisionDate}|${a.decisionActNo}` !== before)
      touched++;
  }

  const tmp = `${APPEALS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, APPEALS_FILE);
  console.log(`→ JSON write-back: ${touched} row(s) updated.`);
};

const cmd = command({
  name: "kzk_rejoin",
  description:
    "Re-derive kzk_appeals.outcome from the stored kzk_decisions corpus (offline).",
  args: {
    apply: flag({ long: "apply", description: "write to Postgres + the JSON" }),
    dryRun: flag({ long: "dry-run", description: "report only (default)" }),
  },
  handler: async ({ apply, dryRun }) => {
    if (apply && dryRun)
      throw new Error(
        "--dry-run and --apply are mutually exclusive (dry-run makes no writes; drop one)",
      );
    await main(apply);
  },
});

run(cmd, process.argv.slice(2)).catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => undefined);
  process.exit(1);
});
