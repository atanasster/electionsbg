// person_browse_table (120_person_browse.sql) — the matview behind the `persons` registry
// resource and the /persons browser. Plan: docs/plans/persons-browser-v1.md (§12).
//
// Every assertion below pins a failure that is SILENT — the matview populates, the page
// renders, and the numbers are quietly wrong or the column is quietly blank:
//
//   1. FAN-OUT. person_role holds 143k rows for 56.8k people. A "simplification" that
//      joins it without folding lists Пеевски seven times AND inflates the count
//      aggregate and every facet identically, with no error anywhere.
//   2. THE PLACE LABEL. place_dim (117) / judicial_body (116) empty on the target DB does
//      not error — it publishes NULL labels, and here it also empties the place FILTER,
//      which reads to a user as "there are no such people".
//   3. THE JUDICIAL TWO-HOP. A judicial place_code is a body_code, not a place. Drop the
//      hop and all 2,676 magistrates silently leave the oblast filter.
//   4. TWO "PRIMARY POST" RULES. If role_prominence() and 100_officials_rankings.sql
//      disagree, /persons and /officials/assets label the same human differently.
//   5. A SECOND MONEY BASIS. public_money_eur computed without the consortium-member
//      exclusion, or on the pre-annex basis, disagrees with the person's own profile.
//   6. THE MULTI-VALUE FILTER TARGETS. Filtering on a representative scalar instead of
//      its code set drops 1,851 people from an oblast they genuinely serve.
//
// Counts quoted are snapshots as of 2026-07; assertions are invariants or ceilings so a
// ±1 drift does not fail the suite.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";
import { OFFICIAL_DECLARATION_SOURCES } from "@/lib/officialSources";

// Test 11 REFRESHes the matview, so this file must never run against a Cloud SQL proxy URL
// left in the shell by db:dump:cloud — lib/pg.ts documents that as a real recurring state.
pinLocalDatabase();

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** "No server" is a SKIP. "Server up, relation gone" is a FAILURE — and the distinction is
 *  the whole point: 090's `DROP … CASCADE` reaches person_browse_table on every
 *  declarations `--resolve`, so collapsing both into "unreachable" would make this suite go
 *  green at exactly the moment the thing it guards had been destroyed. */
const state = async (): Promise<"ok" | "no-server" | "missing" | "empty"> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_browse_table') IS NOT NULL AS ok",
    );
    if (!t?.ok) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_browse_table",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    return "no-server";
  }
};

const dbState = await state();
const skip = dbState === "no-server" ? "Postgres unreachable" : false;

// Not skipped, and deliberately outside the skipIf guard above: if Postgres is up and the
// matview is absent or empty, that is the FINDING, not a reason to stand down.
test.skipIf(dbState === "no-server")(
  "person_browse_table exists and is populated",
  () => {
    assert.equal(
      dbState,
      "ok",
      dbState === "missing"
        ? "person_browse_table does not exist — 090's DROP … CASCADE takes it on every declarations --resolve, so load_declarations_pg.ts must re-apply 120 in the same run"
        : "person_browse_table exists but is empty",
    );
  },
);

// The re-apply that keeps the CASCADE from outliving a run. Asserted against the source
// because the runtime symptom (an absent matview) is precisely what this file cannot
// observe once it has been skipped.
test("load_declarations_pg.ts re-applies 120 after 090's CASCADE", () => {
  const src = readFileSync(
    path.join(ROOT, "scripts/db/load_declarations_pg.ts"),
    "utf8",
  );
  assert.match(
    src,
    /120_person_browse\.sql/,
    "person_browse_table depends on person_wealth_year, whose DROP … CASCADE runs on every --resolve — but load_declarations_pg.ts never re-applies 120, so a resolve leaves /persons with no table",
  );
});

const count = async (sql: string, params: unknown[] = []): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql, params);
  return Number(r.n);
};

afterAll(async () => {
  await end();
});

