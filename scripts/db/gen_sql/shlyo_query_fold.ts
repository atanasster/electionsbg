// Generates pg/141_shlyo_query_fold.sql from src/lib/shlyoRules.ts.
//
//   npm run gen:shlyo-sql            # rewrite the migration
//   npm run gen:shlyo-sql -- --check # exit 1 if it is stale (the gate)
//
// WHY GENERATE IT. The shliokavitsa rules have two consumers — the browser's substring
// filter and every /api/db/*-search route — and a rule table hand-copied into SQL is the
// "computed in two places, so it will drift" case, with a failure nobody can see: the
// browser finds „6umen" and the server does not, and both look like they work.
//
// IT IS DELIBERATELY NOT NAMED `db:gen-*`. That prefix means "writes a committed artifact
// FROM POSTGRES and therefore belongs in db:refresh" — refresh_coverage.test.ts enumerates
// every such script and demands it either join REFRESH_GENERATORS or gate its write behind
// `--write`. This one derives a MIGRATION from TypeScript, runs when a human edits the
// rules, and would be meaningless inside a data reload. `--check` is what CI runs.
//
// The emitted function is IMMUTABLE + PARALLEL SAFE so it can sit inside an indexed
// predicate's parameter side, and it is QUERY-SIDE ONLY — see shlyoRules.ts for why
// applying it to stored data is simply wrong.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHLYO_RULES } from "@/lib/shlyoRules";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
export const OUT = path.join(
  ROOT,
  "scripts/db/schema/pg/141_shlyo_query_fold.sql",
);

/** Single-quote a SQL string literal. The rule patterns are ASCII and contain no quotes
 *  today; escaping anyway means a future rule cannot inject one. */
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export const buildSql = (): string => {
  // Innermost call = FIRST rule, because each wraps the previous one's result. Order is a
  // contract ("6t" before "6"; the ya producers before the y rule), so reversing this
  // silently changes what the fold means.
  let expr = "coalesce(txt, '')";
  const notes: string[] = [];
  for (const r of SHLYO_RULES) {
    expr = `regexp_replace(${expr}, ${lit(r.find)}, ${lit(r.to)}, 'g')`;
    notes.push(`--   ${r.find.padEnd(14)} -> ${r.to.padEnd(4)}  ${r.why}`);
  }

  return `-- GENERATED FILE — DO NOT EDIT.
-- Source: src/lib/shlyoRules.ts · Generator: scripts/db/gen_sql/shlyo_query_fold.ts
-- Regenerate: npm run gen:shlyo-sql   ·   Verify: npm run gen:shlyo-sql -- --check
--
-- SHLIOKAVITSA, server side. translit_bg_latin() (000_search_fns.sql) folds Cyrillic to
-- Streamlined Latin, so „Желязков" and „Zhelyazkov" already meet. What it cannot reach is
-- the Latin-side spelling a Bulgarian actually types — „6umen", „4erven", „sofiq",
-- „plowdiw" — because those fold to themselves.
--
-- Measured before this existed: „Jelqzkov" returned 0 rows from person_search while
-- „Jelyazkov" returned 2. pg_trgm's %> absorbs the letter-for-letter variants and hides
-- half the gap; what it cannot absorb is a substitution that changes the letter COUNT,
-- which is every rule below.
--
-- PRECONDITION: the argument is ALREADY FOLDED — compose this with translit_bg_latin(),
-- never call it on raw input. It does NOT lowercase, because its TypeScript twin does not
-- either, and adding a lower() here made the two disagree on every mixed-case input
-- ("6T" -> "shT" in TS, "sht" in SQL). Latent, since both callers pre-fold; a gate written
-- from lowercase examples would have passed while the two diverged.
--
-- THREE CONTRACTS, all inherited from the shared rule table:
--
--   1. QUERY SIDE ONLY. Compose it with the query parameter — never store its output.
--      A Latin trade name "Wow Ltd" folds to \`wowltd\` and would be indexed as \`vovltd\`.
--      No *_fold_shlyo column may exist.
--   2. STRICTLY ADDITIVE. Probe the plain needle first and this one only after it misses,
--      appending. It can add rows; it must never remove one.
--   3. THE INDEX STILL SERVES. Only the parameter side is transformed, so
--      \`name_fold %> shlyo_query_fold(translit_bg_latin($1))\` uses idx_person_search_fold
--      exactly as the un-rewritten probe does.
--
-- The rules, in application order (order is a contract — "6t" before "6", and the two "ya"
-- producers before the y rule, whose lookahead then protects their vowel):
${notes.join("\n")}
--
-- c -> ts (ц) is DELIBERATELY ABSENT: it would refold every Latin trade name carrying a
-- "c" (Keytruda, Abemaciclib) away from what the reader typed. Do not "complete" it.

CREATE OR REPLACE FUNCTION shlyo_query_fold(txt text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT ${expr};
$$;
`;
};

const run = (): void => {
  const sql = buildSql();
  const check = process.argv.includes("--check");
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (check) {
    if (current === sql) {
      console.log("shlyo_query_fold: up to date");
      return;
    }
    console.error(
      `shlyo_query_fold: ${path.relative(ROOT, OUT)} is STALE — the rules in ` +
        `src/lib/shlyoRules.ts have moved.\nRun: npm run gen:shlyo-sql`,
    );
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sql);
  console.log(
    `shlyo_query_fold: wrote ${path.relative(ROOT, OUT)} (${SHLYO_RULES.length} rules)`,
  );
};

if (process.argv[1] && process.argv[1].includes("shlyo_query_fold")) run();
