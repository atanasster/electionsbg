# Cross-party candidate identity: Велислава Иванова Петрова

Analysis, 2026-08-28. This is a plan, not an implementation. It follows the identity-spine
design in `docs/plans/person-identity-v1.md` and the resolver/publish rules in the
`update-persons` skill.

## Decision

Treat the three candidacies as one person, but do it through a **ref-scoped, audited manual
merge**, not by weakening the automatic resolver.

The current escape hatch is almost suitable: `person_link_override` can merge two name folds
and can split one source ref, but it cannot merge two specific refs. A fold merge is too broad
for this case because all people with the exact same folded name share that key. The durable
fix is to add the missing fourth operation:

```text
merge + ref_a + ref_b = these two source mentions are the same natural person
```

Two pairwise decisions then join all three candidacies transitively:

```text
2021_11_14:c-24-velislava-ivanova-petrova
    <-> 2022_10_02:c-9-velislava-ivanova-petrova

2022_10_02:c-9-velislava-ivanova-petrova
    <-> 2023_04_02:c-12-velislava-ivanova-petrova
```

This keeps the automatic policy conservative for every other same-named candidate while giving
a verified human decision the same deterministic, last-wins semantics already used by ref-level
splits.

---

## 1. What is happening now

### 1.1 The source records

The checked-in CIK candidate shards contain three non-MP candidacies:

| election   | source ref                                  | party | canonical party | МИР | list position |
| ---------- | ------------------------------------------- | ----- | --------------- | --- | ------------: |
| 2021-11-14 | `2021_11_14:c-24-velislava-ivanova-petrova` | ИТН   | `p_0`           | S24 |           107 |
| 2022-10-02 | `2022_10_02:c-9-velislava-ivanova-petrova`  | ПП    | `p_67`          | S25 |           110 |
| 2023-04-02 | `2023_04_02:c-12-velislava-ivanova-petrova` | ПП-ДБ | `p_6`           | S25 |           113 |

None has an `mpId`, so there is no Tier-0 parliament key. The data supplies only name, party,
place, election and list position; it contains no stable CIK person identifier.

### 1.2 The resolver result

Measured against local Postgres on 2026-08-28:

| person_id | slug                       | candidacy          |
| --------: | -------------------------- | ------------------ |
|     59363 | `velislava-petrova-1flnl9` | 2021 / ИТН / S24   |
|     59364 | `velislava-petrova-1sr78o` | 2022 / ПП / S25    |
|     59365 | `velislava-petrova-c65qon` | 2023 / ПП-ДБ / S25 |

All three have `namesake_risk = 3`. They are already grouped in
`person_review_candidate` under `velislava-petrova-zou4w9`, reason
`identical_fullname`. In other words, the resolver has detected the possible identity but has
correctly withheld an unsupported public merge.

Each row currently has one `candidate_person` mapping and one
`person_election_stats` row. The split is therefore upstream of the UI; deduplicating only the
`/persons` table would conceal the defect while leaving profile history, candidate links, search,
watchlists and AI routes inconsistent.

### 1.3 Why the automatic tiers do not merge them

- Tier 0 cannot fire: all three `mpId` values are null.
- Tier 1's weak corroboration requires **same canonical party and same place**. The parties
  differ in every election; 2021 also changes from S24 to S25.
- Tier 2a refuses a name-only merge because `namesake_risk` is 3, above its `<= 1` gate.
- Tier 2b deliberately excludes candidate-only components because the Court-of-Audit and MP
  people-counts do not cover unelected CIK candidates.
- Tier 3 does exactly what it should: keeps three public records and emits a review candidate.

The resolver is missing an adjudication primitive, not a party-switch heuristic.

### 1.4 Why not generalise from this example

The same local database contains:

- 2,812 `identical_fullname` review groups;
- 859 candidate-only groups;
- 290 candidate-only groups containing three or more persons.

An automatic rule such as “identical three-part name in consecutive elections” would turn a
large manual-review population into public identity assertions without a stable identifier.
Party change and movement between Sofia МИРs may be plausible continuity evidence, but neither
identifies a person independently of the name. It should help a reviewer, not license a merge.

---

## 2. Options considered

### A. Broaden Tier 1 to allow cross-party continuity — reject

Possible inputs include adjacent election dates, identical full name, adjacent МИРs, similar list
position and a plausible party transition. These are all circumstantial. They can rank the review
queue, but their conjunction is still not a stable identity key and would be especially risky on
common Bulgarian names.

