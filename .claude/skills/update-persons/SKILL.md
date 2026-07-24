---
name: update-persons
description: Rebuild the unified person-identity layer (Postgres `person`/`person_role`/`person_alias`/`person_review_candidate` + the `candidate_person`/`person_election_stats` electoral tables + the serving fns in 082/084/085) that powers the `/person/{slug}` profile page, the merged `/candidate/:id` electoral block, and the `personProfile`/`personConnections`/`person_elections` AI tools. It resolves EVERY people dataset — MPs, CIK candidates, ЕРИК donors, executive & municipal officials, magistrates (ИВСС), TR company officers/owners (bridged), the curated OFAC/EU sanctions register (data/person/sanctions.json), the curated ДС/COMDOS affiliation register (data/person/ds.json, Комисия по досиетата), and the curated регулатори / независими органи register (data/person/regulators.json) — to ONE stable person_id via `scripts/person/resolve_persons.ts` (+ `scripts/db/load_person_elections_pg.ts` for the per-election stats). Use when the daily watch report flags any of its UPSTREAM sources as changed (`ivss_declarations`, `cacbg_officials`, `cacbg_local`, `egov_commerce`, `cik_results`, `erik_campaign_financing`, `ofac_sanctions`, `comdos_ds`, or `regulator_rosters`), when the user asks to refresh person profiles / свързани лица / sanctions / ДС досиета / регулатори, to add a newly-verified sanctions designee, ДС affiliation, or regulator seat, or after a fresh git clone if the `person` table is empty. Read-only re-derivation — it never mutates its source datasets, only the person_* tables.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Persons skill (the identity spine)

The person layer sits ABOVE nine people datasets and resolves them to one stable
`person_id` (plan: `docs/plans/person-identity-v1.md`). It is a pure, idempotent
**re-derivation** — `scripts/person/resolve_persons.ts` reads the already-ingested
sources, blocks + clusters them, and rebuilds the `person_*` tables with deterministic
slugs. Nothing here re-ingests a source; each source is refreshed by its OWN skill.

## When to run

Re-resolve whenever a source that FEEDS the person layer changed, so the profiles don't
go stale:

| Upstream watcher | Ingested by | What it feeds the person layer |
|---|---|---|
| `ivss_declarations` | `update-judiciary` | magistrates + magistrate_company (Bridge A) |
| `cacbg_officials` / `cacbg_local` | `update-officials` | executive + municipal officials |
| `egov_commerce` | `tr-daily-refresh` | TR officers/owners (Bridge A + B) + company names + procurement join |
| `cik_results` | election ingest | NS candidates (by-slug shards) |
| `cik_local` / `CIK local-elections bundles` | `update-local-elections` | local mayors + councillors (elected office holders) |
| `erik_campaign_financing` | `update-financing` | ЕРИК donors |
| `parliament_mps` | `parliament-scrape` | the MP gold key (Tier 0) |
| `ofac_sanctions` | **this skill (curated)** | the OFAC/EU sanctions facet |
| `comdos_ds` | **this skill (curated)** | the ДС/COMDOS affiliation facet |
| `regulator_rosters` | **this skill (curated)** | the `regulator` "кой решава" facet (independent-body seats) |

It is safe (and cheap, ~10s) to re-run after ANY of these; a rebuild yields identical
person_ids/slugs when nothing changed (verified idempotent).

## How to run

```bash
npm run db:resolve:persons        # applies 081+085+082-084 schema + resolves + rebuilds person_*
npm run db:load:person-elections:pg  # loads candidate_person + person_election_stats (the merged /candidate block)
npm run test:person               # the §7a gold-set + hermetic matcher tests
npm run test:data                 # PG invariants incl. person_resolve.data.test.ts (zero-false-public-merge, tr-bridge licensing, connections public-safety)
```

The resolver self-applies its schema (081 core, **085 electoral tables — must precede 082**,
082 profile/search fns, 083 review queue, 084 person↔person edges), so it also bootstraps a
fresh/empty DB. The `candidate_person`/`person_election_stats` ROWS are then filled by the
separate `db:load:person-elections:pg` loader (which re-applies 085 idempotently and reads the
per-election CIK shards) — always run it AFTER the resolve. Both are wired into `db:refresh` in
that order. (085 must be created before 082 because 082's `person_search` reads
`person_election_stats` in a LANGUAGE-sql body validated at CREATE time.)

## The sanctions register (data/person/sanctions.json) — manually curated

`ofac_sanctions` has no clean machine-readable BG-filtered feed, so the register is
hand-maintained, exactly like `transparency_cpi` / `wiki_governments`. Each entry is an
OFFICIAL government designation (OFAC Global Magnitsky / EU) verified at the official
source: **https://sanctionssearch.ofac.treas.gov/** .