// (1) ONE ROW PER PERSON — the fan-out invariant, and the single most important gate in
// this feature. Asserted as an exact equality against the gated person set, not as a
// ceiling: a fan-out shows up as MORE rows, and "more rows" is precisely what a ceiling
// written generously would tolerate.
test.skipIf(skip)("one row per public person, no role fan-out", async () => {
  const rows = await count("SELECT count(*) n FROM person_browse_table");
  const slugs = await count(
    "SELECT count(DISTINCT slug) n FROM person_browse_table",
  );
  assert.equal(rows, slugs, "slug is not unique — the matview has fanned out");

  // Every gated person WITH a public-safe role, and only those.
  const eligible = await count(
    `SELECT count(DISTINCT p.person_id) n
       FROM person p
       JOIN person_role r ON r.person_id = p.person_id
                         AND r.confidence IN ('exact_id','high','manual')
      WHERE p.status = 'active' AND p.is_public_figure`,
  );
  assert.equal(
    rows,
    eligible,
    `matview has ${rows} rows for ${eligible} eligible persons — it is fanning out over person_role or dropping people`,
  );
});

// (2) THE PRIVACY GATE, applied by the matview itself rather than by its callers.
test.skipIf(skip)(
  "no review-status or non-public person is served",
  async () => {
    const leaked = await count(
      `SELECT count(*) n FROM person_browse_table b
       JOIN person p ON p.slug = b.slug
      WHERE p.status <> 'active' OR NOT p.is_public_figure`,
    );
    assert.equal(leaked, 0, `${leaked} gated person(s) reached the browser`);
  },
);

// (3) THE PLACE LABEL — the empty-dimension guard. A row carrying a place_code with no
// label means place_dim/judicial_body were empty when the matview was built.
test.skipIf(skip)(
  "every placed row carries a label and an oblast",
  async () => {
    const unlabelled = await count(
      `SELECT count(*) n FROM person_browse_table
      WHERE place_code IS NOT NULL AND place_label IS NULL`,
    );
    assert.equal(
      unlabelled,
      0,
      `${unlabelled} row(s) have a place_code but no place_label — place_dim (117) / judicial_body (116) were empty when this was built`,
    );

    // (3b) THE JUDICIAL TWO-HOP. Without it this is ~2,676 (every magistrate), which is why
    // the assertion is on the placed set as a whole rather than on judicial rows alone —
    // it fails loudly for the same reason either way.
    const noOblast = await count(
      `SELECT count(*) n FROM person_browse_table
      WHERE place_code IS NOT NULL AND oblast_code IS NULL`,
    );
    assert.equal(
      noOblast,
      0,
      `${noOblast} placed row(s) have no oblast_code — the judicial two-hop (place_code -> judicial_body -> place_dim) is missing or a place_dim row lost its oblast`,
    );

    const judicial = await count(
      `SELECT count(*) n FROM person_browse_table WHERE place_kind = 'judicial'`,
    );
    assert.ok(
      judicial > 2000,
      `only ${judicial} judicial rows — magistrates have stopped resolving to a body`,
    );
  },
);

