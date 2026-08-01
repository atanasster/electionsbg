# People & Connections consolidation — implementation plan v1

Status: **DRAFT (2026-07-30), scale-grounded rev (2026-07-30).** Owner: TBD.

Consolidates every surface that displays *people* or *connections* into a coherent
information architecture. All operator decisions are locked (§Locked).

Prior art this builds on / supersedes:
- [person-identity-v1.md](person-identity-v1.md) — the resolved `person`/`person_role` layer.
- [persons-browser-v1.md](persons-browser-v1.md) — the `/persons` browser. **§3 there already
  declared "ALL persons are included — candidates, donors, TR-only officers".** That intent was
  only partially realized: the resolver materializes office-holders but **bridges** TR
  footprints onto already-public persons rather than minting TR-only individuals
  (`resolve_persons.ts:19–24, 1238–1246`). This plan completes it (Phase 1), scoped by money.
- [connections-pg-migration-v1.md](connections-pg-migration-v1.md) — design to move the
  MP-declaration graph to PG, keeping `company_politicians` separate. **This plan supersedes it**
  by unifying the two lineages (Phase 3).
- [person-candidate-merge-v1.md](person-candidate-merge-v1.md), [governance-hub-v1.md](governance-hub-v1.md),
  [project_firebase_deploy_ceiling] — the 453k-file dist deploy ceiling constrains prerender scope.

---

## Locked decisions (2026-07-30)

1. **Private-sector company owners merge into `/persons` with a position-type dimension.**
2. **`/connections` is fully rebuilt on the person layer + procurement** — one PG graph engine
   (co-ownership ∪ procurement money), keyed on `person_id` + `eik`, serving both `/connections`
   and every `/person` "Свързани лица" tile.
3. **The browseable private tier is money-linked only** (Tier V, ~68k — owners of companies with
   public money). The ~418k dead tail (Tier N) stays search + company-roster only, `noindex`.
   Search spans all tiers; only the `/persons` **browse table** is scoped to P + V (~125k).

---

## Measured scale (grounds every sizing choice below)

Local DB, 2026-07-30:

| Population | Count | Note |
|---|---|---|
| Public persons (`is_public_figure`, active) | **56,869** | today's `/persons` + prerendered `/person` pages |
| TR owner universe (distinct `name_fold`) | **485,741** | 765,285 `tr_officers` rows |
| **TR owners linked to public money** (contracts ∪ subsidies ∪ EU funds) | **68,274** | the "so what" tier — same order as public |
| 3-part folded names ≤5 firms (verifiable-identity candidates) | 424,719 | Bridge-B uniqueness applies to most |
| short (<3-part) folded names (namesake-ambiguous) | 51,911 | must stay `name_fold` confidence |

