# Deferred-followups verification fixes — v1

Source: `docs/audits/deferred-followups-verification-2026-10.md` (53 checked claims, 2026-10-21).
The followups file itself is already corrected; this plan fixes everything the audit found
OUTSIDE it and works the items it re-opened or unblocked.

Three kinds of work, kept apart because they fail differently:

- **Stale statements in the repo.** CLAUDE.md, skills, code comments and user-facing data-map
  copy that assert something the audit disproved. Cheap, but they are what the next session
  will read and trust.
- **Small code fixes.** A config list or note that encodes a wrong premise (Interreg hosts, a
  keep.eu coverage note, a redirect, one gzip upload).
- **Unblocked work.** Items that were parked on a false „blocked" claim and are now buildable.
  Each is scoped to a first bounded step, not to a whole feature.

Order is by deadline first, then by how much downstream reasoning each stale fact poisons.

---

## Tier 0 — before 25.10.2026 (presidential round 1)

### T0.1 Cycle id: `2026_11_08_pvr` → `2026_10_25_pvr`

Round 1 is **25.10.2026** and the runoff **01.11.2026** (НС decision of 31.07.2026, ДВ
04.08.2026). The polls corpus and `src/data/myarea/upcomingElections.ts` already moved to
2026-10-25 on 2026-10-06. Several places still name the old estimate as the round-1 folder id,
and the update skill would create the tree under it:

| file                                                                         | what                                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `.claude/skills/update-presidential-elections/SKILL.md` (lines ~69–71, ~150) | worked example keyed `2026_11_08_pvr` — **the one that would actually mint the wrong folder** |
| `scripts/polls/accept.ts` (19, 23, 774)                                      | usage and error-message examples                                                              |
| `scripts/polls/restamp.ts` (10, 184)                                         | same                                                                                          |
| `scripts/parsers_presidential/build_split_ticket.ts` (432)                   | comment calls it „this skill's worked example"                                                |
| `src/data/polls/pollsTypes.ts` (171)                                         | doc comment                                                                                   |
| `.claude/skills/update-polls/SKILL.md`                                       | grep and fix                                                                                  |

Test fixtures that use `2026_11_08_pvr` as an arbitrary id (`*.test.ts(x)` under `src/` and
`scripts/polls/`) may stay — but switch them where a test reads as asserting the real cycle
(e.g. `usePresidentialPolls.test.tsx`, `presidential_cycle.test.ts`). Grep:
`grep -rn "2026_11_08\|2026-11-08" src scripts .claude/skills`.

Also confirm the runoff convention the skill documents (a runoff is a toggle on the round-1
cycle, not its own folder — `src/routes.tsx` §presidential), so nobody mints `2026_11_01_pvr`.

**Done:** grep returns only deliberate fixtures; `npm run test:unit` green.

### T0.2 Header / cycle-switcher wiring and sitemap

The followups entry „wire `/presidential` into the main header/cycle switcher… and add
`/presidential/polls` to `route_defs.ts`" is now due. `route_defs.ts:901` already carries
`presidential/:id`; check whether `/presidential/polls` is enumerated, and whether the header
exposes `/presidential` at all. Ship with `npm run deploy` before the 25th so election-night
traffic lands on a reachable page.

**Done:** `/presidential` reachable from the header; `/presidential/polls` has a sitemap
`<loc>` and a prerendered `dist/` file (`scripts/sitemap/families.data.test.ts` after a build).

### T0.3 Results-day readiness check (no code)

Confirm that `npm run data -- --pvr-download pvr2026` reaches ЦИК through the
Cloudflare-warming path the skill uses: plain `curl` gets 403 on results.cik.bg and cik.bg. Do
it on the 24th against a known-good past cycle so failure is distinguishable from „not
published yet".

---

## Tier 1 — stale statements in the repo

### T1.1 CLAUDE.md — the serving instance header

`gcloud sql instances describe electionsbg-pg` reports **`db-custom-2-13312` / ENTERPRISE**.
CLAUDE.md lines ~78–106 say `db-perf-optimized-N-2` / ENTERPRISE_PLUS „as of 2026-08-22".
`gcloud sql operations list` shows UPDATE operations on 2026-08-20 and **2026-08-27 02:54Z**; the
latter is the likely move off N-2.

