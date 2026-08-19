# Company political links — the third arm (migration 158)

Status: PLANNED · 2026-08-19 · **revised after a gap audit (§7 records what changed and why)**
Surface: `/company/:eik` → `src/screens/components/CompanyPoliticalLinks.tsx`

## 1. The defect, measured

`/company/175155542` (МАКЕДОНСКО КУЛТУРНО-ПРОСВЕТНО ДРУЖЕСТВО ГОЦЕ ДЕЛЧЕВ) renders

> Политически връзки (0) — Няма установени връзки с политици.

Its board chair and представляващ is **Красимир Дончев Каракачанов** — former Deputy PM
and Minister of Defence, `person.slug = 'mp-2829'`, `is_public_figure = true`,
`status = 'active'`. The tile does not fail to find him; it **asserts he is not there**.
That is a false claim about a named public figure on a page a reader may screenshot, which
is worse than an absent section. (`CompanyDbScreen` mounts the tile under a bare
`{company && …}` — outside every `contracts > 0` guard — and the component always renders
its Card, so the denial is unconditional.)

The data is present and correct. `company_political_links('175155542')` (migration 158)
returns him in `direct` with `roles = [ngo_board, ngo_representative]`,
`linkBasis = 'name_match'`, plus a `bridged` list of VMRO MPs via СДРУЖЕНИЕ ВМРО
(000681292).

**The page never asks.** `CompanyPoliticalLinks` unions exactly two sources, both
money-gated:

| arm         | source                                                                        | coverage                                   |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| PG          | `company_politicians` (008), procurement `mp_connected`/`pep_connected` joins | **347 EIKs** (522 rows)                    |
| funds       | `fund_payloads(kind='political-by-eik')`, ИСУН beneficiaries                  | **971 EIKs** (1,249 rows)                  |
| **missing** | **`company_political_links` (158), the gated person layer**                   | **26,047 EIKs** (9,982 with a direct link) |

`tr_companies` holds 1,020,707 companies; 29,616 have ever signed a contract. An NGO that
neither contracts nor draws EU funds is invisible to both live arms by construction.

`/api/db/company-connections` already serves 158 and is consumed **only** by the AI chat's
`companyConnections` tool. So the chat and the page answer the same question differently today.

## 2. The constraint 158 imposes, which the design must not break

158's header is explicit, and it is the defect the retired shard family shipped:

> ⚠️ IT IS STILL A SECOND-DEGREE LINK AND MUST NEVER BE RENDERED AS A FIRST-DEGREE ONE. The
> payload keeps the two arms in SEPARATE arrays with separate counts for that reason — a
> single merged list with a `confidence` column is exactly how the shards let a two-hop
> coincidence read as a finding.

So `bridged` gets its **own block with its own heading**, never a row in the same list with a
softer label. Each bridged row must carry `viaCompany`, `bridgeName` and `bridgeCompanies`
visibly — those are what let a reader judge the path.

158 also reports its caps (`directTruncated`, `bridgedTruncated`, `bridgeFoldsSuppressed`,
`bridgeMaxCompanies`) precisely so a consumer does not present a capped answer as a complete
one — CLAUDE.md's "no silent caps". The tile must surface them.

## 3. Where the union happens — ONE server-side route

**Decision: a new `/api/db/company-political` route does the whole union server-side, and the
tile makes one call.** Four measurements force it; none of them is a preference.

### 3a. Dedup is the majority case, and its key is only resolvable server-side

| arm                      | rows  | resolvable to a person slug | **also in 158 `direct`** |
| ------------------------ | ----- | --------------------------- | ------------------------ |
| PG `company_politicians` | 522   | **522 / 522 (100%)**        | **436 (83.5%)**          |
| funds `political-by-eik` | 1,249 | **1,249 / 1,249 (100%)**    | **852 (68.2%)**          |

Without a key the tile double-renders **1,288 rows**. The three arms use three namespaces for
one human:

```
PG      /candidate/mp-2829   or  /officials/<officials-slug>
funds   /candidate/mp-<mpId> or  /officials/<officials-slug>
158     mp-2829              →   /person/<person-slug>
```

The key is the person slug, resolved **forward**. Forward is complete —
`officials_person_slug()` (106) resolved 522/522 and 1,249/1,249.