DEFAMATION RULE (non-negotiable): an entry attaches to a person ONLY via a stable
disambiguator — `mpId` (→ a Tier-0 gold merge onto that MP). A name-ambiguous designee
(several same-named people in the layer) MUST stay `resolved:false` (documented, not
attached) so no wrong same-named person is ever publicly accused. To add a designee:

1. Verify the designation at sanctionssearch.ofac.treas.gov (program, authority, date).
2. Find the person: `psql … -c "SELECT slug, display_name FROM person WHERE display_name ILIKE '%<name>%'"`.
   - If they are an MP and unique → add `"mpId": <id>` and `"resolved": true`.
   - If the name is ambiguous / not an MP → add the entry with `"resolved": false` and a
     `note`; it will be HELD (the resolver logs `held N name-ambiguous sanction(s)`).
3. `npm run db:resolve:persons` and confirm the profile shows the red "Санкции" tile
   (e.g. `/person/mp-5100` for Delyan Peevski → US Global Magnitsky, OFAC, 2021-06-02).

## The regulator register — the Court-of-Audit feed now covers most of it

`data/person/regulators.json` was written on the premise that no machine-readable
roster of the independent bodies exists. That is no longer true. Since the
executive ingest widened to the whole Сметна палата register
(`scripts/officials/categorise.ts`), the register itself supplies **188**
regulator declarants — 25 Конституционен съд, 17 КРС, 16 КЕВР, 15 БНБ, 15 ЦИК,
14 КЗД, 14 КОНПИ, 13 КЗК, 13 СЕМ, 10 НБКСРС, 10 КФН, 9 Сметна палата — with a
statutory filing obligation behind them and a declaration per person. **26 of the
34 curated seats appear in it** (the other 8 differ only by married/hyphenated
surname form).

Keep both, for different jobs:

- **The register is the membership source.** It is broader, refreshes with every
  ingest, and cannot go stale by neglect. These people arrive as `official_exec`
  roles with `role='regulator'` (or `central_bank` / `audit_court`).
- **The curated file is the SEAT source.** It is the only place that records
  *which* seat — chair vs deputy vs member (`constitutional_court_chair`) —
  which the register does not publish. That detail drives the `pp_reg_seat_*`
  labels.

So when refreshing: do not hand-add a member the register already carries; do
add or correct a `seat` where the distinction matters. The accuracy rule below
still governs the curated file.

## The ДС/COMDOS register (data/person/ds.json) — manually curated

`comdos_ds` (comdos.bg — Комисия по досиетата) has NO bulk export or API — only a
per-person search FORM and a per-organisation решения archive — so, exactly like the
sanctions register, `data/person/ds.json` is HAND-CURATED from the published решения
(the primary text of the political решения, e.g. решение № 14 / 04.09.2007, is mirrored on
Wikisource). Each entry is an OFFICIAL state finding of established affiliation to State
Security / БНА intelligence (a публичен акт, not our claim).

DEFAMATION RULE (non-negotiable, identical to sanctions): an entry attaches ONLY via a
stable disambiguator — the parliament `mpId` (→ Tier-0 gold merge) — AND is verified by an
**exact birth-date match** against the решение. This double gate is what defeats the
namesake trap: e.g. решение № 14 names a "Красимир Дончев Каракачанов" born **1937**
(щатен служител), who is a DIFFERENT person from the current ВМРО MP of the same name born
**1965**; a бирth-date mismatch → the entry stays `resolved:false` (documented, HELD, never
attached). To add an affiliation:

1. Find the решение naming the person on comdos.bg (Проверени лица) / the published решения;
   record the решение № + date + collaborator category (агент/сътрудник/…) + псевдоним.
2. Find the MP: `psql … -c "SELECT id, name, birthDate FROM …"` (or grep
   `data/parliament/index.json`) and CONFIRM the решение's birth date matches the MP's.
   - Match → add `"mpId": <id>`, `"birthDate": "<YYYY-MM-DD>"`, `"resolved": true`.
   - Mismatch / no birth date in the решение / not an MP → add with `"resolved": false` and
     a `note`; it is HELD (the resolver logs `held N name-ambiguous ДС affiliation(s)`).
