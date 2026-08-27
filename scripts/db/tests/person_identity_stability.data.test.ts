// mp-party-affiliation-v1 gates 5.4 + 5.9 — populating a DISPLAY column must
// not move WHO IS WHO.
//
// This is the most dangerous interaction in the plan and the least obvious:
// nothing about the ПАРТИЯ column points at it. `cParty` already feeds
// `corroborants.party`, which cluster.ts uses for its weak (party AND place)
// merge signal. Today an MP's raw Cyrillic group short can never equal a
// candidacy's canonical id, so between those two sources the corroborant is
// inert. T2 translates the group to a canonical id AT THE WRITE precisely so it
// stays inert — doing it at the mention (`resolve_persons.ts:674`) would switch
// it on and start merging people as a side effect of a display fix.
//
// So these gates assert the ABSENCE of change. Both directions matter: a DROP
// in the person count means the crosswalk leaked into the corroborant and
// merged strangers; a RISE means something split.
//
// The baselines are the measured 2026-08-07/09 figures and are FLOORS-and-
// ceilings rather than equalities, because the corpus legitimately grows. What
// they cannot tolerate is a step change.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();

const tableExists = async (name: string) =>
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*) n FROM pg_class WHERE relname = $1`,
        [name],
      )
    )[0]?.n,
  ) > 0;

const haveIdentity = await tableExists("person");

afterAll(async () => {
  await end();
});

const skipIdentity =
  !haveDb || !haveIdentity
    ? "Postgres unreachable, or the person table is absent — run npm run db:resolve:persons"
    : false;
reportSkip(import.meta.url, skipIdentity);

test.skipIf(skipIdentity)(
  "5.9 — the active-person count did not step",
  async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person WHERE status = 'active'`,
    );
    const persons = Number(n);
    // 127,288 measured either side of the T2 resolve — unchanged, which is the
    // point. NOTE the resolver's own log line says "63340 persons": that is the
    // count BEFORE it mints 63,948 tier-V private owners, and the table holds
    // both. Reading the log number here is the mistake this comment exists to
    // prevent; it made the first draft of this gate fail on a healthy database.
    //
    // SIZING THE BAND. The hazard is bounded: `weakBoth` needs party AND place,
    // and an MP mention's `cPlace` is `currentRegion`, populated for only the 240
    // sitting members. So the worst case this gate must catch is a few hundred
    // people merging — a first draft used ±6% (~7,600), which is ~30× too loose
    // to see it. ±0.4% still absorbs a TR re-ingest moving the tier-V half by a
    // few hundred, and catches the failure mode.
    // RE-BASELINED 2026-08-11, deliberately, per the instruction in this gate's own failure
    // message. The ShareTransfers recovery (person-enrichment-v1) added 96,078 exit-only
    // shareholder rows to the TR corpus, and the resolver mints a tier-V private-owner row
    // per newly-seen owner: 63,948 → 68,796, i.e. +4,848 genuinely NEW people rather than a
    // merge/split of existing ones.
    //
    // The RESOLVED half is the control, and it did not move: 63,340 persons and 3,425 review
    // groups both before and after, which is what says the identity layer itself is unchanged
    // and only the private-owner tail grew. (An earlier run of this change DID move both —
    // 63,750 / 3,673 — because the recovered rows were inflating officer_name_counts and
    // splitting people apart. That was a defect; see 008's header. This baseline is the
    // corpus AFTER that fix, so it must not be raised again to accommodate a resolved-count
    // drift.)
    // RE-BASELINED 2026-08-14, deliberately, for the second time and for a different reason
    // than the first: the /2026/ register folder landed (18,570 filings — the годишни за
    // 2025), so the corpus gained declarants rather than gaining owners. 132,136 → 133,721.
    //
    // The attribution, which is what makes this a step and not a merge: 6,989 people have
    // their FIRST filing in the 2026 folder, and the active count rose by only 1,585. So the
    // overwhelming majority of new declarants were matched to people the layer already knew
    // (as candidates, MPs or TR owners) rather than minted — the identity layer working, and
    // the opposite of the failure this gate exists for. Nothing dropped.
    //
    // The warning above still stands and is NOT relaxed by this: do not raise the baseline to
    // absorb a resolved-count drift with no such attribution behind it.
    //
    // RE-BASELINED 2026-08-27, deliberately, for the third time — the 2026-08-25 resolve took
    // 133,721 → 134,237 (+516). The move splits across two arms:
    //
    //   tier-V private owners  68,796 → 69,138  (+342)   ATTRIBUTED: ingest_first_seen holds
    //                                                    1,885 new tr_company rows dated
    //                                                    2026-08-24, and a new company brings
    //                                                    its owners with it
    //   the resolved base      64,925 → 65,099  (+174)   NOT attributed — see below
    //
    // ⚠️ THAT THE TWO SUM IS NOT EVIDENCE OF ANYTHING, and reading it as evidence is the trap
    // this paragraph exists to disarm — an earlier draft of it led with "decomposes exactly".
    // The arms are a PARTITION (tier-V is `person` rows holding no role outside tr/ngo; the
    // base is the remainder), so `NOT EXISTS` and `EXISTS` over one predicate always sum to
    // the total, for any database state at all. A corpus in which hundreds of people had been
    // wrongly merged and hundreds more spuriously minted would sum just as exactly. Being a
    // partition also makes the two deltas NET rather than gross: a tier-V owner who acquires
    // a non-tr/ngo role moves between the arms without changing the total, so neither figure
    // is a count of new people. The sum is a check that both arms were measured over the same
    // population, and nothing more.
    //
    // ⚠️ AND THE +174 IS UNATTRIBUTED, which is recorded rather than papered over. No ingest
    // in the window explains it: `ingest_first_seen` between the last baseline and this
    // resolve holds only tr_company (2026-08-24, the tier-V arm) and council_minutes
    // (2026-08-17..22, which attaches votes to roster people and mints none). The obvious
    // candidate does NOT work — the 18,096-filing cacbg_declarations batch was already spent
    // by the PREVIOUS re-baseline: it finished at 19:42 UTC on 2026-08-14 and commit
    // 971d449481 recorded 133,721 at 20:45 UTC the same day, having measured it after that
    // batch resolved. Citing it again here would be one batch claimed for two separate moves.
    // The likeliest remaining explanations are reclassification across the partition and the
    // residue of that same drop, and neither is demonstrable from the corpus.
    //
    // ⚠️ SO THE JUSTIFICATION RESTS ON THE CONTROLS, AND THEY ARE THE PART THAT CAN FAIL.
    // A merge COLLAPSES multi-person name folds and review groups. Both grew — folds
    // 3,458 → 3,495 and review groups 3,425 → 3,464, i.e. the same direction as the total —
    // which is what new people with colliding names look like and the opposite of what this
    // gate is for. A rise in the total with a FALL in either control is not re-baselined; it
    // is investigated. Both are now asserted (5.9b, 5.9c) rather than only cited.
    //
    // Also checked before re-baselining, because each would look identical from here:
    //  · the 2026-08-25 person-layer commits (623d45c0db, b7447a5b3e) only RECORD which
    //    licence made each tr/ngo attachment (person_role.bridge / bridge_footprint). Every
    //    attach predicate — Bridge B's `n_uic <= cap`, tier-V's mint predicate and cap — is
    //    unchanged, so they cannot mint a person.
    //  · `person_elections` shows 42,511 rows first-seen on the resolve date, the largest
    //    same-day entry in the changelog. It cannot mint one either: db:load:person-elections
    //    writes only candidate_person and person_election_stats, and runs AFTER the resolver,
    //    so those rows are a CONSEQUENCE of the re-COPY that reassigns person_id.
    //
    // ⚠️ THE "BEFORE" FIGURES CANNOT BE RE-MEASURED. `person` is DELETEd and re-COPYd on
    // every resolve, so `created_at` is the RESOLVE date for every row (all 134,237 read
    // 2026-08-25 today) and the table keeps no history of its own prior state. 68,796 /
    // 64,925 / 3,458 / 3,425 survive only in this comment block. They are internally
    // consistent (63,340 + 68,796 = 132,136, matching the stated 132,136 → 133,721, and
    // 63,340 + 1,585 = 64,925), which is the only check available — so carry them forward
    // verbatim and never "correct" one from memory.
    const BASELINE = 134_237;
    const TOLERANCE = 500;
    assert.ok(
      Math.abs(persons - BASELINE) <= TOLERANCE,
      `active persons = ${persons}, more than ${TOLERANCE} from the ${BASELINE} baseline — ` +
        `if this DROPPED, check that groupShortToCanonical is applied at the WRITE and ` +
        `NOT where the MP mention sets cParty (§8c). If the corpus genuinely grew, ` +
        `re-baseline deliberately rather than widening the tolerance.`,
    );
  },
);