⚠️ **Corrected at T6, which measured the mechanism this plan had guessed at.** Totality does
**not** rest on the `person_slug_retired` fallthrough. 106 is a `COALESCE` whose FIRST branch is
a `person_role.ref` join, and that branch answers **445/445** officials refs on its own; 37 refs
also carry a retirement row but never reach it, and removing that arm from 106 would leave the
gate green. What totality actually rests on is every ref having a LIVE `person_role` — so what
the T6 gate really catches is **cross-loader drift**: `company_politicians` is rebuilt by
`db:load:tr:pg` and `person_role` by `db:resolve:persons`, and a roster re-slug reaching one and
not the other strands refs with no live role. Still server-side-only, for the same reason.
Reverse is not complete either: `person_role.ref` at
`official_exec`/`official_muni` covers just 417 of 445, so "have 158 return its aliases" would
silently miss 28. A browser cannot call `officials_person_slug`, so the resolution cannot be
client-side.

### 3b. The funds arm cannot be resolved where the plan first put it

`/api/db/fund-payload` is a **generic passthrough** —
`SELECT payload FROM fund_payloads WHERE kind = $1 AND key = $2` — serving ~18 payload kinds.
Special-casing `political-by-eik` inside it puts one kind's identity join into a route that
knows nothing about kinds. Baking `personSlug` into the stored shard at load time is worse: it
freezes a slug that a re-resolve moves (CLAUDE.md's whole `person_slug_retired` apparatus
exists because slugs move), so the artifact would go quietly stale.

### 3c. A cross-arm collision the union would otherwise reintroduce

158's own data test asserts a person is never in both `direct` and `bridged`, because "the tool
renders the two with different wording, so the same human would be described to the reader
twice". The union breaks that guarantee from outside: a PG-arm person with no `person_role` at
source tr/ngo for this EIK is not in 158's `direct_role`, so 158 may legitimately place them in
`bridged` — while the PG arm puts them in our direct block. **Measured: 9 people union-wide** — 5 via the PG arm and 4 via the funds arm. (An earlier
figure of 7 was join ROWS rather than people, and was scoped to the PG arm alone: one EIK
carries three refs that fold to one slug.)

The union must subtract the resolved direct-slug set from `bridged`, and a gate must assert it.

### 3d. Cost — measured, and why one call beats two

`EXPLAIN (ANALYZE, BUFFERS)` on `company_political_links(eik, 50)`, local:

| eik                                | buffers                   | time        |
| ---------------------------------- | ------------------------- | ----------- |
| 175155542 (the example)            | 1,252                     | 14.6 ms     |
| 831646048 (13 direct + 11 bridged) | 1,930                     | 13.8 ms     |
| 204332614 (worst post-cap fan-out) | 12,303 (2,086 cold reads) | **56.5 ms** |

Note 158's header records 14 ms for that last EIK — that figure is warm; 56 ms is what a cold
buffer pool costs, and Cloud SQL is a db-g1-small over the proxy. `/api/db/**` carries
`s-maxage=3600`, so human traffic is edge-served — but a crawler walking 1.02M distinct
`/company/<eik>` URLs misses on every one, which is exactly the traffic shape 084's header
records as the reason `person_connections` had to be rewritten. One invocation per URL instead
of two is the cheap half of that.

**Not folded into the existing `/api/db/company`** despite that route's own comment about
avoiding a second round-trip: it is a `Promise.all` of ~18 queries, so its latency is its
slowest member, and adding a 56 ms worst case to the critical path of every company page —
including the 96.6% that are not contractors — delays the whole page rather than one tile. A
separate route lets the page paint and the tile fill in. It also keeps a 42883/42P01 from 158
away from a query set that currently cannot fail that way.

### 3e. What the route returns

