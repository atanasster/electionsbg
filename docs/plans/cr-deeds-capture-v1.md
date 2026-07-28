# CR Deeds full-capture — v1

Capture and durably persist the Търговски регистър deed record for every company we care
about, from the authoritative Registry Agency API, so that today's gap (missing ownership)
and any future feature (activities, addresses, capital, branches, insolvency,
transformations, …) are served from data we fetched **once**.

## 0. Status — what this plan inherited (2026-07-27)

**The `fetch_company_founded` crawl was CANCELLED mid-run so it could be folded into this
plan.** This is no longer "starts after that crawl finishes"; that crawl is not going to
finish separately, and three things now belong to this plan:

1. **The remaining founding-date work set: 10,844 contractor EIKs.** `company_founded`
   holds 15,887 rows (15,799 dated) against 26,731 distinct contractor EIKs, so the
   never-fetched tail is 26,731 − 15,887 = **10,844** — a *subset* of the contractor set,
   not an addition to it. (An earlier revision said 10,953, computed against a slightly
   older contracts corpus; the two figures were never consistent with the 15,887 above.)
   The crawl stopped at 100/10,844 with 0 failures — the earlier IP block had expired by
   then (measured 6.0s/EIK, 2/2 answered).
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

⚠️ **The same trap has a second mouth one layer down — see §2 Layer 1.** If a failure is
written into the raw store and the resume query skips "any EIK already present", the
identical permanent-lie bug returns at raw-capture scale.

**Measured response semantics (live API, 2026-07-27) — build on these, not on guesses:**

| response | meaning | persist? |
|---|---|---|
| 200 + JSON object with `uic`/`deedStatus`/`sections` (29–41KB) | real company | ✅ |
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

## 0a. What the endpoint actually returns (measured 2026-07-27 — supersedes earlier guesses)

Two live captures — `121587769` (ШНАЙДЕР ЕЛЕКТРИК БЪЛГАРИЯ, EOOD, 41,068 B) and `000022044`
(МБАЛ Разлог, EOOD, 28,761 B) — settle what were spikes §4.1 and §4.2. **Read this before
designing Layer 2; three earlier design decisions rest on premises it disproves.**

### ✅ The premise holds

`000022044` has **no owner** in our data. The API returns
`CR_F_23_L :: ОБЩИНА РАЗЛОГ, ЕИК/ПИК 000024948`, `fieldEntryDate 2008-09-04` — a pre-2021
genesis entry, exactly the cold-start gap §1 diagnoses. The fetch does close the hole.

### ❌ It is CURRENT STATE, not deed history

The field object's complete key set is
`nameCode, htmlData, fieldEntryNumber, recordMinActionDate, fieldEntryDate, fieldActionDate,
fieldIdent, fieldOperation, order` — **no erasure marker, no validity end date, no
superseded values**. Шнайдер (registered 1998, absorbed a company in 2014, moved seat 2021)
returns **24 fields in total**. `fieldEntryDate` is when the *currently in-force* value was
entered; it is not a history spine.

`?showHistory=true`, `?historical=true` and `?includeHistory=true` are all ignored
(byte-identical 41,068 B responses). `/CR/api/DeedsHistory/{eik}` returns the SPA shell, not
an API route. There is no history variant of this endpoint.

Consequences, folded into the sections below:
- "returns the complete deed history back to registration" (old §1) is **wrong**; so is
  "the CR full history is authoritative" (old §2).
- **delete+replace-per-uic becomes a data-loss regression** — see §2 Layer 2.
- min(`fieldEntryDate`) still resolves the founding date in practice (fields 1/2/3 rarely
  change after registration), but it is precisely "the earliest surviving *current* field
  entry", not "the registration date". The existing 2008-is-re-registration caveat stands.
- `fieldOperation` takes values 1 and 3 with no documented meaning. **Resolve this before
  trusting any field** — it is the only remaining candidate for a status signal.

### ❌ Values are rendered HTML, not structured records

```
CR_GL_MAIN_CIRCUMSTANCES_L  CR_F_23_L  2009-04-30 ::
  <div class='record-container record-container--preview'><p class='field-text'>"ШНАЙДЕР
  ЕЛЕКТРИК ИНДЪСТРИЗ" С.А.С., Идентификация 954503439, Чуждестранно юридическо лице,
  Държава: ФРАНЦИЯ</p></div>
```

`PERSON_SECTION_TO_ROLE`, `META_FIELD_TO_KIND` and `parseShareAmount`
(`scripts/declarations/tr/parse_daily_filing.ts:41,73,113`) key off the **egov feed's
structured XML nodes** (`SoleCapitalOwner`, `Subject`, `LegalEntity`). None of them apply
here. Layer 2 is an HTML-scraper plus a `nameCode`/`fieldIdent` dictionary — not "a thin
adapter that normalizes field names."

