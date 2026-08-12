/**
 * Shareholdings the Commerce Registry places on a declarant that their own декларация for
 * that year does not list.
 *
 * A REPORT, not a page, and deliberately so. „Undeclared holding" is an accusation, and this
 * repo's standing rule is that a wrong public link is one too — so the output is a file for
 * a human to work from, not a badge on /person. Nothing here is published.
 *
 *   npx tsx scripts/person/declared_vs_registry.ts [--out <path>] [--limit N]
 *
 * ── WHY THE SET IS SMALL, AND WHY THAT IS THE POINT ─────────────────────────────────────
 *
 * Four conditions must ALL hold before a company is reported, because each one removes a
 * reason the gap could be innocent rather than concealed:
 *
 *  1. The person filed an ANNUAL declaration for that fiscal year, with a stakes table.
 *     Annual only: that filing is a statement ABOUT A YEAR, so "held during it and absent
 *     from it" is a real discrepancy. An Entry or Vacate filing is a snapshot at the moment
 *     of taking up or leaving a post and never claimed to cover the year around it — the
 *     first draft compared against those too and produced provable false accusations.
 *  2. EVERY stake row on that filing resolved to an EIK (via declaration_stake_company's
 *     three gates). This is the one that matters most: an unresolved row is a stake we
 *     could not name, and it may be exactly the company we are about to report as missing.
 *     A person-year with any unresolved row is SKIPPED and counted separately.
 *  3. The registry role is a SHAREHOLDER one (partner / sole_owner). чл.37 declares
 *     participations; a manager who holds no shares has nothing to declare, so including
 *     managers would manufacture findings.
 *  4. The holding overlapped that fiscal year. A stake acquired after the year ended belongs
 *     on the NEXT filing, and reporting it here would call a correct declaration incomplete.
 *
 * ── WHAT IT STILL CANNOT RULE OUT ───────────────────────────────────────────────────────
 *
 * The registry link itself is name-based for all but 57 of 186,152 `tr` roles, so a namesake
 * can put a stranger's company on somebody's list. The report prints each person's
 * namesake_risk and orders by it, lowest first — but that score counts companies registered
 * to the name fold, not people, so it is a weak signal and the only one left. Read the output
 * as a queue of things to check, never as a list of findings.
 */

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../db/lib/pg";

type Row = {
  slug: string;
  display_name: string;
  namesake_risk: number;
  fiscal_year: number;
  uic: string;
  company_name: string | null;
  role: string;
  added_at: string | null;
  erased_at: string | null;
  declared_n: string;
};