One payload: `direct[]` (PG ∪ funds ∪ `158.direct`, deduped on person slug), `bridged[]`
(158's, minus the direct slugs), 158's four cap fields, and an explicit
`arms: { pg, funds, personLayer }` tri-state per arm — `ok` | `absent` | `unavailable` — so the
tile can tell "nothing found" from "we could not look" (§5). Degrade each arm independently
(`missingMigration` for 158, the existing catches for the other two); never let one arm's
absence blank the others.

## 4. Work

### T1 — `/api/db/company-political` (new route, `functions/db_routes.js`)

Reads all three arms, resolves every ref forward through `officials_person_slug()`, dedups on
person slug, subtracts direct slugs from `bridged`, returns §3e's shape. Precedence on
collision: **PG > funds > 158** — PG and funds carry `total_eur` and the richer relation
labels 158 does not have; 158 contributes the people neither knows. Per-arm `.catch()`
degradation, per the file's established 42883/42P01 pattern.

### T2 — the hook

`useCompanyPolitical(eik)` in `src/data/procurement/` (beside `useCompanyProfile.ts`). Treat a
`null`/`unavailable` arm as **unknown**, never as "none".

### T3 — the renderer, two blocks

1. **Пряка връзка** — the deduped direct set. Ordering: existing `totalEur desc, name` for rows
   that have money; 158-only rows have none, so append them in **158's own order** (office
   prominence desc) rather than letting `?? -1` scatter them. 158-only rows link to
   `/person/<slug>`.
2. **Косвена връзка (втора степен)** — `bridged`, own heading, own count, per-row
   `viaCompany` / `bridgeName` / `bridgeCompanies` / `pathCount`, plus a one-line explainer.
   Meaningless without it.

Surface the caps: on `directTruncated`/`bridgedTruncated` say how many of
`directCount`/`bridgedCount` are shown; on `bridgeFoldsSuppressed > 0` say N officers were too
widely held to traverse — that is what separates "no second-degree link" from "we did not look".

Render `linkBasis` honestly: `declared` is **not** a confirmed identity (148 §0.2) and must not
read as "verified".

### T4 — labels (this is correctness, not styling)

- **`officeRole` → `usePersonLabels().roleLabel()`** (`pp_role_*`). **Do NOT render 158's
  `office` field**: it is `person_source.label_bg` and `person_source` has **no `label_en`
  column**, so the plan's first draft would have shipped Bulgarian office names to `/en`.
  `pp_role_*` is bilingual and covers **55 of the 57** office roles; `audit_office_chair` and
  `kzk_deputy` have no key in either locale and pass through as raw codes, which
  `personLabels.ts` documents as deliberate.
- **`roles[]` → `trRoleLabel()`** (`src/lib/trRole.ts`, `tr_role_*`), which covers **all 13**
  tr/ngo role codes in **both** locales. **Do NOT extend `TR_ROLE` in `officialLabels.ts`** —
  it covers 7 of 13 (`actual_owner`, `ngo_board`, `ngo_representative`, `sole_owner`,
  `trustee`, `verifier` are absent), so 158's own example would render the raw string
  `ngo_board` to the reader.

  ⚠️ The two vocabularies **disagree on meaning**, so this is not a free choice:
  `tr_role_director` = „съвет на директорите" / "board of directors" while
  `procurement_rel_director` = „директор" / "director" — a body versus a post.
  `CompanyConnectionCheck` on this same page already uses `trRoleLabel`, so choosing it also
  stops one page describing one code two ways.

- Move the tile's hardcoded Bulgarian (`Политически връзки`, the empty line) into both corpora;
  the file already imports `useTranslation`. New keys must satisfy
  `scripts/i18n/key_usage.test.ts`.

### T5 — the empty state

The current copy is the false claim in §1 and must not survive. Three distinct states, driven
by §3e's `arms`:

| state                                    | copy                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| all arms answered, nothing found         | name what was searched (registry roles + the one-hop bridge), not a bare denial |
| an arm is `unavailable` (158 absent)     | say the check could not run — never a denial                                    |
| a fold was refused / a bridge suppressed | say so; a refusal is not an absence                                             |

### T6 — tests

- `CompanyPoliticalLinks.test.tsx` (new — the component has none). Cover: the §1 regression
  (empty PG + empty funds + populated `158.direct` renders the person); dedup (a person in two
  arms renders **once**); separation (a `bridged` row never appears in the direct block); and
  the §3c subtraction (a person in both PG-direct and 158-bridged renders only as direct).
  The separation and subtraction assertions need a **mutation check** — with the arrays
  concatenated they must fail, or they are satisfied by any implementation that renders both.
- Extend `scripts/db/tests/company_political_links.data.test.ts`:
  - forward-resolution totality — every `company_politicians.ref` and every funds
    `political-by-eik` officials slug resolves to a non-null person slug (522/522 and
    1,249/1,249 today; if it stops being total the dedup key silently degrades);
  - the §3c cross-arm rule, mirroring the existing internal `dupes` check.
    That file deliberately does **not** skip on an unapplied 158; keep it that way.

