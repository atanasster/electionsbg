// Bridge B (name-based TR discovery) — the ONE definition of who is eligible and how
// big their name-matched Commerce-Registry footprint is.
//
// It lives here, apart from the resolver, because it has two consumers that must not be
// allowed to disagree: `resolve_persons.ts`, which ATTACHES the footprint, and
// `scripts/db/tests/person_slug_retired.data.test.ts`, which asserts the two guards still
// exclude somebody. Those guards are what stands between a public figure and a stranger's
// companies, so a test carrying its own near-copy of the query can go on passing while the
// writer's copy has drifted — it would be measuring a rule nobody applies.
//
// THE THREE GUARDS, all carried by the CTEs below:
//   • people-uniqueness — the fold must map to exactly ONE row of `person`. Note the
//     anti-join is over the WHOLE table, not just public 3-part people: a fold shared with
//     a private or 2-part person is ambiguous too, and dropping that scope would widen the
//     bridge.
//   • registry-uniqueness — the COMMERCE REGISTRY must record exactly one person under the
//     fold (tr_name_fold_people, migration 148). This is the guard the first two could not
//     provide: the anti-join above asks whether the fold is unique among people WE have
//     resolved, and a private namesake never enters `person` at all, so it is blind in
//     precisely the case it exists for. Replayed against the registry's own count, the
//     pre-148 rule admitted 1,995 folds the registry says are 2+ people (11.9% of the
//     eligible set) — 722 of them on prerendered pages, the largest carrying €983.3m.
//   • FOOTPRINT_CAP — at most this many distinct companies under the fold. A globally
//     unique 3-part name across a handful of firms is that one person; a bigger footprint
//     is colliding owners.
//
// ⚠️ THE REGISTRY GUARD DEMANDS POSITIVE EVIDENCE — `EXISTS (… people_n = 1)`, never
// `NOT EXISTS (… people_n > 1)`. The two differ only for a fold the counter has never
// observed (489 of the eligible set, 2.9%; the feed starts 2021-01-01 and the CR-Deeds arm
// publishes no identity key at all), and for those the second form silently means "assume
// one person". Unmeasured is not evidence of uniqueness, and this is the one bridge where
// being wrong puts a stranger's companies on a named public figure's page.
//
// An ABSENT or EMPTY tr_name_fold_people therefore mints NOTHING rather than everything.
// That is the safe direction, and resolve_persons preflights it explicitly so the operator
// gets told which loader to run instead of quietly publishing a corpus with no companies.
//
// SHAPE. `hits` is every (person_id, uic, role) an eligible person's fold matches, and
// `footprint` is the per-person distinct-company count over exactly that set. A person with
// no match never reaches `hits`, so `footprint` is implicitly n_uic >= 1 — which is where
// the lower half of the old `BETWEEN 1 AND cap` went. Both CTEs are MATERIALIZED on
// purpose; see the note in `resolve_persons.ts` for what inlining them cost.
export const FOOTPRINT_CAP = 5;

// The CTE body. Callers prepend `WITH ` and append their own final statement, which may
// read `elig`, `hits` or `footprint`. `count(DISTINCT uic)` groups by person_id rather than
// by name_fold — equivalent here, because eligibility already forces the fold to be unique
// to one person, and cheaper to join back on.
export const BRIDGE_B_CTE = `elig AS MATERIALIZED (
       SELECT p.person_id, p.name_fold
         FROM person p
        WHERE p.name_parts = 3 AND p.is_public_figure
          AND NOT EXISTS (SELECT 1 FROM person p2
                           WHERE p2.name_fold = p.name_fold
                             AND p2.person_id <> p.person_id)
          AND EXISTS (SELECT 1 FROM tr_name_fold_people f
                       WHERE f.name_fold = p.name_fold
                         AND f.people_n = 1)
     ),
     hits AS MATERIALIZED (
       SELECT e.person_id, t.uic, t.role
         FROM elig e
         JOIN tr_person_roles t ON t.name_fold = e.name_fold
     ),
     footprint AS (
       SELECT person_id, count(DISTINCT uic) AS n_uic
         FROM hits
        GROUP BY person_id
     )`;