### B. Use the existing fold merge with the same name on both sides — reject

`merge(nameFold, nameFold)` happens to union every component carrying that fold. It would merge
the target today, but its scope is “all present and future mentions of this exact name.” A newly
ingested namesake would be silently absorbed too. The decision being made is narrower: these three
specific candidacies are one person.

### C. Hard-code these refs in `cluster.ts` — reject

That turns data adjudication into resolver policy, is not auditable through the existing override
model, and invites a growing list of one-off identities in code.

### D. Add ref-scoped manual merge — recommended

It expresses the exact decision, composes transitively, survives resolver reruns, and leaves every
automatic safety threshold untouched. The operation is also reusable for marriage-name cases where
only selected mentions should join, or for two same-fold records whose namesakes must remain split.

### E. Obtain a source-native stable person ID — ideal, not currently available

If a future CIK dataset exposes a durable candidate identifier, ingest it as a gold key and migrate
reviewed ref merges onto that key. Until then, explicit adjudication is more honest than inferring a
key from party and geography.

---

## 3. Target design

### 3.1 Override shapes

Keep the existing table and columns, but make the supported shapes explicit:

| operation     | fields                                     | semantics                                                     |
| ------------- | ------------------------------------------ | ------------------------------------------------------------- |
| fold merge    | `kind=merge`, `fold_a`, `fold_b`           | union every component carrying either named fold              |
| **ref merge** | `kind=merge`, `ref_a`, `ref_b`             | union only the two components containing those exact mentions |
| fold split    | `kind=split`, `fold_a`, `fold_b`           | peel one fold away from the other                             |
| ref split     | `kind=split`, `ref_a` and optional `ref_b` | isolate the named mention(s)                                  |

Add an idempotent database constraint or resolver preflight that rejects mixed/incomplete shapes.
For a ref merge, both refs are mandatory. A typo must fail the resolve; it must not degrade to a
no-op that looks published.

### 3.2 Exact ref resolution

Reuse the three accepted mention keys already supported by ref splits:

- resolver mention id, such as
  `candidate:2021_11_14:c-24-velislava-ivanova-petrova`;
- bare source-native ref, such as
  `2021_11_14:c-24-velislava-ivanova-petrova`;
- source-qualified ref.

Each endpoint must resolve to exactly one mention. Zero matches or more than one match should abort
before `DELETE FROM person`, with the override id and offending ref in the error.

### 3.3 Precedence

Preserve the existing “specific correction wins” order:

1. automatic resolver groups;
2. fold merges;
3. ref merges;
4. fold splits;
5. ref splits.

A ref split must continue to veto even a manual ref merge. This makes an erroneous adjudication
reversible without deleting history.

### 3.4 Confidence and review queue

A ref-merged component spanning automatic groups gets `confidence='manual'`. After the merge, the
three target mentions map to one person, so their old `identical_fullname` review group naturally
disappears. Do not delete review rows directly; they are derived and must reconcile from the final
groups.

### 3.5 Durable, reviewable decisions

The current table survives a resolver rebuild but is instance-local. A decision inserted only into
local Postgres does not reach Cloud SQL, and a fresh database has no memory of it. Add a committed
registry, for example `data/person/link_overrides.json`, and have the resolver read it alongside
database overrides.

Each committed decision should carry:

```json
{
  "kind": "merge",
  "refA": "2021_11_14:c-24-velislava-ivanova-petrova",
  "refB": "2022_10_02:c-9-velislava-ivanova-petrova",
  "note": "Verified as the same person across an ITN -> PP candidacy change",
  "decidedBy": "operator",
  "decidedAt": "2026-08-28",
  "evidence": []
}
```

Before shipping the target entries, attach either a stable public source that connects the
candidacies or an explicit operator-adjudication note. The resolver must not fetch evidence at run
time. Deduplicate committed and DB decisions by a canonical key
`kind + sorted(endpoint pair)` so a hotfix later committed to the repository does not apply twice.

The database table remains useful for emergency/operator decisions; the committed registry is the
reproducibility layer for decisions intended to exist in local, CI and production.

### 3.6 Same-election guard

`person_election_stats` is keyed by `(person_id, election_date)` and assumes one party per person per
election. Ref-merging two different-party candidacies from the same election would currently cause
a projection collision or silent winner selection. Fail such a merge unless both mentions resolve
to the same effective party, or widen that schema in a separate project. The three target refs are
in distinct elections and are safe under the current shape.

---

## 4. Implementation plan

### Tier 0 — complete the override primitive

