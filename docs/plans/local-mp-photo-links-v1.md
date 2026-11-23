# Local-election MP photo links — require an exact full-name match (v1)

## Problem

`scripts/parsers_local/decorate_local_mp_links.ts` stamps `mpId` on local-election candidate
rows (mayor R1/R2/elected, council, kmetstva, districts) so `MpAvatar` shows the parliament.bg
portrait. Its lookup is `byFull.get(full) ?? byFirstLast.get(firstLast)`. The first+last
fallback fires whenever the middle names differ, which in Bulgarian names means a different
father, i.e. a different person. „Валери Димов Вълков" gets MP „Валери Стефанов Вълков"'s photo.

Measured 2026-10-21 over all 68 local cycles in `data/`:

| unit | stamped | wrong person (full name ≠ MP's) |
| --- | --- | --- |
| candidate rows | 17,374 of 150,252 | **11,991 (69%)** |
| distinct (name, mpId) pairs | 5,262 | **4,419 (84%)** |

(The earlier report said 3,536 of 4,965. It was counted on an older corpus and possibly on a
different unit. The direction is the same.)

The other signals are clean:

- Of the misses, 1 candidate has a two-part name and 0 MPs do, so this is not a case of one
  source dropping a patronymic. The fallback's stated reason does not show up in the data.
- 4-part names (hyphenated double surnames such as „Милева-Георгиева") already match on the
  full key, because `normalise` folds `-` to a space. They are kept.
- `data/parliament/index.json` has 0 full-name collisions today. The decorator still breaks
  ties by "photo wins", which would quietly pick one namesake if a collision ever appeared.

## Why removing the stamp is enough on the frontend

`MpAvatar` resolves `findMpById(mpId) ?? findMpByName(name)`. `findMpByName` is an EXACT
full-name lookup (`normalizeMpName`: case, whitespace and hyphen spacing only). So once a row
loses its wrong `mpId`, the fallback finds nothing and the row shows initials. Rows that match
exactly keep the same MP either way. No frontend change is needed.

## Fix

1. **Matcher** (`decorate_local_mp_links.ts`). Delete `firstLastKey` / `byFirstLast`. Match only
   on `normalise(fullName)`, and only when that key maps to exactly ONE MP. Count the collisions
   and drop any key that has them, instead of letting photo-wins choose. Also require at least 2
   tokens. Move the index build and lookup into a small pure module
   (`scripts/parsers_local/mpNameMatch.ts`) so the rule can be unit-tested without the CLI's
   `run()`. Update the header comment: it claims to mirror the officials decorator's
   first+last fallback, and that is the defect.
2. **Stats line**. Print, per cycle, `stamped`, `removed (previously stamped, no longer
   matches)` and `ambiguous keys skipped`, so the one-time drop of ~12k rows reads as intended.
3. **Tests**
   - Unit (`mpNameMatch.test.ts`): middle-name mismatch → no match; exact → match; hyphenated
     4-part name → match; a key held by two MPs → no match (mutation check: with the
     ambiguity guard stubbed out the same input must match); two-part name vs three-part MP →
     no match.
   - Data gate (`scripts/parsers_local/local_mp_links.data.test.ts`, next to
     `local_bundles.data.test.ts`): for every stamped row in every bundle,
     `normalise(row name) === normalise(index[mpId].normalizedName)` and that key is unique in
     the index. Skip with its own reason when `data/<cycle>/municipalities` or the parliament
     index is absent (fresh clone).
4. **Regenerate the downstream copies**. `mpId` is copied out of the bundles by three builders,
   and all three outputs are gitignored and served from the bucket:
   - `build_region_json.ts` → per-cycle rollups (`npm run data -- --local --local-date <cycle>`
     path, or whatever entry point `buildLocalRollups` runs from in `main.ts`; confirm while
     implementing)
   - `build_chmi_history.ts` → `data/local_chmi_history.json`
   - `reports/local/build_local_place_trends.ts` → `data/local_place_trends/`
     (`npm run data -- --local-place-trends`)
5. **Publish**: `bucket:sync` the bundles, rollups, `local_chmi_history.json` and
   `local_place_trends/`. Nothing reaches Postgres and nothing needs `deploy`/`deploy:db`.
   Verify on the live site: open a município whose candidate previously carried a mismatched
   `mpId` (pick one from the dry-run list) and confirm it shows initials.

## Regression risk

A correct link can be lost only if CIK and parliament.bg spell the SAME person's full name
differently beyond case, diacritics, whitespace and hyphens (for example a transliterated
patronymic). The rule would then show initials instead of a face. That fails safe, and the
fix's own dry run can list how often it happens: a stamped-before, unstamped-after row whose
first+last still matches an MP with a one-letter middle-name difference. Review that list
once before writing. Do not reintroduce a fuzzy tier to recover those rows.

## Residual risk (not fixed here)

An exact three-part match still is not identity. About 843 distinct pairs remain, and common
names (for example „Георги Иванов Георгиев") can be namesakes. This plan removes the
provably-wrong links only. A plausibility check (MP's `seatedRegion` vs the município's oblast)
could later *report* suspicious exact matches, but it should not gate them: MPs often run
locally outside their constituency.

## Part B — the officials candidate-link join (`candidate_link_join.ts`)

`resolveCandidateLink` attaches two things to each municipal official on the cacbg roster: the
mi2023 council SLATE row (party, list position, preference votes, elected flag) and an MP
photo. It has the same `byFull ?? byFirstLast` shape. Both writers share it:
`candidate_links.ts` (the JSON shards) and `load_official_candidate_links_pg.ts`
(`official_candidate_link`, which `municipal_officials_table` LEFT JOINs for the party colour and
avatar on governance and My-Area tiles).

Measured 2026-10-21 against local Postgres, using the module's own functions over the loader's
exact membership (6,298 decoratable listings):

| path | rows | verdict |
| --- | --- | --- |
| slate, exact full name | 5,517 | correct, except the 8 below |
| slate, exact full name but 2+ candidates in the município share it | 8 | **ambiguous**: first-wins picks one |
| slate, first+last only, middle name 1–2 edits apart | 15 | **correct**: roster typos („Радослваов", „Геогиев", „Осмаов"), all councillors |
| slate, first+last only, a genuinely different middle name (4–8 edits) | 10 | **wrong person**: all mayors / deputy mayors, 7 of 10 on an unelected slate row |
| slate, first+last only, one side has no middle name | 4 | plausible, kept |
| MP photo, exact full name | 223 | correct |
| MP photo, first+last only | 1 | „Любиша Блажевски Блажевски" → MP „Любиша Блажевски", a roster artifact |
| no link | 752 | — |

So this join is a much smaller problem than Part A: 10 wrong rows rather than thousands. The
reason is scope. The fallback runs within ONE município's slates, where a first+last collision is
rare, while Part A searches the national MP index, where it is the norm. The wrong 10 are all
appointed or executive officials, whom the fallback mismatched to an unrelated council candidate
with the same first and last name, so a deputy mayor is shown with someone else's party and
preference votes.

The same typo tolerance would NOT be safe in Part A. Of Part A's 4,413 wrong three-part pairs,
61 have a middle name only 1–2 edits from the MP's, and most of those are different people
(Петров/Петков, Янков/Цеков, Николов/Николаев). Part A therefore stays exact-only, and Part B
does not reuse Part A's rule as-is.

### Fix (B)

1. **Slate join**
   - **Exact full-name match, unique in the município:** take it.
   - **Exact full name shared by several slate rows:** take the single elected one if exactly one
     is elected; otherwise refuse. This covers the 8 ambiguous rows; measure how many resolve.
   - **First+last fallback:** allowed only when (a) the first+last key is unique across the
     município's slates, and (b) either one side has no middle name, or both have one and they
     are at most 2 edits apart. Measured outcome: keeps the 15 typos and the 4 missing-middle
     rows, and drops the 10 wrong people.
   - Replace the last-wins `byFirstLast` map with a count-aware one so (a) is checkable.
2. **MP join**: exact full name only, via Part A's `mpNameMatch` module, so the two decorators
   cannot drift. That loses the one „Любиша Блажевски" photo. Accept it rather than keep a
   two-name tier for one row.
3. **Comments**: fix the module header and `buildSlateIndex`'s comments, which present the
   first+last fallback (with "last-wins is fine") as harmless.
4. **Tests**
   - Unit tests on `resolveCandidateLink` (new `candidate_link_join.test.ts`): typo → match;
     different middle name → no slate row; first+last held by two candidates → no match;
     duplicate full name with one elected → the elected row; with zero or two elected → refused.
     Include a mutation check: with the edit-distance guard removed, the different-middle case
     must match.
   - Extend `scripts/db/tests/official_candidate_link.data.test.ts`: for every linked row whose
     slate came from a first+last match, the middle names are within 2 edits; and every
     `mp_id` names an MP with an identical full name.
5. **Publish**, in this order: `npx tsx scripts/officials/decorate_candidate_links.ts` (JSON
   shards), `npm run db:load:official-candidate-links:pg`, then
   `npm run db:load:official-candidate-links:pg:cloud`. Nothing runs the cloud step automatically,
   and skipping it leaves prod on the old links at a 200. No `deploy:db`/`deploy` is needed:
   the table shape is unchanged.

## Order

Part A first. It is the large one, and Part B's MP join reuses its `mpNameMatch` module. The two
publish independently: A is a bucket sync, B is a Cloud SQL loader.