test.skipIf(skipIdentity)(
  "5.9b — name-fold fragmentation did not step",
  async () => {
    // The sharper signal. 3,459 folds / 9,826 rows measured 2026-08-07. Merging
    // strangers shows up here first and much more clearly than in the total,
    // because it collapses exactly the multi-person folds.
    //
    // RE-BASELINED 2026-08-27 alongside 5.9, in the same commit and on the same attribution
    // — 3,458 → 3,495 folds / 9,962 rows after the 2026-08-25 resolve. Moving the two
    // together is deliberate rather than tidy-mindedness: this number had reached 37 of its
    // 40 tolerance, so re-baselining only 5.9 would have handed the next ordinary TR refresh
    // a red 5.9b, and an operator reading THAT in isolation sees "the sharpest merge signal
    // stepped" for what is in fact the same few hundred new owners.
    //
    // ⚠️ WHICH DIRECTION IT MOVED IS THE WHOLE JUSTIFICATION, and it is the one thing a
    // future re-baseline must re-establish rather than inherit. This gate exists to catch a
    // DROP; a rise means new people whose names collide with people already known, i.e. the
    // fold count tracking the corpus. Raising this baseline to absorb a FALL would delete
    // the gate.
    //
    // ⚠️ SIGNAL-TO-NOISE, recorded because this datapoint is the first sign of it: ONE
    // ordinary resolve moved this +37 against a tolerance of 40. The band was sized when a
    // resolve moved it by ~1. So a merge collapsing up to ~37 folds, concurrent with ordinary
    // growth, now nets inside the band and passes green — the DROP sensitivity this gate is
    // named for has degraded to roughly the size of routine movement. The tolerance is
    // deliberately NOT widened, which would make it worse. If the next resolve again moves
    // this by more than 25, the fix is to make the assertion DIRECTIONAL — `folds >=
    // FOLD_BASELINE - FOLD_TOLERANCE`, letting growth run free — not a bigger symmetric band.
    // That would also end the re-baselining ritual, which is itself a hazard: each one is a
    // human decision point at which a real merge can be waved through.
    const [row] = await allRows<{ folds: string; rows: string }>(
      `SELECT count(*)::text AS folds, COALESCE(sum(n), 0)::text AS rows
       FROM (SELECT name_fold, count(*) n
               FROM person WHERE status = 'active'
              GROUP BY 1 HAVING count(*) > 1) q`,
    );
    const folds = Number(row.folds);
    const FOLD_BASELINE = 3_495;
    const FOLD_TOLERANCE = 40;
    assert.ok(
      Math.abs(folds - FOLD_BASELINE) <= FOLD_TOLERANCE,
      `${folds} multi-person name folds, more than ${FOLD_TOLERANCE} from the ` +
        `${FOLD_BASELINE} baseline (measured either side of the T2 resolve) — a DROP ` +
        `means people were merged. This is the SHARPEST signal available: a merge ` +
        `collapses exactly the multi-person folds, so it moves this number far more ` +
        `than the total.`,
    );
    // The second column was computed and never asserted, while the re-baseline note above
    // cites it as evidence — a figure quoted as proof that no machine had ever confirmed.
    // It is also independent rather than decorative: `folds` counts how many NAMES collide,
    // this counts how many PEOPLE sit in colliding folds, so a merge that takes a 3-person
    // fold down to 2 moves this and leaves the fold count untouched. 1,410 of the 3,495 folds
    // hold >= 3 people, so that class is a fifth of the population, not a hypothetical.
    // Tolerance is FOLD_TOLERANCE scaled by the same ratio (40/3,495 ≈ 1.14% of 9,962).
    const foldRows = Number(row.rows);
    const FOLD_ROWS_BASELINE = 9_962;
    const FOLD_ROWS_TOLERANCE = 120;
    assert.ok(
      Math.abs(foldRows - FOLD_ROWS_BASELINE) <= FOLD_ROWS_TOLERANCE,
      `${foldRows} people sit in multi-person name folds, more than ` +
        `${FOLD_ROWS_TOLERANCE} from the ${FOLD_ROWS_BASELINE} baseline — a DROP means ` +
        `people were merged. This moves when a fold changes SIZE without changing the fold ` +
        `COUNT, which the assertion above cannot see.`,
    );
  },
);

