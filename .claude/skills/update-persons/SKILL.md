---
name: update-persons
description: Rebuild the unified person-identity layer (Postgres `person`/`person_role`/`person_alias`/`person_review_candidate` + the serving fns in 082/084) that powers the `/person/{slug}` profile page and the `personProfile`/`personConnections` AI tools. It resolves EVERY people dataset — MPs, CIK candidates, ЕРИК donors, executive & municipal officials, magistrates (ИВСС), TR company officers/owners (bridged), the curated OFAC/EU sanctions register (data/person/sanctions.json), and the curated ДС/COMDOS affiliation register (data/person/ds.json, Комисия по досиетата) — to ONE stable person_id via `scripts/person/resolve_persons.ts`. Use when the daily watch report flags any of its UPSTREAM sources as changed (`ivss_declarations`, `cacbg_officials`, `cacbg_local`, `egov_commerce`, `cik_results`, `erik_campaign_financing`, `ofac_sanctions`, or `comdos_ds`), when the user asks to refresh person profiles / свързани лица / sanctions / ДС досиета, to add a newly-verified sanctions designee or ДС affiliation, or after a fresh git clone if the `person` table is empty. Read-only re-derivation — it never mutates its source datasets, only the person_* tables.
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

It is safe (and cheap, ~10s) to re-run after ANY of these; a rebuild yields identical
person_ids/slugs when nothing changed (verified idempotent).

## How to run

```bash
npm run db:resolve:persons        # applies 081-084 schema + resolves + rebuilds person_*
npm run test:person               # the §7a gold-set + hermetic matcher tests
npm run test:data                 # PG invariants incl. person_resolve.data.test.ts (zero-false-public-merge, tr-bridge licensing, connections public-safety)
```

The resolver self-applies its schema (081 core, 082 profile/search fns, 083 review queue,
084 person↔person edges), so it also bootstraps a fresh/empty DB.

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

## Publishing to production (Cloud SQL)

The `person_*` tables are Postgres-only, so `db:resolve:persons` above updates only LOCAL
Postgres. The live `/person` page + `personProfile`/`personConnections` AI tools read the
`db` Cloud Function against **Cloud SQL**, so a change is not public until you re-resolve
against the cloud proxy:

```bash
# The resolver reads its PG sources (magistrate / official_roster / tr_person_roles /
# contracts) from whatever DATABASE_URL points at, so those must ALREADY be loaded on
# Cloud SQL (db:load:magistrates:pg:cloud, db:load:tr:pg:cloud, db:load:pg:cloud) first.
npm run db:resolve:persons:cloud     # applies 081-084 + rebuilds person_* on Cloud SQL
```

The route layer (`functions/db_routes.js` person-profile / person-lookup / person-connections)
ships with the normal `npm run deploy` (functions deploy) — until that deploy runs, prod
returns `{"error":"unknown db route"}` for the person routes.

CAVEAT (like `reference_contracts_reload_lock`): the resolver TRUNCATE+COPYs `person_*`, so
`/person` briefly 500s during the ~10s cloud rebuild. It is small and fast enough that a
staging-swap isn't warranted, but don't run it during a traffic spike.

## After running

Record the ingest marker for the orchestrator:

```bash
node -e 'const fs=require("fs");fs.writeFileSync("state/ingest/persons.json",JSON.stringify({lastSuccessfulIngest:new Date().toISOString(),skill:"update-persons",summary:"<one line>"},null,2))'
```

Then commit the changed `data/person/sanctions.json` / `data/person/ds.json` (if edited) —
the person_* tables are Postgres-only (no serving JSON, no `recordIngestBatch`), so there is
nothing else to commit.
