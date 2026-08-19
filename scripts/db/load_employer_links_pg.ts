// Build declaration_employer_link (migration 165) — the bridge from a declarant's
// own stated employer to a procurement BUYER.
//
//   npm run db:load:employer-links:pg          (local)
//   npm run db:load:employer-links:pg:cloud    (Cloud SQL proxy)
//
// PURE DERIVATION, no external input: it reads `declaration.filed_institution`
// and `contracts.awarder_name` and writes the fold that joins them. So it needs
// no file, works on any database that has both corpora, and is safe to re-run.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ITS ORDER IS AFTER BOTH CORPORA, and the declarations half is the subtle one:
// `filed_institution` is written by declarations PHASE 1
// (`db:load:declarations:pg`, no --resolve). Phase 2 only fills person_id. Run
// this before phase 1 on a fresh database and every employer is NULL, so the
// table comes out empty and every surface reads „no employer matched" for the
// whole corpus — green, loaded, and wrong.
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT IT REFUSES, AND WHY ONE CHECK IS NOT ENOUGH. A fold matching more than one
// EIK writes NOTHING — the `tr_name_fold_people` rule: a confidence score on an
// ambiguous match is an invitation to publish the wrong one, and „Общинска
// администрация" is a name dozens of municipalities share.
//
// But checking the BUYER side alone is one-sided, and the first cut shipped that
// way. „Средно училище „Бачо Киро"" names exactly one buyer in `contracts` and
// TWO REAL SCHOOLS in the МОН register (000123533 and 000281565) — so the fold
// looked unambiguous while attributing a declarant to one of two same-named
// institutions on a coin flip. Four folds were in that state, and the migration
// header promises never to publish one.
//
// So the refusal consults every INDEPENDENT name→EIK register on the database as
// well: a fold naming more than one organisation ANYWHERE is refused, whether or
// not the extras procure. `AMBIGUITY_REGISTERS` is that list, and it is probed
// for existence rather than assumed — most are loaded by chain steps this loader
// does not depend on.

import fs from "node:fs";
import path from "node:path";
import { exec, allRows, withTx, vacuumAfterReload, end } from "./lib/pg";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/165_declaration_employer.sql",
);

/** The fold, written ONCE and used by both sides. Conservative on purpose: every
 *  widening (transliteration, punctuation stripping) widens the ambiguity the
 *  loader must then refuse, and costs more matches than it wins. */
const FOLD = (col: string) =>
  // NBSP (U+00A0) is NOT in Postgres's `\s`, and it turns up in pasted register
  // names — so it is normalised to a space FIRST, before the collapse. Without
  // that, „Община  Варна" with a hard space folds to a different key than the
  // same name typed with an ordinary one, and the two never meet.
  `lower(regexp_replace(btrim(replace(${col}, U&'\\00A0', ' ')), '\\s+', ' ', 'g'))`;

/** Independent name→EIK registers, consulted ONLY to detect ambiguity — never to
 *  supply an EIK. A fold naming two rows in any of them is two organisations, and
 *  the bridge must not choose between them.
 *
 *  Probed with `to_regclass` rather than assumed: `schools` comes from
 *  db:load:schools:pg and `tr_companies` from the excluded db:load:tr:pg, so a
 *  perfectly healthy database can be missing either. A missing register weakens
 *  the check, so the loader SAYS which ones it consulted rather than implying it
 *  checked them all. */
const AMBIGUITY_REGISTERS: { table: string; name: string; eik: string }[] = [
  { table: "schools", name: "name", eik: "eik" },
  // tr_companies keys on `uic`, not `eik` — same identifier, different column
  // name. It is 1.02M rows, so the fold over it is the expensive arm; it earns
  // its place because it is the widest independent register of organisation
  // names on the database.
  { table: "tr_companies", name: "name", eik: "uic" },
];

/** Folds that name more than one organisation in an independent register. An
 *  empty register list yields a never-matching CTE rather than an empty one, so
 *  the NOT EXISTS above stays valid SQL on a database that has neither. */
const ambiguousSql = (
  regs: { table: string; name: string; eik: string }[],
): string =>
  regs.length
    ? regs
        .map(
          (r) => `SELECT ${FOLD(r.name)} AS fold FROM ${r.table}
                   WHERE ${r.eik} IS NOT NULL AND ${r.name} IS NOT NULL
                   GROUP BY 1 HAVING count(DISTINCT ${r.eik}) > 1`,
        )
        .join("\n         UNION ")
    : "SELECT NULL::text AS fold WHERE false";

