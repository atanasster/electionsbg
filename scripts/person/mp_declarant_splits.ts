/**
 * MPs whose declarations sit on a SEPARATE person row — the residual Tier 2b cannot merge.
 *
 * A REPORT, not a page, and for the same reason `declared_vs_registry.ts` is: every row here
 * is a question about whether two records name one human, and this repo's standing rule is
 * that a wrong public link is an accusation. Nothing is published; the output is a queue for
 * a human, ordered so the safest evidence is read first.
 *
 *   npx tsx scripts/person/mp_declarant_splits.ts [--out <path>] [--limit N]
 *
 * ── WHY THIS EXISTS WHEN A REVIEW QUEUE ALREADY DOES ────────────────────────────────────
 *
 * `person_review_candidate` holds ~12.6k rows over ~3.4k groups, and all of these are in it,
 * undifferentiated. That is the problem rather than the solution: a queue nobody can finish
 * is a queue nobody starts. This narrows to one answerable question — "is the MP the same
 * person as the declarant of that name?" — over ~130 rows.
 *
 * ── HOW TO READ THE EVIDENCE COLUMNS ────────────────────────────────────────────────────
 *
 * `registerDeclarants` is the count that decides most of it: how many DIFFERENT people the
 * Сметна палата knows by this exact name, counted per identity (distinct filing GUID, plus
 * one for each subject_ref whose filings carry only per-document guids and so name nobody).
 *
 *   0  → NOT "no declarant" — the row would not be here if there were none. It means the
 *        register SPELLS the name differently from the person record, so the two folds do
 *        not meet. Usually a typo at source: „Донка Ивнова Михайлова" against „Донка Иванова
 *        Михайлова". `slug_identity.ts` explains why this cannot be levelled — a typo and a
 *        second same-named person are indistinguishable from the outside. Decide these by
 *        reading the filing, never by assuming the spellings are the same person.
 *   1  → the register knows exactly one declarant of the name. Tier 2b did not merge these
 *        for a stated reason — a mass name over the namesake cap, an ambiguous 4-token name,
 *        a third identity on the fold, or a component with no counted anchor. Each is a
 *        decision the rule declined to make automatically, not an oversight.
 *   ≥2 → the register itself knows two people of this name. These are NOT adjudicable from
 *        the corpus and need an outside source; they are reported last.
 *
 * `namesakeRisk` is `officer_name_counts.company_count` — companies, not people. It is
 * printed because it is what Tier 2a gates on and what the mass-name cap reads, NOT because
 * it measures namesakes. A high value means "this name is common in the registry", which is
 * a reason to be careful and not a finding.
 *
 * ── WHAT A DECISION LOOKS LIKE ──────────────────────────────────────────────────────────
 *
 * A same-fold merge is expressible today, though it is not the shape the CLI's usage text
 * describes:
 * `kind='merge'` unions every component carrying `fold_a` with every component carrying
 * `fold_b`, so passing the SAME fold for both unions all identities on it. That is exact
 * when `personsOnFold` is 2 and TOO BROAD when it is more — for those, split the third
 * identity out first (`kind='split'`, `ref_a`) or leave the row alone.
 *
 *   npm run person:override -- merge --fold-a <fold> --fold-b <fold> --note "<why>" --by "<who>"
 *
 * Overrides apply as Tier 4, last, so a hand decision always wins over the automatic result.
 */

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../db/lib/pg";
import { PERSON_GUID_SQL_PATTERN } from "../officials/slug_identity";

type Row = {
  name_fold: string;
  mp_slug: string;
  mp_name: string;
  mp_refs: string;
  oth_slug: string;
  oth_name: string;
  oth_sources: string;
  oth_institutions: string | null;
  declarations: string;
  register_declarants: string;
  namesake_risk: string;
  persons_on_fold: string;
};

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// Counted per IDENTITY, not per GUID — the same expression `resolve_persons.ts` uses. A
// subject_ref whose filings are all bare per-document guids names nobody, so it counts as
// one unknown declarant rather than vanishing from the total. Reading it the other way is
// how a two-declarant fold scores 1 and looks unique.
const REGISTER_PEOPLE_SQL = `
  WITH scoped AS (
    SELECT translit_bg_latin(d.declarant_name) AS f, d.subject_ref,
           upper(substring(d.source_url from $1)) AS guid
      FROM declaration d
      -- Scoped to the folds actually in play. Invariant in RESULT — it filters the grouped
      -- column — and 73x in cost: unscoped this folds all 47,983 declarant names and
      -- correlates two subqueries over the lot, 68.1 s against 0.9 s.
     WHERE translit_bg_latin(d.declarant_name) IN (
             SELECT p.name_fold FROM person p
              JOIN person_role r ON r.person_id = p.person_id AND r.source = 'mp'))
  SELECT f,
         ( (SELECT count(DISTINCT s2.guid) FROM scoped s2
             WHERE s2.f = s.f AND s2.guid IS NOT NULL)
         + (SELECT count(*) FROM (
              SELECT s3.subject_ref FROM scoped s3
               WHERE s3.f = s.f GROUP BY s3.subject_ref
              HAVING count(s3.guid) = 0) g) ) AS n
    FROM scoped s GROUP BY f`;

