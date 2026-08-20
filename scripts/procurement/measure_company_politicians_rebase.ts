// READ-ONLY. What re-basing `company_politicians` onto the gated person layer would change.
//
// Tier 4 of docs/plans/company-page-consolidation-v1.md replaces both arms of that table:
// the `mp` arm is fed by companies-index.json (a name match with no people-per-name guard)
// and the `official` arm by data/officials/derived/company_links.json (the same method, with
// an `isUniqueName` proxy its own header calls wrong in both directions). Both become the
// gated `person_role` set that /person, /company and /governance/companies already publish.
//
// ⚠️ WHY THIS SCRIPT EXISTS RATHER THAN A ROW COUNT. `company_politicians` is read by 24
// migrations, and two of them decide what a reader SEES about a named contract:
//
//   033_procurement_risk_indexes — publishes mpConnectedEiks / pepConnectedEiks straight to
//                                  the CLIENT-SIDE risk scorer.
//   112_contract_risk_cache      — its `mp` and `pep` CTEs are bits 1 and 2 of the fired
//                                  mask, and `contract_risk_grade_letter(fired)` turns that
//                                  count into the A-F grade rendered in the contracts
//                                  browser and filterable via ?grade=D,E,F.
//
// So the question is not "how many rows move" but "which contracts change grade, and in
// which direction". A count of changed rows would report a number and hide the story.
//
// The grade is a function of the FIRED COUNT alone, so the transition matrix can be derived
// without rebuilding a 409,644-row cache: flip bits 1 and 2 per contract and re-letter.
//
//   npx tsx scripts/procurement/measure_company_politicians_rebase.ts
//
// Writes nothing. Run it against whichever database you intend to re-base.

import { allRows, end, DATABASE_URL, redactUrl } from "../db/lib/pg";

/** The gated replacement, split the way company_politicians splits today.
 *
 *  `mp` means the person holds an mp role; everything else is `official`. A person can be
 *  both (an ex-minister now in the chamber), so the two arms OVERLAP by person — which is
 *  fine, because both arms of the current table are EIK sets and 033 unions them anyway. */
const REPLACEMENT = `
  WITH gated AS (
    SELECT DISTINCT ptr.ref AS eik, pe.person_id
      FROM person_role ptr
      JOIN person pe
        ON pe.person_id = ptr.person_id
       AND pe.status = 'active' AND pe.is_public_figure
      JOIN tr_person_roles t
        ON t.uic = ptr.ref AND t.name_fold = pe.name_fold
      JOIN tr_name_fold_people f
        ON f.name_fold = pe.name_fold AND f.people_n = 1
     WHERE ptr.source IN ('tr','ngo')
       AND ptr.confidence IN ('exact_id','high','manual')
    UNION
    SELECT DISTINCT sc.uic, sc.person_id
      FROM declaration_stake_company sc
      JOIN person pe
        ON pe.person_id = sc.person_id
       AND pe.status = 'active' AND pe.is_public_figure
  ),
  -- ⚠️ CONTRACT-RESTRICTED, and this is the single most consequential line in the file.
  -- company_politicians is fed by mp_connected / pep_connected, both of which JOIN the
  -- contractor rollups — so today the table means "a politically-linked CONTRACTOR", never
  -- "a politically-linked company". Dropping the restriction takes the set from 464 to
  -- 17,608 and silently redefines every consumer's question, including the A-F grade on
  -- 409,644 contracts. Measured both ways: unrestricted moves 15,537 contracts (13,385
  -- worse); restricted moves far fewer, and only where a real contractor gained or lost a
  -- link. The plan's own expected figure (~925 + 127) is the restricted one.
  held AS (
    SELECT g.eik, g.person_id
      FROM gated g
     WHERE EXISTS (SELECT 1 FROM contracts c WHERE c.contractor_eik = g.eik)
  ),
  arms AS (
    SELECT g.eik,
           bool_or(EXISTS (SELECT 1 FROM person_role m
                            WHERE m.person_id = g.person_id AND m.source = 'mp')) AS is_mp,
           bool_or(NOT EXISTS (SELECT 1 FROM person_role m
                                WHERE m.person_id = g.person_id AND m.source = 'mp'))
             AS is_official
      FROM held g
     GROUP BY g.eik
  )`;

const pct = (n: number, d: number) =>
  d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;