const SQL = `
WITH filed AS (
  -- (1) person-years where an ANNUAL stakes table was actually filed.
  --
  -- 'Annualy' ONLY, and that restriction is the difference between a review queue and a
  -- libel. An annual declaration is a statement ABOUT A YEAR, so "held during that year and
  -- absent from it" is a real discrepancy. An Entry or Vacate filing is a snapshot at the
  -- moment of taking up or leaving a post — it never claimed to cover the year around it,
  -- and treating it as if it did produced provable false accusations: measured on the first
  -- draft, 6 of 20 rows rested on a non-annual filing, two of them refuted by their own
  -- dates (a holding acquired 2025-12-11 reported against an Entry filed 2025-02-13, and one
  -- erased 2025-01-29 reported against a Vacate filed 2025-07-05).
  --
  -- Note 096's COALESCE(fiscal_year, declaration_year) is right for ATTRIBUTING a declared
  -- stake to a year and wrong when inverted into "everything held that year belongs on this
  -- filing". Hence fiscal_year alone here.
  SELECT d.person_id, d.fiscal_year AS fy, count(*) AS stake_rows
    FROM declaration d
    JOIN declaration_stake s ON s.declaration_id = d.declaration_id
    JOIN person p ON p.person_id = d.person_id
   WHERE d.person_id IS NOT NULL
     AND s.company_name IS NOT NULL
     -- The person's OWN stakes, matching the resolved CTE below. Both sides must count the
     -- same population or "every declared stake resolved" compares a declarant-only numerator
     -- against a whole-filing denominator, and no one with a spouse's company is ever clean.
     --
     -- 096's own function, never a copy of its predicate: declaration_stake carries no flag,
     -- so this side has to re-derive what the matview stored, and a second spelling of the
     -- rule is how the two drift. declared_vs_registry.data.test.ts pins the call.
     AND stake_holder_is_declarant(s.holder_name, p.name_fold)
     AND d.declaration_type = 'Annualy'
     AND d.fiscal_year IS NOT NULL
   GROUP BY 1, 2
),
resolved AS (
  -- how many of that year's stake rows we could name an EIK for, on the same annual basis.
  SELECT sc.person_id, d.fiscal_year AS fy,
         count(*) AS resolved_rows,
         array_agg(DISTINCT sc.uic) AS uics
    FROM declaration_stake_company sc
    JOIN declaration d ON d.declaration_id = sc.declaration_id
   -- The person's OWN stakes. The matview also resolves rows the filing attributes to a
   -- spouse or a child; counting those here would compare a resolved-row total against a
   -- filed denominator that is every stake row on the filing, and the two would agree for
   -- the wrong reason. This measure is about how much of a person's own declared portfolio
   -- we can name an EIK for.
   WHERE sc.holder_is_declarant
     AND d.declaration_type = 'Annualy'
     AND d.fiscal_year IS NOT NULL
   GROUP BY 1, 2
),
-- (2) only person-years where EVERY declared stake resolved. An unresolved row could BE
-- the company below, so a partial resolution cannot support the claim.
clean AS (
  -- An INNER join, because the LEFT one could not fire: resolved_rows is count(*) over a
  -- group, so it is >= 1 wherever the row exists at all, and stake_rows is >= 1 by the same
  -- argument — a person-year with no resolved row can never satisfy the equality. Written as
  -- a LEFT JOIN + COALESCE it read as if "clean with zero resolutions" were a reachable
  -- state, which is the opposite of the rule this CTE enforces.
  SELECT f.person_id, f.fy, r.uics AS declared_uics, f.stake_rows
    FROM filed f
    JOIN resolved r ON r.person_id = f.person_id AND r.fy = f.fy
   WHERE r.resolved_rows = f.stake_rows
),
registry AS (
  -- (3) shareholder roles only, (4) overlapping the fiscal year.
  --
  -- COLLAPSED to one row per (person, year, company). tr_person_roles holds one row per
  -- registry RECORD, so a partner whose stake was re-entered — a capital change, a second
  -- дял — has several, and each would otherwise print as its own finding. The span is the
  -- outer bound of those records, and a single NULL erased_at means still held.
  SELECT pr.person_id, c.fy, tpr.uic,
         min(tpr.role)       AS role,
         min(tpr.added_at)   AS added_at,
         CASE WHEN bool_or(tpr.erased_at IS NULL) THEN NULL
              ELSE max(tpr.erased_at) END AS erased_at
    FROM clean c
    JOIN person_role pr
      ON pr.person_id = c.person_id AND pr.source = 'tr'
    JOIN tr_person_roles tpr
      ON tpr.uic = pr.ref
     AND tpr.name_fold = (SELECT name_fold FROM person WHERE person_id = pr.person_id)
   WHERE tpr.role IN ('partner', 'sole_owner')
     AND (tpr.added_at IS NULL OR tpr.added_at < make_date(c.fy + 1, 1, 1))
     AND (tpr.erased_at IS NULL OR tpr.erased_at >= make_date(c.fy, 1, 1))
   GROUP BY 1, 2, 3
)
SELECT p.slug, p.display_name, p.namesake_risk,
       g.fy AS fiscal_year, g.uic,
       tc.name AS company_name, g.role,
       to_char(g.added_at, 'YYYY-MM-DD')  AS added_at,
       to_char(g.erased_at, 'YYYY-MM-DD') AS erased_at,
       -- How many stakes the person DID declare that year. Context for a reviewer: an
       -- omission from a filing listing six companies reads differently from one listing
       -- none. (An earlier draft counted rows of the clean CTE, which is one per
       -- person-year by construction and so was always 1.)
       c.stake_rows::text AS declared_n
  FROM registry g
  JOIN person p ON p.person_id = g.person_id
  LEFT JOIN tr_companies tc ON tc.uic = g.uic
  JOIN clean c ON c.person_id = g.person_id AND c.fy = g.fy
 WHERE NOT (g.uic = ANY (c.declared_uics))
   AND p.status = 'active'
 -- Safest evidence first: LOWEST namesake risk, then the most recent year.
 --
 -- Namesake risk is the only discriminator left, and it is a weak one — it counts companies
 -- registered to the name fold, not people. A sharer count is deliberately NOT a key here:
 -- filter (2) already requires the whole filing to have resolved through 096, whose gate C
 -- demands a unique active name fold, so every surviving row has exactly one sharer and the
 -- key would be a permanent no-op dressed up as a safeguard.
 ORDER BY p.namesake_risk, g.fy DESC, p.display_name, g.uic
`;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const outArg = argv.indexOf("--out");
  const out =
    outArg >= 0
      ? argv[outArg + 1]
      : path.join("reports", "declared_vs_registry.md");
  // A bare `--limit` (or a non-numeric one) previously became NaN, and `slice(0, NaN)` is
  // empty — so the file came out with no rows while stdout still reported the full count.
  const limArg = argv.indexOf("--limit");
  const parsedLimit = limArg >= 0 ? Number(argv[limArg + 1]) : Number.NaN;
  if (limArg >= 0 && !Number.isFinite(parsedLimit)) {
    console.error("--limit needs a number");
    process.exit(2);
  }
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : Infinity;

  // Context figures, so the report can state what it is a fraction OF.
  const [ctx] = await allRows<{
    filed_years: string;
    clean_years: string;
    skipped_years: string;
  }>(`
    -- Same ANNUAL basis as the main query — a context figure computed on a wider basis
    -- would report a coverage fraction the rows below are not drawn from.
    WITH filed AS (
      SELECT d.person_id, d.fiscal_year fy, count(*) n
        FROM declaration d JOIN declaration_stake s USING (declaration_id)
        JOIN person p ON p.person_id = d.person_id
       WHERE d.person_id IS NOT NULL AND s.company_name IS NOT NULL
         -- Own stakes on BOTH sides, as in the main query above.
         AND stake_holder_is_declarant(s.holder_name, p.name_fold)
         AND d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
       GROUP BY 1, 2),
    resolved AS (
      SELECT sc.person_id, d.fiscal_year fy, count(*) n
        FROM declaration_stake_company sc JOIN declaration d USING (declaration_id)
       WHERE sc.holder_is_declarant
         AND d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
       GROUP BY 1, 2)
    SELECT count(*)::text filed_years,
           count(*) FILTER (WHERE COALESCE(r.n, 0) = f.n)::text clean_years,
           count(*) FILTER (WHERE COALESCE(r.n, 0) <> f.n)::text skipped_years
      FROM filed f LEFT JOIN resolved r ON r.person_id = f.person_id AND r.fy = f.fy`);

  const rows = await allRows<Row>(SQL);
  const shown = rows.slice(0, limit);

  const lines: string[] = [
    "# In the Commerce Registry, not in the declaration",
    "",
    "Generated by `scripts/person/declared_vs_registry.ts`. **A review queue, not a set of",
    "findings.** Every row is a shareholding the registry places on a declarant in a year",
    "whose own declaration does not list it — which has innocent explanations this script",
    "cannot rule out, the largest being that the registry link is matched by NAME.",
    "",
    `- person-years with an ANNUAL stakes table listing the declarant's OWN stake: **${ctx.filed_years}**`,
    `- of those, every OWN stake row resolved to an EIK (usable): **${ctx.clean_years}**`,
    `- skipped, because at least one OWN stake row did not resolve: **${ctx.skipped_years}**`,
    "",
    `**Coverage is the headline number here.** Only ${ctx.clean_years} of ${ctx.filed_years}`,
    "person-years are usable, because `declaration_stake_company` resolves a declared company",
    "NAME to an EIK only when the registry independently places the declared holder at a",
    "company of that name, and exactly one such company survives that check. Where one row",
    "fails to resolve, the whole person-year is unusable — the unresolved row could be the",
    "very company we would otherwise report as missing. Widening resolution, not widening",
    "this query, is what would make the exercise representative.",
    "",
    "**Both figures count the declarant's OWN stakes only.** Tables 10/11 name a holder per",
    "row and it is often a spouse or a child; those are out of scope on both sides, since",
    "чл.37 asks the declarant about their own participations. A person-year in which every",
    "stake belongs to a family member therefore does not appear above at all, rather than",
    "appearing as unusable.",
    `- rows reported: **${rows.length}**${
      shown.length < rows.length ? ` (showing ${shown.length})` : ""
    }`,
    "",
    "Ordered LOWEST-namesake-risk first, then most recent year. Namesake risk counts",
    "companies registered to the name fold, not people — it is a weak discriminator and the",
    "only one left, since filter (2) already requires a unique active name fold.",
    "",
    "| person | year | company | EIK | role | held from | held to | namesake risk | stakes declared that year |",
    "| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |",
  ];
  for (const r of shown)
    lines.push(
      `| [${r.display_name}](https://electionsbg.com/person/${r.slug}) | ${r.fiscal_year} | ` +
        `${r.company_name ?? "—"} | ${r.uic} | ${r.role} | ${r.added_at ?? "—"} | ` +
        `${r.erased_at ?? "—"} | ${r.namesake_risk} | ${r.declared_n} |`,
    );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf-8");
  console.log(
    `declared-vs-registry: ${rows.length} row(s) over ${ctx.clean_years} usable person-year(s) ` +
      `(${ctx.skipped_years} skipped as unresolvable) → ${out}`,
  );
  await end();
};

main().catch(async (e) => {
  await end().catch(() => {});
  console.error(e);
  process.exit(1);
});
