# CR Deeds full-capture — v1

Capture and durably persist the **complete** Търговски регистър deed record for every
company we care about, from the authoritative Registry Agency API, so that today's gap
(missing ownership) and any future feature (activities, addresses, capital history,
branches, insolvency, transformations, …) are served from data we fetched **once**.

Starts **after** the running `fetch_company_founded` crawl finishes (~3 days from
2026-07-25, ~6.3k contractor EIKs left of 26.7k).

---

## 1. Problem recap (why this exists)

- The TR pipeline is a daily-filings **event stream** (data.egov.bg), floor **2021-01-01**
  (bulk 2021-01-01→2022-09-02, per-resource after). Verified: local `dataset-index.json`
  earliest = 2022-09-03; bulk covers the 2021 window.
- Filings are **deltas** — only changed sections. A company born before 2021 whose
  ownership never changed since has its owner only in a pre-window genesis filing → we
  never see it. Result: **477,881 / 676,287 EOOD (71%) have no owner record**, even though
  a single-member LLC *must by law* have exactly one. (Хърикейн / Алфред Дюмон / АЙ РОУД:
  managers present from 2026 delta filings, owner Ирина absent.)
- Not a parser bug — `parse_daily_filing` maps `SoleCapitalOwner → sole_owner` correctly
  (Пирин голф, born 2022, has its owner). It's a **cold-start / pre-2021 genesis** gap.
- The **only** full-current-state source is per-company:
  `GET https://portal.registryagency.bg/CR/api/Deeds/{eik}` — no auth, no CAPTCHA, returns
  the complete deed history back to registration (2008). Already proven in-repo by
  `scripts/procurement/fetch_company_founded.ts` (curl to dodge TLS fingerprinting;
  ~1 req/5s; 429 backoff; resumable). That tree contains the pre-2021 genesis deed with the
  owner section — but the running job walks it only for the min date and **discards the
  rest**.

**Design principle (per request):** persist ALL available deed information verbatim, even
fields we don't consume today. Fetch is the only expensive step; never pay it twice.

---

## 2. Architecture — three layers

### Layer 1 — Raw capture (the durable store; the ONLY rate-limited step)

Store the complete API response per EIK, immutable, gzipped.

- Store: `raw_data/tr/cr_deeds.sqlite` (parallel to `state.sqlite`, same grain), table:
  ```
  cr_deeds(
    uic          TEXT PRIMARY KEY,
    raw_gz       BLOB NOT NULL,     -- gzip of the exact HTTP body
    byte_len     INTEGER,           -- uncompressed length
    content_hash TEXT,              -- sha256(body) for change detection on refresh
    http_status  INTEGER,
    fetched_at   TEXT NOT NULL,
    api_version  TEXT               -- endpoint id, in case the API shape changes
  )
  ```
  (SQLite chosen for consistency with `state.sqlite`, trivial resume/query, one file.
   Gitignored; large. Alternative if it outgrows a file: a PG `cr_deeds_raw` jsonb table.)
- Fetcher `scripts/declarations/tr/fetch_cr_deeds.ts`: reuse the `fetch_company_founded`
  harness verbatim (curl, `-w %{http_code}`, 5s pace, exp backoff on 429, empty-body retry,
  30s timeout). For each target EIK: fetch → store raw body → nothing parsed here.
- **Resumable / idempotent:** skip EIKs already present with a recent `fetched_at` (unless
  `--refresh-before <date>`). Checkpoint-friendly for a weeks-long crawl.
- **Politeness:** single IP token bucket — **never run concurrently** with
  `fetch_company_founded` or any other CR job. This job SUPERSEDES the founding crawl.

### Layer 2 — Projection (re-runnable offline, NO fetching)

Parse the raw store into typed outputs. Because raw is cached, adding a new field later =
re-run this layer over the store, zero new fetches.