### Field map (from the two captures — extend during implementation)

Shape: `sections[] → subDeeds[] → groups[] → fields[]`, addressed by
`groups[].nameCode` + `fields[].nameCode`, ordered by `fieldIdent`.

| group | field | content |
|---|---|---|
| `CR_GL_MAIN_CIRCUMSTANCES_L` | `CR_F_1_L` | ЕИК + фирмено дело |
| | `CR_F_2_L` / `CR_F_4_L` | name / transliteration |
| | `CR_F_3_L` | legal form (BG long form) |
| | `CR_F_5_L` | seat + address (държава/област/община/населено място/ул.) |
| | `CR_F_6_L` / `CR_F_6a_L` | предмет на дейност / НКИД group+class |
| | `CR_F_7_L` | **Управители** (`op=1`) |
| | `CR_F_11_L` | начин на представляване |
| | `CR_F_23_L` | **Едноличен собственик на капитала** — person *or* legal entity, ЕИК inline |
| `CR_GL_FUND_L` | `CR_F_31/32/33_L` | капитал / внесен капитал / непарична вноска (already in €) |
| `CR_GL_ACTUAL_PERSON_OWNERS_L` | `CR_F_550_L` | **действителен собственик** (ЗМИП) |
| `CR_GL_BASIC_INFORMATION_L` | `CR_F_529/530_L` | ЗМИП legal basis |
| `CR_GL_TRANSFORMATION_L` | `CR_F_701/702/703_L` | вид преобразуване / преобразуващо се / приемащо |
| `CR_GL_PROV_RIGHT_L` | `CR_F_702_L` | правоприемство |
| `CR_GL_ANNOUNCED_ACTS_L` | `CR_F_1001_L` | обявени актове (ГФО, доклади) with announce dates |
| `CR_GL_CURRENT_CONSTUTIVE_ACT_L` | `CR_F_1001_L` | актуален учредителен акт |

`subDeeds[]` also carry `subUIC`, `subUICType`, `subDeedStatus`, `subDeedIsClosed` (all
`false` on both samples — untested against an erased/insolvent company). Top level carries
`deedStatus`, `legalForm` (numeric code — `10` = ЕООД on both samples), `companyName`,
`fullName`, `uic`, `uicWithCtx`.

### ⚠️ One GET does not capture "everything"

The top level exposes `hasInstructions`, `hasAssignments`, `hasCompanyCasees`,
`hasNotifications`, `hasLegalFormChange`, `hasForeignParentCompany`, `hasForeignBranches` as
**bare booleans** — pointers to other endpoints. "Fetch is the only expensive step; never pay
it twice" holds for the deed body and nothing else. Either scope the design principle to the
deed body, or add those endpoints to Layer 1 explicitly.

### No ЕГН

Nothing in the response carries the person hash/salt the open-data dump's `Indent` element
does. The existing "name_norm joins only" policy is unaffected.

---

## 1. Problem recap (why this exists)

- The TR pipeline is a daily-filings **event stream** (data.egov.bg), floor **2021-01-01**
  (bulk 2021-01-01→2022-09-02, per-resource after). Verified: local `dataset-index.json`
  earliest = 2022-09-03; bulk covers the 2021 window.
- Filings are **deltas** — only changed sections. A company born before 2021 whose
  ownership never changed since has its owner only in a pre-window genesis filing → we
  never see it. Result: **477,776 / 676,362 EOOD (70.6%) have no owner record**, even though
  a single-member LLC *must by law* have exactly one. (Хърикейн / Алфред Дюмон / АЙ РОУД:
  managers present from 2026 delta filings, owner Ирина absent. Independently reproduced on
  МБАЛ Разлог — see §0a.)
- Not a parser bug — `parse_daily_filing` maps `SoleCapitalOwner → sole_owner` correctly
  (Пирин голф, born 2022, has its owner). It's a **cold-start / pre-2021 genesis** gap.
- The **only** full-current-state source is per-company:
  `GET https://portal.registryagency.bg/CR/api/Deeds/{eik}` — no auth, no CAPTCHA, returns
  the company's complete **current** deed state, whose fields carry their original entry
  dates back to 2008. Already proven in-repo by
  `scripts/procurement/fetch_company_founded.ts` (curl to dodge TLS fingerprinting;
  ~1 req/5s; 429 backoff; resumable). That state contains the pre-2021 genesis owner field —
  but the running job walks it only for the min date and **discards the rest**.

