# PRD: Arbitrary-person search & full Commerce Registry ingestion

Status: **not started** — the largest item on the connections roadmap; needs
its own design spike before implementation.

## Context

The connections feature today covers a *curated, bounded* set of entities —
MPs and non-MP officials (cabinet, governors, mayors, councillors) — pre-computed
offline into static JSON and cross-referenced against a partial Commerce
Registry.

The goal of this phase: let a reader type **any** Bulgarian person's name and
see that person's ties to the political class — MPs, officials, party donors,
EU-funds beneficiaries, procurement contractors. A journalist investigating a
name should not be limited to people the pipeline already curates.

This cannot be done with the current architecture. You cannot pre-compute a
connection graph for every person in Bulgaria, and the full Commerce Registry
(~1M+ legal entities, millions of officer records) cannot be shipped as static
JSON to the browser. Arbitrary-person search needs a queryable backend.

## Verified data availability

- **Current TR** — `raw_data/tr/state.sqlite` is a **partial** Commerce
  Registry: 576k companies, 243k `company_persons` rows, ~162k distinct person
  names. Built by `scripts/declarations/tr/` (the `update-connections` skill),
  scoped to companies the MP/official cross-references touch.
- **Full TR** — the Търговски регистър has ~1M+ active legal entities and far
  more historical/erased ones; officer records run to millions. A daily feed +
  bulk ZIPs are already partly wired (`raw_data/tr/daily/`, `dataset-index.json`,
  `scripts/declarations/tr/fetch_bulk_zip.ts`, `fetch_daily.ts`).
- **No ЕГН** anywhere — TR identifies people by name only. Entity resolution is
  therefore the central, permanent problem (see below).

## Architecture — two tiers

From the connections-expansion brainstorm. Keep the two tiers separate:

- **Tier 1 — curated graph (already shipped).** MPs + officials, pre-computed
  offline into static JSON (`connections.json` etc.), served from the GCS
  bucket. Fast, free, SEO-friendly, prerenderable. No change.
- **Tier 2 — arbitrary-person search (this PRD).** A queryable database. The
  static SPA calls it directly for the open-ended lookups; results link back
  into the Tier-1 curated graph where the person touches it.

### Database: Supabase (hosted Postgres)

Recommended. Rationale:

- **`pg_trgm`** — trigram fuzzy matching, essential for messy Bulgarian names
  (2-part vs 3-part, typos, transliteration variants).
- **Recursive CTEs** — bounded-depth graph traversal (person → company →
  co-officer → …) without a dedicated graph DB.
- **PostgREST / RPC** — Supabase exposes the database to the static client
  directly, so the "no backend server to operate" property of the JAMstack app
  is preserved. The SPA calls a search RPC; there is no Node server to run.
- Avoid **Firestore** — weak at exactly the two things this feature is (graph
  traversal and fuzzy search); per-document read billing punishes graph
  expansion.
- A dedicated graph DB (Neo4j/Memgraph) is overkill — bounded-depth CTEs in
  Postgres are sufficient and add no ops surface.

### Entity resolution — the hard part

No ЕГН ⇒ deterministic dedup is impossible. This is a permanent pipeline stage,
never "done":

- A canonical **`person`** entity (synthetic stable id) plus a **`mention`**
  layer linking raw name occurrences to it. Keep "raw mention" and "resolved
  person" as distinct layers — never silently merge.
- Resolution signals (no ЕГН): normalized name, **co-occurrence** (two
  "Иван Петров" sharing a company / address / co-officer are probably one
  person; sharing nothing, probably not), role context, date ranges,
  declaration cross-links.
- Confidence is first-class: "confirmed" vs "possible match" in the UI. The
  existing typo-override file pattern in `update-connections` extends naturally
  into a manual merge/split decision file.
- Adopt a typed ontology — the **FollowTheMoney** (FtM) schema (Person, Company,
  Ownership, Directorship, Membership, Payment) is the de-facto standard.
  References for the resolution workflow: **OpenSanctions**, **OCCRP Aleph**,
  **LittleSis**, **OpenCorporates** (which treats officer→person matching as
  deliberately probabilistic and un-merged).

## Phasing

- **Phase 0 — feasibility spike.** Full-TR data volume and the bulk-ZIP / daily-
  feed coverage; Postgres sizing; a Supabase free-tier vs paid assessment;
  prototype `pg_trgm` fuzzy match + a recursive-CTE traversal on a TR sample.
- **Phase 1 — full TR → Postgres.** Extend `scripts/declarations/tr/` ingest to
  full coverage; load `companies` + `company_persons` into Supabase Postgres
  with `pg_trgm` indexes on the name columns.
- **Phase 2 — entity-resolution pipeline.** The `person` / `mention` two-layer
  model; co-occurrence-based resolution; confidence scoring; a manual
  merge/split override file.
- **Phase 3 — search RPC.** A Postgres RPC: fuzzy name → candidate persons →
  1–2-hop connections to the curated MPs/officials + EU-funds + procurement
  (join on EIK where available). Returns confidence per edge.
- **Phase 4 — frontend.** A person-search surface; a result page showing the
  searched person's ties into the Tier-1 graph. Reuse the existing connections
  rendering where possible.

## Risks & open questions

- **Entity resolution is never finished** — with no ЕГН, there is an
  irreducible error rate. The product must present matches as probabilistic.
- **Cost** — full TR in Supabase Postgres at scale may exceed the free tier;
  size it in Phase 0.
- **Data volume** — full TR bulk data is large; ingestion and refresh cadence
  need a design (daily-feed deltas vs periodic bulk reload).
- **Tier-1 / Tier-2 consistency** — the curated static graph and the DB must
  agree on companies/persons they share (join on EIK).
- **Legal / privacy** — a searchable person-connection graph is built entirely
  from public registers, but the aggregation is more powerful than any single
  source; worth a deliberate editorial/legal check before launch.
- **Scope creep** — Tier 1 must stay static JSON. Resist moving the curated
  graph into the DB; only the unbounded arbitrary search belongs there.