3. `npm run db:resolve:persons` and confirm the profile shows the amber "Досие ДС" tile
   (e.g. `/person/mp-902` for Ahmed Dogan → агент „Сергей", реш. № 14/2007-09-04).
## The regulators register (data/person/regulators.json) — manually curated

`regulator_rosters` has no unified feed — each independent body publishes its own roster —
so the register is hand-maintained (like `sanctions.json`), covering the Конституционен съд,
Сметна палата, КФН, БНБ (Управителен съвет), СЕМ, КЗК and the Омбудсман. Each entry is a
PUBLIC-RECORD seat verified against the body's OFFICIAL page (the per-entry `url`).

ACCURACY RULE (same discipline as sanctions, though a regulator seat is a NEUTRAL civic
office, not an accusation): an entry attaches ONLY via a stable disambiguator — an `mpId`
(→ a Tier-0 gold merge onto that MP) OR a name confirmed globally-unique in the person
layer. To add / refresh a member:

1. Get the current roster from the body's official page (see each entry's `url`).
2. Resolve the person: if they are (or were) an MP, prefer `"mpId": <id>` (grep
   `data/parliament/index.json` for the full name). Otherwise add `"resolved": true` and,
   after resolving, CONFIRM the minted person is `namesake_risk <= 1`:
   `psql … -c "SELECT slug, namesake_risk FROM person WHERE display_name = '<name>'"`.
   If the name is NOT unique (namesake_risk > 1, or several same-named people) → flip the
   entry to `"resolved": false` with a `note`; it is HELD (`held N name-ambiguous
   regulator seat(s)`) and never attached.
3. `npm run db:resolve:persons` and confirm the profile shows the neutral "Регулатори /
   независими органи" tile + the `Регулатор` facet chip (e.g. `/person/pavlina-panova-…`).
   Seat labels live under the `pp_reg_seat_<seat>` i18n keys — add a new seat there.

## Publishing to production (Cloud SQL)

The `person_*` tables are Postgres-only, so `db:resolve:persons` above updates only LOCAL
Postgres. The live `/person` page + `personProfile`/`personConnections` AI tools read the
`db` Cloud Function against **Cloud SQL**, so a change is not public until you re-resolve
against the cloud proxy:

```bash
# The resolver reads its PG sources (magistrate / official_roster / tr_person_roles /
# contracts) from whatever DATABASE_URL points at, so those must ALREADY be loaded on
# Cloud SQL (db:load:magistrates:pg:cloud, db:load:tr:pg:cloud, db:load:pg:cloud) first.
npm run db:resolve:persons:cloud            # applies 081+085+082-084 + rebuilds person_* on Cloud SQL
npm run db:load:person-elections:pg:cloud   # loads candidate_person + person_election_stats on Cloud SQL
```

BOTH commands are required — the first rebuilds the identity/roles/connections layer, the
second fills the electoral tables behind the merged `/candidate` block. Publishing only the
first leaves `/candidate/:id` and the header search's party badge stale/empty on prod. On a
FRESH Cloud SQL (person tables absent), `db:resolve:persons:cloud` now self-bootstraps the
right order (085 before 082); if you ever hit `relation "person_election_stats" does not exist`
on an older checkout, apply `085_person_elections.sql` by hand first, then re-run.

The route layer (`functions/db_routes.js` person-profile / person-lookup / person-connections)
ships with the normal `npm run deploy` (functions deploy) — until that deploy runs, prod
returns `{"error":"unknown db route"}` for the person routes.

CAVEAT (like `reference_contracts_reload_lock`): the resolver TRUNCATE+COPYs `person_*`, so
`/person` briefly 500s during the ~10s cloud rebuild. It is small and fast enough that a
staging-swap isn't warranted, but don't run it during a traffic spike.

## After running

`db:resolve:persons` stamps `state/ingest/update-persons.json` itself, with the person /
role / alias counts and whether it hit local or cloud — there is no marker step to
remember. (It used to be a hand-rolled `node -e` that wrote the marker under a shorter
name; the orchestrator looks up `state/ingest/<skill>.json`, so that marker was never
found and this skill was queued on every single run.)

It also appends a `/data/updates` row — the person tables are Postgres-only and write
nothing under `data/`, so the orchestrator's `git diff --stat data/` gate would otherwise
never see this layer. Both are skipped when the derivation resolves zero persons (a fresh
clone or a wrong `DATABASE_URL`): a marker claiming success there would make the
orchestrator skip the layer silently. `db:resolve:persons:cloud` passes `--no-stamp` — the
marker answers "when was the LOCAL layer last rebuilt", so a cloud-only publish must not
advance it. Pass it yourself for a scratch run (`npm run db:resolve:persons -- --no-stamp`,
note the `--`).

Under `/process-watch-report` the orchestrator stamps the same file again in its step 5, so
the committed summary there is the orchestrator's rather than this script's — same
timestamp semantics either way.

To re-stamp by hand — e.g. after a run that only did the person-elections load — use the
shared CLI every other skill uses:

```bash
npx tsx scripts/stamp-ingest.ts update-persons --summary "<one line>"
```

Then commit the changed curated register(s) — `data/person/sanctions.json` /
`data/person/ds.json` / `data/person/regulators.json` (if edited). The person_* tables are
Postgres-only (no serving JSON, no `recordIngestBatch`), so there is nothing else to commit.