// (4) MULTI-VALUE FILTER TARGETS. The scalar is for display; the padded code set is what
// the filter matches. The set must contain the scalar, and it must be PADDED — an
// unpadded set makes ILIKE '%ngo%' match 'ngo_board' and the filter over-selects.
test.skipIf(skip)("code sets contain their scalar and are padded", async () => {
  // `_` is a LIKE single-character wildcard and these values are full of it (`p_16`,
  // `SOFIA_CITY`, `chief_architect`). Unescaped, the containment test below is not one —
  // a value differing only at an `_` position would pass. Escaped, it is exact. The
  // registry filter that ships in T1 needs the same treatment.
  const esc = (col: string) =>
    `replace(replace(${col}, '\\', '\\\\'), '_', '\\_')`;

  const oblastGap = await count(
    `SELECT count(*) n FROM person_browse_table
      WHERE oblast_code IS NOT NULL
        AND oblast_codes NOT LIKE '% ' || ${esc("oblast_code")} || ' %'`,
  );
  assert.equal(
    oblastGap,
    0,
    `${oblastGap} row(s) have oblast_code ∉ oblast_codes`,
  );

  const partyGap = await count(
    `SELECT count(*) n FROM person_browse_table
      WHERE party_primary IS NOT NULL
        AND party_codes NOT LIKE '% ' || ${esc("party_primary")} || ' %'`,
  );
  assert.equal(
    partyGap,
    0,
    `${partyGap} row(s) have party_primary ∉ party_codes`,
  );

  // NULL slips through every NOT LIKE above (`NULL NOT LIKE x` is NULL, not true), and a
  // NULL code set would drop the person from the code-set filter entirely. role/facet are
  // NOT NULL upstream and the top_role join is INNER, so this should be structurally
  // impossible — which is exactly the kind of assumption worth pinning.
  const nullSets = await count(
    `SELECT count(*) n FROM person_browse_table
      WHERE role_codes IS NULL OR facet_codes IS NULL`,
  );
  assert.equal(
    nullSets,
    0,
    `${nullSets} row(s) have a NULL role_codes/facet_codes — those people vanish from the code-set filters`,
  );

  const unpadded = await count(
    `SELECT count(*) n FROM person_browse_table
      WHERE role_codes   NOT LIKE ' %' OR role_codes   NOT LIKE '% '
         OR facet_codes  NOT LIKE ' %' OR facet_codes  NOT LIKE '% '
         OR (party_codes  IS NOT NULL AND (party_codes  NOT LIKE ' %' OR party_codes  NOT LIKE '% '))
         OR (oblast_codes IS NOT NULL AND (oblast_codes NOT LIKE ' %' OR oblast_codes NOT LIKE '% '))`,
  );
  assert.equal(
    unpadded,
    0,
    `${unpadded} row(s) carry an unpadded code set — '% ngo %' would match 'ngo_board' and the filter silently over-selects`,
  );

  // The multi-oblast population is the reason oblast_codes exists at all. If it collapses
  // to zero, someone has folded the set down to the representative value.
  const multi = await count(
    `SELECT count(*) n FROM person_browse_table
      WHERE oblast_codes IS NOT NULL AND oblast_codes LIKE '% % % %'`,
  );
  assert.ok(
    multi > 1000,
    `only ${multi} people span 2+ oblasts (expected ~1,851) — oblast_codes has collapsed to the scalar`,
  );
});

// (5) ONE "PRIMARY POST" RULE. Restricted to the six Court-of-Audit officials sources,
// role_prominence() must pick the same role 100_officials_rankings.sql picks. Both order
// by (source priority, start_date DESC NULLS LAST, ref), so this holds by construction —
// which is exactly why it needs a test: the equality is invisible in either file alone.
test.skipIf(skip)(
  "prominence agrees with officials_rankings on the shared set",
  async () => {
    const [r] = await allRows<{ compared: string; disagreements: string }>(
      `WITH mine AS (
       SELECT DISTINCT ON (r.person_id) r.person_id, r.role
         FROM person_role r
         JOIN person p ON p.person_id = r.person_id
                      AND p.status = 'active' AND p.is_public_figure
        WHERE r.confidence IN ('exact_id','high','manual')
          AND r.source IN ('official_exec','official_muni','public_sector',
                           'president','mep','diplomat')
        ORDER BY r.person_id,
                 role_prominence(r.source, r.role) DESC,
                 r.start_date DESC NULLS LAST, r.ref
     )
     SELECT count(*) AS compared,
            count(*) FILTER (WHERE mine.role <> o.category) AS disagreements
       FROM mine
       JOIN person p ON p.person_id = mine.person_id
       JOIN officials_rankings_table o ON o.slug = p.slug`,
    );
    assert.ok(Number(r.compared) > 10000, "the comparison set has collapsed");
    assert.equal(
      Number(r.disagreements),
      0,
      `${r.disagreements} person(s) get a different primary post from role_prominence() than from 100_officials_rankings.sql — /persons and /officials/assets would label them differently`,
    );

    // The SHIPPED primary_role is picked across ALL sources, so it does diverge from the
    // officials category — for 494 people, every one of them an MP, because `mp` outranks
    // every officials source by design. Pin that: the divergence set must be exactly the
    // MPs. A non-MP appearing here means the ordering slipped somewhere else.
    const nonMp = await count(
      `SELECT count(*) n FROM person_browse_table b
       JOIN officials_rankings_table o ON o.slug = b.slug
      WHERE b.primary_role IS DISTINCT FROM o.category AND NOT b.is_mp`,
    );
    assert.equal(
      nonMp,
      0,
      `${nonMp} non-MP(s) have a primary_role differing from their officials category — only the deliberate mp-outranks-officials case may diverge`,
    );
  },
);