**Design principle (per request):** persist the whole deed body verbatim, even fields we
don't consume today. Fetching the body is the expensive step; never pay it twice. (Scope
note: the body is not the whole registry — see §0a's "one GET does not capture everything".)

---

## 2. Architecture — three layers

### Layer 1 — Raw capture (the durable store; the ONLY rate-limited step)

Store the complete API response per EIK, immutable, gzipped.

- Store: `raw_data/tr/cr_deeds.sqlite` (parallel to `state.sqlite`, same grain, same
  gitignored directory — `.gitignore:95`; `bucket:sync` only syncs `data/`, so the store
  cannot leak into the bucket). Two tables, deliberately:
  ```
  cr_deeds(                        -- ANSWERS ONLY. A row here means the register answered.
    uic          TEXT PRIMARY KEY,
    raw_gz       BLOB NOT NULL,     -- gzip of the exact HTTP body
    byte_len     INTEGER,           -- uncompressed length
    content_hash TEXT,              -- sha256(body) for change detection on refresh
    http_status  INTEGER,
    fetched_at   TEXT NOT NULL,
    api_version  TEXT               -- endpoint id, in case the API shape changes
  )

  cr_deeds_failed(                  -- NON-ANSWERS. Never consulted by the resume query.
    uic          TEXT PRIMARY KEY,
    reason       TEXT NOT NULL,     -- rate-limited | curl-failed | unexpected-shape | http-NNN
    http_status  INTEGER,
    attempts     INTEGER,
    failed_at    TEXT NOT NULL,
    fail_count   INTEGER NOT NULL DEFAULT 1   -- bumped on each re-attempt
  )
  ```
  ⚠️ **The two-table split is the §0 invariant, one layer down.** An earlier draft put
  failures in `cr_deeds` alongside answers while resuming on "skip any EIK already present"
  — that combination makes a failed fetch permanent and never-retried, which is *exactly*
  the bug that poisoned `company_founded`. Failures must be recorded (over weeks a silent
  gap is indistinguishable from "this company has no deeds") but must never satisfy the
  resume skip. `raw_gz NOT NULL` enforces it structurally: a failure cannot be written to
  `cr_deeds` even by accident.
- Fetcher `scripts/declarations/tr/fetch_cr_deeds.ts`: **extract** the
  `fetch_company_founded` client into a shared module and call it — do not copy it. It
  carries the ok/not-ok invariant in §0 plus curl (TLS fingerprinting), `-w %{http_code}`,
  adaptive pacing from 5s, exp backoff on 429, confirmed-empty-body handling, a circuit
  breaker and a 30s timeout. A verbatim copy forks those semantics, and only one fork gets
  the next fix. The extraction must widen the result to carry the **raw body** (today
  `fetchFounded` returns only the derived date); keep `fetch_company_founded.test.ts` green
  across the move. For each target EIK: fetch → store raw body → nothing parsed here.
- **Resumable / idempotent:** skip EIKs present **in `cr_deeds`** with a recent `fetched_at`
  (unless `--refresh-before <date>`). `cr_deeds_failed` rows are always re-attempted.
  Checkpoint-friendly for a weeks-long crawl.
- **Politeness:** single IP token bucket — **never run concurrently** with
  `fetch_company_founded` or any other CR job. This job SUPERSEDES the founding crawl.

### Layer 2 — Projection (re-runnable offline, NO fetching)

Parse the raw store into typed outputs. Because raw is cached, adding a new field later =
re-run this layer over the store, zero new fetches.

- Parser `scripts/declarations/tr/parse_cr_deeds.ts` — walks
  `sections[] → subDeeds[] → groups[] → fields[]` and **scrapes `htmlData`** per the §0a
  field map. This is a new parser, not an adapter over `parse_daily_filing`: the CR body is
  rendered HTML keyed by opaque `nameCode`/`fieldIdent` codes, so
  `PERSON_SECTION_TO_ROLE` / `META_FIELD_TO_KIND` / `parseShareAmount` are **not reusable**
  (§0a). `state_replay.ts` does not apply either — it replays daily DELTA filings, and the
  Deeds body is a resolved current state with no deltas in it.
  Unit-test the scraper against checked-in fixtures under
  `scripts/declarations/tr/__fixtures__/` (the two §0a captures are a starting set; add an
  АД/ЕАД, an ЕТ, a ЮЛНЦ, a branch, a bankrupt and a transformed company).