const main = async () => {
  const t0 = Date.now();
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  const present: typeof AMBIGUITY_REGISTERS = [];
  for (const r of AMBIGUITY_REGISTERS) {
    const [row] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.' || $1) IS NOT NULL AS ok`,
      [r.table],
    );
    if (row?.ok) present.push(r);
  }

  const [pre] = await allRows<{
    decls: string;
    employers: string;
    buyers: string;
  }>(
    `SELECT (SELECT count(*) FROM declaration) decls,
            (SELECT count(*) FROM declaration WHERE filed_institution IS NOT NULL
                AND btrim(filed_institution) <> '') employers,
            (SELECT count(DISTINCT awarder_eik) FROM contracts
              WHERE awarder_eik IS NOT NULL) buyers`,
  );
  if (!Number(pre.decls)) {
    console.warn(
      "  ⚠ employer-links: `declaration` is empty — run db:load:declarations:pg first.",
    );
    console.warn("    Leaving declaration_employer_link untouched.");
    await end();
    process.exit(0);
  }
  if (!Number(pre.employers)) {
    console.warn(
      "  ⚠ employer-links: no declaration carries filed_institution. That column is written by declarations PHASE 1 (db:load:declarations:pg, WITHOUT --resolve) — --resolve alone does not write it.",
    );
    console.warn("    Leaving declaration_employer_link untouched.");
    await end();
    process.exit(0);
  }
  if (!Number(pre.buyers)) {
    console.warn(
      "  ⚠ employer-links: `contracts` names no buyer — run db:load:pg first.",
    );
    console.warn("    Leaving declaration_employer_link untouched.");
    await end();
    process.exit(0);
  }

  const stats = await withTx(async (c) => {
    await c.query("DELETE FROM declaration_employer_link");
    const res = await c.query(
      `WITH employer AS (
         SELECT ${FOLD("filed_institution")} AS fold,
                min(btrim(filed_institution)) AS sample,
                count(DISTINCT btrim(filed_institution)) AS spellings
           FROM declaration
          WHERE filed_institution IS NOT NULL AND btrim(filed_institution) <> ''
          GROUP BY 1
       ),
       buyer AS (
         SELECT ${FOLD("awarder_name")} AS fold,
                min(awarder_eik) AS eik,
                count(DISTINCT awarder_eik) AS eiks
           FROM contracts
          WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL
          GROUP BY 1
       ),
       ambiguous AS (${ambiguousSql(present)})
       INSERT INTO declaration_employer_link
         (employer_fold, eik, confidence, basis, employer_sample, spellings)
       SELECT e.fold, b.eik, 'exact', 'awarder', e.sample, e.spellings
         FROM employer e JOIN buyer b USING (fold)
        -- THE REFUSAL. One spelling, one buyer, AND one organisation everywhere
        -- else we can look — or nothing at all.
        WHERE b.eiks = 1
          AND NOT EXISTS (SELECT 1 FROM ambiguous a WHERE a.fold = e.fold)
       RETURNING 1`,
    );
    const ambiguous = await c.query(
      `WITH employer AS (
         SELECT ${FOLD("filed_institution")} AS fold FROM declaration
          WHERE filed_institution IS NOT NULL AND btrim(filed_institution) <> ''
          GROUP BY 1
       ),
       buyer AS (
         SELECT ${FOLD("awarder_name")} AS fold, count(DISTINCT awarder_eik) AS eiks
           FROM contracts WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL
          GROUP BY 1
       )
       SELECT count(*)::int AS n FROM employer e JOIN buyer b USING (fold)
        WHERE b.eiks > 1`,
    );
    return {
      linked: res.rowCount ?? 0,
      refused: (ambiguous.rows[0] as { n: number }).n,
    };
  });

  await vacuumAfterReload("declaration_employer_link");

  const [cov] = await allRows<{ filings: string; matched: string }>(
    `SELECT count(*) filings,
            count(l.eik) matched
       FROM declaration d
       LEFT JOIN declaration_employer_link l
              ON l.employer_fold = ${FOLD("d.filed_institution")}
      WHERE d.filed_institution IS NOT NULL AND btrim(d.filed_institution) <> ''`,
  );
  const pct = ((Number(cov.matched) / Number(cov.filings)) * 100).toFixed(1);
  console.log(
    `employer-links: consulted ${
      present.length ? present.map((r) => r.table).join(" + ") : "NO"
    } independent register(s) for ambiguity`,
  );
  console.log(
    `employer-links: ${stats.linked} employer(s) → buyer, ${stats.refused} refused as ambiguous · ` +
      `${cov.matched}/${cov.filings} filings matched (${pct}%) in ${(
        (Date.now() - t0) /
        1000
      ).toFixed(1)}s`,
  );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