// (6) is_exec / is_muni are MEMBERSHIP flags mirroring officials_rankings_table, and the
// source list is the SQL mirror of OFFICIAL_DECLARATION_SOURCES — not a `source LIKE
// 'official%'` test, which drops president/mep/diplomat (227 people).
//
// COUPLING, so the next reader diagnoses a failure in seconds: this and test 5 compare 120
// (which restricts to confidence IN exact_id/high/manual) against officials_rankings_table
// (which applies NO confidence filter). Today every person_role row is `high` or
// `exact_id`, so the two populations are identical and the equality holds trivially. The
// first officials role the resolver parks at `medium`/`review` will break these counts for
// a DATA reason, not the code reason the messages name — check
// `SELECT confidence, count(*) FROM person_role GROUP BY 1` before hunting the source list.
test.skipIf(skip)(
  "is_exec/is_muni are in lockstep with officials_rankings",
  async () => {
    const [r] = await allRows<{
      b_exec: string;
      o_exec: string;
      b_muni: string;
      o_muni: string;
    }>(
      `SELECT (SELECT count(*) FROM person_browse_table WHERE is_exec)      AS b_exec,
            (SELECT count(*) FROM officials_rankings_table WHERE is_exec) AS o_exec,
            (SELECT count(*) FROM person_browse_table WHERE is_muni)      AS b_muni,
            (SELECT count(*) FROM officials_rankings_table WHERE is_muni) AS o_muni`,
    );
    assert.equal(
      r.b_exec,
      r.o_exec,
      "is_exec disagrees with officials_rankings_table",
    );
    assert.equal(
      r.b_muni,
      r.o_muni,
      "is_muni disagrees with officials_rankings_table",
    );

    // The non-prefix sources specifically: if someone rewrites the SQL list as
    // `source LIKE 'official%'`, these people keep their row but lose is_exec.
    const nonPrefix = [...OFFICIAL_DECLARATION_SOURCES].filter(
      (s) => !s.startsWith("official"),
    );
    assert.ok(
      nonPrefix.length > 0,
      "officialSources.ts no longer declares any non-`official*` officials source — this guard has nothing left to protect",
    );
    const dropped = await count(
      `SELECT count(*) n
       FROM person_browse_table b
       JOIN person p ON p.slug = b.slug
      WHERE NOT b.is_exec
        AND EXISTS (SELECT 1 FROM person_role r
                     WHERE r.person_id = p.person_id
                       AND r.confidence IN ('exact_id','high','manual')
                       AND r.source = ANY($1::text[]))`,
      [nonPrefix],
    );
    assert.equal(
      dropped,
      0,
      `${dropped} president/MEP/diplomat(s) are not flagged is_exec — the source list has been narrowed to a 'official%' prefix test`,
    );
  },
);

// (7) ONE MONEY BASIS. The browser figure must equal the profile's own procuredEur sum
// for the same person — same basis (post-annex, tag='contract', consortium members
// excluded), no second computation. Sampled over the largest figures, where a basis
// difference is both most likely and most damaging.
test.skipIf(skip)(
  "public_money_eur reconciles with the person profile",
  async () => {
    const rows = await allRows<{
      slug: string;
      browse: string | null;
      profile: string | null;
    }>(
      `WITH sample AS (
       SELECT slug, public_money_eur
         FROM person_browse_table
        WHERE public_money_eur IS NOT NULL
        ORDER BY public_money_eur DESC LIMIT 25
     )
     SELECT s.slug,
            s.public_money_eur::text AS browse,
            (SELECT round(sum((c->>'procuredEur')::numeric), 2)
               FROM jsonb_array_elements(person_by_slug(s.slug)->'companies') c
              WHERE c->>'procuredEur' IS NOT NULL)::text AS profile
       FROM sample s`,
    );
    assert.ok(rows.length > 0, "no money-carrying persons to reconcile");
    for (const r of rows) {
      assert.equal(
        r.browse,
        r.profile,
        `${r.slug}: browser says ${r.browse}, the profile says ${r.profile} — two money bases have appeared`,
      );
    }

    // The money column is NOT additive across rows (co-officers of one company each carry
    // its full sum), so nothing may declare it as a sum aggregate. To be guarded in
    // functions/db_table.test.js when the `persons` registry entry lands in T1 —
    // `public_money_eur` must not carry `agg: "sum"`. Noted here because this is where the
    // reason lives, not because the guard exists yet.
    const carriers = await count(
      `SELECT count(*) n FROM person_browse_table WHERE public_money_eur IS NOT NULL`,
    );
    assert.ok(
      carriers > 500 && carriers < 5000,
      `${carriers} people carry ЗОП money (expected ~1,070) — the TR bridge or the contract basis has shifted`,
    );
  },
);