Steps:

1. Establish the tier history from Cloud Audit Logs (`gcloud logging read` on
   `cloudsql.instances.update` for the instance, with `protoPayload.request.settings.tier`).
   That gives: g1-small → N-2 date, N-2 → custom-2-13312 date.
2. Rewrite the header to name the current tier, with the date and its server-reported
   `shared_buffers`, re-read via `SHOW shared_buffers` over the proxy.
3. **Apply the file's own rule — never relabel a measurement.** Rows stamped „on
   `db-perf-optimized-N-2`" keep that label if they were taken before the change. The
   2026-08-27 publish table and the 2026-08-29 person-chain table are the ones to check: if the
   tier changed at 02:54Z on the 27th and those runs came later, they were measured on
   `db-custom-2-13312` and their stamp is wrong. Correct only what the audit log proves.
4. Restate the rule paragraph so it covers TWO upgrades and one downgrade, not just
   „predates the upgrade".

Same edit, read-only check, in the files grep found carrying the tier name:
`.claude/skills/process-watch-report/SKILL.md` (502, 1157), `.claude/skills/update-procurement/SKILL.md`
(130), `.claude/skills/update-agri/SKILL.md` (72), `scripts/db/load_tenders_pg.ts` (98, 311),
`scripts/db/tests/mp_tr_roles.data.test.ts` (470). Most are dated measurements and stay; the
comment in `load_tenders_pg.ts:311` — „the 53400 that once forced shipping is gone on
`db-perf-optimized-N-2`" — is a claim about the CURRENT box and must be re-verified on
`db-custom-2-13312` (re-run `db:load:tenders:pg:cloud` and look for
„built in-place on cloud").

**Done:** no sentence presents N-2 as the current tier; every tier-stamped figure matches the
audit-log window it was taken in.

### T1.2 АОП experts — the citation is right for the LIST, wrong as a claim about the law

The ingested list (174, 88 experts) really is the one aop.bg titles „по чл. 232а, ал. 2 ЗОП".
That provision was repealed from 01.01.2021; the current чл. 232а is ex-ante control, and the
live experts list is under **чл. 229, ал. 1, т. 17**. So the fix is a qualifier, not a
search-and-replace:

- CLAUDE.md `aop_expert` section: „…the register under the **2019–2020** чл. 232а, ал. 2 ЗОП
  (repealed; the live list is чл. 229, ал. 1, т. 17, whose page `ee2014.php` is 404)".
- `scripts/data_map/model.ts` (1338/1339, BG + EN — **user-facing**): same qualifier in both
  languages.
- Header comments in `174_aop_experts.sql`, `scripts/procurement/aop_experts/{sources,ingest}.ts`
  and `scripts/watch/sources/aop_experts.ts`.
- Keep the `source:` string in `ingest.ts:56` verbatim — it quotes АОП's own title.
- `.claude/skills/process-watch-report/SKILL.md` — grep and qualify.

**Done:** every mention states „historical, repealed provision"; `npm run test:unit` green
(`data_map` snapshot tests, if any, updated).

### T1.3 Assistant memory (outside the repo)

Update `~/.claude/projects/-Users-atanasster-data-bg/memory/`:

- `project_cloudsql_tier_evaluation.md` — current tier and date from T1.1.
- `reference_cloud_person_chain_timings.md` — the „~37 min" figure is the retired box; point at
  the 7m35s re-measure and its correct tier label from T1.1.
- `MEMORY.md` index lines for both.

---

## Tier 2 — small code fixes

### T2.1 Interreg open-calls: replace the „unreachable" hosts

`scripts/opencalls/interreg_parse.ts:47–56` justifies omitting four programmes by measurements
that were against the WRONG hosts. `interreg_parse.test.ts:44–55` pins those dead hostnames as
„blocked".

1. Rewrite the `PROGRAMMES` comment: the live sites are `ipa-bgrs.mrrb.bg`, `ipa-bgmk.mrrb.bg`
   and `ipa-bgtr.mrrb.bg`, plus RO-BG's `interregviarobg.eu`.
2. Add the four programmes, one parser `kind` per page shape. The three mrrb.bg sites share one
   Drupal taxonomy layout („Calls for proposals" → one term page per call), so probably ONE new
   kind; RO-BG is its own. Keep the existing rules:
   - deadline from its LABEL, with time of day, via `sofiaWallClockToUtc`;
   - a page with no labelled deadline is REJECTED;
   - an unreachable programme is excluded from the watcher fingerprint.
3. **TLS:** the mrrb.bg hosts send an incomplete chain, and Node fetch fails „unable to verify
   the first certificate". Do NOT disable verification. Bundle the missing intermediate (a PEM
   under `scripts/opencalls/certs/`, passed via a scoped `undici` Agent `ca`), the pattern
   `scripts/lib/egov_tls.ts` should be checked against first. Add a test that the agent is
   scoped to those three hosts only.
4. Replace the „lists only programmes that were actually reachable" test with one asserting
   each listed programme has a fixture-backed parser test, and keep the completeness guard in
   `interreg_fetch.ts`.
5. Update the coverage line on `/funds/calls` if it names programme counts. Per CLAUDE.md it
   must say „част от", never a count.

**Done:** fixtures for each new kind (one open, one closed, one undated → rejected);
`npm run opencalls:interreg` writes rows for ≥5 programmes; `db:load:open-calls:pg:cloud`
published.

### T2.2 keep.eu coverage notes

`scripts/funds/interreg/programmes.ts:67` says GR-BG „38% of partnerships in keep.eu" — now
21/21 projects and 85/85 partnerships, with 0% budgets and postcodes. Also update:

- BG-RS — the note says „0 of 8"; the programme now reports 10 projects / 60 partnerships, 0 in
  keep.eu;
- ESPON 2030 — 0 of 110 projects.

Prefer deriving the numbers from the keep.eu API at ingest (`/api/programme/<id>/` exposes
`projects_in_keep` and `total_no_of_projects`) over hand-typed strings, so the note cannot go
stale again. Then `funds:ingest-interreg` → `db:load:interreg:pg[:cloud]`.

**Done:** no hand-typed coverage percentage remains, or each one carries a date.

### T2.3 `ai.electionsbg.com` lands on the homepage, not `/chat`

`firebase.json` (target `ai`) already declares `/` → `https://naiasno.bg/chat` (301), but the
live response is `301 → https://naiasno.bg/`. So something upstream wins: most likely the
Cloudflare electionsbg.com → naiasno.bg redirect rule matching the `ai.` subdomain, or the `ai`
hosting target not deployed with the current rules. Diagnose with
`curl -sI https://electionsbg-ai.web.app/` (the hosting origin, bypassing Cloudflare).

- If the origin is correct, add a Cloudflare exception or a host-specific rule for
  `ai.electionsbg.com` → `naiasno.bg/chat` (operator; mind the 5/5 custom-rule ceiling in
  memory `project_edge_gate`).
- If not, run `firebase deploy --only hosting:ai`.

Then retire `ai/app/` per the followups entry. Separately, confirm whether the
`elections-bg-llm` GCP project still exists: the current account has no access, so ask the
owner rather than assume it is gone.

### T2.4 `governments.json` gzip

`canonical_parties.json` is already gzip-encoded; `governments.json` is not (9,960 B identity).
Add it to the hot set in `scripts/bucket_gzip.ts`, then `npm run bucket:gz:dry` → `bucket:gz`.

**Done:** `gsutil ls -L gs://data-electionsbg-com/governments.json` shows
`Content-Encoding: gzip`.

### T2.5 Customs 2025 `fines_total`

`scripts/budget/customs_revenue.ts:75` matches a „Глоби" row that the 2025 „Митническа хроника"
no longer prints as text: the table is an image. The residual method gives 21.0 млн лв
≈ €10.74m, and 8.2 against the stored 8.1 for 2024.

Decision first (owner): publish a DERIVED residual or keep null.

- If derived: add a `finesBasis: "printed" | "residual"` field. The residual must be labelled
  „глоби и други" because it is not fines alone. The surface states the basis.
- Never write the residual into the same key unlabelled; it reads as a printed figure.

Gate: a unit test reproducing 2024's printed 8.1 within 0.2 from the residual, so the method's
error is pinned.

### T2.6 Five dead paths in docs

The followups file now flags them; resolve each by finding the real artifact or deleting the
reference: `data/social/aksu_homes.json`, `scripts/nap/Cross_check_issuers.ts`,
`data/tourism/ntr.json`, `data/customs/enforcement.json` (→ `revenue_breakdown/customs`, done
in the followups), and `scripts/procurement/verify_eur_currency_eop.ts` (never existed — T3.4
writes it). `git log --all --diff-filter=D --name-only | grep -i "aksu\|cross_check\|ntr"`
finds renames.

---

## Tier 3 — open questions that need a measurement or a decision

### T3.1 ЗПФ чл. 130а — six criteria or seven

`scripts/budget/municipal_fiscal/criteria.ts` reads SEVEN from МФ's releases; the consolidated
law text found online lists SIX. Fetch the current consolidated ЗПФ (lex.bg) and the last ДВ
amendment to чл. 130а, and compare with one МФ release's criterion labels 1–7. Record the
mapping in `criteria.ts`'s header and in CLAUDE.md's `municipal_fiscal` section („the statute
has SEVEN criteria, not six" is asserted there). If МФ splits т. 1, say so; if the statute
changed, cite the ДВ issue.

### T3.2 UBO legal gate

ДВ бр. 49/2025 added чл. 63б ЗМИП („законен интерес" access). The TR feed still carries
`ActualOwners` (05500) with names and addresses, and `parse_daily_filing.ts:61` parses them as
`actual_owner`.

1. Inventory where `actual_owner` rows reach Postgres and any public surface: `tr_person_roles`
   → `person_role` → `/person`, `/company`.
2. Owner decision with GDPR counsel (already scheduled per memory `project_gdpr_privacy`):
   whether displaying registry-sourced UBOs is still covered by the journalistic exemption
   after 63б.
3. Until decided, do not build the UBO-vs-owner signal.

### T3.3 CR Deeds field codes in code

Grep `scripts/declarations/tr` and `scripts/db` for `06010`, `05400` and `1005010`. If any code
uses them with the wrong meaning, fix it; the audit found them only in the followups doc, but
confirm. Add a comment table of the verified codes beside the CR parser's field map
(`00050` seat, `05500`/`05510` actual owners, `06000`–`06020` enterprise transfer, ГФО =
`ActModeValue` 2).

### T3.4 ЦАИС ЕОП EUR guard — write the missing verifier

`verify_eur_currency_eop.ts` never existed. Write it read-only over the cached daily JSON
(`raw_data/procurement/eop/*.json.gz`):

- for the ~365 2020–2025 rows tagged EUR in the АОП CSV, join by `tenderId` /
  `uniqueProcurementNumber`;
- report `currency` vs `contractCurrency` agreement;
- decide which field is authoritative from the cases where they disagree;
- output the list for the existing ~322-row finding.

Read-only; any correction goes through the normal re-key chain in CLAUDE.md.

### T3.5 Cloud SQL tier decision

Already a followups entry. T1.1 supplies the facts it was missing (dates and which
measurements belong to which box). No new work here beyond that.

---

## Tier 4 — work unblocked by the audit (first bounded step each)

Each item names its first deliverable only. A whole-feature build goes to its own plan if
taken further.

| #    | item                             | first step                                                                                                                                                                    | source verified 2026-10-21          |
| ---- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 4.1  | АХУ open calls                   | `opencalls:ahu` fetcher + parser for `/portal/page/7` and `/123`; filter staff competitions; `indicative` until a dated window is parsed; watcher                             | `ahu.mlsp.government.bg` 200        |
| 4.2  | АЗ intake windows                | parse dated news items into `indicative` rows with the verbatim window text; never infer a deadline from a date elsewhere on the page                                         | `az.government.bg/bg/news/...`      |
| 4.3  | Administration e-service volumes | ingest МЕУ's еФорми dataset (data.egov.bg dataset 20218) into a table; Matomo visits optional and labelled VISITS                                                             | data.egov.bg, analytics.egov.bg API |
| 4.4  | НОИ ТП map                       | ingest „пенсионери по ТП" CSV 2010–2025 (data.egov.bg `3eab3ab2-…`); 28 ТП ↔ oblast crosswalk, with Sofia city and Sofia oblast separate                                      | data.egov.bg НОИ org 123            |
| 4.5  | НТР tourism register             | cookie-jar + XPages postback fetcher, no browser; replace the static snapshot                                                                                                 | `ntr.tourism.government.bg`         |
| 4.6  | `tour_occ_ninat` watcher         | `scripts/watch/sources/` entry on the Eurostat dataset's `updated` stamp                                                                                                      | Eurostat API                        |
| 4.7  | parliament.bg bills              | crawler over `POST /api/v1/fn-bills` + `GET /api/v1/bill/{id}`; fill `bill.final_item` only where `L_Act_dv_iss` is set; rate-limit; undocumented API, so cache raw responses | parliament.bg                       |
| 4.8  | ИВСС money tables                | map № 10/11/13 (stocks) into `person_wealth_year` beside cacbg 4/5/7; thresholds in лева → EUR at the peg; gate against double-counting № 12 receivables                      | ИВСС 2026 form                      |
| 4.9  | Live чл. 229 т. 17 experts list  | locate the live page (the ЦАИС bundle's other config key, per CLAUDE.md); if found, a second loader beside 174 — never merged into the historical table                       | aop.bg                              |
| 4.10 | Сметна палата audit reports      | scoping only: enumerate bulnao.government.bg audit-report listings and their format; decide the table shape                                                                   | bulnao.government.bg                |
| 4.11 | СЕБРА daily                      | locate the current minfin.bg СЕБРА page (Cloudflare — operator download, as for the other minfin series); Наредба по ПМС 299/2016 defines the per-day Excel shape             | minfin.bg                           |
| 4.12 | КФП monthly history              | ingest `/statistics/5` monthly workbooks (operator download); annotate GFSM 86/2001/2014 eras; no ESA claim                                                                   | minfin.bg (Wayback-verified)        |
| 4.13 | Долно Езерово pre-2016           | ЗДОИ or archive search for Община Бургас заповеди за образуване на секции 2011/2015/2016; only then place codes                                                               | —                                   |
| 4.14 | `person_source` facets           | measure which facets are empty after the full officials ingest; close the followups entry if none                                                                             | repo                                |

4.1–4.3 share the open-calls and data.egov plumbing and can run in parallel with each other;
4.7 and 4.8 touch the person / parliament layers and should not run alongside a
`db:resolve:persons`.

---

## Deploy order (cloud)

Only the steps that change serving state:

1. T2.1 → `db:load:open-calls:pg:cloud`.
2. T2.2 → `db:load:interreg:pg:cloud` → `db:load:graph:pg:cloud` →
   `db:load:tr-company-place:pg:cloud` (the 127 arm, per CLAUDE.md).
3. T0.2 / any `src` change → `npm run deploy`. If the bundle hash moves and no function changed,
   one deploy is enough; otherwise use the three-step order in CLAUDE.md.
4. T2.4 → `bucket:gz`.
5. T2.3 → Cloudflare rule or `firebase deploy --only hosting:ai`.

## Verification

- `npm run lint`, `npx tsc -b`, `npm run test:unit` after every tier.
- `npm run test:data` after T2.1, T2.2 and any Tier 4 loader.
- Re-run the specific external probe from the audit for each fixed item, and append a „fixed
  <date>" note to `docs/audits/deferred-followups-verification-2026-10.md` rather than editing
  its verdicts (the audit is a dated record).
- Update `docs/deferred-followups.md`: remove entries this plan completes; Tier 4 items not
  taken stay there.