## 5. Deploy order

158 is "applied, never loaded", and the route's `missingMigration` is the **non-logging**
variant — so if 158 is not on the serving database the new arm reads as "no political links"
with nothing in the logs. **Verify before shipping the bundle**; the AI chat's use does not
prove it:

```bash
psql "$CLOUD_URL" -c "SELECT to_regprocedure('company_political_links(text,int)')::text;"
```

If absent (148 first — 158's body SELECTs `person_company_bridge_a`, and a `LANGUAGE sql` body
is validated at CREATE, so 158 alone fails the whole file with 42P01):

```bash
npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 158_company_political_links.sql
```

Then the function must lead the bundle that calls the new route:

```bash
npm run deploy:db    # /api/db/company-political
npm run deploy       # the tile
```

No third `SKIP_PREDEPLOY` step: `/company/**` recovered at step 2 in both 2026-08-16
measurements. `/person/**` is the family needing the edge purge, and nothing here touches it.

## 6. Named, and deliberately out of scope

- **The crawlable body is a SECOND surface.** `/company/**` is function-served and
  `functions/spa_page.js` `companyPage()` emits its own `<h1>` + table for crawlers — EIK,
  legal form, seat, status, contracts, funds. It has no political links and this plan does not
  add any. Deliberate: a crawler-visible claim raises the stakes on `linkBasis`'s
  "declared ≠ verified" caveat, which a bare table cannot carry. Revisit separately.
- **Two adjacent bridge concepts.** `CompanyConnectionCheck` sits directly below the tile and
  already renders a bridge with a degree ordinal („2-ра степен") from `company_connection()` —
  a name-only match, self-described as "a lead, not proof". 158's bridge is gated on
  `tr_name_fold_people.people_n = 1` and capped at 25 companies. After T3 the two sit adjacent
  with different rules; the bridged block's copy must distinguish itself. Unifying them is a
  separate piece of work.
- **The officers table above links `/person/<NAME>`**, an ungated name lookup, while the new
  tile links `/person/<slug>`. Two identity rules on one page. Pre-existing; not this change.
- **`company_related` ignores legal-entity edges** — ХИДРОРЕМОНТСТРОЙ - СВИЩОВ is linked only
  through «Драгажен флот - Истър» АД as a `partner` row, and 019 joins person folds only.
- **1,621 `tr_person_roles` rows / 451 companies with the role label glued into the name**
  (`АНДРЕЙ СТОЯНОВ КЬОСОВСКИ - член на КС`). Polluted folds → no `person_role` → invisible to
  both 158 and 019. Same class as the council `VOTE_LABEL_SOURCE` purge.
- **Company search without contracts** — `search_all`/`search_companies` already answer it and
  `/api/db/search` is a live route with zero frontend consumers.

## 7. What the gap audit changed

| #   | gap                                                                          | effect on the plan                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `person_source` has **no `label_en`**; the draft rendered `office`           | EN would ship Bulgarian office names. → T4 renders `roleLabel(officeRole)`                                                                                                                         |
| 2   | draft implied extending `officialLabels.TR_ROLE` (7 of 13 codes)             | `ngo_board` would render raw. → T4 uses `trRoleLabel` (13/13, both locales); the two vocabularies also **disagree** on `director`                                                                  |
| 3   | `fund-payload` is a **generic passthrough** over ~18 kinds                   | the draft's funds-arm resolution was unimplementable there. → §3 restructured to one server-side union route                                                                                       |
| 4   | union reintroduces a direct/bridged collision 158 forbids internally         | **9 people** described twice. → explicit subtraction + gate (§3c, T6)                                                                                                                              |
| 5   | `spa_page.js` `companyPage()` is a second, crawler-facing surface            | named and scoped out (§6)                                                                                                                                                                          |
| 6   | `CompanyConnectionCheck` already renders a different bridge on the same page | named; copy must distinguish (§6)                                                                                                                                                                  |
| 7   | cost was quoted from 158's header (warm)                                     | re-measured: **56.5 ms cold** worst case, and `/api/db/**` is edge-cached but a crawler misses every URL. → argues one route, not two, and not folded into `/api/db/company`'s `Promise.all` (§3d) |