// (8) tr_link_basis says how the link was ESTABLISHED. 'declared' means EVERY contributing
// company is curated; 'mixed' means only some are; 'name_match' means none. Anything that
// is not 'declared' carries the namesake caveat on screen, so a wrongly-'declared' row is
// a dropped warning over partly name-derived money.
//
// The Bridge-A join below is deliberately RE-DERIVED here rather than imported from the
// matview: a test that reused 120's own CTE would validate nothing, because a change to
// that CTE would silently redefine what `declared` means and the test would follow it. Do
// not "DRY this up" — the duplication is the guard.
test.skipIf(skip)(
  "tr_link_basis='declared' is backed by a curated link",
  async () => {
    const wrong = await count(
      `WITH bridge_a AS (
       SELECT DISTINCT pr.person_id
         FROM company_politicians cp
         JOIN person_role pr
           ON (cp.kind = 'mp' AND pr.source = 'mp'
               AND pr.ref = replace(cp.ref, '/candidate/mp-', ''))
           OR (cp.kind = 'official'
               AND pr.source IN ('official_exec','official_muni','public_sector')
               AND pr.ref = replace(cp.ref, '/officials/', ''))
       UNION
       SELECT DISTINCT pr.person_id
         FROM magistrate_company mc
         JOIN person_role pr ON pr.source = 'magistrate' AND pr.ref = mc.magistrate_name
        WHERE mc.eik IS NOT NULL AND NOT mc.eik_ambiguous
     )
     SELECT count(*) n
       FROM person_browse_table b
       JOIN person p ON p.slug = b.slug
      WHERE b.tr_link_basis = 'declared'
        AND NOT EXISTS (SELECT 1 FROM bridge_a a WHERE a.person_id = p.person_id)`,
    );
    assert.equal(
      wrong,
      0,
      `${wrong} row(s) claim a 'declared' TR link with nothing curated behind it — the page would drop the namesake caveat on a name-matched company`,
    );

    // The direction the one-way implication above CANNOT catch: 'declared' must mean ALL
    // contributing companies are curated, not merely one of them. A person holding one
    // declared company and four name-matched ones renders no caveat if this regresses to
    // bool_or — over money that is mostly name-derived.
    const mixedAsDeclared = await count(
      `WITH person_company AS (
       SELECT p.slug, r.ref AS uic
         FROM person_role r
         JOIN person p ON p.person_id = r.person_id
                      AND p.status = 'active' AND p.is_public_figure
        WHERE r.source = 'tr' AND r.confidence IN ('exact_id','high','manual')
        GROUP BY 1, 2
     ),
     bridge_a AS (
       SELECT DISTINCT pr.person_id, cp.eik AS uic
         FROM company_politicians cp
         JOIN person_role pr
           ON (cp.kind = 'mp' AND pr.source = 'mp'
               AND pr.ref = replace(cp.ref, '/candidate/mp-', ''))
           OR (cp.kind = 'official'
               AND pr.source IN ('official_exec','official_muni','public_sector')
               AND pr.ref = replace(cp.ref, '/officials/', ''))
       UNION
       SELECT DISTINCT pr.person_id, mc.eik
         FROM magistrate_company mc
         JOIN person_role pr ON pr.source = 'magistrate' AND pr.ref = mc.magistrate_name
        WHERE mc.eik IS NOT NULL AND NOT mc.eik_ambiguous
     )
     SELECT count(*) n FROM (
       SELECT pc.slug
         FROM person_company pc
         JOIN person p ON p.slug = pc.slug
         JOIN person_browse_table b ON b.slug = pc.slug
         LEFT JOIN bridge_a a ON a.person_id = p.person_id AND a.uic = pc.uic
        WHERE b.tr_link_basis = 'declared'
        GROUP BY pc.slug
       HAVING bool_or(a.uic IS NULL)
     ) x`,
    );
    assert.equal(
      mixedAsDeclared,
      0,
      `${mixedAsDeclared} row(s) are marked 'declared' while holding at least one name-matched company — they should be 'mixed' and keep the caveat`,
    );

    // All three populations must exist, or the flag has collapsed and every row renders the
    // same. 'mixed' is the small one (~8 people) and the first to disappear if bool_and
    // regresses to bool_or.
    const [b] = await allRows<{
      declared: string;
      mixed: string;
      named: string;
    }>(
      `SELECT count(*) FILTER (WHERE tr_link_basis = 'declared')   AS declared,
            count(*) FILTER (WHERE tr_link_basis = 'mixed')      AS mixed,
            count(*) FILTER (WHERE tr_link_basis = 'name_match') AS named
       FROM person_browse_table`,
    );
    assert.ok(Number(b.declared) > 0, "no 'declared' TR links at all");
    assert.ok(Number(b.named) > 0, "no 'name_match' TR links at all");
    assert.ok(
      Number(b.mixed) > 0,
      "no 'mixed' TR links — the three-value flag has collapsed back to bool_or, dropping the caveat on mixed footprints",
    );
  },
);

