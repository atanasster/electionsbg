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
  -- 17,608 and silently redefines every consumer's question. The plan's own expected figure
  -- (~925 + 127) is the restricted one.
  --
  -- ⚠️ IT IS A NO-OP FOR THE GRADE MATRIX, and an earlier version of this comment claimed
  -- the opposite. Measured both ways the matrix is IDENTICAL — every EIK the restriction
  -- removes holds no contracts, so it can move no contract's grade. What it is load-bearing
  -- for is the EIK counts above (464 vs 964 vs 17,608, i.e. whether the number means
  -- „contractor" or „company") and for runtime: 23 s against over two minutes.
  held AS (
    SELECT g.eik, g.person_id
      FROM gated g
     WHERE EXISTS (SELECT 1 FROM contracts c WHERE c.contractor_eik = g.eik)
  ),
  arms AS (
    SELECT g.eik,
           bool_or(EXISTS (SELECT 1 FROM person_role m
                            WHERE m.person_id = g.person_id AND m.source = 'mp')) AS is_mp,
           -- WARNING: AN OFFICIALS SOURCE, NOT "not an MP". NOT is_mp admitted 457 people who
           -- hold no office at all — 288 election candidate rows and 176 local ones —
           -- and 112 SUMS f_mp + f_pep into the fired count, so those inflate the grade
           -- shift by 38% (15,537 → 10,893 moved, 13,385 → 8,296 worse). The set is
           -- OFFICIAL_DECLARATION_SOURCES from src/lib/officialSources.ts, plus the two
           -- office-holding tiers that carry their own source, so the arm keeps meaning
           -- what kind='official' means today.
           bool_or(EXISTS (SELECT 1 FROM person_role m
                            WHERE m.person_id = g.person_id
                              AND m.source IN ('official_exec','official_muni','public_sector',
                                               'president','mep','diplomat','regulator',
                                               'magistrate'))) AS is_official
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
  //
  // ⚠️ CLASSIFIED AT THE (PERSON, EIK) GRAIN, NOT PER EIK. company_politicians.ref names the
  // person the old artifact claimed, and the question "why was this lost" is only answerable
  // about that person — an EIK-level diff can say a link went away but never whose, and a
  // refusal and a bridge bug look identical from there.
  //
  // The causes are MUTUALLY EXCLUSIVE and ordered, so they partition. The last bucket must
  // stay at zero: a loss matching none of the documented refusals is a link we dropped by
  // accident, and the plan's Tier 4 gate blocks on it.
  //
  // Measured 2026-08-20: 141 rows over 137 EIKs, and the partition closed with ZERO
  // unexplained — 68 with no registry basis at all (the old link was a pure name match) and
  // 73 refused by the name-fold gate, of which 64 are folds tr_name_fold_people never
  // measured. That table's own comment is the rule: „Absent row = unmeasured, never unique."
  const lost = await allRows<{ cause: string; rows: string; eiks: string }>(`
    ${REPLACEMENT},
    cur AS (SELECT DISTINCT eik FROM company_politicians),
    gone AS (SELECT eik FROM cur EXCEPT SELECT eik FROM arms),
    claim AS (
      SELECT cp.eik, cp.ref FROM company_politicians cp JOIN gone g ON g.eik = cp.eik),
    -- The URL-string ref, resolved to a person_id. Both formats, because that string IS the
    -- join key today (G20) — 4c replaces it with a real person_id.
    resolved AS (
      SELECT c.*,
             (SELECT pr.person_id FROM person_role pr
               WHERE (c.ref LIKE '/officials/%'
                        AND pr.ref = substring(c.ref from '^/officials/(.*)$'))
                  OR (c.ref LIKE '/candidate/mp-%' AND pr.source = 'mp'
                        AND split_part(pr.ref, ':', 1)
                            = substring(c.ref from '^/candidate/mp-(.*)$'))
               LIMIT 1) AS person_id
        FROM claim c)
    SELECT CASE
             -- ⚠️ NOT A REFUSAL. The ref is a URL STRING, so a roster re-slug breaks it
             -- and lands here — a link lost by accident wearing a refusal's label. Split
             -- out and counted as a bug, which is what load_graph_pg's per-arm preflight
             -- THROWS on.
             WHEN r.person_id IS NULL
               THEN 'UNEXPLAINED — ref does not resolve (re-slug?), do NOT ship'
             WHEN NOT EXISTS (SELECT 1 FROM person p
                               WHERE p.person_id = r.person_id
                                 AND p.status = 'active' AND p.is_public_figure)
               THEN 'person is retired or not a public figure'
             WHEN NOT EXISTS (SELECT 1 FROM tr_person_roles t JOIN person p
                                  ON p.person_id = r.person_id
                               WHERE t.uic = r.eik AND t.name_fold = p.name_fold)
               THEN 'no registry basis — the old link was a pure name match'
             WHEN NOT EXISTS (SELECT 1 FROM tr_name_fold_people f JOIN person p
                                  ON p.person_id = r.person_id
                               WHERE f.name_fold = p.name_fold)
               THEN 'name fold NEVER MEASURED (148: absent = unmeasured, never unique)'
             WHEN NOT EXISTS (SELECT 1 FROM tr_name_fold_people f JOIN person p
                                  ON p.person_id = r.person_id
                               WHERE f.name_fold = p.name_fold AND f.people_n = 1)
               THEN 'name fold SHARED by several registry people'
             -- ⚠️ THE LABEL USED TO ASSERT EXISTENCE THAT THE PREDICATE NEVER CHECKED, so a
             -- DELETED person_role row — the resolver bug load_graph_pg throws on — reported
             -- as a confidence refusal. Existence is checked first now, and its absence is a
             -- bug rather than a refusal: the registry places the person there and the person
             -- layer has no row for it.
             WHEN NOT EXISTS (SELECT 1 FROM person_role pr
                               WHERE pr.person_id = r.person_id AND pr.ref = r.eik
                                 AND pr.source IN ('tr','ngo'))
               THEN 'UNEXPLAINED — registry has the pair, person layer does not, do NOT ship'
             WHEN NOT EXISTS (SELECT 1 FROM person_role pr
                               WHERE pr.person_id = r.person_id AND pr.ref = r.eik
                                 AND pr.source IN ('tr','ngo')
                                 AND pr.confidence IN ('exact_id','high','manual'))
               THEN 'link exists but below the confidence floor'
             ELSE 'UNEXPLAINED — bridge bug, do NOT ship'
           END AS cause,
           count(*)::text AS rows,
           count(DISTINCT r.eik)::text AS eiks
      FROM resolved r
     GROUP BY 1 ORDER BY count(*) DESC`);
  const gained = await allRows<{ n: string }>(`
    ${REPLACEMENT},
    cur AS (SELECT DISTINCT eik FROM company_politicians)
    SELECT count(*)::text AS n FROM (SELECT eik FROM arms EXCEPT SELECT eik FROM cur) z`);
  console.log("── movement ────────────────────────────────────────────────");
  console.log(`  gained  ${gained[0].n} EIKs`);
  console.log("  lost, by cause (mutually exclusive, ordered):");
  for (const l of lost)
    console.log(
      `    ${l.rows.padStart(4)} rows / ${l.eiks.padStart(4)} EIKs  ${l.cause}`,
    );
  // SUMMED, not `find`. There are THREE distinct UNEXPLAINED labels — an unresolvable ref,
  // a pair the registry holds and the person layer does not, and the fall-through — and
  // reporting only the first would print a smaller number than the gate is failing by.
  const unexplained = lost
    .filter((l) => l.cause.startsWith("UNEXPLAINED"))
    .reduce((a, l) => a + Number(l.rows), 0);
  console.log(
    unexplained > 0
      ? `  ⚠️ ${unexplained} UNEXPLAINED — links dropped by ACCIDENT, not refusals. The ` +
          "plan's Tier 4 gate blocks on this being zero.\n"
      : "  ✓ every loss is a documented refusal — the Tier 4 gate is met\n",
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
     ORDER BY count(*) DESC`);
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
