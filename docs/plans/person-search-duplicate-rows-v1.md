# Duplicate person rows in search — „Боян Иванов Бойчев"

Analysis + plan, 2026-09-03. Measured against LOCAL Postgres (5433) **and** Cloud SQL (5434);
every figure below is re-derivable with the query beside it.

---

## 0. What is actually on screen

| surface | source | rows for „Боян Иванов бойчев" |
| --- | --- | --- |
| header dropdown | `/api/db/person-lookup` → `person_search(text,int)` **FUNCTION** (082) over `person` | **2** |
| home „Търсене" | `/api/db/person-search` → `person_search` **TABLE** (126) | **2** |

⚠️ **It is 2, not 3, in the header.** The third row in the screenshot is a DIFFERENT person —
„Иван Бойчев Иванов" (`ivan-boichev-ivanov-053008`). Verified on both databases; the route's
`limit=6` returns exactly the six rows visible. Nothing else in the header can contribute a
seventh: the only other people surface is the static municipal-officials index, and it holds
**0** rows for this name (`municipal_officials_table`). So there is ONE defect here, not two.

The two surfaces read two different relations that happen to agree, which is worth knowing
before either is "fixed" — a change to one does not move the other.

## 1. Root cause — two `person` rows for one human

```
person_id 6461  boyan-boychev-1a9q2r    candidate 2022_10_02:c-28  S24  bsp
                                        candidate 2024_10_27:c-28  S24  bsp
person_id 6462  boyan-boychev-1a9q2r-2  candidate 2023_04_02:c-1   S23  bsp
```

(Cloud carries the same split under `boyan-boychev-1a9q2r` + `boyan-boychev-ocsl10` — the
documented per-database slug drift from `person_slug_lock`, not a second defect.)

The CIK shards carry name, ballot number, oblast and a preference count and **nothing else** —
`mpId` is null on all three, so there is no Tier-0 gold key:

```json
{"slug":"c-28-boyan-ivanov-boychev","partyNum":28,"oblasts":["S24"],"mpId":null}
{"slug":"c-1-boyan-ivanov-boychev", "partyNum":1, "oblasts":["S23"],"mpId":null}
```

`partyNum` 28 vs 1 is the BALLOT number, which changes every election; the canonical party is
`bsp` in all three.

**The resolver did not fail — it refused, and it filed the refusal.** Both rows sit in
`person_review_candidate` under group `boyan-boychev-l09wee`, reason `identical_fullname`,
`namesake_risk = 2`. Every licence in `scripts/person/cluster.ts` is shut for this pair:

| tier | why it cannot fire |
| --- | --- |
| Tier 0 `hardId` | no `mpId` on any of the three candidacies |
| Tier 1 `weakBoth` | needs party **AND** place equal; place is S24 vs S23 |
| Tier 1 `sameLocalSeat` | `local`-source only; a candidacy carries no `localSeat` |
| Tier 1 `samePartyOffice` | needs a NATIONAL party office; neither has one |
| Tier 2a | needs `namesakeRisk <= 1`; it is 2 |
| Tier 2b | REFUSES candidate-only components by design (the register/MP people-counts do not cover unelected candidates) |
| Tier 3 | did exactly its job — two active persons, one review candidate |

So the only thing that split this person is **a change of Sofia МИР between elections**, and
the corpus offers no independent identifier to rule out a namesake. This is the same class as
`docs/plans/person-cross-party-candidate-merge-v1.md` (Велислава Иванова Петрова), one notch
weaker: there the PARTY changed too, here only the district did.

## 2. Scale — and why the two surfaces show it differently

Over the 63,836 tier-P rows in `person_search`:

| what a reader can distinguish by | rows sitting in a cluster of >1 |
| --- | --- |
| share a `name_fold` at all | **9,809** |
| home finder renders `roleSubtitle` → `(fold, place_label, primary_role)` | **4,766** (measured 2026-09-03; the ceiling `person_identity_duplicates.data.test.ts` holds has since been re-cut to **4,778** for an officials ingest — quote the file, not this row, when re-cutting) |