**Implication:** merging *all* 486k owners as first-class persons is a ~9× blow-up of the
person layer and would push prerendered `/person` pages from ~57k toward the deploy ceiling.
But the **money-linked 68k** is bounded, journalistically meaningful, and roughly doubles (not
9×'s) the corpus. That gap is what the tiered design (below) exploits.

---

## The three person tiers

| Tier | Who | Count | In browse matview? | Prerendered `/person` page? | Indexed |
|---|---|---|---|---|---|
| **P — public** | office-holders, candidates, magistrates, regulators, sanctions/ДС, public donors | ~57k | yes | yes (as today) | yes |
| **V — money-linked private** | TR owners of companies with public money | ~68k | yes (`position_type=частен сектор`) | yes, **gated on a money threshold** (see §Prerender) | yes for gated subset |
| **N — long-tail private** | every other TR owner | ~418k | **no** | no — client-rendered lightweight portfolio | `noindex` |

- **Browse** (`/persons` DbDataTable) covers **P + V** (~125k), server-paginated, **default view =
  public only**; частен сектор is an opt-in slice.
- **Search always spans all three** — the existing `/api/db/person-search` over `tr_officers`
  already finds Tier N; that is retained, so "find any owner" still works. This resolves the
  inconsistency that motivated the consolidation (procurement search finds everyone, `/persons`
  didn't) **without** dumping 418k dormant-company owners into the accountability directory.
- Tier N reachable via: global/procurement search + company officer rosters → a cleaned-up
  name-keyed portfolio (the legacy `PersonScreen`, reframed as "фирмено досие по име", `noindex`).

---

## Identity design — materializing V without poisoning the layer

TR owners have no stable id; the identity unit is the **folded name** (`tr_officers.name_fold`,
a generated `translit_bg_latin(name)`). Materialize Tier V thus:

- **Identity unit = folded name**, one Tier-V person per money-linked folded name.
- **`identity_confidence`:**
  - `verified` — 3-part folded name, globally unique across the TR owner universe **and** ≤5
    firms (reuse Bridge B's rule, `resolve_persons.ts:1586–1628`). Gets a durable slug.
  - `name_fold` — short/ambiguous or non-unique name. Name-keyed URL, badged
    "съвпадение по име — непроверена самоличност". **Never** seeds a graph edge by default.
- **Separate resolver pass**, gated to the money-linked EIK set. It runs *after* the public
  resolve and **must not** merge Tier-V groups into public groups (preflight asserts public
  counts unchanged). Where a folded name already matches a public person, it stays a **bridge**
  (existing behaviour) — no duplicate Tier-V person is minted.
- **`position_type`** is a *derived coarse bucket over the existing `primary_facet`*, not a new
  independent taxonomy: политик ← {mp,candidate,local,mep,president,official_muni,historic_mp} ·
  изпълнителна власт ← {official_exec,diplomat} · публичен сектор ← public_sector ·
  магистрат ← magistrate · регулатор ← regulator · **частен сектор ← {company,concession} on a
  Tier-V/N person**. This avoids a redundant column and reuses the shipped mix-bar partition.

---

## Prerender & deploy-ceiling policy (load-bearing)

The dist file count is a hard constraint. Policy:
- Tier P: prerender + index (unchanged).
- Tier V: prerender + index **only** the subset above a public-money threshold (tune so P+V
  prerendered pages stay well under the ceiling — start with a conservative €-cutoff, measure
  the resulting page count against the current dist before widening). The rest of V renders
  client-side, `noindex`, still browseable/searchable.
- Tier N: never prerendered, always `noindex`.
- Sitemap: add only the prerendered subset. Re-run the sitemap-validity gate
  ([project_sitemap_validity_audit]) — every `<loc>` must have a real `dist/<path>/index.html`.

---

## Findability & search UX — the core of "easily find a person"

**The tiers created a findability hazard the first draft waved away.** "Search spans all
tiers" is only a win if results are *ranked and disambiguated*. Over 543k people with heavy
Bulgarian-name collision, an unranked scan makes findability **worse**: a search for a common
surname returns dozens of dormant Tier-N owners burying the one MP/mayor the user meant. And
today "search" is **four disjoint paths** returning different things:

| Entry point | Covers | Ranking | Gap |
|---|---|---|---|
| Global nav "търсене" (`useSearchItems`) | curated MPs, parties, places | static | **finds almost no people** — not the 543k |
| Procurement search (`/api/db/person-search` over `tr_officers`) | TR persons + companies + contracts | none | thin metadata ("8 фирми"); no tier/prominence rank |
| `/persons` browser `?q` | P + V browse | ILIKE | the `searchFold` combination bug (persons-browser §0a F1) |
| client rosters (`useCorpusPersonIndex`, magistrate roster) | MPs / officials / magistrates | partial | fragments the same query across 3 sources |

### Fix 1 — one shared `person_search` index (fold into Phase 1)
A precomputed serving table (pattern: the existing `contractor_search`) — **one row per findable
identity across P + V + N** — that *every* search box reads, so results are identical everywhere:
`name, name_fold, tier, position_type, primary_role, party, place, top_eik, firms_count,
public_money_eur, has_photo, identity_confidence, slug | name_key, rank_static`.
Indexes: `gin trgm(name_fold)` (fuzzy), `btree(name_fold)` (exact + prefix typeahead), and a
precomputed `rank_static` so the ranked-`LIMIT` query uses the OFFSET-0 fence
([reference_dbtable_search_orderby_fence]) instead of a seq-scan. Replaces the ad-hoc
`tr_officers` scan **and** the client rosters.

### Fix 2 — relevance ranking (surface the accountable, sink the noise)
`score = match_quality (exact ≫ prefix ≫ trigram) × tier_weight (P ≫ V ≫ N) × prominence`,
where prominence = `role_prominence()` for P, `log(public_money_eur)` for V/N, plus a small
`has_photo` boost and an **exact-name override** (typing a sitting minister's full name always
returns the minister first, never a private namesake). The dormant-namesake tail always ranks last.

### Fix 3 — grouped, disambiguating typeahead
Results group by tier so the user reads intent at a glance:
**Хора във властта** (P) · **Свързани с обществени пари** (V) · **Други собственици** (N,
collapsed to "+312 собственици на фирми", expandable) · **Фирми** · **Договори**. Per-tier result
card carries the *distinguishing* signal: avatar + role + party + place for P; top company +
firms count + public money for V/N; the `name_fold` badge where identity is unproven. "виж
всички" deep-links `/persons?q=…` where the full filter rail narrows by place/party/facet.

### Fix 4 — namesake disambiguation, never a silent merge
When a folded name maps to >1 distinct owner-cluster, do **not** serve a silently-merged
portfolio — show a **namesake chooser** (reuse the candidate page's existing one) plus the
`name_fold` badge. `verified` singletons route straight to the profile.

### Fix 5 — bilingual + fuzzy robustness (get the primitives right)
Cyrillic **and** Latin via `translit_bg_latin`; hyphen/whitespace folding
([reference_person_fold_and_bridgeb]); trigram tuned to avoid the "-иране" seed junk
([reference_dossier_trigram_seed_pollution]); the `searchFold` combination fixed (persons-browser
§0a F1); prefix index for typeahead latency; OFFSET-0 fence for the ranked `LIMIT`.

### Fix 6 — browse-side findability (attributes, not just names)
For the "I don't know the name but know the attributes" case, surface `position_type`, place,
party, and public money as **prominent filter chips**; add sort-by-money and sort-by-companies;
and keep a **persistent "включи частен сектор" chip** in the browse so a money-linked private
owner the user is hunting is never hidden behind the public default without a one-click reveal.

### Canonical entry point
Elevate the top-nav **"търсене"** box to *the* people-and-money search (today it finds almost no
people). One box, one `person_search` index, ranked + grouped + disambiguated — the single
highest-leverage findability change, and the thing that finally makes "find a person" work the
same everywhere.

---

## Connections engine (Phase 3–4 detail)

**Model (new PG schema, follow the `direct-db-ingest` pattern):**
- `graph_person_node` — one row per person that has any edge: `person_id`, `slug|name_key`,
  `facet`, `position_type`, `identity_confidence`, `public_money_eur` (rollup of linked
  companies).
- `graph_company_node` — `eik`, `name`, `public_money_eur` (contracts ∪ subsidies ∪ EU funds —
  reuse the person-browse money basis + the procurement cross-ref).
- `graph_edge` — `person_id`, `eik`, `kind ∈ {tr_role, tr_owner, declared_stake, procurement}`,
  `is_current`, `confidence`. **Money lives on the company node**; a person's money exposure is
  the sum over linked companies (consistent with `person_browse.public_money_eur`).
- Unifies the two lineages: co-ownership edges (from `person_connections`/declarations) **∪**
  procurement edges (from `company_politicians`/`mp_connected`/`pep_connected`).

**Serving (the global graph is too big to ship whole):**
- **Global `/connections` view:** a **precomputed, down-sampled** blob per scope — top-N nodes by
  money/degree (pattern: `procurement_geo_payloads`). Renderable; not the full 486k.
- **Drill-in:** a live **ego-graph** endpoint per person — `person_connections()` (084)
  generalized to read the unified engine, so `/person` "Свързани лица" and a `/connections`
  node click share one code path.
- **Matrix view:** the party×party matrix is a *politician-slice* view (magistrates/regulators/
  private have no party). Generalize to a **facet×facet** matrix; keep party×party as the default
  slice when the facet filter = политик.
- Default population = public figures; **"включи частен сектор" toggle** adds Tier V; Tier-N and
  `name_fold` nodes suppressed by default even then.

---

## Phased plan

### Phase 0 — spike (mostly done; finish sizing)
- ✅ Owner-universe / money-linked / uniqueness counts (above).
- Remaining: measure prerender page-count deltas for candidate €-thresholds against current dist;
  EXPLAIN a P+V browse matview + search on worst-case (a common surname) per [feedback_db_query_perf].

### Phase 1 — person layer: materialize Tier V + the search index (data model)
- Money-linked EIK set + Tier-V resolver pass; `position_type` + `identity_confidence` columns on
  `person` / `person_browse_table` (120 is DROP+CREATE — **column-type cloud-reload rule**).
- Build the shared **`person_search`** index (Findability Fix 1): one row per findable identity
  across P+V+N, with `rank_static` + trgm/prefix indexes. This is the backbone Phase 2b consumes.
- Preflight: public counts unchanged; Tier-V counts by confidence; join-key population;
  `person_search` covers all three tiers and worst-case surname query stays sub-100ms (EXPLAIN).

### Phase 2 — `/persons` browser: dimension + public default
- `PersonsAnalysisStrip`: `position_type` partition, частен-сектор hue. Default mix stays public.
- `useUrlPersonFilters`: `?sector=public|private|all` (default `public`), `?position=…`; validate
  on read (drop unknowns) per the URL-contract convention. Search box spans all tiers.
- Title/subtitle: default "Хора във властта"; частен-сектор slice relabels. `name_fold` badge.
- Browse-side findability (Fix 6): position_type / place / party / money filter chips; sort by
  money and by companies; persistent "включи частен сектор" reveal chip.

### Phase 2b — unified search (the findability payoff)
- Repoint the top-nav "търсене", the procurement search, and the `/persons` `?q` box **all at
  `person_search`** (Fix 1) — one ranked, grouped, disambiguated result set everywhere.
- Ranking (Fix 2) + grouped typeahead cards (Fix 3) + namesake chooser (Fix 4) + bilingual/fuzzy
  primitives (Fix 5). "виж всички" → `/persons?q=`. Retire the client rosters and the ad-hoc
  `tr_officers` scan.

### Phase 3 — unify the two connection lineages (PG engine)
- Build `graph_*` schema + loader; wire `/api/db`; register in `recent_updates` + both changelogs
  ([reference_two_changelogs]); add `db:load:*:pg:cloud` + the migrated-family watch-reload entry
  ([reference_migrated_family_watch_reload]) or prod goes stale.
- Re-point `person_connections()` at the engine.

### Phase 4 — `/connections` rebuild
- Node population = all governance facets + Tier-V (toggle); money on company nodes; down-sampled
  global blob + live ego-graph; facet×facet matrix. Keep orbital graph + BFS path-finder.

### Phase 5 — retire duplicates & fix routing
- Retire `connections.json` / `connections-*.json` / `mp-connections/*` +
  `build_connections_graph.ts`; update the update-connections skill.
- Procurement "ЛИЦА (ТР)" search → unified profile (P/V) or `noindex` name portfolio (N).
- Delete orphaned `CompanyConnectionsSection`; reframe legacy `PersonScreen` as the Tier-N portfolio.

### Phase 6 — entity-page cleanup
- Officer rosters link to person slugs where `verified`, name-keyed otherwise; verify
  `CompanyPoliticalLinks` (in-power) and owner links don't duplicate.

---

## Consumers to update (second-consumer rule)
- **AI tools** `personProfile` / `personConnections` / `person_elections` ([project_ai_chat_tools])
  read the person layer — broadening population touches them + the grounded-number gate.
- **SEO/prerender** ([feedback_static_seo], [project_sitemap_validity_audit]) — per §Prerender.
- **Sitemap** generator — add only prerendered subset.

---

## Surface disposition

| Surface | Disposition |
|---|---|
| `/persons` (Хора) | **Grows** — position-type dimension, public default, Tier-V slice (P1–2) |
| Global nav "търсене" search | **Adopt** `person_search` — becomes the canonical ranked people search (P2b) |
| `/procurement` "ЛИЦА (ТР)" search | **Reroute** onto `person_search`; unified profile (P/V) / `noindex` portfolio (N) (P2b, P5) |
| client rosters (`useCorpusPersonIndex`, magistrate roster) | **Retire** — folded into `person_search` (P2b) |
| `/connections` (Връзки) | **Rebuild** on PG engine, all functions + money (P3–4) |
| `PersonConnections` (/person tile) | **Re-source** from unified engine (P3) |
| `MpConnectionsMini/Tile`, officials connections | **Re-source** or retire with `connections.json` (P5) |
| `CompanyPoliticalLinks`, `MpConnectedContracts`, procurement tiles | **Fold into** engine (P3); keep UI |
| legacy `/person/:name` `PersonScreen` | **Reframe** as Tier-N portfolio, `noindex` (P5) |
| `CompanyConnectionsSection` (orphan) | **Delete** (P5) |
| Company officer rosters | **Upgrade** links to person slugs where verified (P6) |
| `MpAvatar`, magistrate/officials tiles, my-area, governance | **Unchanged** (public default preserved) |

---

## Risks
1. **Deploy ceiling.** Prerendering all of V blows the 453k-file dist. Mitigated by the money
   threshold + measuring page-count deltas in Phase 0 before widening.
2. **Directory dilution.** Public-first default + explicit toggle; governance callers pin public.
3. **Name-fold noise in the graph.** `identity_confidence`, default `name_fold` suppression, the
   existing >6-officer association-noise guard.
4. **Resolver blast radius.** Tier-V is a separate pass; preflight asserts public counts unchanged.
5. **Cloud staleness.** 120 DROP+CREATE column-type rule; graph engine needs `:cloud` wiring +
   watch-reload entry.
6. **Browse/search perf at ~125k.** EXPLAIN worst-case surname in Phase 0; index both sides of
   every join key ([reference_pg_query_performance]).
7. **Search buries the accountable person.** The headline findability risk: "search spans all"
   without ranking sinks the MP under dormant namesakes. Mitigated by `person_search` +
   tier/prominence ranking + exact-name override + grouped/collapsed N tail (Findability §).

---

## Success criteria
- **One ranked search index** (`person_search`) behind every box; typing a common surname returns
  the accountable person (P, then money-linked V) above the dormant tail, with namesakes
  disambiguated — the same result set in the nav bar, procurement, and `/persons`.
- One browser slices public⇄private by `position_type`, public by default, search spans all.
- One connection lineage serves `/connections` and `/person`; every company node carries the
  public money it touched.
- Procurement лица search + officer rosters resolve to real profiles or an honest name portfolio,
  no ambiguous dead-end.
- Governance/my-area still reads "people in power" with no private-sector leakage.
- Prerendered page count stays safely under the deploy ceiling.