test.skipIf(skipIdentity)(
  "5.9c — the review-group count did not step",
  async () => {
    // The SECOND control 5.9's re-baseline rests on, and until 2026-08-27 it was cited as
    // evidence with nothing asserting it: `person_resolve.data.test.ts` checks only that a
    // review group spans >= 2 persons, never how many groups exist. So half the argument for
    // moving the baseline rested on a number no test would ever notice moving.
    //
    // A review candidate is a "these might be the same person" flag, so a merge removes the
    // question along with the duplicate and the count FALLS — the same direction as the fold
    // count, and for the same reason. It rose here (3,425 → 3,464), which is what genuinely
    // new people with colliding names produce.
    const [r] = await allRows<{ groups: string }>(
      `SELECT count(DISTINCT group_key)::text AS groups FROM person_review_candidate`,
    );
    const groups = Number(r.groups);
    const GROUP_BASELINE = 3_464;
    const GROUP_TOLERANCE = 40;
    assert.ok(
      Math.abs(groups - GROUP_BASELINE) <= GROUP_TOLERANCE,
      `${groups} review groups, more than ${GROUP_TOLERANCE} from the ${GROUP_BASELINE} ` +
        `baseline — a DROP means people were merged. Re-baseline this only alongside 5.9 ` +
        `and 5.9b, on one shared attribution: it is one of the two controls that argument ` +
        `depends on, so moving it alone would remove the evidence for moving the others.`,
    );
  },
);