// (8b) PHOTOS come from two sources joined on two DIFFERENT keys — mp_profile by
// mp_id::text, official_candidate_link by official_slug — with MP winning the COALESCE. If
// either convention drifts (a zero-padded mp_id, a re-slugged official) the column just
// empties, which no other assertion here would notice.
test.skipIf(skip)("photos resolve on both join keys, MP first", async () => {
  const photos = await count(
    "SELECT count(*) n FROM person_browse_table WHERE photo_url IS NOT NULL",
  );
  assert.ok(
    photos > 1500,
    `only ${photos} rows carry a photo (expected ~2,174) — an mp_profile / official_candidate_link join key has drifted`,
  );

  // Every MP with a parliament photo must show ONE OF THEIRS, never an officials-side one.
  //
  // "One of" is not looseness: two people (mp-2461, mp-3861) hold TWO mp_profile records
  // each — the same human seated under two mp_ids across parliaments — so demanding
  // equality with *every* candidate photo fails on them by construction. The matview picks
  // deterministically (lowest mp_id); this asserts the pick came from the MP source at all,
  // which is what the COALESCE precedence actually guarantees.
  const wrongOrder = await count(
    `SELECT count(*) n
       FROM person_browse_table b
       JOIN person p ON p.slug = b.slug
      WHERE EXISTS (
              SELECT 1 FROM person_role r
                JOIN mp_profile m ON m.mp_id::text = r.ref
               WHERE r.person_id = p.person_id AND r.source = 'mp'
                 AND r.confidence IN ('exact_id','high','manual')
                 AND m.photo_url IS NOT NULL)
        AND NOT EXISTS (
              SELECT 1 FROM person_role r
                JOIN mp_profile m ON m.mp_id::text = r.ref
               WHERE r.person_id = p.person_id AND r.source = 'mp'
                 AND r.confidence IN ('exact_id','high','manual')
                 AND m.photo_url = b.photo_url)`,
  );
  assert.equal(
    wrongOrder,
    0,
    `${wrongOrder} MP(s) show a photo that is not any of their mp_profile ones — the COALESCE precedence has flipped to the officials side`,
  );
});