⚠️ **The header's two rows in that table were WRONG in this plan's first draft, and the
correction is worth keeping rather than editing away — it is the same mistake this repo
warns about everywhere.** They read „3,028" before and „572" after, measured by grouping
`person_search` on its `party` column. That column is `party_primary` (from 120's `tp.party`);
the header renders `person_election_stats.party_nick`, which 082's LATERAL emits. Different
columns, different NULL populations — 34,899 rows carry no `party_nick` against 25,046 with no
`party_primary` — so the proxy UNDERSTATED the defect by grouping people the header shows as
identical. Re-measured 2026-09-04 against the column the surface actually renders, over the
63,844 active public figures carrying a tier-P browse row:

| what the header can distinguish by | rows in a cluster of >1 |
| --- | --- |
| today: name + party badge → `(fold, party_nick)` | **4,527** |
| after §3: `(fold, party_nick, primary_role, place_label)` | **2,312** — a 49% cut |

And the residue decomposes, which is what says the remainder is an identity problem rather
than a rendering one: **2,065 of the 2,312 (89%) carry no party badge at all**, so this one
line is their whole distinguishing content, and **0** are left with neither a role nor a
place. Closing the rest is Tier B.

⚠️ **The header's 4,527 is the number this ticket is about, and it is a RENDERING number, not
an identity one.** Two same-named people in one party render as two byte-identical rows with
no avatar, no office and no place — indistinguishable even when the split is correct. The home
finder already prints „Кандидат · София 24 МИР" / „· София 23 МИР", which is why the same pair
reads as two records there and as a bug in the header.

Duplicate identities in the person layer, for context: **3,424** folds / **9,809** person rows
carry more than one active public figure. This plan closes a slice, not the class.

---

## 3. Tier A — the header must never render two identical rows (recommended first)

**The measured win: 4,527 → 2,312 indistinguishable rows (−49%), with no identity claim made.**

`src/layout/search/SearchItems.tsx` renders a `p` row as avatar + name + `PartyBadge` and
stops. Give it the same second line the home finder has, from the same helper:

- `roleSubtitle(hit, bg, roleLabel)` already exists in
  `src/screens/components/search/personSearchSource.ts` — reuse it, do not write a second one.
- `person_search(text,int)` (082) must therefore return `primaryRole` + `placeLabel` beside
  `party`/`mpId`. Additive to the JSON; `/api/db/person-lookup` and the `personSearch` AI tool
  are unaffected. **Shipped with `placeLabelEn` as a third key** — 120 already carries
  `place_label_en` and `person_by_slug` already emits the pair, so omitting it would have left
  the `/en` header printing a Bulgarian place name beside an `/en` profile printing the English
  one. It is NULL for judicial seats by design (`name_en` is `place_dim`-only in 120, because
  `judicial_body` carries no English name); mirror that asymmetry rather than inventing a
  fallback.

⚠️ **Do not re-derive the representative role/place inside 082.** `120_person_browse.sql`
already picks it (`tr.role` → `primary_role`, and a `place_label` expression its own comment
says is *"COPIED VERBATIM from 082 … a different one here means the browser and the profile
print different place names for the same seat"*). A third copy is how the header and the home
finder come to name two different offices for one person.

⚠️ **But 082 may NOT read `person_browse_table` from a `LANGUAGE sql` body.** Two reasons, both
live in this repo: a `LANGUAGE sql` body is validated at CREATE, and `db:resolve:persons`
applies 082 **before** `db:load:declarations:pg -- --resolve` creates 120's matview — so on a
cold database the whole file would fail 42P01 and take the entire person API with it; and 120
is `DROP MATERIALIZED VIEW` + `CREATE`, the CASCADE hazard `migration_drop_dependents.data.test.ts`
polices.

**Mechanism:** a small `LANGUAGE plpgsql` accessor in 082 —
`person_browse_card(bigint) RETURNS jsonb` — selecting `primary_role, place_label` from
`person_browse_table`, with `EXCEPTION WHEN undefined_table THEN RETURN NULL`. plpgsql bodies
are not parsed at CREATE, so they record no `pg_depend` edge and cannot fail the apply; a
database without 120 degrades to a subtitle-less row instead of a 500. Called once per returned
row, ≤20 rows — the same shape as the existing `mpId` / party LATERALs.

Ship: `apply_functions.ts 082_person_api.sql` → `npm run deploy:db` → `npm run deploy`.
Nothing else; no reload, no matview refresh, no outage window.

⚠️ **This paragraph named `functions/db_routes.person_search.test.js` as the gate and that was
the wrong file** — it covers the same-named *table* (126) behind the `person-search` route, not
the 082 *function* behind `person-lookup`, so it cannot host these assertions. The gates as
built (2026-09-04):

- `scripts/db/tests/person_search_card.data.test.ts` — the parity arm (the pair is READ from
  120, never re-derived), the `pg_depend`/plpgsql arm, a call-count arm that catches the
  `OFFSET 0` fence going missing, and both null paths separately (relation absent → the
  EXCEPTION arm; person absent from the matview → `SELECT … INTO` finding nothing). Note a
  matview cannot be `DELETE`d from, so the second is driven through the function directly
  rather than by hiding one row.
- `functions/db_routes.person_lookup.test.js` — the JS contract: the card keys forwarded
  verbatim, null keys kept rather than stripped, limit clamping, and that a **42501 is NOT**
  degraded at the route (it is `person_browse_card`'s own job to swallow it, since
  `missingMigrationEmpty` covers only 42883/42P01).
- an arm in `person_identity_duplicates.data.test.ts` (§5 C1, below).

## 4. Tier B — a candidate-continuity corroborant in the resolver

**The measured win: 580 person rows collapse to 266 — 314 duplicate identities gone,
0 contested cases in the corpus.**

Add a Tier-1 corroborant to `cluster.ts`, built as the structural twin of `sameLocalSeat`:

> Two `candidate` mentions are the same person when they carry an identical 3-part name
> (patronymic present and equal), the same **canonical** party, and belong to **different
> elections** — provided no single election carries that (fold, party) more than once, and
> the fold is not a mass name.

Each clause earns its place, and the last two are the guards:

- **Different elections** is the analogue of `sameLocalSeat`'s different-cycle rule. Within ONE
  election, two same-named candidates of one party on two lists may be two people.
- **The contested exclusion must be BLOCK-level, not pairwise** — `sameLocalSeat`'s header
  explains why at length: "different election" is an ANTI-condition and union-find closes over
  edges regardless, so three mentions with two in one election still fuse through the third,
  AND the `identical_fullname` review flag is computed from the final components, so a bad
  union also DELETES the flag that was meant to carry the case to a human.
- **`namesakeRisk <= 12`**, the cap `samePartyOffice` / `sameLocalSeat` already use to mean
  "this fold is not a mass collision". Necessary: the uncontested 3-part population reaches
  `namesake_risk` **220**, and "two ГЕРБ candidates named Георги Иванов Георгиев" is not one
  person in any expected sense.

Measured over the corpus (all candidate mentions carrying a canonical party):

| | folds×party |
| --- | --- |
| groups split across ≥2 active public persons | 317 |
| of those, **uncontested** (no election carries the pair twice) | **317** (contested: **0**) |
| …and a 3-part name | 312 |
| …and `namesake_risk <= 12` → **would merge** | **266** (spanning 580 person rows) |

It fixes the reported case: `bsp`, three distinct elections, `namesake_risk = 2`, 3-part name,
no election carrying the pair twice.

**Implementation notes**

- `resolve_persons.ts` must add the election to the candidate mention's corroborants — the
  value is already in hand at the `add(...)` call site (`election`, ~line 1136-1195). Note it
  passes `cPlace: oblast` (`c.oblasts[0]`) while the stored role place is `primaryMir`; leave
  that alone, this rule does not read place.
- The party must be the CANONICAL id (`canon`), never `partyNum` — the ballot number changes
  every election (28 → 1 → 28 in this very case).
- ⚠️ **Slug retirement is part of the change, not follow-up.** ~314 `/person/<slug>` URLs stop
  existing; every one needs a `person_slug_retired` row so it 301s rather than 404s, and
  `collapseSlugRedirectChains()` must run after (the resolver already calls it). Some of those
  slugs are in the committed `data/person/prerender_slugs.json`, so `npm run person:slugs:cloud`
  has to be re-minted from the SERVING database afterwards.
- Cloud is a separate act, and the local↔cloud slug drift above means the two databases retire
  DIFFERENT slugs. Chain (measured 2026-08-29, ~18 min end to end):
  `db:resolve:persons:cloud` → `db:load:declarations:pg:cloud -- --resolve` →
  `person-elections` → `persons-browse` → `person-search` → `graph` → `person:slugs:cloud`.
  ⚠️ 090's CASCADE puts `/persons`, `/officials/assets`, `/mp-assets` and
  `/declarations/crypto` at 500 for the declarations phase-2 window — off-peak only.

**Gates**

- `scripts/person/cluster.test.ts` — the rule's own cases, INCLUDING a synthetic contested
  block asserting that all three mentions stay split AND keep their `identical_fullname` flag
  (the pairwise-guard trap above is only visible in that second half).
- `person_resolve.data.test.ts` — the over-merge direction; a wrong public merge is an
  accusation, so this is the gate that must stay green.
- A floor/ceiling pair in `person_identity_duplicates.data.test.ts` (§5).

## 5. Tier C — the residue, and keeping the number honest

After A + B, **2,312 − 197 = ~2,115** rows still render identically in the header. The 197
is the overlap between Tier B's mergeable set and the post-Tier-A residue, and it is derivable
rather than asserted — group the candidate-only mentions by (fold, canonical party), keep the
groups spanning ≥2 active public persons with no election carrying the pair twice, a 3-part
name and `namesake_risk <= 12`, then intersect their people with the rows in a
`(fold, party_nick, primary_role, place_label)` cluster of more than one. Measured twice on
2026-09-04, against both the `person_search` proxy base and the faithful one: 197 either way.
Tier B
therefore closes 8.5% of the post-A residue, not the bulk of it — the plan's first draft said
„~375" because it inherited the understated §2 base. Most of what is left is undecidable from
the corpus, and 89% of it is people with no party badge, where the office+place line is doing
all the work there is to do.

1. **Extend the existing ratchet — SHIPPED 2026-09-04.**
   `scripts/db/tests/person_identity_duplicates.data.test.ts` holds `duplicateSearchRows` for
   the HOME finder's `(fold, place_label, primary_role)` cluster; it now also holds
   `headerIdenticalRows: 2312` for what the header renders after Tier A —
   `(fold, party_nick, primary_role, place_label)` — with a `headerPersonRows: 63844` floor on
   its denominator, because a ceiling alone reads a lost source as progress.
   ⚠️ It groups on `person_election_stats.party_nick`, the badge 082 emits, NOT on
   `person_search.party`; grouping on the latter is the proxy that understated §2.

   Two things about the arm are worth knowing. It reads the PRODUCER
   (`person_browse_table`), not the served payload — it is a claim about the corpus, and
   whether the API and renderer still carry the pair is held by
   `person_search_card.data.test.ts` and `SearchItems.test.tsx`. And the ceiling is PAIRED
   with a re-derivation of the pre-Tier-A number (name + badge alone, 4,527) asserted to be
   strictly larger: a bare ceiling is satisfied by the corpus losing the very columns it
   measures, since blanking one of the two can make clusters merge and the count fall while
   the surface gets worse. The "before" is re-derived rather than pinned, so it cannot go
   stale against a moving corpus.
2. **Adjudicate one at a time with the existing primitive.** The ref-scoped merge that
   `person-cross-party-candidate-merge-v1.md` asked for **is implemented** —
   `person_link_override kind='merge'` with `ref_a`/`ref_b`. No new machinery is needed.
3. **A „2 записа" affordance is deliberately NOT proposed.** Collapsing two rows under one
   name asserts an identity the corpus refuses; showing "2 records" invites the reader to
   assume it. Distinguishing them (Tier A) is the honest answer.

⚠️ **Out of scope, explicitly: deduping search results by name.** It would hide real
namesakes — 9,809 P rows share a fold — and would turn a visible, correct refusal into an
invisible wrong claim.

## 6. Immediate mitigation for the reported case (no code, ~20 min)

Two ref-merge rows join all three candidacies transitively, then re-resolve:

```bash
npm run person:override -- merge --ref 2022_10_02:c-28-boyan-ivanov-boychev \
  --ref-b 2023_04_02:c-1-boyan-ivanov-boychev \
  --note "same person; BSP, Sofia MIR 24 -> 23 -> 24" --by atanasster
npm run db:resolve:persons && npm run db:load:person-elections:pg
```

⚠️ Do this ONLY as a demonstration or if the pair has been verified by hand. It is one
adjudication against 3,424 duplicate folds — the reason Tier B exists is that this does not
scale, and the reason Tier A comes first is that it needs no adjudication at all.

## 7. Order of work

| step | why first |
| --- | --- |
| **A** header subtitle | biggest measured win (−49%, 4,527 → 2,312), no identity claim, no reload, ships in one deploy |
| **C1** the ratchet arm | must land WITH A so the new number is locked before it moves |
| **B** resolver tier | the real fix for 314 rows; carries a resolve + slug-retirement + cloud chain |
| **C2** adjudications | ongoing, per case |
