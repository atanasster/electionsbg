# Roll-call source and identity ledger

Measured 2026-09-12 against local PostgreSQL, without modifying source records. See `ai-rollcall-chat-source-snapshot-v1.json` for exact query results. This is not a production freshness assertion.

- Parliament: assemblies 44–52; 623 indexed day records, all with PDF links. The 52nd reaches 2026-09-11. Blank titles exist in every indexed assembly and must not exclude a session or cast from browsing.
- Boyko Rashkov resolves in the source seat table as БОЙКО ИЛИЕВ РАШКОВ, `(48,5254)` through `(52,5254)`. Equal source names/IDs across terms are candidate evidence, not by themselves a canonical cross-term identity claim. The implementation must offer explicit seats when the verified bridge is unavailable.
- Council: 16 indexed councils; six have resolutions marked with named votes (Burgas, Gabrovo, Pernik, Sofia, Kazanlak, Veliko Tarnovo). The old five-council/29,054-cast comments are obsolete snapshot counts. Current named cast rows: 51,672; linked person rows: 48,653. A linked row is not proof of mandate validity; do not advertise historical role eligibility from it alone.
- Haskovo's 387 rows all carry 2022-01-01. The parser confirms the cause: `scripts/council/parsers/hkv.ts` constructs the date as `${year}-01-01` from the year. Disable day/month/session claims for these year-only source records; preserve year-level coverage with an explicit date-quality limitation.
- Council source topics live in raw `tags`; schema 160 does not persist that field. Source-title matching can operate now; tag search needs an explicitly owned projection and version. Generated summaries cannot independently prove a vote or topic classification.

## Serving ownership and dependency order

Parliament raw facts: `scripts/db/load_rollcall_pg.ts`, migrations 134 and 180, sourced from durable session JSON. `load_rollcall_derived_pg.ts`/migration 135 own whole-term metrics; these cannot answer restricted date windows. Preserve `(ns,mp_id)`, standing markers and affiliation at cast time.

Council facts: `scripts/db/load_council_pg.ts`, migrations 160/161, sourced from durable per-resolution shards, not capped/stripped index derivatives. Resolve frontend and roster codes using `councilObshtinaMap.ts` and `council_muni_code`. Person resolution precedes the council loader; person rebuild can null the person bridge, so revision invalidation and reattachment must be verified.

## Capability boundaries

| Population | Supported evidence | Must remain unavailable unless new evidence is verified |
|---|---|---|
| Parliament sessions | Indexed `(ns,date)`, source PDF, item counts | Complete future calendar, official session number inferred from day |
| Parliament votes/casts | Motion title/topic, raw/standing status, explicit choices, composite seat, cast-time faction | Legal enactment/quorum inferred from tally; unverified cross-term person grouping |
| Council resolutions | Indexed stable resolution ID, source title, recorded outcome/tallies | Complete procedural-vote register; source-tag scope until projected |
| Council sessions | Derived groups of indexed resolutions, qualified date quality | Complete official sitting register |
| Council casts | Published named rows, source identity, qualified person links | Physical absence from missing rows; historical party/eligible-member metrics without mandate evidence |

Regression specifications for the two screenshots, named latest votes and scoped council decisions are checked in as expected failures; step 5 must turn them into ordinary passing assertions. All requested audit categories have now been measured or inspected as documented below; implementation tests must enforce these capability boundaries.

## Additional review-verified evidence

Reproducible SQL and results are retained under `additionalProbes` in the snapshot.

- Parliamentary casts have no duplicate `(item_id,mp_id)` keys and no items without cast rows. Twelve item tallies disagree with named cast counts; return both and flag discrepancies.
- Council has 220 derived municipality/date/session groups; no missing source URL or session identifier in the current snapshot. There are 773 aggregate/named tally disagreements and zero named flags without cast rows. Neither statistic establishes source completeness.
- Twenty-six parliamentary MP IDs carry distinct names across assemblies. The current person writer (`scripts/person/resolve_persons.ts`, `mpRoleRowsFor`) does emit composite `mpId:ns` role references, alongside undated bare IDs. Exact composite references, verified confidence and matching source names can establish cross-term identity; bare references alone cannot.
- Rashkov's five composite roles all resolve with `exact_id` to the same canonical person and matching full name in this snapshot. This supports his cross-term query after revision-bound validation; never hard-code the positional person ID.
- `official_roster` has name/slug/role/tier/municipality/district/sitting, but no mandate interval. Council person roles have either filing dates (94 rows) or no date basis (4,857); electoral councillor-role dates are election evidence, not independently verified mandate participation. The council loader matches municipality-scoped names and corroborates three-part protocol names, but does not establish historical mandate eligibility. Disable council eligible-member attendance, party alignment and canonical cross-mandate attribution; source-labeled named rows remain queryable.