- ⚠️ **Merge is ADDITIVE, not replace-per-uic.** An earlier draft had CR delete and replace a
  uic's `company_persons` rows on the grounds that "the CR full history is authoritative."
  §0a disproves the premise: CR carries **no history and no erasure**, so a replace would
  permanently discard every ex-manager and prior owner the daily feed built — precisely what
  `tr_person_roles` exists to serve ("Raw per-role records for the person page's history
  (from/to dates + share)", `scripts/db/load_tr_pg.ts:215`) — and would degrade
  `tr_officers`' `active`/`changed_at` derivation (`load_tr_pg.ts:195`). Instead:
  - CR rows are inserted in their own `record_id` namespace (`cr:<fieldEntryNumber>`, with
    `field_ident` from CR's own `fieldIdent`) — this satisfies the existing
    `PRIMARY KEY (uic, record_id, field_ident)` on `company_persons` without collision;
  - daily-feed rows are left untouched; CR wins only where both describe the same
    `(uic, role, field_ident)` currently in force;
  - CR rows are marked `persons_source='cr'`. **That column does not exist yet** — it must
    be added to the `SCHEMA` constant in `scripts/declarations/tr/sqlite_writer.ts:19`.
  - **Guard:** write CR rows only from a complete, successfully-parsed body that yields ≥1
    person-or-entity record (an EOOD MUST resolve an owner) — never from an empty/partial/
    errored parse.
- Note the owner is often a **legal entity**, not a natural person (23,934 of 265,173
  current `sole_owner` rows already look like entities; the §0a sample returned
  `ОБЩИНА РАЗЛОГ`). The existing model handles this (`parse_daily_filing.ts` maps
  `LegalEntity` alongside `Subject`/`Person`), but the projection must tag them so they
  never feed the person bridge as people.
- Outputs (phased — persons first, rest as features need them):
  1. **Persons/owners** → merge into `state.sqlite.company_persons` (the Cause-2 fix), per
     the additive rules above.
  2. **Founding date** → `company_founded` (subsumes `fetch_company_founded`; same
     `min(fieldEntryDate)` logic, now off the cached raw, with the §0a caveat that this is
     the earliest surviving *current* field entry).
  3. **Company meta already modelled**: seat, funds/capital, legal_form, status,
     cessation/liquidation/bankruptcy flags.
  4. **Everything else the deed body carries** (capture now in raw, project when a feature
     lands): предмет на дейност, full addresses, capital (§0a `CR_F_31/32/33_L`), branches,
     procurators, transformations (`CR_GL_TRANSFORMATION_L`), правоприемство, ЗМИП
     действителен собственик, foreign-jurisdiction owners, ЮЛНЦ governing bodies. → new
     typed tables per feature, always re-derived from raw.

### Layer 3 — Load & bridge (⚠️ the wiring DOES change)

`db:load:tr:pg` reads `company_persons` → `tr_person_roles` / `tr_officers` →
`resolve_persons` bridges owners to people → person/company/connections pages. New owner
rows flow through with **no schema change to the PG load path**.

⚠️ **But `state.sqlite` is deleted and rebuilt from scratch on every daily refresh**, so a
projection written into it survives about a day. `writeStateToSqlite` unlinks the file
outright (`scripts/declarations/tr/sqlite_writer.ts:90` — "Always start from a clean DB"),
it is called unconditionally by `reconstruct_state.ts:211`, and `tr:daily-refresh`
(`package.json:169`) runs that on every `egov_commerce` watcher flip. This is not a
merge-precedence question — it is total loss.

Therefore the projection must become a **step inside the rebuild**, ordered:

```
daily_refresh.ts  →  reconstructState()  →  parse_cr_deeds projection  →  db:load:tr:pg
```

i.e. wire `parse_cr_deeds` into `daily_refresh.ts` after `reconstructState` (before
`buildCompanyConnections`), and extend the `tr:daily-refresh` npm script accordingly. The
projection is offline and re-runnable by construction (Layer 2), so paying it on every
refresh is cheap and keeps CR-derived rows durable without a second store.

---

## 3. Scope & sequencing (rate limit is the binding constraint: ~1/5s ≈ 17k/day)

| Tier | Target set | Count | Wall-clock @5s |
|---|---|---|---|
| 0 | Every contractor EIK (15,887 already fetched for their date but with the raw discarded, + the 10,844 never-fetched tail) | 26,731 | ~1.5 days |
| 1 | Missing-owner ∩ (contractor ∪ EU-funds ∪ subsidy ∪ person-bridged) | 29,652 unique | ~1.7 days |
| 2a | EOOD missing owner | 477,776 | ~4 weeks |
| 2b | + ООД missing partner/owner | 610,739 total | ~5 weeks |
| 3 | Full corpus (durable-store completeness) | ~1M+ | months, background |

Tier 0 is a single set of **26,731** EIKs — the 10,844 tail is a *subset*, not an addition.

Tier-1 breakdown (measured 2026-07-27): 8,480 contractors, 18,578 EU-funds beneficiaries,
6,347 subsidy recipients, 717 already person-bridged (understated — discovering owners
*creates* bridges); 29,652 unique across the union.

⚠️ **The wall-clock column is the healthy-pace figure and will not hold on one IP.** §5's
egress note records that throughput degraded to ~30 min/EIK by day 7 of sustained crawling
from a single address. Tier 0/1 fit inside that window; Tier 2 and 3 do not. Plan the egress
before starting them rather than discovering it on day 6.

**Detection SQL** (pure SQL, no fetch). Note the exact vocabulary — an earlier draft's
Cyrillic `'ЕООД'` matches **zero rows**, and `tr_entity_class` is the *function*, while the
column on `tr_companies` is `entity_class` (`003_tr_search.sql:22`):

```sql
SELECT c.uic
  FROM tr_companies c
 WHERE c.legal_form IN ('EOOD', 'Еднолично дружество с ограничена отговорност')  -- add
                                                                                 -- 'OOD',
       -- 'Дружество с ограничена отговорност' for Tier 2b
   AND NOT EXISTS (SELECT 1 FROM tr_person_roles r
                    WHERE r.uic = c.uic AND r.role IN ('sole_owner','actual_owner'));
```

Measured shape of that vocabulary: `EOOD` 676,362 rows, `OOD` 196,333,
`Еднолично дружество с ограничена отговорност` 51,327, `Дружество с ограничена отговорност`
11,383. The BG long forms are a post-2021-feed artefact — only **6** of the 51,327 long-form
EOODs are missing an owner, so including them barely moves the target set. Keep them in the
filter anyway; the cost is nil and the omission would be silent.

⚠️ **Do not inherit `fetch_company_founded`'s EIK regex.** `contractor_eik ~ '^[1-9][0-9]{8}$'`
(`fetch_company_founded.ts:421`) drops every leading-zero EIK — 961 missing-owner EOODs, 66
of them contractors, disproportionately municipal hospitals and utilities, i.e. exactly the
interesting ownership cases. The §0a sample `000022044` is one of them. Use `^[0-9]{9}$`.

Run Tier 0→1, reassess, then let Tier 2/3 grind unattended with checkpointing.

---

## 4. Spikes — resolved 2026-07-27

1. ~~**Deeds JSON schema inventory**~~ — **DONE**, see §0a. The body is rendered HTML keyed
   by `nameCode`/`fieldIdent`; the raw→typed field map is in §0a; the decision is **a new CR
   parser, not a `parse_daily_filing` adapter**. Remaining work: extend the map with the
   entity types not yet sampled (АД/ЕАД, ЕТ, ЮЛНЦ, branch, bankrupt, transformed) and
   resolve what `fieldOperation` ∈ {1,3} means.
2. ~~**Current-state derivation**~~ — **RESOLVED NEGATIVELY**, see §0a. The body carries no
   erasure marker, no validity interval and no superseded values, and there is no history
   variant of the endpoint. Active-vs-erased **cannot** be reconstructed from CR. Open
   question this leaves: a company whose owner changed *before* 2021 yields only the current
   owner, with no record of the predecessor — acceptable for the missing-owner fix, but it
   means CR can never replace the daily feed's history (hence the additive merge in §2).
3. ~~**Storage sizing**~~ — **MEASURED**. gzip -9 of the two captures: 41,068 → 8,119 B and
   28,761 → 5,692 B (≈5× ratio, ~7 KB/company). So Tier 2 ≈ **3.3 GB**, Tier 3 ≈ **7 GB** —
   not the 10–20 GB an earlier draft projected by applying the *uncompressed* size to a
   gzipped store. A single SQLite blob file at that size is comfortable; the sharded-files
   and PG-jsonb alternatives are unnecessary. Re-check once a few thousand real captures
   exist (large АД/holding deeds will pull the mean up).
4. **Refresh policy** — still open. Deeds change; post-2021 changes still arrive via the
   daily feed, but a captured company can go stale. Define a re-fetch cadence (e.g.
   re-capture on a daily-feed delta touch, or an N-month sweep of active companies).
   `content_hash` drives no-op skips. This plan owns the cadence (§0.2).

---

## 5. Interactions & risks

- **⚠ Bridge B footprint cap (Cause 1 coupling).** Backfilled owners raise a person's TR
  footprint. `FOOTPRINT_CAP = 5` in `scripts/person/resolve_persons.ts:1431` is a hard
  `BETWEEN 1 AND 5` filter, so a person pushed to 6 companies loses **all** her name-matched
  companies, not just the sixth. Ирина 3→6 would do exactly that, and owner backfill will
  push others over too. Before/with Tier-1 load: revisit the cap, or treat CR-sourced owner
  rows as a stronger corroborant (still name-only — no ЕГН — so the cap logic, not just the
  source, must change). Re-check the `person_resolve` "licensed bridge" invariant after.
- **Legal-entity owners must not enter the person graph.** A large share of recovered owners
  are общини, state bodies and companies (§0a; 23,934 of 265,173 current `sole_owner` rows).
  Bridge B's 3-part-public-figure gate makes accidental matches unlikely, but the projection
  should tag entity rows explicitly rather than rely on that.
- **One source of truth.** Raw store → projects into `state.sqlite`; do NOT fork a parallel
  PG persons table. `company_persons` stays canonical.
- **Merge semantics.** Additive, per §2 Layer 2 — CR does not carry the history that would
  justify a replace. Precedence: daily feed owns history and erasure; CR owns the currently-
  in-force owner field for companies it has captured.
- **Licensing.** ⚠️ Unverified. CC-BY covers the **data.egov.bg open-data feed**; this is the
  **portal API**, whose terms are separate and may restrict bulk extraction. Check the
  portal's conditions before writing the attribution line, and before Tier 2/3 in particular.
- **Changelog.** New/enriched owner data is a dataset change → wire into `recent_updates`
  per the PG-changelog rule.
- **Egress.** curl endpoint reachable from the run host — confirmed on the dev machine
  2026-07-27 (`--probe`: 2/2 answered, 6.0s/EIK; re-confirmed with 4 live GETs during the
  2026-07-27 audit). Re-confirm if run elsewhere, and note the limit is **per-IP**: the
  2026-07 block tightened over ~7 days of sustained crawling from one address, so a
  weeks-long Tier-3 run should assume it will be throttled and plan the egress accordingly.
- **⚠ Scrape fragility at Tier-3 scale.** 478k–1M requests over weeks/months at 1/5s is
  exposed to IP-blocking, silent API-shape changes mid-crawl, and ToS limits on an unofficial
  bulk extraction. **Before committing to Tier 3, evaluate an official full-database bulk**
  from the Registry Agency (Агенция по вписванията offers paid database access / пълен
  достъп). §0a strengthens this: a licensed dump would carry the **deed history this
  endpoint does not**, which is the one thing the crawl can never recover. The per-EIK crawl
  stays the right tool for Tier 0–2 (targeted, ~30k) regardless. Persist
  `api_version`/`content_hash` so a mid-crawl shape change is detected, not silently
  mis-parsed.

---

## 6. Deliverables / order of work

1. ~~Spike §4.1–§4.2~~ — done (§0a). Remaining: sample the 6 untried entity types, extend
   the field map, resolve `fieldOperation`.
2. Extract the shared CR client from `fetch_company_founded.ts` (widen the result to carry
   the raw body; keep `fetch_company_founded.test.ts` green).
3. `fetch_cr_deeds.ts` (Layer 1) + the `cr_deeds` / `cr_deeds_failed` schema. Start the
   Tier 0/1 crawl (26,731 then 29,652 EIKs, `^[0-9]{9}$`).
4. `parse_cr_deeds.ts` (Layer 2) + fixtures → persons projection → **additive** merge into
   `company_persons` with `persons_source='cr'` (add the column to `sqlite_writer.ts`'s
   `SCHEMA`); fold in founding-date so `fetch_company_founded` is retired.
5. Wire the projection into `daily_refresh.ts` between `reconstructState` and
   `buildCompanyConnections`, and extend the `tr:daily-refresh` script (§2 Layer 3) — without
   this the projection is wiped on the next watcher flip.
6. `db:load:tr:pg` reload → `db:resolve:persons`; verify Хърикейн/Алфред Дюмон/АЙ РОУД show
   Ирина as **Едноличен собственик** and МБАЛ Разлог shows ОБЩИНА РАЗЛОГ; re-check the
   Bridge B cap + invariant test.
7. **Cloud path** (not optional — prod currently holds only a `company_founded` stub, so
   `newFirmWinner` is dormant there):
   - apply `033_procurement_risk_indexes.sql` to Cloud SQL before any write,
   - `npm run db:load:company-founded:pg:cloud` (ships the table + refreshes
     `procurement_risk_indexes_cache`),
   - `npm run db:load:tr:pg:cloud` for the owner rows,
   - add both to the regenerating watch skill so the live copy cannot go stale.
8. Tier 2/3 background crawl with checkpointing; refresh policy (§4.4).
9. Regression test + changelog entry. ⚠️ **Assert `≥ 1` active owner, not "exactly one"** —
   4,127 companies today already have >1 non-erased `sole_owner` row and 4,074 have >1
   distinct non-erased owner *name*, because `tr_person_roles` keeps one row per filing. An
   "exactly one" assertion fails on the existing corpus before CR contributes anything.

---

## 7. Open decisions for the operator

- Raw store: single `cr_deeds.sqlite` blob table vs sharded gz files vs PG jsonb.
  (**Recommended: SQLite blob** — §4.3 measured ~3.3 GB at Tier 2, well inside comfort.)
- Coverage ambition: stop at Tier 2a (EOOD, 477,776), extend to 2b (+ООД, 610,739), or push
  Tier 3 (full corpus) for the durable archive. (Default: Tier 0–2a by crawl now; for
  Tier 3, first evaluate the official paid CR bulk vs a months-long scrape — §5, now also
  the only route to deed *history*.)
- Bridge B cap change: raise the cap, or add a distinct higher-confidence tier for
  CR-sourced owners. (Needs a call before Tier-1 load lands owners on public figures.)
- Whether to add the auxiliary endpoints behind `hasInstructions` / `hasAssignments` /
  `hasCompanyCasees` / `hasNotifications` to Layer 1 now (while we are paying the per-EIK
  rate limit anyway) or leave the design principle scoped to the deed body (§0a).
- Which §8 UI slice ships with Tier 1. (Default: A2 + B1 + A3 — see §8's shortlist.)

---

## 8. UI integration — what the capture unlocks

Two framing points drive everything below, and both are easy to get wrong:

- **It is corpus-wide, not per-page.** ~478k companies × ~15 fields nothing else in the repo
  carries. The instinct is "add a tile to the company page"; the larger payoff is **new
  facets on the browsers and new leaderboards**, because that is where 478k rows earn out.
- **⚠️ It has no history (§0a).** Every ownership surface renders "as recorded on
  2008-09-04", never as a from–to timeline. The moment a time axis is drawn over CR data,
  the dataset is being misused. Role history stays daily-feed-sourced.

Surfaces referenced: `src/screens/dev/CompanyDbScreen.tsx` (the `/company/:eik` dashboard),
the `company_person_roles` matview behind `/company/:eik/officers` (`022_company_officers.sql`),
`src/screens/person/PersonCompanies.tsx` + `PersonConnections.tsx`,
`src/screens/components/procurement/CompanyRiskChips.tsx` + `EntityRiskGradeCard.tsx`.

### 8.1 Tier A — closing the ownership gap

**A1. A real "Собственост" block, separate from the officers list.** Owners and managers are
collapsed today into one `company_person_roles` list ordered by role code. Split it:
**едноличен собственик / съдружници** (with share % where CR supplies it) above
**управители**, each stamped with its `fieldEntryDate`.

**A2. ⭐ Tri-state coverage, not absence.** The UI face of the §0 invariant; treat as
non-negotiable. Three distinct renderings:

| state | render |
|---|---|
| owner recorded | the name (+ entry date) |
| deed captured, no owner field in it | "няма вписан собственик" — for an EOOD this is a genuine registry anomaly, worth surfacing |
| not yet captured | "още не е проверено" + the tier it is queued in |

A missing owner currently renders as blank, indistinguishable from "we never looked." During
a months-long crawl that ambiguity covers most of the corpus, and it is exactly the
answered-vs-unreachable confusion §0 exists to prevent — the same bug, in pixels.

**A3. ⭐⭐ The ownership chain.** `CR_F_23_L` carries the owner's **ЕИК inline** when the
owner is a legal entity (measured: `ОБЩИНА РАЗЛОГ, ЕИК/ПИК 000024948`;
`"ШНАЙДЕР ЕЛЕКТРИК ИНДЪСТРИЗ" С.А.С., Идентификация 954503439, ФРАНЦИЯ`). The owner graph is
therefore **walkable**: EOOD → parent → … → terminal owner (person, община, or foreign
entity). New UI object: a breadcrumb-style chain on the company page ("зад това дружество
стои…"), plus an **ultimate-owner column** in the contracts browsers. This answers "who
actually won this contract", which no current surface can.

**A4. Ownership-type badges → a new browsable class.** Terminal owner type is derivable:
person / company / община / state body / foreign. Municipal and state-owned companies are
invisible as a class today (the 961 leading-zero missing-owner EOODs in §3 are largely
these). Ship: a `общинско дружество` chip on the company page, a facet on
`/procurement/contractors`, and a **"дружествата на моята община"** tile on the
governance / my-area dashboards, which already carry the municipal roster.

**A5. Foreign ownership with flags.** `Държава: ФРАНЦИЯ` comes straight out of the field;
reuse the shared Flag component. A "чуждестранна собственост" facet over the contractor
corpus is a story on its own.

### 8.2 Tier B — fields nothing else in the repo has

**B1. ⭐⭐⭐ НКИД vs CPV mismatch.** `CR_F_6a_L` gives the declared activity class
(`Група по НКИД: 27.12`). Cross it with the contract's CPV division: *does this winner do
this for a living?* A firm whose only declared activity is retail winning a €4M road
contract is a first-class risk signal — cheap, corpus-wide, and it drops into the existing
risk index and `CompanyRiskChips` / `EntityRiskGradeCard` with no new surface. **If one thing
ships from this plan, it is this.**

**B2. Thin capitalisation.** `CR_F_31/32/33_L`, already denominated in €. "Капитал 2 €,
спечелени договори 12 млн. €" — a ratio chip on the contract detail page and a sortable
column in the contracts browser.

**B3. Successor lineage / phoenix detection.** `CR_GL_TRANSFORMATION_L` +
`CR_GL_PROV_RIGHT_L` carry вливане/преобразуване with both parties' ЕИК. Two payoffs: a
"поело е X" banner that stitches a predecessor's contracts into the successor's history
(contract attribution is currently broken across mergers), and a debarment-evasion signal
when a debarred firm's business reappears under a fresh EIK.

**B4. ГФО compliance chip.** `CR_GL_ANNOUNCED_ACTS_L` carries per-act announce dates.
"Последен подаден ГФО: 2019" is a dormancy flag, corpus-wide, and it pairs with the existing
ГФО revenue ingest.

**B5. ⭐ Shared registered addresses.** `CR_F_5_L` is a full structured seat. The awarder
pages already render a seat; this extends it to **contractors** — and with 478k seats,
*"23 contractors registered at the same apartment"* falls out of a GROUP BY. Shell-company
signal, map tile, and leaderboard from one field.

**B6. UBO vs registered owner.** `CR_F_550_L` is the ЗМИП действителен собственик, legally
distinct from the registered owner. Rendering both side by side makes divergence visible,
which is the entire point of the ЗМИП register.

### 8.3 Tier C — corpus-scale surfaces

- **New facets** on `/procurement/contractors`: ownership type, foreign flag, capital band,
  NKID↔CPV mismatch, shared-address.
- **Coverage meter on `/data`** — % of companies with a captured deed, by tier. The honest
  way to display a months-long crawl, and it doubles as the operator's progress bar.
- **Leaderboards**: largest municipal-company portfolios · top foreign owners by contract
  value · addresses hosting the most contractors · biggest capital-to-contract gaps.
- **Connections graph**: an ownership edge is *evidence*; today's name-matched officer edge
  is an *inference*. Style them differently and add "ownership chain" as a path type in
  `connection_between` — every edge currently looks equally certain, which flatters the weak
  ones.
- **AI chat**: an `ultimateOwner` / `companyOwnership` tool over the chain — a question the
  existing tool set cannot answer.
- **Наясно post** (DATASET kind): "71% от ЕООД-тата нямаха вписан собственик — вече имат."

### 8.4 Guardrails the UI must carry

1. **No timelines over CR data.** Entry dates only (§0a). Role history stays daily-feed-sourced.
2. **Legal-entity owners are not people** — no MpAvatar, no `/person/` link for
   `ОБЩИНА РАЗЛОГ`. Already ~9% of current `sole_owner` rows; that share rises sharply after
   the backfill.
3. **Keep the name-only caveat** wherever a recovered owner drives a person link — CR carries
   no ЕГН, so the existing caveat chip applies unchanged.
4. **⚠️ Bridge B lands BEFORE, not after** (§5). Owner backfill pushes people past
   `FOOTPRINT_CAP = 5`, and the cap is a hard `BETWEEN 1 AND 5` — a person going 5→6 loses
   **all** her companies from the page. Ship the cap change with the Tier-1 load, or person
   pages get emptier rather than richer.

### 8.5 Shortlist

**B1** (НКИД vs CPV) — biggest analytic payoff per line of code, reuses the risk chips
wholesale. **A3** (ownership chain) — the genuinely new UI object; nothing in the app answers
"who is behind this". **A2** (tri-state coverage) — small, and without it every other
ownership surface lies by omission for months.