const main = async (): Promise<void> => {
  const limit = Number(arg("--limit") ?? 0);
  const out =
    arg("--out") ?? path.join(process.cwd(), "reports/mp_declarant_splits.md");

  const rows = await allRows<Row>(
    `WITH mps AS (
       SELECT DISTINCT p.person_id, p.name_fold, p.slug, p.display_name, p.namesake_risk
         FROM person p JOIN person_role r ON r.person_id = p.person_id
        WHERE r.source = 'mp'),
     regp AS (${REGISTER_PEOPLE_SQL}),
     folds AS (SELECT name_fold, count(*) AS n FROM person GROUP BY 1)
     SELECT m.name_fold, m.slug AS mp_slug, m.display_name AS mp_name,
            m.namesake_risk::text,
            (SELECT string_agg(DISTINCT r.ref, ',' ORDER BY r.ref)
               FROM person_role r WHERE r.person_id = m.person_id AND r.source = 'mp') AS mp_refs,
            o.slug AS oth_slug, o.display_name AS oth_name,
            (SELECT string_agg(DISTINCT r.source, ',' ORDER BY r.source)
               FROM person_role r WHERE r.person_id = o.person_id) AS oth_sources,
            (SELECT string_agg(DISTINCT d2.institution, ' · ')
               FROM declaration d2 WHERE d2.person_id = o.person_id
                AND d2.institution IS NOT NULL) AS oth_institutions,
            (SELECT count(*) FROM declaration d3 WHERE d3.person_id = o.person_id)::text AS declarations,
            COALESCE(regp.n, 0)::text AS register_declarants,
            folds.n::text AS persons_on_fold
       FROM mps m
       JOIN person o ON o.name_fold = m.name_fold AND o.person_id <> m.person_id
       JOIN folds ON folds.name_fold = m.name_fold
       LEFT JOIN regp ON regp.f = m.name_fold
      WHERE EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = o.person_id)
      -- Safest evidence first: the register naming ONE declarant, on the least common name,
      -- with the fewest competing identities on the fold.
      -- Total order. The four evidence keys leave 58% of rows in a tie group, and an
      -- undetermined order makes every re-run look like the queue changed.
      ORDER BY COALESCE(regp.n, 0), folds.n, m.namesake_risk, m.display_name,
               m.slug, o.slug`,
    [PERSON_GUID_SQL_PATTERN],
  );

  const shown = limit > 0 ? rows.slice(0, limit) : rows;
  const adjudicable = rows.filter(
    (r) =>
      Number(r.register_declarants) === 1 && Number(r.persons_on_fold) === 2,
  );

  const md: string[] = [
    "# MPs whose declarations sit on a separate person row",
    "",
    "Generated by `npx tsx scripts/person/mp_declarant_splits.ts` — a review queue, not a",
    "set of findings. Every row is a QUESTION. Nothing here is published, and a name match",
    "is never on its own a reason to merge.",
    "",
    `- **${rows.length}** same-name pairs, over **${new Set(rows.map((r) => r.mp_slug)).size}** MPs`,
    `- **${rows.reduce((n, r) => n + Number(r.declarations), 0)}** declarations on the second row, IF the two are one person`,
    `- **${adjudicable.length}** are cleanly adjudicable: the register knows ONE declarant of`,
    "  the name and the fold carries exactly two identities, so a `merge` override on that",
    "  fold joins precisely those two and nothing else",
    "",
    "`registerDeclarants ≥ 2` means the Сметна палата itself knows two people of this name.",
    "Those are not decidable from this corpus — they need an outside source — and sort last.",
    "",
    "`registerDeclarants = 0` does NOT mean there is no declarant — the row would not exist.",
    "It means the register spells the name differently from the person record, usually a typo",
    "at source, so the two folds never meet. Read the filing; do not assume the spellings are",
    "one person.",
    "",
    "The **decide?** column carries the caveat on the row rather than only in the prose above:",
    "only `yes` rows are answerable from this corpus, and even those are a question.",
    "",
    "| # | decide? | name | MP | declarant | institutions | decls | registerDeclarants | onFold | namesakeRisk |",
    "|--:|---|---|---|---|---|--:|--:|--:|--:|",
  ];
  // Why a row is or is not answerable from this corpus, stated per row. Without it the six
  // rows naming one MP against six institutions read exactly like the four clean ones.
  const verdict = (r: Row): string => {
    const reg = Number(r.register_declarants);
    const fold = Number(r.persons_on_fold);
    if (reg === 0) return "no — register spells the name differently";
    if (reg > 1) return `no — register knows ${reg} of this name`;
    if (fold > 2) return `no — ${fold} identities on the fold`;
    return "yes";
  };

  shown.forEach((r, i) => {
    md.push(
      `| ${i + 1} | ${verdict(r)} | ${r.mp_name} | \`${r.mp_slug}\` (mp ${r.mp_refs}) | \`${r.oth_slug}\` (${r.oth_sources}) | ` +
        `${(r.oth_institutions ?? "—").slice(0, 90)} | ${r.declarations} | ${r.register_declarants} | ` +
        `${r.persons_on_fold} | ${r.namesake_risk} |`,
    );
  });
  md.push(
    "",
    "## Deciding a row",
    "",
    "```bash",
    'npm run person:override -- merge --fold-a "<name_fold>" --fold-b "<name_fold>" \\',
    '  --note "register knows one declarant; <evidence>" --by "<who>"',
    "```",
    "",
    "`merge` is POSITIONAL — `--kind merge` prints usage and exits without writing — and the",
    "attribution flag is `--by`, not `--decided-by`, which defaults to `operator` silently.",
    "",
    "The same fold on both sides unions every identity on it — exact when `onFold` is 2,",
    "too broad above that. Overrides apply last (Tier 4), so a decision always wins over the",
    "automatic result. Re-run `npm run db:resolve:persons` for it to take effect.",
    "",
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md.join("\n"), "utf-8");
  console.log(
    `mp-declarant splits: ${rows.length} pair(s) over ${new Set(rows.map((r) => r.mp_slug)).size} MP(s); ` +
      `${adjudicable.length} cleanly adjudicable → ${path.relative(process.cwd(), out)}`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