test.skipIf(skipIdentity)(
  "5.4 — the party-office merge licence did not widen",
  async () => {
    // person_resolve.data.test.ts licenses a cross-source merge when a person
    // holds a `party_leader` role and another role from a different source with
    // the SAME party. Populating MP party adds rows to that join's right side, so
    // a person who is both a party leader and an MP could newly acquire a licence
    // they did not have.
    //
    // 108 party_leader roles exist (all official_exec) and 61 of those people also
    // hold an mp role — so the exposure is the normal case for a party leader,
    // not an edge case. This counts the licence directly.
    // SELF-COMPUTING, not a magic number. A first draft asserted `<= 61` — the
    // size of the *exposed* set (people holding both a party_leader and an mp
    // role). That is a different population from the metric, whose structural
    // maximum is only 58, so the assertion could not fail and proved nothing.
    //
    // Instead: compute the licence WITH every source, and again with `mp`
    // excluded from the right-hand side. If populating MP party widened the
    // licence, the two differ — and that difference is exactly the set of people
    // who newly became mergeable. No baseline to maintain, and it fails for the
    // right reason.
    const [row] = await allRows<{ withmp: string; without: string }>(
      `SELECT (SELECT count(DISTINCT office.person_id)
               FROM person_role office
               JOIN person_role other
                 ON other.person_id = office.person_id
                AND other.source <> office.source
                AND other.party = office.party
              WHERE office.role = 'party_leader'
                AND office.party IS NOT NULL)::text AS withmp,
            (SELECT count(DISTINCT office.person_id)
               FROM person_role office
               JOIN person_role other
                 ON other.person_id = office.person_id
                AND other.source <> office.source
                AND other.party = office.party
                AND other.source <> 'mp'
              WHERE office.role = 'party_leader'
                AND office.party IS NOT NULL)::text AS without`,
    );

    assert.equal(
      row.withmp,
      row.without,
      `the party-office merge licence widened by ${Number(row.withmp) - Number(row.without)} ` +
        `person(s) once MP party was populated — that is an IDENTITY change, not a ` +
        `display one. person_resolve.data.test.ts uses this licence to justify a ` +
        `cross-source merge, so a person who newly qualifies can be merged with a namesake.`,
    );

    // Floor: the metric must be measuring something.
    assert.ok(
      Number(row.withmp) > 10,
      `only ${row.withmp} licensed merges — the join stopped matching, so this gate is vacuous`,
    );
  },
);

test.skipIf(skipIdentity)(
  "5.4b — the exposed set is what we think it is",
  async () => {
    // Floors the gate above: if party_leader roles vanished, 5.4 would pass
    // vacuously while proving nothing.
    const [row] = await allRows<{ leaders: string; both: string }>(
      `SELECT (SELECT count(*) FROM person_role WHERE role = 'party_leader')::text AS leaders,
            (SELECT count(*) FROM (
               SELECT person_id FROM person_role WHERE role = 'party_leader'
               INTERSECT
               SELECT person_id FROM person_role WHERE role = 'mp') q)::text AS both`,
    );
    assert.ok(
      Number(row.leaders) > 50,
      `only ${row.leaders} party_leader role(s) — gate 5.4 has nothing to guard`,
    );
    assert.ok(
      Number(row.both) > 30,
      `only ${row.both} people hold both party_leader and mp — the exposure moved`,
    );
  },
);