// (8c) held_office is a DENY-list of the four non-office sources, so a person holding ANY
// post is true regardless of what else they are. The complement is the candidate-only long
// tail. Both populations must be substantial, or the flag has collapsed and the "held
// office only" toggle either does nothing or empties the table.
test.skipIf(skip)(
  "held_office reflects any office role, not the primary one",
  async () => {
    const held = await count(
      "SELECT count(*) n FROM person_browse_table WHERE held_office",
    );
    const notHeld = await count(
      "SELECT count(*) n FROM person_browse_table WHERE NOT held_office",
    );
    assert.ok(
      held > 20000,
      `only ${held} people held office (expected ~31,971)`,
    );
    assert.ok(
      notHeld > 10000,
      `only ${notHeld} never held office (expected ~24,830)`,
    );

    // Anyone with an office-source role must be flagged, whichever role won the
    // representative slot — the failure an allow-list of offices would produce.
    const missed = await count(
      `SELECT count(*) n
       FROM person_browse_table b
       JOIN person p ON p.slug = b.slug
      WHERE NOT b.held_office
        AND EXISTS (SELECT 1 FROM person_role r
                     WHERE r.person_id = p.person_id
                       AND r.confidence IN ('exact_id','high','manual')
                       AND r.source NOT IN ('candidate','tr','ngo','donor'))`,
    );
    assert.equal(
      missed,
      0,
      `${missed} person(s) hold an office-source role but are not flagged held_office`,
    );

    // And nobody is flagged on the strength of a candidacy / company / NGO / donation alone.
    const overreach = await count(
      `SELECT count(*) n
       FROM person_browse_table b
       JOIN person p ON p.slug = b.slug
      WHERE b.held_office
        AND NOT EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id
                           AND r.confidence IN ('exact_id','high','manual')
                           AND r.source NOT IN ('candidate','tr','ngo','donor'))`,
    );
    assert.equal(
      overreach,
      0,
      `${overreach} person(s) are flagged held_office with no office role at all`,
    );
  },
);

// (9) THE MIX-BAR PARTITION. primary_facet is single-valued and total: the "Тип лице" bar
// is a partition, so its segments must sum to the row count. The boolean flags overlap by
// design and cannot serve this — which is why the column exists.
test.skipIf(skip)("primary_facet partitions the whole table", async () => {
  const total = await count("SELECT count(*) n FROM person_browse_table");
  const [g] = await allRows<{ n: string }>(
    `SELECT COALESCE(sum(c), 0) n FROM (
       SELECT count(*) c FROM person_browse_table
        WHERE primary_facet IS NOT NULL GROUP BY primary_facet) x`,
  );
  assert.equal(
    Number(g.n),
    total,
    "primary_facet is NULL for some rows — the mix bar would not sum to the table",
  );
});

// (10) SEARCH WORKS IN CYRILLIC. The registry searches the transliterated fold, so the
// term must be folded too; `searchCol` without `searchFold` matches Cyrillic against
// Latin and returns nothing, forever. That bug is invisible to any schema-only assertion.
test.skipIf(skip)("a Cyrillic name term matches via the fold", async () => {
  const hits = await count(
    `SELECT count(*) n FROM person_browse_table
      WHERE name_fold ILIKE '%' || translit_bg_latin($1) || '%'`,
    ["Иван"],
  );
  assert.ok(
    hits > 100,
    `a folded search for "Иван" returned ${hits} rows — the fold pipeline is broken`,
  );

  // And the raw-term arm returns nothing, which is the actual trap: it looks like a
  // working query and is simply always empty.
  const raw = await count(
    "SELECT count(*) n FROM person_browse_table WHERE name_fold ILIKE $1",
    ["%Иван%"],
  );
  assert.equal(
    raw,
    0,
    "a raw Cyrillic ILIKE against name_fold matched rows — name_fold is no longer transliterated, so the registry's searchFold flag is now wrong",
  );
});

// (11) DETERMINISM. Every representative scalar is picked with an explicit tiebreak, so a
// rebuild must reproduce the same row exactly. A drifting pick changes a rendered chip
// between refreshes for no visible reason (reference_pg_payload_determinism).
test.skipIf(skip)(
  "representative picks are stable across a rebuild",
  async () => {
    const snap = async () =>
      allRows<{ slug: string; sig: string }>(
        `SELECT slug,
              concat_ws('|', primary_role, primary_facet, party_primary,
                             place_kind, place_code, oblast_code) AS sig
         FROM person_browse_table
        WHERE parties_n > 1 OR oblast_codes LIKE '% % % %'
        ORDER BY slug LIMIT 200`,
      );
    const before = await snap();
    assert.ok(
      before.length > 0,
      "no multi-valued people to test determinism on",
    );
    await allRows("REFRESH MATERIALIZED VIEW CONCURRENTLY person_browse_table");
    const after = await snap();
    assert.deepEqual(
      after,
      before,
      "the representative role/party/place changed across a REFRESH — a tiebreak is missing",
    );
  },
);