- Parser `scripts/declarations/tr/parse_cr_deeds.ts` — maps the CR Deeds tree to our
  existing event/section model. Reuse `PERSON_SECTION_TO_ROLE`, `META_FIELD_TO_KIND`,
  `parseShareAmount` where field shapes align; otherwise a thin adapter normalizes CR field
  names first. **Do NOT assume `state_replay.ts` applies** — it replays a stream of daily
  DELTA filings, whereas the Deeds API likely returns either the full deed history OR an
  already-resolved current state in one document; the reconstruction (or lack of one) is
  part of spike §4.1/§4.2. **Section-shape + state-model parity is the #1 spike** (§4).
- Outputs (phased — persons first, rest as features need them):
  1. **Persons/owners** → merge into `state.sqlite.company_persons` (the Cause-2 fix). For a
     company with a CR capture, the CR full history is authoritative → **delete+replace that
     uic's `company_persons` rows** (avoids partial-merge/dedup guesswork). Companies with
     no CR capture keep their daily-feed-derived rows. **Guard:** replace ONLY on a
     complete, successfully-parsed capture that yields ≥1 person record (an EOOD MUST resolve
     an owner) — never on an empty/partial/errored parse, or a fetch glitch silently wipes
     good daily-feed data. Mark replaced uics (`persons_source='cr'`) so the daily feed and
     re-runs know precedence.
  2. **Founding date** → `company_founded` (subsumes `fetch_company_founded`; same
     `min(fieldEntryDate)` logic, now off the cached raw).
  3. **Company meta already modelled**: seat, funds/capital, legal_form, status,
     cessation/liquidation/bankruptcy flags.
  4. **Everything else the deeds carry** (capture now in raw, project when a feature lands):
     subject-of-activity / предмет на дейност, full addresses, capital-share history,
     branches (клонове), procurators, insolvency trustees, transformations
     (преобразувания), pledges on shares (залог на дял), foreign-jurisdiction owners, ЮЛНЦ
     governing bodies. → new typed tables per feature, always re-derived from raw.

### Layer 3 — Load & bridge (existing pipeline, unchanged wiring)

`db:load:tr:pg` reads `company_persons` → `tr_person_roles` / `tr_officers` →
`resolve_persons` bridges owners to people → person/company/connections pages. New owner
rows flow through with **no schema change** to the load path.

---

## 3. Scope & sequencing (rate limit is the binding constraint: ~1/5s ≈ 17k/day)

| Tier | Target set | Count | Wall-clock |
|---|---|---|---|
| 0 | Re-fetch the ~26.7k contractors (raw was discarded) + finish the 6.3k tail | ~26.7k | ~2 days |
| 1 | Missing-owner ∩ (contractor ∪ EU-funds ∪ subsidy ∪ person-bridged) | ~30k unique | ~2 days |
| 2 | All EOOD/ООД missing owner/partner | ~478k | ~4 weeks |
| 3 | Full corpus (durable-store completeness) | ~1M+ | months, background |

Tier-1 breakdown (measured): 8.5k contractors, 18.6k EU-funds beneficiaries, 6.4k
subsidy recipients, 717 already person-bridged (understated — discovering owners *creates*
bridges). Detection is pure SQL, no fetch: `tr_entity_class='company'` + EOOD/ЕООД legal
form + `NOT EXISTS` a `sole_owner`/`actual_owner` in `tr_person_roles`.

Run Tier 0→1, reassess, then let Tier 2/3 grind unattended with checkpointing.

---

## 4. Spikes to resolve first (when the founding crawl is done)

1. **Deeds JSON schema inventory** — fetch ~8 diverse EIKs (EOOD, ООД, АД/ЕАД, ЕТ, ЮЛНЦ,
   a branch, a bankrupt, a transformed company), dump raw, enumerate every element/field.
   Deliverable: the raw→typed field map + a decision "reuse `parse_daily_filing` vs CR
   adapter." The CR API and the data.egov open-data export are the same registry deed model
   but **may differ in field names** — this is the main unknown.
2. **Current-state derivation** — confirm the Deeds tree carries erasure/validity so we can
   reconstruct *active* vs *erased* records (owners closed on transfer, ex-managers). The
   founding crawl proves full history is returned; confirm the active/erased signal.