1. Extend `ParsedOverrides` in `scripts/person/overrides.ts` with `refMerges`.
2. Parse `kind='merge'` rows carrying both `ref_a` and `ref_b` as ref merges.
3. Resolve each endpoint uniquely and union the two containing components before any split phase.
4. Recompute confidence as `manual` when the final component spans automatic groups.
5. Update comments and the operation table in migration 081 and
   `docs/plans/person-identity-v1.md`; the existing columns are sufficient, so no destructive
   migration is required.
6. Extend `scripts/person/add_override.ts` with a clear operator form, for example:

   ```bash
   npm run person:override -- merge --ref <ref-a> --ref-b <ref-b> --note ... --by ...
   ```

7. Validate the decision shape and exact endpoint cardinality before inserting or resolving.

### Tier 1 — make adjudications reproducible

1. Add `data/person/link_overrides.json` with a schema-version field and audited entries.
2. Validate duplicate keys, missing notes, self-pairs, incomplete ref pairs and unknown kinds in a
   hermetic test.
3. Load committed and DB overrides through one normalisation path; deduplicate before
   `applyOverrides()`.
4. Add the registry to the `update-persons` skill's curated inputs and watcher mapping so changing
   it queues a re-resolve.

### Tier 2 — record this identity decision

1. Add the 2021↔2022 and 2022↔2023 ref-merge entries.
2. Run a dry/read-only resolver diagnostic that reports the proposed component before writing:
   three candidate mentions, three elections, three canonical parties, no same-election conflict.
3. Re-resolve persons and rebuild `candidate_person` / `person_election_stats`.

Expected identity result:

- one active person with three candidate roles;
- `confidence='manual'`;
- three party codes (`p_0`, `p_67`, `p_6`) and `parties_n = 3` after the persons-browser rebuild;
- one election-stat row for each of 2021-11-14, 2022-10-02 and 2023-04-02;
- the person appears under “само сменили партия”;
- the `velislava-petrova-zou4w9` review group disappears.

### Tier 3 — preserve URL continuity

All three slug locks were first seen at the same timestamp. The deterministic tie-break should
retain the 2021 anchor, `velislava-petrova-1flnl9`, and retire:

- `velislava-petrova-1sr78o`;
- `velislava-petrova-c65qon`.

Do not hard-code this outcome into the adjudication. Test the invariant instead: exactly one of the
three old slugs remains live, the other two exist in `person_slug_retired`, and both redirects land
on that same live person. This keeps the test valid if slug-lock history differs between local and
Cloud SQL.

### Tier 4 — rebuild every dependent projection

Locally, the minimum functional chain is:

```bash
npm run db:resolve:persons
npm run db:load:declarations:pg
npm run db:load:declarations:pg -- --resolve
npm run db:load:official-candidate-links:pg
npm run db:load:person-elections:pg
npm run db:load:council:pg
npm run db:load:persons-browse:pg
npm run db:gen-declarations-hub-stats
npm run db:load:person-search:pg
npm run db:load:graph:pg
npm run data:local-person-refresh
```

`db:load:council:pg` is a person-resolve dependency, not merely a council-ingest step:
`council_vote.person_id` is `ON DELETE SET NULL`, so rebuilding `person` clears every named-vote
attribution until the council loader re-resolves it. The declarations hub generator is likewise
required after `person_browse_table` because its committed headline counts are copied from that
projection.

For production, follow the full `update-persons` publish sequence rather than copying local rows.
In particular: load the place/judicial/TR-name prerequisites, run the Cloud SQL resolve, run both
declaration phases, rebuild candidate links/elections/council/persons-browse/search/graph,
regenerate the declarations hub snapshot from the serving projection, load slug redirect maps,
mint the prerender slug manifest from Cloud SQL, and stamp local-election person links from the
serving database before bucket sync.

---

## 5. Tests and gates

### 5.1 Hermetic override tests

Add cases to `scripts/person/overrides.test.ts` for:

- a ref merge joins two same-fold components without joining a third namesake;
- two ref-merge rows join three components transitively;
- a ref split applied later isolates one endpoint again;
- missing/ambiguous endpoints fail closed;
- fold merges and existing ref splits retain their present behavior;
- input order does not change the final groups or confidence.

### 5.2 Postgres override test

Extend `scripts/db/tests/person_override.data.test.ts` to insert a synthetic ref merge, load it
through the resolver's exact `SELECT`, and prove that only the selected mentions join. Keep the
existing ref-split test as the reversal gate.