const main = async (): Promise<void> => {
  console.log(`measuring against ${redactUrl(DATABASE_URL)}\n`);

  // ── 1. the EIK sets, by arm ──────────────────────────────────────────────────────────
  const [sets] = await allRows<Record<string, string>>(`
    ${REPLACEMENT}
    SELECT (SELECT count(DISTINCT eik)::text FROM company_politicians)                AS cur_all,
           (SELECT count(DISTINCT eik)::text FROM company_politicians WHERE kind='mp') AS cur_mp,
           (SELECT count(DISTINCT eik)::text FROM company_politicians
             WHERE kind='official')                                                    AS cur_official,
           (SELECT count(*)::text FROM arms)                                           AS new_all,
           (SELECT count(*)::text FROM arms WHERE is_mp)                               AS new_mp,
           (SELECT count(*)::text FROM arms WHERE is_official)                         AS new_official`);
  console.log("── linked-EIK sets ─────────────────────────────────────────");
  console.log(
    `  current   all ${sets.cur_all}  ·  mp ${sets.cur_mp}  ·  official ${sets.cur_official}`,
  );
  console.log(
    `  gated     all ${sets.new_all}  ·  mp ${sets.new_mp}  ·  official ${sets.new_official}\n`,
  );

  // ── 2. gained / lost, and WHY each loss ──────────────────────────────────────────────
  // A loss is only acceptable if it is a refusal the gates make deliberately. Anything else
  // is a bridge bug, and the difference is the whole reason to measure rather than diff.
  const lost = await allRows<Record<string, string>>(`
    ${REPLACEMENT},
    cur AS (SELECT DISTINCT eik FROM company_politicians),
    gone AS (SELECT eik FROM cur EXCEPT SELECT eik FROM arms)
    SELECT
      count(*)::text AS n,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM person_role ptr
          JOIN person pe ON pe.person_id = ptr.person_id
          JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
         WHERE ptr.ref = gone.eik AND ptr.source IN ('tr','ngo') AND f.people_n > 1))::text
        AS shared_name,
      count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM person_role ptr WHERE ptr.ref = gone.eik
          AND ptr.source IN ('tr','ngo')))::text AS no_registry_role,
      -- The privacy gate: the person layer holds them, but retired or not a public figure.
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM person_role ptr
          JOIN person pe ON pe.person_id = ptr.person_id
         WHERE ptr.ref = gone.eik AND ptr.source IN ('tr','ngo')
           AND (pe.status <> 'active' OR NOT pe.is_public_figure)))::text AS not_public_figure
      FROM gone`);
  const gained = await allRows<{ n: string }>(`
    ${REPLACEMENT},
    cur AS (SELECT DISTINCT eik FROM company_politicians)
    SELECT count(*)::text AS n FROM (SELECT eik FROM arms EXCEPT SELECT eik FROM cur) z`);
  console.log("── movement ────────────────────────────────────────────────");
  console.log(`  gained  ${gained[0].n}`);
  console.log(
    `  lost    ${lost[0].n}, by cause (the causes OVERLAP — one EIK can hit several):`,
  );
  console.log(`    shared name fold      ${lost[0].shared_name}`);
  console.log(`    no gated registry role ${lost[0].no_registry_role}`);
  console.log(`    not an active public figure ${lost[0].not_public_figure}`);
  console.log(
    "  ⚠️ THE CAUSES OVERLAP AND DO NOT PARTITION. A loss matching NONE of them is a bridge\n" +
      "     bug rather than a refusal, and the plan's Tier 4 gate says to resolve those\n" +
      "     before shipping 4a/4b — a refusal is a deliberate narrowing, a bridge bug is a\n" +
      "     link we lost by accident, and both look like a smaller number.\n",
  );

  // ── 3. the grade transition matrix ───────────────────────────────────────────────────
  // The grade is contract_risk_grade_letter(fired), so flipping bits 1 (mp) and 2 (pep)
  // per contract and re-lettering gives the exact matrix without a cache rebuild.
  const moves = await allRows<Record<string, string>>(`
    ${REPLACEMENT},
    c AS (
      SELECT r.key, r.fired, r.grade,
             ((r.fired_mask >> 1) & 1) AS cur_mp,
             ((r.fired_mask >> 2) & 1) AS cur_pep,
             COALESCE((SELECT is_mp FROM arms WHERE arms.eik = k.contractor_eik), false)::int
               AS new_mp,
             COALESCE((SELECT is_official FROM arms WHERE arms.eik = k.contractor_eik), false)::int
               AS new_pep
        FROM contract_risk_cache r
        JOIN contracts k ON k.key = r.key
    ),
    g AS (
      SELECT grade AS from_grade,
             contract_risk_grade_letter(fired - cur_mp - cur_pep + new_mp + new_pep)
               AS to_grade
        FROM c
    )
    SELECT from_grade, to_grade, count(*)::text AS n
      FROM g
     WHERE from_grade IS DISTINCT FROM to_grade
     GROUP BY 1, 2
     ORDER BY 3 DESC`);
  const [tot] = await allRows<{ n: string }>(
    "SELECT count(*)::text AS n FROM contract_risk_cache",
  );
  const moved = moves.reduce((a, r) => a + Number(r.n), 0);
  console.log("── contract grade transitions ──────────────────────────────");
  if (moves.length === 0) {
    console.log("  none — the two bases grade every contract identically");
  } else {
    for (const m of moves)
      console.log(`  ${m.from_grade} → ${m.to_grade}   ${m.n.padStart(7)}`);
    console.log(
      `  ${moved} of ${tot.n} contracts change grade (${pct(moved, Number(tot.n))})`,
    );
    // Direction is the story a count hides: worse means the gated layer FOUND a link the
    // name match missed, better means it refused one the name match asserted.
    const worse = moves
      .filter((m) => m.to_grade > m.from_grade)
      .reduce((a, r) => a + Number(r.n), 0);
    console.log(`  worse ${worse} · better ${moved - worse}`);
  }
  await end();
};

void main();