3. **Storage sizing** — measure avg gzipped deed size × target count. 478k × ~15-40 KB ⇒
   ~10-20 GB raw. Confirm SQLite-blob store is comfortable (or switch to sharded
   `raw_data/tr/deeds/{shard}/{eik}.json.gz`, or a PG jsonb table).
4. **Refresh policy** — deeds change; post-2021 changes still arrive via the daily feed, but
   a captured company can go stale. Define a re-fetch cadence (e.g. re-capture on a daily-
   feed delta touch, or an N-month sweep of active companies). `content_hash` drives no-op
   skips.

---

## 5. Interactions & risks

- **⚠ Bridge B footprint cap (Cause 1 coupling).** Backfilled owners raise a person's TR
  footprint. Ирина 3→6 companies would exceed `FOOTPRINT_CAP = 5` in `resolve_persons.ts`
  → Bridge B drops **all** her name-matched companies. Owner backfill will push others over
  too. Before/with Tier-1 load: revisit the cap, or treat CR-sourced owner rows as a
  stronger corroborant (still name-only — no ЕГН — so the cap logic, not just the source,
  must change). Re-check the `person_resolve` "licensed bridge" invariant after.
- **One source of truth.** Raw store → projects into `state.sqlite`; do NOT fork a parallel
  PG persons table. `company_persons` stays canonical.
- **Merge semantics.** CR full history is authoritative → replace-per-uic on capture; daily
  feed owns companies without a capture. Document precedence so a later daily delta on a
  CR-captured company doesn't half-overwrite it (options: daily feed also upserts by
  record_id, or CR-captured companies are marked and daily deltas re-trigger a CR refresh).
- **Licensing.** CR is CC-BY — add attribution (as the ГФО ingest does).
- **Changelog.** New/enriched owner data is a dataset change → wire into `recent_updates`
  per the PG-changelog rule.
- **Egress.** curl endpoint reachable from the run host (the founding crawl runs there).
  Re-confirm if run elsewhere.
- **⚠ Scrape fragility at Tier-3 scale.** 478k–1M requests over weeks/months at 1/5s is
  exposed to IP-blocking, silent API-shape changes mid-crawl, and ToS limits on an unofficial
  bulk extraction. **Before committing to Tier 3, evaluate an official full-database bulk**
  from the Registry Agency (Агенция по вписванията offers paid database access / пълен
  достъп) — a one-shot licensed dump would be more robust and complete than a months-long
  crawl, and may be cheaper in effort. The per-EIK crawl stays the right tool for Tier 0–2
  (targeted, ~30k) regardless. Persist `api_version`/`content_hash` so a mid-crawl shape
  change is detected, not silently mis-parsed.

---

## 6. Deliverables / order of work

1. Spike §4.1–§4.2 on ~8 EIKs; write the field map into this doc.
2. `fetch_cr_deeds.ts` (Layer 1) + `cr_deeds.sqlite` schema. Start Tier 0/1 crawl.
3. `parse_cr_deeds.ts` (Layer 2) → persons projection → `company_persons` replace-per-uic;
   fold in founding-date so `fetch_company_founded` is retired.
4. `db:load:tr:pg` reload → `db:resolve:persons`; verify Хърикейн/Алфред Дюмон/АЙ РОУД show
   Ирина as **Едноличен собственик**, and re-check the Bridge B cap + invariant test.
5. Tier 2/3 background crawl with checkpointing; refresh policy (§4.4).
6. Regression test: PG-backed assertion that a sampled EOOD with a CR capture has exactly
   one active owner; changelog entry.

---

## 7. Open decisions for the operator

- Raw store: single `cr_deeds.sqlite` blob table vs sharded gz files vs PG jsonb. (Default:
  SQLite blob, revisit at §4.3 sizing.)
- Coverage ambition: stop at Tier 2 (missing-owner EOOD/ООД) or push Tier 3 (full corpus)
  for the durable archive. (Default: Tier 0–2 by crawl now; for Tier 3, first evaluate the
  official paid CR bulk vs a months-long scrape — §5.)
- Bridge B cap change: raise the cap, or add a distinct higher-confidence tier for
  CR-sourced owners. (Needs a call before Tier-1 load lands owners on public figures.)