### 5.3 Target regression test

Add a data test keyed on the three immutable candidacy refs, not person ids or whichever slug wins:

```sql
SELECT count(DISTINCT person_id)
FROM person_role
WHERE source = 'candidate'
  AND ref IN (...three refs...);
-- expected: 1
```

Then assert:

- exactly three target roles exist;
- they cover the expected election/party/place tuples;
- `candidate_person` maps all three slugs to that same person;
- `person_election_stats` has exactly three distinct election rows for that person;
- no review group contains more than one of the target refs/persons;
- `person_browse_table.parties_n = 3` and its code set contains all three canonical parties;
- the two retired slugs redirect to the one live slug.

The ref-keyed test is important: `person_id` is rebuilt and slugs can legitimately consolidate.

### 5.4 Corpus safety gates

Record before/after counts for:

- total persons (expected delta: `-2`);
- candidate roles (expected unchanged);
- `candidate_person` rows (expected unchanged);
- `person_election_stats` rows (expected unchanged: three elections remain three rows);
- review groups (expected delta: `-1`);
- any other automatic merge (expected none from the code change alone).

Run at least:

```bash
npm run test:unit
npm run test:person
npm run test:data
npm run build
```

The decisive safety test is a zero-diff baseline with no ref-merge entries: adding support for the
new operation must not change any existing person grouping by itself.

---

## Implementation result (2026-08-28)

Implemented in four path-scoped commits: ref-merge semantics (`db16bcaa65`), the committed audited
registry (`dd62c01f5e`), the two target decisions (`97dad0a653`), and the ref-keyed regression gate
(`2420d59b4e`). Local acceptance produced:

- persons: 65,120 → 65,118 (`-2`), with candidate roles unchanged at 125,085 total roles;
- the three target refs all map to one active person and one live slug;
- electoral rows remain distinct: ИТН 2021 (48), ПП 2022 (120), ПП-ДБ 2023 (104);
- review groups: 3,478 → 3,477, and the target identical-name review group is absent;
- exactly two historical slugs remain as direct redirects to the live slug;
- persons browser exposes `parties_n = 3` with `p_0`, `p_67`, and `p_6`;
- council attribution was restored to 43,261/46,121 named votes after the person rebuild;
- local-election person-link regeneration was churn-free (0 bundles rewritten).

Acceptance: `test:person` 261 passed / 1 skipped; `test:data` 1,905 passed / 29 skipped;
target gate 6/6; lint and production build green. The all-project `test:unit` command exited
non-zero with 12,583 passing / 31 skipped, two unrelated OG-card coverage failures, and one
database grant test timing out under full-suite contention; that database test passed 2/2 in
isolation.

---

## 6. UI acceptance

After the rebuilt data is running locally:

1. `/persons?q=Велислава+Петрова` returns one Велислава Иванова Петрова row, not three.
2. The row reports three parties and is included by “само сменили партия”.
3. The profile shows three candidacy sections in chronological order, with each election retaining
   its own party colour, МИР, list position and preference totals.
4. Each old candidate URL resolves to the same unified person profile.
5. Each of the three old `/person/...` URLs either remains canonical or redirects once to the
   canonical slug; no chain and no 404.
6. Searching/filtering by ИТН, ПП or ПП-ДБ can all find the unified person because
   `party_codes` contains the full career, while `party_primary` may remain the resolver's latest /
   most representative scalar.

Completed locally on 2026-08-28: all six checks passed. Search returns one target row with three
parties; the party-change facet narrows it to that row; the profile retains the 2021 ИТН, 2022 ПП
and 2023 ПП-ДБ candidacies; both retired person slugs land directly on the live profile; all three
candidate detail URLs show the same identity; and each of the three party facets finds it.

---

## 7. Non-goals

- Do not automatically merge the other 858 candidate-only identical-name review groups.
- Do not redefine ПП and ПП-ДБ as the same canonical party merely to create corroboration; that
  would corrupt party analysis globally and still would not connect the ИТН candidacy.
- Do not edit the three CIK source shards to invent an `mpId` or another source-native identifier.
- Do not solve the issue only in React or the persons-browser matview.
- Do not delete old slugs; retire them through the existing redirect machinery.

## Recommended delivery shape

Ship Tiers 0–3 as one identity-layer change, then run the full local gates before any Cloud SQL
mutation. The implementation is small, but the rollout is identity-sensitive: the value is in the
exact-ref scope, reproducibility, redirects and projection checks, not in the union operation alone.
