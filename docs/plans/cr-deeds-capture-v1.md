# CR Deeds full-capture — v1

Capture and durably persist the **complete** Търговски регистър deed record for every
company we care about, from the authoritative Registry Agency API, so that today's gap
(missing ownership) and any future feature (activities, addresses, capital history,
branches, insolvency, transformations, …) are served from data we fetched **once**.

## 0. Status — what this plan inherited (2026-07-27)

**The `fetch_company_founded` crawl was CANCELLED mid-run so it could be folded into this
plan.** This is no longer "starts after that crawl finishes"; that crawl is not going to
finish separately, and three things now belong to this plan:

1. **The remaining founding-date work set: ~10,953 contractor EIKs.** `company_founded`
   holds 15,887 rows (15,799 dated). The crawl stopped at 100/10,953 with 0 failures — the
   earlier IP block had expired by then (measured 6.0s/EIK, 2/2 answered).
2. **The refresh cadence.** `procurement-risk-v2` §7.5 deliberately did NOT wire a periodic
   `fetch_company_founded` run into the watcher, because two independent daily crawlers
   against one rate-limited host would throttle each other and re-create the block that
   corrupted the 2026-07 run. Whichever crawler survives owns the cadence — that is this one.
3. **The hardened fetch semantics below.** Do not re-derive them.

### ⚠️ The invariant this plan MUST carry over

`fetch_company_founded` was hardened on 2026-07-27 after it silently corrupted its own
table: it returned a bare `null` for **every** failure mode and persisted it, and because the
resume query skips any EIK already present, a failed fetch became a permanent, never-retried
claim that the firm has no founding date. The daily null rate climbed 4.7% → 47.2% in
lockstep with the source throttling us.

**A row means "the register answered." A null field means "it answered and had nothing."
It must never mean "we could not reach it."** Copying the old crawler's shape and
re-deriving this would silently reopen the same hole at 478k–1M-request scale, where it
would be far harder to notice. Reuse `fetchFounded`'s discriminated result
(`{ok:true,…} | {ok:false,reason,…}`) — see DUP-001 in the 2026-07-27 review: extract the
shared client rather than fork it.

**Measured response semantics (live API, 2026-07-27) — build on these, not on guesses:**

| response | meaning | persist? |
|---|---|---|
| 200 + JSON object with `uic`/`deedStatus`/`sections` (~36KB) | real company | ✅ |
| 200 + **empty body** (confirmed twice) | no such company — it does **not** 404 | ✅ as a real null |
| 200 + parseable JSON without the deed shape (`{}`, `[]`, `null`, `{"Message":…}`) | block page / error envelope | ❌ |
| 200 + unparseable body | interstitial | ❌ |
| 404 / other non-200 / 429 / timeout | no answer (404 never occurs in practice ⇒ treat as WAF) | ❌ |

Also inherited and worth reusing: adaptive pacing + a circuit breaker on both consecutive
failures and wall-clock silence (a stalled run must be loud — the old one ground for days at
~30 min/EIK before anyone looked), a read-only `--probe` to measure block state before
committing to a long run, and `http_status`/`attempts` provenance columns so a null is
auditable after the fact.

⚠️ `company_founded` carries `http_status`/`attempts` (migration 033). Apply 033 to any
target DB **before** writing, or the upsert fails; the script preflights and exits 2.

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
- Fetcher `scripts/declarations/tr/fetch_cr_deeds.ts`: **extract** the
  `fetch_company_founded` client into a shared module and call it — do not copy it. It
  carries the ok/not-ok invariant in §0 plus curl (TLS fingerprinting), `-w %{http_code}`,
  adaptive pacing from 5s, exp backoff on 429, confirmed-empty-body handling, a circuit
  breaker and a 30s timeout. A verbatim copy forks those semantics, and only one fork gets
  the next fix. For each target EIK: fetch → store raw body → nothing parsed here.
  ⚠️ At this scale the raw store must record the FAILURE too (eik, reason, status, attempts)
  rather than dropping it — over weeks a silent gap is indistinguishable from "this company
  has no deeds."
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

## 4. Spikes to resolve first (nothing blocks these now — the founding crawl was cancelled)

1. **Deeds JSON schema inventory** — fetch ~8 diverse EIKs (EOOD, ООД, АД/ЕАД, ЕТ, ЮЛНЦ,
   a branch, a bankrupt, a transformed company), dump raw, enumerate every element/field.
   Deliverable: the raw→typed field map + a decision "reuse `parse_daily_filing` vs CR
   adapter." The CR API and the data.egov open-data export are the same registry deed model
   but **may differ in field names** — this is the main unknown.
2. **Current-state derivation** — confirm the Deeds tree carries erasure/validity so we can
   reconstruct *active* vs *erased* records (owners closed on transfer, ex-managers). The
   ~15.8k EIKs the founding crawl did fetch confirm the Deeds tree returns dated history
   (`min(fieldEntryDate)` resolves for every one of them); the active/erased signal is still
   unconfirmed and is the real unknown here.
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
- **Egress.** curl endpoint reachable from the run host — confirmed on the dev machine
  2026-07-27 (`--probe`: 2/2 answered, 6.0s/EIK). Re-confirm if run elsewhere, and note the
  limit is **per-IP**: the 2026-07 block tightened over ~7 days of sustained crawling from
  one address, so a weeks-long Tier-3 run should assume it will be throttled and plan the
  egress accordingly rather than discovering it on day 6.
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
