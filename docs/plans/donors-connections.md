# PRD: Campaign donors in the connections graph

Status: **blocked on data quality** — gated on a ЕРИК-register feasibility check.

## Context

The connections graph now covers MPs and non-MP officials (cabinet, governors,
mayors, councillors). Campaign **donors** are the next entity in the
"whole political class" picture: who funds the parties, and do those donors
share companies with the MPs / officials they fund.

This was attempted and **reverted** — see "Verified data availability". The
blocker is not effort; it is that the donor data on hand carries no identifier
strong enough to resolve a donor to a Commerce Registry person. This PRD
documents the blocker, the reverted design (so it can be rebuilt), and the
ЕРИК-register path that might unblock it.

## Verified data availability

- **Current donor data** — `data/{election}/parties/financing/{partyNum}/filing.json`,
  field `data.fromDonors[]` (type `FinancingFromDonors`: `name, date, monetary,
  nonMonetary, goal, coalition, party`). Source: the per-party campaign-finance
  filings parsed by `scripts/smetna_palata/parse_donors.ts` from `from_donors.csv`.
- **Volume** — 453 distinct donors / 521 donation rows, **only 2 elections**
  (2024-06-09, 2024-10-27).
- **The blocker** — every donor name is **2-part** (given + family, e.g.
  "Георги Бакалов"). All 521 of 521. The Commerce Registry identifies people by
  **3-part** Bulgarian names — 210,010 of ~238k current `company_persons`
  records are 3-part, only 21,155 are 2-part. A 2-part name cannot be resolved
  to a specific 3-part TR person. There is no EIK and no ЕГН on the donor rows.
- **Reverted proof-of-concept** — a `build_donor_links.ts` cross-reference was
  built and run: exact normalised match produced **5 of 453** donors with any
  company, **0** donor↔MP bridges. The scaffolding was reverted (commit history
  has none of it).

## Why fuzzy matching is not an option

The only way to lift the match rate is a first-token + last-token match against
TR (ignoring the patronymic). That would assert that donor "Петър Петров"
(literally in the donor list) co-owns companies with MP X — almost always
falsely. In a civic-transparency app a confidently-wrong link is worse than no
feature. The officials work already showed ~38% of name matches are
namesake-ambiguous *with* 3-part names; 2-part names are far worse. Do not ship
a fuzzy donor cross-reference.

## The ЕРИК path (the only viable unblock)

`erik.bulnao.government.bg` (Единен регистър по Изборния кодекс — the Court of
Audit's election-financing register) is the authoritative campaign-finance
source. The About page already links per-election report pages
(`erik.bulnao.government.bg/Reports/Index/83` for 2024-10-27,
`/80` for 2024-06-09). It is **unverified** whether ЕРИК's donor records carry
fuller identifiers than the parsed CSVs do.

### Phase 0 — ЕРИК feasibility (GO / NO-GO gate)

Inspect a single campaign's donor records on `erik.bulnao.government.bg`:

1. Do donor records carry **3-part names**? (Unblocks individual donors.)
2. Is there an **EIK** for any corporate donors? (Note: BG law heavily restricts
   corporate political donations, so corporate donors are rare — but an EIK is a
   clean join key when present.)
3. Is the site behind Cloudflare / a WAF? (results.cik.bg is — see
   `scripts/watch/sources/cik.ts`; ЕРИК may be too, which would need a
   Playwright-based fetch.)

If ЕРИК has only 2-part names → **donors-in-connections stays blocked**; stop
here and record it. If it has 3-part names → proceed.

### Phase 1 — ingest donors from ЕРИК

Add an ingest (extend `scripts/smetna_palata/` or a new `scripts/financing/`
script) that pulls donor records with full names, keyed per election + party,
into a stable artifact (e.g. `data/financing/donors/{election}.json`).

### Phase 2 — donor → company / MP / official cross-reference

Re-instate the reverted `build_donor_links.ts` design (additive, mirrors
`build_officials_company_links.ts` — does NOT touch the connections-graph
builder):

- Dedup donors across elections, keyed by `normalize(name)` (the shared
  `scripts/officials/shared.ts` `normalize`).
- TR `company_persons` name match (`erased_at IS NULL`), same `normalize` on
  both sides.
- `trCompanyCount` per donor — a high count flags a common name → low
  confidence.
- Bridge donor company UICs against `data/parliament/companies-index.json`
  (`mpRoles` → MPs) and `data/officials/derived/company_links.json`
  (→ officials); drop edges where the donor and the MP/official share an
  identical normalised name (same person).
- Output `data/financing/derived/donor_links.json`
  (type sketch: `DonorLinksFile` / `DonorLinksEntry` / `DonorCompanyLink` /
  `DonorMpConnection` — keyed by normalised name; carries `donations[]`,
  `companies[]`, `mpConnections[]`, `officialConnections[]`).
- Standalone runner `scripts/run-donor-links-only.ts`; wire into
  `scripts/declarations/index.ts` after `buildOfficialsConnections`.

### Phase 3 — graph + UI (optional follow-on)

Fold donors into `connections.json` as a `donor:` node type (mirror the
officials Stage 1 — phase 2.5 of `build_connections_graph.ts`), and surface a
donor section. Defer until Phase 2 proves the data is clean enough.

## Risks & open questions

- **ЕРИК may also carry only 2-part names** — then donors are permanently
  blocked with the current sources. Phase 0 is a hard gate.
- **Namesake noise remains** even with 3-part names (officials: ~38% of TR
  matches namesake-ambiguous). Donor links will need confidence flags and an
  honest UI treatment.
- **Cross-election aggregation** also conflates namesakes — a 2-part (or even
  3-part-common) name collapses distinct real donors into one entry.
- ЕРИК may be WAF/Cloudflare-protected → Playwright-based fetch.
- Only 2 elections of donor data exist today; older campaigns may need
  backfilling from ЕРИК.
