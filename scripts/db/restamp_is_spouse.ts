/**
 * Re-derive `declaration_asset.is_spouse` in place on a target database.
 *
 *   npx tsx scripts/db/restamp_is_spouse.ts                          # dry run against DATABASE_URL
 *   npx tsx scripts/db/restamp_is_spouse.ts --apply
 *   npx tsx scripts/db/restamp_is_spouse.ts --to <url> --apply
 *
 * ── WHY RECOMPUTE RATHER THAN SHIP OR RELOAD ────────────────────────────────────────────
 *
 * `is_spouse` is a pure function of two columns the target ALREADY HAS — `holder_name` on the
 * asset row and `declarant_name` on its filing — so nothing has to travel. That makes this
 * strictly safer than its two neighbours:
 *
 *   - ship_held_abroad.ts / ship_filed_position.ts carry VALUES, so they key on
 *     (source_url, seq) and spend most of their length proving that key lands on the same row
 *     on both sides — a mis-key there writes „Белгия" against somebody else's account. Here
 *     there is no key and no second corpus: every row is judged on its own two fields.
 *   - `db:load:declarations:pg:cloud` phase 1 + `--resolve` is the documented reload, measured
 *     at 39 s + 4m52s on Cloud SQL with /persons, /officials/assets, /mp-assets,
 *     /declarations/crypto and /declarations/abroad answering 500 throughout — phase 1 NULLs
 *     every `person_id` and phase 2 runs 090's `DROP MATERIALIZED VIEW … CASCADE`, and a
 *     DbDataTable resource has no `missingMigration` degrade. This takes a RowExclusiveLock on
 *     the rows it changes and nothing else, so readers stay on their MVCC snapshot.
 *
 * Use the reload when the SHARDS have moved for some other reason; use this when the only
 * difference between the two databases is which version of `isSpouseHolder` stamped them.
 *
 * ⚠️ IT IS THE RULE THAT IS AUTHORITATIVE, NOT THE SOURCE DATABASE. A row is rewritten when
 * the target's own stored value disagrees with what `isSpouseHolder` says about the target's
 * own holder and declarant. So this converges any database onto the shipped rule regardless
 * of vintage, and running it twice is a no-op.
 *
 * ⚠️ BOTH DIRECTIONS ARE REPORTED SEPARATELY, and the second one matters more. Clearing a row
 * (true → false) stops publishing a declarant's own property as somebody else's. Re-marking
 * one (false → true) does the opposite — it republishes „held by somebody else" against a
 * named person — and only ever happens when a REFUSAL was added or widened (the masc/fem
 * carve-out, „и др.", a generational rotation). It should never pass unread, which is why the
 * dry run prints a sample of each.
 *
 * Plan: docs/plans/declaration-holder-self-fold-v1.md §6.
 */

import { Pool } from "pg";
import { copyRows } from "./lib/copy";
import { DATABASE_URL, redactUrl } from "./lib/pg";
import { isSpouseHolder } from "../../src/lib/declarations";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (f: string): boolean => process.argv.includes(f);

/** Refuse above this share of the corpus. The rule is a fold over hand-typing accidents, so a
 *  legitimate change touches single-digit percentages — the T1-T6 widening moved 2.4% of all
 *  asset rows, its largest move to date. A double-digit rewrite means the rule regressed, the
 *  target's `declarant_name` is not what this expects, or both; refusing costs one re-run and
 *  publishing costs a claim about who owns what on tens of thousands of rows. */
const MAX_CHANGE_SHARE = 0.1;

type Row = {
  declaration_id: string;
  seq: number;
  holder_name: string | null;
  declarant_name: string;
  is_spouse: boolean;
};

const main = async (): Promise<void> => {
  const toUrl = arg("--to") ?? DATABASE_URL;
  const apply = has("--apply");
  console.log(`target: ${redactUrl(toUrl)}${apply ? "" : "   (dry run)"}`);

  const dst = new Pool({ connectionString: toUrl, max: 1 });
  try {
    const rows = await dst.query<Row>(
      `SELECT a.declaration_id::text, a.seq, a.holder_name, d.declarant_name, a.is_spouse
         FROM declaration_asset a
         JOIN declaration d USING (declaration_id)
        ORDER BY a.declaration_id, a.seq`,
    );
    if (!rows.rowCount)
      throw new Error(
        "target has no declaration_asset rows — load declarations there first",
      );

    const changed: Row[] = [];
    let cleared = 0;
    let remarked = 0;
    for (const r of rows.rows) {
      const next = isSpouseHolder(r.holder_name, r.declarant_name);
      if (next === r.is_spouse) continue;
      changed.push({ ...r, is_spouse: next });
      if (next) remarked++;
      else cleared++;
    }

    const share = changed.length / rows.rowCount;
    console.log(
      `  ${rows.rowCount} asset row(s); ${changed.length} disagree with the rule ` +
        `(${(share * 100).toFixed(2)}%) — ${cleared} to clear, ${remarked} to re-mark`,
    );
    const sample = (want: boolean, n: number) =>
      changed
        .filter((r) => r.is_spouse === want)
        .slice(0, n)
        .map((r) => `    ${r.holder_name}  ⟂  ${r.declarant_name}`)
        .join("\n");
    if (cleared)
      console.log(`  clearing (own name, respelled):\n${sample(false, 5)}`);
    // Printed at every run, not only in the dry run: a re-mark republishes „held by somebody
    // else" against a named individual, and the operator should see whose name it was.
    if (remarked)
      console.log(`  RE-MARKING (a refusal now applies):\n${sample(true, 10)}`);

    if (!changed.length) {
      console.log("  nothing to do — the target already matches the rule");
      return;
    }
    if (share > MAX_CHANGE_SHARE)
      throw new Error(
        `${(share * 100).toFixed(1)}% of rows would change, above the ${(MAX_CHANGE_SHARE * 100).toFixed(0)}% ceiling. ` +
          `That is not a fold widening — check that the target's declarant_name is populated ` +
          `and that isSpouseHolder has not regressed before overriding this.`,
      );
    if (!apply) {
      console.log("  DRY RUN — pass --apply to write");
      return;
    }

    const c = await dst.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `CREATE TEMP TABLE restamp_is_spouse (
           declaration_id bigint NOT NULL,
           seq int NOT NULL,
           is_spouse boolean NOT NULL,
           PRIMARY KEY (declaration_id, seq)
         ) ON COMMIT DROP`,
      );
      await copyRows(
        c,
        "restamp_is_spouse",
        ["declaration_id", "seq", "is_spouse"],
        changed.map((r) => [r.declaration_id, r.seq, r.is_spouse]),
      );
      // Keyed on the target's OWN (declaration_id, seq) — read from this same database a few
      // statements ago, inside this transaction — so the bigserial's load-order origin, which
      // makes it unusable ACROSS databases, is irrelevant here.
      const upd = await c.query(
        `UPDATE declaration_asset a
            SET is_spouse = s.is_spouse
           FROM restamp_is_spouse s
          WHERE a.declaration_id = s.declaration_id AND a.seq = s.seq
            AND a.is_spouse IS DISTINCT FROM s.is_spouse`,
      );
      await c.query("COMMIT");
      console.log(`  updated ${upd.rowCount} row(s)`);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } finally {
    await dst.end();
  }
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
