# person_connections association-noise guard — v2

Two changes to `084_person_connections.sql`, decided 2026-09-09 after the audit below:
unify the association-noise guard on `coowner_count`, and retire the Tier-V private arm from
`person_connections()`. `person_graph_ego()` keeps its toggle and is untouched.

## Locked decisions (2026-09-09)

1. **The default view bounds `coowner_count <= 6`, same as the private view did.** The guard's
   own written rationale is a claim about the COMPANY; `public_officer_count` measures something
   else. With the private arm retired the `CASE` disappears entirely and one bound remains.
2. **`p_include_private` is removed from `person_connections()`** — signature back to
   `person_connections(text)`. It has no product consumer and is a publicly reachable surface
   that names non-public individuals.
3. **`person_graph_ego(text, boolean)` is NOT touched.** Its toggle IS consumed (the
   `/connections` EgoPanel), and it returns the subject's own person→company star, so it names
   no third party and needs no fan-out guard. Do not "finish the job" by retiring it too.

## What is wrong today

**The guard measures the wrong quantity for its own stated purpose.** 084's header says a company
with too many co-owners "is a board / professional association / кооперация, not a business tie".
That is a property of the company. The DEFAULT view implements it as `public_officer_count <= 6`,
which asks how many of the members happen to be public figures — so a mass-membership vehicle
passes whenever few of its members are public.

Verified live on production 2026-09-08, `/api/db/person-connections?slug=andrey-ivanov-1bxuxb`
returns five connections for Андрей Ангелов Иванов, every one bridged solely by
`000703172` ФЕДЕРАЦИЯ НА НАУЧНО-ТЕХНИЧЕСКИТЕ СЪЮЗИ В БЪЛГАРИЯ — 54 co-owners, 6 public officers,
a federation of scientific-technical unions. `PersonProfileScreen` renders this and the AI
`personConnections` tool narrates it.

The graph already stores the right column. On the worst vehicles `officer_count` and
`coowner_count` agree while `public_officer_count` does not: 96/96/2 (ЖИТЕН КЛАС-98), 97/97/2
(ШИЙП ГРУП – 2016), 55/54/6 (ФЕДЕРАЦИЯ).

**The private arm has no consumer.** The `/connections` checkbox drives `graph-ego`;
`PersonProfileScreen` and `ai/tools/person.ts` both call `person-connections` without the flag.
Nothing in the repo sets `private=1` on that route. It is nonetheless live and public: from
3,128 public entry points it can name 4,302 non-public individuals. Their names are already
served by `/api/db/person-profile`, so what the arm adds is a linkage claim rather than a new
disclosure — but it buys nothing today.

## Measured cost of change 1 (local corpus, 2026-09-08)

| | today | after |
| --- | --- | --- |
| company nodes admitted as bridges | 88,880 | 87,373 |
| directed edge slots on the default path | 8,060 | 5,906 |
| subjects rendering a Connections block | 4,331 | 3,457 |

Of the 4,331 subjects with connections today: **874 (20.2%) lose the block entirely**, 98 lose
some, 3,359 are unchanged. 1,507 companies leave the admitted set. Losing the block is the
visible cost and it is the intended outcome: those subjects' only "ties" were co-membership of
a professional association.

## What this supersedes

Commit `78713dad3c` (2026-09-09) fixed `person_connections.data.test.ts` to document the SPLIT
guard. Change 1 removes the split, so parts of that commit are deliberately superseded:

- **superseded** — the "toggle keeps both-guard edges / drops public-only-guard edges" test, and
  the `coowner_count >= public_officer_count` invariant that its subset reasoning rested on.
- **carried forward, and load-bearing** — the non-vacuous picker on the over-link gate. That gate
  had never once executed: it picked the corpus-wide worst offender (`811202228`, 123 co-owners,
  **0** public officers) and then skipped because such a company can never have a public member.
  Keep the public-member requirement inside the picker.
- **becomes correct again** — with one guard, the original "must never bridge in EITHER state"
  assertion is true, because there are no longer two states.

## Step sequence (each: implement → review → repair → commit)

1. **084** — drop the `CASE` in both `subj_co` and `p_co`, leaving `cn.coowner_count <= 6`.
   Remove `p_include_private` from `person_connections` and every eligibility clause that reads
   it. Keep `DROP FUNCTION IF EXISTS person_connections(text);` AND add
   `DROP FUNCTION IF EXISTS person_connections(text, boolean);` so a re-apply is idempotent from
   either direction. Rewrite the header: the guard is one bound, and say why the ego function
   keeps its toggle.
2. **128** — update the `public_officer_count` comment. It is now a display/degree signal and no
   longer any serving guard, so nothing should read it as one.
3. **The route** — `functions/db_routes.js` `person-connections`: drop `includePrivate` and pass
   one argument. Leave `graph-ego` alone. Update the comment.
4. **The gate** — `person_connections.data.test.ts`: 1-arg helper; `reachable()` probes
   `person_connections(text)`; assert the 2-arg overload is GONE so a stale caller fails loudly;
   replace the toggle test with "a verified private person is never a subject and never an
   endpoint"; collapse the over-link gate to one arm, keeping the picker. Add a mutation check
   that restores the split body in a rolled-back transaction and asserts the mass-membership
   company DOES bridge under it, so the gate is proven to discriminate.
5. **Check `PersonConnectionCheck.tsx`** — it references `MAX_CO_OFFICERS = 6` in a comment.
   Confirm whether its own behaviour or copy depends on the old semantics; correct if so.

## Cloud

⚠️ **`deploy:db` FIRST, then the migration.** Applying 084 first drops the 2-arg overload while
the deployed route still calls it; that raises **42883**, which `missingMigration(null)` degrades
to a null body — so the Connections block silently disappears from every `/person` page until the
function ships. The reverse order is safe: a 1-arg call resolves against the old
2-arg-with-default.

```bash
npm run deploy:db                                    # 1. route calls person_connections($1)
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts 084_person_connections.sql   # 2. guard + retirement
```

084 is applied-not-loaded, so nothing carries it automatically; `db:resolve:persons:cloud` would,
but that is a multi-hour rebuild. Apply locally the same way before running the gate. No hosting
deploy is needed unless step 5 changes bundle copy; if it does, follow CLAUDE.md's three-step
order because the bundle hash moves.

## Risks

- **874 subjects lose their Connections block.** Intended, but it is a visible content change on
  a page family that is prerendered for public figures. No prerender re-mint is required, since
  the block is fetched client-side from `/api/db`.
- **`coowner_count` counts ELIGIBLE persons (public ∪ verified), not all registered officers.** A
  company whose officers are mostly unresolved could still slip under 6. `officer_count` is the
  wider measure and agrees closely on the observed offenders; revisit only with a measurement.
- **The threshold 6 is inherited, not re-derived.** This plan changes WHICH quantity is bounded,
  not the bound. Re-tuning is separate work.

## Success criteria

- `person_connections(text,boolean)` no longer exists; `person_connections(text)` does.
- No `/person` connection is bridged solely by a company with `coowner_count > 6`, on local and
  on production.
- The over-link gate EXECUTES rather than skips, and fails when the split body is restored.
- The buffer ceiling holds.
- `andrey-ivanov-1bxuxb` returns no related edges through `000703172`.

## Status — SHIPPED 2026-09-09

Steps 1-5 done and verified on local Postgres:

- `person_connections(text, boolean)` is gone, `person_connections(text)` exists,
  `person_graph_ego(text, boolean)` is untouched.
- Sampling the 400 highest-degree public figures: 327 bridge companies, **0** with
  `coowner_count > 6`.
- `andrey-ivanov-1bxuxb` returns 0 related edges, down from 5 through `000703172`.
- The over-link gate EXECUTES (no skip) and its mutation check fails when the
  `public_officer_count` guard is restored in a rolled-back transaction.
- Gates: person_connections 8/8, the three graph gates 33/33, `functions:test` 594/594,
  `npm run test:data` 2,127 passing. The one red in the full run (`sql_library`) passes in
  isolation and references none of this; it is the documented load flake.
- Step 5 needed no change: `PersonConnectionCheck` calls `/api/db/connection` and only mentions
  `person_connections` in a comment, which the unified guard makes MORE accurate rather than less.

**Deployed 2026-09-09**, in the documented order, and verified on production:

- `npm run deploy:db` first. Confirmed the new function was actually serving BEFORE touching the
  database, on a cache-busted request: `?private=1` came back ignored. The plain URL still answered
  from a stale edge entry (`x-cache: HIT`, `s-maxage=3600`), so verify this with a cache-buster or
  you will read the pre-deploy answer and conclude the deploy failed.
- `apply_functions.ts 084` against Cloud SQL: **1.1 s**, no collateral drops. It replaces two
  functions and rebuilds nothing, so there is no reader-visible window and no off-peak requirement.
- On production: `andrey-ivanov-1bxuxb` 5 related → **0**; an unaffected subject (`mp-801`) still
  returns its 6; `graph-ego` answers 200 in both toggle states; and over the 400 highest-degree
  public figures, 356 bridge companies with **0** at `coowner_count > 6`.

**No hosting deploy was needed and the three-step order did not apply.** Nothing in this change
touches `src/`, and `deploy:db` is `firebase deploy --only functions:db` with no build predeploy, so
the bundle hash cannot move. Verified either side: hosting `/` and all five function-served families
(`/person`, `/company`, `/funds/contract`, `/funds/interreg`, `/council/resolution`) serve
`index-CPHYCUWA.js`, so there was no stale-shell window to purge.

One residue, immaterial: `?private=1` responses cached at the edge before the deploy keep answering
for up to `s-maxage` (1 hour). Nothing links to that URL.
