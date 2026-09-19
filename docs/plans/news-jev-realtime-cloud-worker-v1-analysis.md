# Review of `news-jev-realtime-cloud-worker-v1.md`

> **Status: audit record.** Every finding below has been folded into the plan itself —
> `docs/plans/news-jev-realtime-cloud-worker-v1.md` §0 records each correction, and §1–§10
> are the corrected design. **The plan is the authoritative document; this file is the
> evidence trail behind it** and is kept because it carries the full sourced claim-by-claim
> table and the primary-source citations.
>
> **Appendix A** (end of file) holds the plan's revision passes 2–8, moved here verbatim on
> 2026-09-19. It uses the **phase numbering of its time** — the plan's §7 carries the mapping
> (its "Phase 1" Jev benchmark is now Phase 3, "Phase 3" publish baseline is Phase 4, and so
> on). The ninth pass, which re-ordered the roadmap, lives in the plan as §0.2.

**Reviewed**: 2026-09-19. Every figure below is either measured in this repo, read from the
plan under review, or cited to a source. Nothing is estimated without saying so.

**Verdict**: the plan identifies a real problem (hourly publication latency) and a real
technology (Jev), but it diagnoses the bottleneck as *hosting* when it is *fetch path +
publish model*, its cost model does not survive its own arithmetic, and it proposes a
Jev workload that the repo has already measured to cost about the same as the system it
replaces.

A claim-by-claim audit (§3) finds **13 false or stale claims** — including every price in
its cost table — and one structural gap (`topics` is multi-label in 36% of articles) that
is **not mentioned at all**. Meanwhile the single largest reliability defect in the
pipeline today — the browser tier saving zero articles from the three biggest outlets — is
**absent from the plan**, and no hosting change fixes it.

---

## 1. What the plan gets right

These are correct and should be kept.

* **Jev's pricing and shape.** Verified independently: OpenRouter lists
  `typesafe/jev-1.13` at **$0.042/1M input, $0.00/1M output**
  ([llm24.net](https://llm24.net/model/jev-1-13)), identical to the $42/Btok in
  `functions/jev_payload.js`. Jev 1.13 released 2026-09-18, so the plan is current.
* **Jev is non-autoregressive and cannot generate prose.** This is the load-bearing
  structural fact and the plan states it correctly. `docs/plans/jev-typesafe-eval-v1.md`
  §1 says the same thing more strongly: *there is no primitive that generates a value*.
* **The two-tier cascade is the right shape.** Jev gates first, a generative model
  summarises only survivors. That is the correct decomposition.
* **Bulgarian is fine.** The repo measures Jev at 95% BG on tool routing and 100% on BG
  closed-vocabulary args, so the language is not a blocker.
* **"17 browser sites" is exactly right.** `news/data/bg_news_sites.csv` has
  12 `browser_render_scrape` + 2 `browser_then_rss` + 3 `browser_then_sitemap` = 17.
* **The 40/60 non-civic split is roughly right.** Measured over the 2,583 saved analyses:
  `site_relevant = false` on 1,150 (44.5%).
* **Polling, not push, is correct.** No Bulgarian outlet offers a webhook.
* **A single small VPS beats serverless for a 24/7 Chromium workload.** The reasoning is
  sound even though the price and the vendor premise are not (§3).

---

## 2. The defect the plan does not mention, and that costs the most

The plan's entire host argument rests on browser-tier reliability. The browser tier is
**currently broken for the largest outlets**, from a residential Mac mini, today:

| domain | method | consecutive failures | last error | newest stored |
| --- | --- | ---: | --- | --- |
| `blitz.bg` | `browser_then_rss` | 11 | `listed 20, saved 0, 20 per-article failures` — HTTP 403 | 2026-08-22 |
| `dnevnik.bg` | `browser_render_scrape` | 11 | `listed 20, saved 0, 20 per-article failures` — HTTP 403 | 2026-08-22 |
| `capital.bg` | `browser_then_sitemap` | 4 | `listed 20, saved 0, 14 per-article failures` — HTTP 403 | 2026-09-02 |
| `24chasa.bg` | direct | 8 | `listed 20, saved 0, 16 per-article failures` | 2026-09-02 |
| `bta.bg` | `browser_render_scrape` | 0 | 30 URLs queued, HTTP 429 | 2026-09-02 |

(`news/data/_state/*.json`, 2026-09-02. Full alert list in the `acquire_direct` stage
report: also `bntnews.bg`, `burgas24.bg`, `focus-news.net`, `forbesbulgaria.com`,
`plovdiv24.bg`, `varna24.bg`.)

**The mechanism is a fetch-path bug, not IP reputation.** The Cloudflare challenge is
cleared successfully — the feed or the homepage is read, and 20 links are harvested. Then
the *article pages* are fetched by a plain HTTP client and every one is 403'd:

* In `harvest_browser.mjs`, the `browser_then_rss` / `browser_then_sitemap` branches have
  **no page-level browser fallback at all**. They end at
  `next: fetch_latest_articles.py --stdin=<kind>`, after which `save_articles.py` fetches
  each article with a bare HTTP client. `blitz.bg` and `capital.bg` are both in this group
  and both fail with 403 ×20.
* In the `browser_render_scrape` branch the fallback exists, but the routing decision is a
  **single-link probe**:
  `probe.status === 200 && probe.len > 5000` → `route = "plain_http"`. A Cloudflare
  interstitial is a 200 with several KB of HTML, so that predicate can classify a
  protected site as plain-fetchable. `dnevnik.bg` is in this group and also fails 403 ×20.

**Consequence for the plan**: a Hetzner VPS cannot fix either branch. Both are
`harvest_browser.mjs` control flow. This is a one-to-two day fix with **zero recurring
cost**, and it recovers three of the top twenty outlets plus the national news agency.

**Also note the challenge timings**, from the same file's measured comment:
`blitz.bg ~12s`, **`dnevnik.bg ~5 min`**, **`capital.bg ~10 min`**. The plan's §3 says
"12s to 5 minutes" — it understates the worst case by 2×, and the plan's headline
"end-to-end latency 1.5–3 minutes" is physically impossible for those 17 domains while a
10-minute challenge wait is in the path. The plan should claim sub-3-minute latency for
the **42 direct-tier domains only**, and state a 20-minute-to-1-hour budget for the
browser tier.

---

## 3. Claim-by-claim audit

| # | Plan claim | Reality | Status |
| --- | --- | --- | --- |
| 1 | Jev `$42/Btok` in, output free | Confirmed by OpenRouter listing and `functions/jev_payload.js` | ✅ |
| 2 | Jev is non-autoregressive, no prose | Confirmed, and stronger: no primitive generates a value | ✅ |
| 3 | Jev "70ms–250ms per article" | Repo measures **310–492 ms**; the chat client had to raise its budget from 1,200 ms to **2,500 ms** because it expired on every live call, with the server handler alone taking 1.0–1.18 s | ❌ understated ~2× |
| 4 | "vs 4,000–8,000ms for autoregressive LLMs" | Measured GLM 5.3 Flash: **8.95 s median, 10.98 s mean**; live batch 10.07 s median / 22.61 s p90 | ❌ understated |
| 5 | Schema fit: `entities` resolved deterministically "in 2ms via `gazetteer.json` (30k+ Bulgarian entities)" | Gazetteer holds **14,066** entries (4,655 person / 3,824 institution / 5,404 place / 183 party) — **and zero companies**. The `mention_index` stage **explicitly excludes** `place` (20,263 mentions) and `company` ("no company entries exist: 1.02M registry names cannot be matched by name"). Yet `entities.places` is non-empty in **79.8%** of saved analyses and `companies` in **23.9%** | ❌ wrong on count *and* on coverage |
| 6 | `party_tones` is "100% Native" and a Jev strength | Party tone is **deliberately hidden in production**: all four tested models *failed* the release gate on unsupported evidence (`openrouter-model-benchmark-2026-08-29.md`). Jev cannot produce the `evidence` string the gate validates | ❌ contradicts a live safety gate |
| 7 | "~40% non-civic" bypasses Tier 2 | Measured 44.5% — close enough | ✅ |
| 8 | Gold eval set is "50 articles" | It is **240** records; 50 is the repeat-adjudication subset | ❌ understated 5× |
| 9 | Baseline "~$30.50/month" | Measured **$22.99–$25.55/mo** at the measured 900–1,000 articles/day; $26.00/mo per 1,000/day. $30.50 is not traceable | ❌ unsourced |
| 10 | 1,500 articles/day | Measured **900–1,000/day** | ⚠️ 1.5× high (harmless as capacity) |
| 11 | Tier-2 summaries $9.00/mo | Unsourced. Derived from GLM's measured $0.000655/response for a full-schema call, a summary-only call is ~$2–3/mo at 22.5k | ❌ ~3× high |
| 12 | GCS $0.50/mo | $0.50 is roughly **today's** cost (65 objects × 24 hourly publishes). The proposed design is what breaks it — see §5 | ❌ stale basis |
| 13 | Hetzner CAX11/CX22 at €3.79–3.99 (~$4.15) | Hetzner raised cloud prices **twice in 2026** (Apr 1 all customers; Jun 15 new orders + rescales, which also **renamed** the lineup). **€3.79 is a stale pre-2026 price.** Per Hetzner's own price-adjustment doc, `CAX11` is **€5.99/mo** ex-VAT and ex-IPv4; **`CX22` no longer exists** (renamed `CX23`, €5.49); **IPv4 is now a separate €0.50/mo line item**. All eight Cost-Optimized plans are reported **not orderable** today, and two independent aggregators disagree on both the exact prices and which plan is the cheapest *orderable* one (CPX12 €11.99 1 vCPU/2 GB, vs CPX22 €19.49 2 vCPU/4 GB). Every reading puts the realistic VPS line at **~€6–20 (~$7–23)**, not $4.15 — **verify at hetzner.com at order time; do not plan against a number from any secondary source** | ❌ stale price + availability risk |
| 13b | Cloudflare Workers + Browser Rendering "$0.05/min … $3.00/hr → ~$50–225/mo" | Both unit prices are wrong by ~33×. Cloudflare's own pricing page (updated 2026-04-21): Workers Paid **includes 10 browser hours/month**, then **$0.09 per additional hour** = **$0.0015/min**; 10 concurrent browsers included, then $2.00 each | ❌ unit prices wrong |
| 13c | Oracle Cloud OCI Free Tier "4 OCPU, 24 GB" | Halved on **2026-06-15** to **2 OCPU / 12 GB** (1,500 OCPU-hours + 9,000 GB-hours/mo), and the idle-reclaim rule (CPU, network *and* memory all <20% over 7 days) is a live risk for a mostly-idle poller. European A1 capacity is scarce | ❌ stale spec |
| 14 | Hetzner IPs "are not flagged as datacenter scrapers by Cloudflare" | **Inverted.** Hetzner is **AS24940**, tagged `hosting` by the IP-intelligence databases Cloudflare consults *before* headers. Hetzner works for scraping because of Chromium's genuine TLS fingerprint plus polite per-host rates — not because its reputation is clean | ❌ inverted reasoning, right conclusion |
| 15 | `topics` = "Hierarchical `choice`" | **`topics` is an array.** 878 of 2,457 non-empty analyses (**35.7%**) carry ≥2 topics. Jev `Choice` is single-select; `jev-typesafe-eval-v1.md` §6 names this as unvalidated. **Not mentioned in the plan** | ❌ structural gap |
| 16 | Free-text subfields | `quality.notes`, `leaning.evidence`, `russia_stance.evidence`, `ai_generated.signals[]`, `party_tones[].evidence` are all `minLength: 1` strings. The plan calls evidence "extractive" but never says how `signals[]` is produced | ⚠️ hand-waved |
| 17 | The plan's own roadmap files | `news/scripts/jev_client.py`, `eval_jev_benchmark.py`, `daemon_ingest.py`, `news/standalone/deploy_hetzner.sh` — **none exist**. All four are new work | ℹ️ scope |

Two further measured constraints the plan never mentions, both from the repo's own working
production code in `functions/jev_payload.js`:

* **Maximum 8 questions per request.** `quality` + `site_relevant` + `category` +
  `subcategory` + `leaning` + `russia_stance` + `ai_generated` = **7**, leaving room for
  exactly one more — with no `party_tones` and no multi-topic.
* **Maximum 300 options/question, 600 chars/option, 24,000 chars of `state`, 100,000
  chars total.** The 26+103 taxonomy fits, but only just, and the criteria are billed as
  input tokens.

---

## 4. The cost model does not survive its own arithmetic

This is the most important quantitative correction. The plan assumes **2,000 input
tokens/article**. The repository has already measured what a Jev call actually costs at
two different option counts:

| configuration | input tokens | cost/call | latency | source |
| --- | ---: | ---: | ---: | --- |
| Jev `choice` over **236 options** | **11,582** | **$0.00049** | 492 ms | `jev-typesafe-eval-v1.md` §2 |
| Jev `choice` over **k=5 options** | **559** | **$0.000023** | 329 ms | same |
| GLM 5.3 Flash, full schema (live) | ~5,114/request | **$0.000867**/accepted | 10.07 s median | `openrouter-live-batch-2026-08-31.md` |

**Jev's question definitions are input tokens.** A `Choice`'s `criteria` map is part of the
request, and at $42/Btok a large option set dominates. The measured cost of one 236-option
question ($0.00049) is **the same order as the entire current GLM analysis**
($0.000655–0.000867). Jev is *not* intrinsically cheaper than GLM here — it is cheaper only
when the option set is small.

The plan's taxonomy needs 26 categories + 103 subcategories ≈ 129 options, plus leaning,
russia, AI, quality and party-tone options. At the measured ~48 tokens/option:

```
article state (measured, ~4.7k)  +  ~150 options × 48 tok  ≈ 11,900 input tokens
11,900 × $42/1e9 × 30,000 articles/month                    ≈ $15.00/month
```

Against a measured GLM baseline of **$22.99–$25.55/mo for the whole schema including
summaries**, the plan's cascade saves ~30% — before the VPS — not 43%. And with the VPS at
its real price (€6.49–11.99 ≈ $7–13), the total is **$22–28/mo: break-even to slightly
worse than doing nothing.**

**The prize only appears with a retrieval prefilter.** Retrieve ~6–8 plausible taxonomy
nodes, then ask Jev a `choice` over the shortlist:

```
article state (~4.7k)  +  ~6 options × 48 tok  ≈ 5,100 input tokens
5,100 × $42/1e9 × 30,000                       ≈ $6.42/month
+ Tier-2 summaries                             ≈ $2–3/month
                                               ≈ $9/month  →  a real 60–65% saving
```

The repo has already proved this pattern is 21× cheaper per call (559 vs 11,582 tokens), and
has already flagged the catch: the k=5 row was measured with a **synthetic** retriever, so
it is a ceiling given perfect retrieval, not a prediction. Retrieval is the hard part, and
it is real engineering the plan does not budget for.

⇒ **Recommendation: do not build the full-taxonomy Jev classifier. Build the retriever
first, or build only the cheap gate (§6, Stage A).**

---

## 5. The publication model cannot do what the plan asks

The plan says *"Incremental bundle build & atomic GCS sync (500ms)"*. Two measured facts
say no:

**a) The bundle is not small.** `bundles` produces **65 files / 27,118,153 bytes** in 13 s.
The upload is `gsutil -m cp -r <tmp>/app-data/* gs://…/versions/<run-id>` — every publish
is a full 27 MB tree.

**b) The frontend pins the layout.** `newsapp/app/data.ts` validates the manifest with
`row.data_base !== \`versions/${runId}\`` → **throws**, and every bundle URL is built as
`${root}/${manifest.data_base}/${path}` with `cache: "force-cache"`. So a new version
directory must be *complete*; you cannot upload only the changed files and leave the rest
404.

Consequences:

* **GCS Class A operations become a primary cost.** 65 objects per publish:
  * at the plan's implied 90-second cadence — 960 publishes/day × 65 = **62,400 ops/day**
    (**1.87 M/month**);
  * at a 5-minute cadence — 288 × 65 = **18,720 ops/day** (**561 k/month**).
  At GCS's published regional-Standard Class A rate (~$0.05/1,000 — **verify against your
  own bill**), that is roughly **$94/month and $28/month** respectively, against a budgeted
  **$0.50**. (Today's hourly cadence is 65 × 24 = 1,560 ops/day ≈ $2.34/mo — which is where
  the plan's $0.50 came from. It is a *current* number carried into a 40× more frequent design.)
* **The version tree grows 27 MB per publish.** At 5-minute cadence that is 7.8 GB/day
  (~234 GB/month) retained, because the README deliberately forbids deleting version
  directories without a chosen rollback window.
* **Client latency floor.** `PUBLICATION_POLL_MS = 60_000` and the manifest is fetched
  `cache: "no-store"`, so an already-open tab learns about a release within **60 s**. Cold
  visitors are immediate. The plan's 90-second publish target is inside that window — fine —
  but the plan never states that the *client* poll, not the server, sets the floor for open tabs.

**The fix that makes the plan's cadence affordable**: change the release to
**content-addressed per-file publication**.

```
manifest v4:  { version: 4, objects: { "home.json": "sha256-…", "latest.json": "…", … } }
objects/<sha256>.json   ← create-only, immutable, max-age=31536000
manifest.json           ← the only mutable object, CAS-written last
```

Each publish then uploads only the ~3–8 changed objects plus the manifest — ~100 KB and
~5 ops instead of 27 MB and 65 ops — at a 90-second cadence: ~7,200 ops/day ≈ **$11/month**,
falling to ~$5/month at a 120-second debounce. Immutability, the last-writer-wins CAS
pointer, and pointer-only rollback are all preserved. The cost is a **scoped frontend
change** in `newsapp/app/data.ts` (the repo already versions the manifest v1/v2/v3 with
explicit validation, so adding v4 is the established pattern) plus its
`data.publication.test.ts` gate.

---

## 6. Recommended architecture

**Principle: this is not one pipeline on one clock. It is three clocks, and the plan
couples them.**

| clock | bound by | realistic period |
| --- | --- | --- |
| **Scrape** | per-source: HTTP politeness → Cloudflare challenge | 60 s (direct) … 10 min (browser) |
| **Decide** | model latency | ~1–2 s (Jev gate) … ~10 s (GLM) |
| **Publish** | debounce + upload ops + reader poll | 60–120 s |

### Keep (do not rebuild)

The standalone bundle, the direct/browser tier split, `save_articles.py`'s extractor and
gates, the immutable-version + manifest-CAS release, the hourly cold path (image rights,
evals, `mention_index`, validation). The plan proposes to replace a working system with
four unbuilt scripts; almost none of that is necessary.

### Change 1 — fix the browser tier (coverage; no new spend; do first)

* Give the `browser_then_rss` / `browser_then_sitemap` branches the same page-level
  fallback `browser_render_scrape --route` already has: when a plain-HTTP article fetch is
  not 2xx, re-fetch it **inside the cleared browser context** (carrying its cookies) and
  hand it to `save_articles.py --prefetched=`.
* Replace the single-link route probe with a sample of 3–5 links, and require evidence of
  an *article* (expected length band **and** a title/body marker), not
  `status === 200 && len > 5000`, which a Cloudflare interstitial satisfies.
* Back off harder on `bta.bg`'s 429 (it is a rate problem, not a challenge problem).

### Change 2 — split the schedule (latency for the direct tier; no new spend)

A **hot path** every 2–5 minutes running only `acquire_direct → analyze (small batch) →
bundles → publish`, under its own lock; the browser tier, image pipeline, `mention_index`,
evals and full validation stay on the hourly **cold path**. The measured stages make this
comfortable: `acquire_direct` 34 s, `bundles` 13 s; at 42 articles/hour a 5-minute hot path
decides ~3.5 articles.

This is where most of the plan's "30× faster" claim is actually collected — and it requires
**no new model and no new host**.

### Change 3 — content-addressed publication (enables Change 2's cadence)

See §5. Small objects + manifest v4; debounce publishes to ~90–120 s.

### Change 4 — Jev as a *gate*, not a replacement (measure first)

* **Stage A (build this):** one cheap Jev call per article — `site_relevant` (`noul`) +
  `quality.verdict` (`choice`, 6 options). ≈ **44%** of articles stop here having cost
  ~nothing. This is the plan's cascade idea, correctly scoped, and it is defensible on the
  evidence the repo already has (Jev's calibrated confidence; 96% on closed-vocab choices,
  with 81% of wrong answers falling below a 0.7 gate).
* **Stage B:** civic + `ok` articles continue into the **existing GLM path**. Ship nothing
  new here until the Jev benchmark in §7 says otherwise.
* **Stage C (only if the benchmark passes):** add the retrieval prefilter, then let Jev take
  over `topics` / `leaning` / `russia_stance` / `ai_generated` over a shortlist. Use
  **multiple questions over the same shortlist** to recover multi-label `topics` (a
  `primary` question plus a `secondary` question), which stays inside the 8-question cap.
* **Never** let Jev own a field that requires an evidence string. `quality.notes`,
  `leaning.evidence`, `russia_stance.evidence`, `ai_generated.signals[]` and
  `party_tones[].evidence` must stay with a generative model or deterministic extraction —
  and `party_tones` stays hidden until it passes the existing release gate.
* **Pin the version.** `functions/jev_payload.js` pins `jev-1.13.0` deliberately, because
  `jev-latest` moves and confidence thresholds tuned against one release do not hold on the
  next. The plan uses the alias.

### Change 5 — do not move the scraper to a datacenter ASN

* Acquisition depends on clearing Cloudflare challenges; the current residential IP is an
  asset, and Hetzner (AS24940, tagged `hosting`) is the exact signal weighted *before*
  headers ([ASN analysis](https://dev.to/james_clark/your-scraper-isnt-blocked-because-of-your-headers-its-blocked-because-of-your-asn-13gn)).
  The sharper version of the point: **no provider on the plan's list satisfies the
  requirement**, because they are all datacenter ASNs. Cloudflare's bot score specifically
  targets headless browser signatures. What actually works today is a residential/mobile
  egress or a stealth-patched browser — not a different VPS. The plan's own §3 premise
  ("Clean European IP reputation") is not purchasable at €4.
  Hetzner is nonetheless a *better* scraping host than AWS/GCP/Azure, which is the plan's
  correct conclusion reached by incorrect reasoning.
* If the hot path should leave the Mac mini, move the **analysis + derive + publish**
  stages — pure compute, no scraping — to a cheap VM. That is where a VPS genuinely fits,
  and it needs no special IP.
* Re-derive the host price at order time. In no reading is €3.79 the current price for
  2 vCPU / 4 GB.
* **The plan's Cloudflare verdict is right for the wrong reason, and the right reason is
  stronger.** Its unit prices are off by 33×, but the workload still does not fit: the repo
  budgets *an hour per browser sweep* (dominated by `dnevnik.bg`'s ~5 min and `capital.bg`'s
  ~10 min challenge waits). At a 20-minute stagger that is 72 sweeps/day × 1 h =
  **~2,160 browser hours/month**, which at the real $0.09/hr is **~$194/month** — and
  Browser Run runs on Cloudflare's own datacenter IPs, so it would not clear the challenges
  it was bought for. Drop the plan's price figures; keep its conclusion.

### Corrected economics at the measured 1,000 articles/day

| line | plan | measured / derived |
| --- | ---: | ---: |
| Baseline (current GLM, whole schema) | $30.50 | **$22.99–25.55** |
| Jev classification, full taxonomy | $3.78 (2,000 tok) | **~$15.00** (~11,900 tok) |
| Jev classification, retrieved shortlist | — | **~$6.42** (~5,100 tok) |
| Tier-2 summaries | $9.00 | **~$2–3** |
| GCS at the proposed cadence | $0.50 | **$28–94** (65 ops/publish) |
| GCS with content-addressed publish | — | **$5–11** |
| VPS | $4.15 | **$7–23** (CAX11 €5.99 / CX23 €5.49 ex-VAT ex-IPv4 + €0.50 IPv4; Cost-Optimized line currently unorderable) |

**Honest bottom line.** Full-taxonomy Jev on a new VPS: **$24–31/mo — no saving**. Jev gate
+ shortlist + content-addressed publish, reusing the existing host: **~$9–14/mo, a real
50–65% saving**. The saving comes from the retriever and the publish model, not from Jev
being a cheap model.

---

## 7. What to do first — cheapest information, in order

1. **Fix the browser tier** (§6, Change 1). 1–2 days, zero recurring cost, recovers
   `blitz.bg`, `dnevnik.bg`, `capital.bg`, `bta.bg` and ~7 more. This is worth more than any
   hosting decision in the plan.
2. **Benchmark Jev against the real gold set before designing anything else.** 240 records
   (`news/data/gold/gold_set.json`) × 2 configurations ≈ 480 calls ≈ **$0.25**. Port the
   request shape from the repo's working `functions/jev_payload.js` — do not write a new
   client from the API docs.
3. **Measure the actual input-token count for the real taxonomy payload** in that same run.
   Every cost number in both documents depends on it, and the repo's own 236-option call
   (11,582 tokens) is the calibration point.
4. Only then choose between the gate, the shortlist, or neither.

---

## 8. Corrected verification gates

The plan's §7 gates need replacing, because two of them cannot fail for the right reason.

| plan gate | problem | use instead |
| --- | --- | --- |
| "50-article gold set" | the set is **240** records | `news/data/gold/gold_set.json`, 240 records; the 50 is the repeat subset |
| "≥85% leaning agreement **vs the established baseline**" | GLM's leaning macro-F1 against human labels is **0.544** — a model can agree with GLM and be wrong. Human repeat agreement is **0.978**, which is the real ceiling | score against **human labels**; report the human repeat-agreement band as context |
| "≥90% topics" | measured GLM top-1 vs gold is 0.750 | same, plus a **multi-label rate assertion**: the ≥2-topic rate must stay near the measured **35.7%**, so a model that collapses everything to one topic fails loudly |
| — | `leaning` has only **38** non-`not_applicable` gold records and `russia_stance` only **22**. A 90% score on n=22 carries a ±13 pt 95% CI | state n beside every field; never set a release gate on the n=22 field alone |
| — | no test that Jev did not fabricate evidence | assert every `*.evidence` / `signals` value is a **verbatim substring of the article after whitespace folding** — the repo already implements exactly this predicate at `news/scripts/analyze_local.py:344–356` |
| — | `party_tones` | keep it **hidden** until the existing release gate passes; Jev cannot supply the evidence field that gate validates |

---

## 9. One-paragraph summary for the decision

The plan is directionally right that Jev plus a small always-on host can cut latency, and
it is right about Jev's shape, its price and the need for a generative tier. It is wrong
about *where the time and money go*: the latency is set by the publish cadence and the
client's 60-second manifest poll, not by the classifier; the reliability is set by a
one-link route probe and a missing browser fallback in `harvest_browser.mjs`, not by IP
reputation; and the cost is set by how many options you put in a Jev `choice` and how many
objects you re-upload per release, not by the model's price. Fix those three things first
— all measurable, two of them free — and the 30× speedup largely arrives without a new
host. Then spend the $0.25 benchmark to decide whether Jev earns a place at all.

---

### Sources

* Plan under review: `docs/plans/news-jev-realtime-cloud-worker-v1.md`
* `docs/plans/jev-typesafe-eval-v1.md` — repo's measured Jev accuracy, latency, token counts
* `functions/jev_payload.js`, `functions/llm_http.js`, `ai/llm/jevClient.ts` — production Jev
* `news/evals/openrouter-live-batch-2026-08-31.md` — $0.000867/accepted, 900–1,000/day
* `news/evals/openrouter-model-benchmark-2026-08-29.md` — per-field accuracy, party-tone gate
* `news/evals/gold-set-2026-08-28.md` — 240 records, label distribution, repeat agreement
* `news/data/_nightly/2026-09-02T145946Z-16095.json` — stage timings, 65 files / 27,118,153 bytes
* `news/data/_state/*.json` — browser-tier failure state
* `news/scripts/harvest_browser.mjs`, `save_all_browser.sh` — route probe, challenge timings
* `newsapp/app/data.ts` — `PUBLICATION_POLL_MS`, manifest pinning, cache policy
* `news/data/gazetteer.json` — 14,066 entries, no companies
* [llm24.net — Jev 1.13 pricing](https://llm24.net/model/jev-1-13)
* [Hetzner 2026 price adjustments](https://agentdeals.dev/hetzner-pricing-2026) (read 2026-09-04)
* [Hetzner cloud pricing aggregator](https://cloudpricecheck.com/hetzner/cloud-servers-pricing)
* [Why the ASN, not the headers, gets you blocked](https://dev.to/james_clark/your-scraper-isnt-blocked-because-of-your-headers-its-blocked-because-of-your-asn-13gn)
* [Cloudflare Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/) — 10 browser hours/mo included, then $0.09/hr


---

## Appendix A — revision passes 2–8 (moved from the plan, 2026-09-19)

Moved verbatim from the plan's §0.1–§0.8 so the plan reads as a design, not as its own
audit history. **The ids are unchanged** — every `§0.1 R8`, `§0.3 V1`, `§0.7 T1`, `§0.8 U2` …
reference in the plan resolves here. Rows later withdrawn (G1, G6) or corrected (T1, T3, T4)
are kept struck-through or annotated, as they were.

### 0.1 Second revision — what the first revision got wrong

Each row was re-derived from source, not from the analysis document.

| # | First revision said | Verified | Evidence |
| --- | --- | --- | --- |
| R1 | Latency today is ~1 hour | **17 days.** Nothing has published since 2026-09-02; no scheduler is installed. Every `_state` failure count in §3.2 is a 2026-09-02 snapshot, not current | `gsutil cat …/news/app-data/manifest.json`; `gsutil ls …/versions/` (12 trees); `crontab -l` |
| R2 | GCS Class A is **~$0.05 per 1,000**, so 5-min publishing is ~$28/mo and 90 s ~$94/mo | The bucket is **regional `EUROPE-WEST3`, Standard**: Class A is **$0.05 per 10,000 = $0.005 per 1,000**. Every figure in the old §5.3 was **10× high**: 5 min ≈ **$2.81**, 90 s ≈ **$9.36**, content-addressed 90 s ≈ **$1.15** | `gsutil ls -L -b gs://data-electionsbg-com`; [GCS pricing](https://cloud.google.com/storage/pricing) via [nOps](https://www.nops.io/blog/google-cloud-storage-pricing/) |
| R3 | GCS operations are the cost that scales with cadence | **Reader egress is**, and the plan never modelled it. On a new `run_id` the client calls `dataCache.clear()`, so every open tab re-downloads every mounted bundle. Story/Article/Outlet/Saved screens all mount `stories.json` = **4,358,382 B served uncompressed** (`x-goog-stored-content-encoding: identity`; gzip -9 would be 964,573 B). At $0.12/GB that is **~$4.5 per continuously-open tab per month at a 5-min cadence, ~$15 at 90 s** | `newsapp/app/data.ts` `resolveBase`; `curl -sI` on the live object |
| R4 | Content-addressed releases upload "~3–8 changed objects, ~100 KB" | One new article changes at least `articles/<domain>.json` (0.3–1.2 MB), `latest.json` (484 KB), `home.json`, `stats.json` and — when it joins a story — **`stories.json` (4.36 MB)**. A realistic release is **~5–6 MB**, not 100 KB. Content-addressing fixes the unchanged 21 MB; it does **not** fix the hot objects | `news/app-data/*` sizes |
| R5 | *(absent)* | **Storage grows without bound.** The bucket has **no lifecycle configuration** and 266 MiB of version trees from two days. Full trees at a 5-min cadence add ~233 GB/month (+~$5/mo *every* month). And an age-based lifecycle rule is **unsafe** under content addressing: an unchanged object (e.g. `taxonomy.json`) stays referenced by the current manifest while its `timeCreated` ages out | `gsutil lifecycle get` → none; `news/standalone/README.md` §GCS setup |
| R6 | The hot path runs `acquire_direct → analyze → bundles → publish` | **The uploader refuses it.** `upload_to_gcs.py` publishes hot JSON only when the full stage report is structurally intact and the `mention_index`, `bundles`, and exact-payload `home_health` stages succeeded, and the manifest carries `home_health_ready: true`. ⚠️ **The README's "twelve-stage report" is stale — the enforced count is 14** (`upload_to_gcs.py` `EXPECTED_STAGES` = 14, `run_nightly.sh` `STAGES_EXPECTED=14`); the gate that bites is the second check (`mention_index, eval_export, bundles, eval_task_build, home_health` all exit 0). The hot path must run `home_health` and needs its own publish predicate. It must also publish through `public_app_data_scopes()` — the default scope list re-rsyncs the whole private archive and the mentions tree on every publish | `news/standalone/README.md`; `upload_to_gcs.py` `EXPECTED_STAGES` / `commands()` / `public_app_data_scopes()`; `run_nightly.sh` |
| R7 | A hot path "decides ~3.5 articles per run" | Only if it analyses **the articles it just fetched**. The shared queue (`queue_sort_key`) orders by publication **day**, then outlet rank — not by arrival — and ~5,000 of 7,736 stored articles are unanalysed. With any backlog, a hot run with a small `--limit` spends it on older same-day articles from higher-ranked outlets and never reaches the one published a minute ago | `news/scripts/analyze_articles.py:331` |
| R8 | Two schedules, "under its own lock (distinct from `var/hourly.lock`)" | Two independent writers of one release pointer can **regress** it: the hourly cold path takes a snapshot at T, runs ~30 min, and then CAS-publishes a release that lacks everything the hot path published after T. The manifest CAS guards against lost updates, not against a stale-but-newer write. Needs one publisher, or a monotonic content watermark | `upload_to_gcs.py` CAS on `generation` only |
| R9 | 8 questions / 300 options / 24,000 chars are **Jev's "structural" hard limits** | They are **this repo's chat-proxy input caps** (`functions/jev_payload.js` `LIMITS`, "added because the only other thing standing between this module and an unbounded paid payload was the caller's 110KB body cap"). A server-side news pipeline holding its own key does not go through that proxy. TypeSafe's actual API limits are **unverified** and must be read from their docs in Phase 1 | `functions/jev_payload.js:17–36` |
| R10 | Jev state ≈ a **~4.7k-token article**, so full taxonomy ≈ 11,900 tok ($15/mo) and k≈6 ≈ 5,100 tok ($6.42/mo) | ~4.7–5.1k is GLM's **whole prompt** (instructions + taxonomy + schema + article). The article itself is **median 1,994 / mean 3,067 / p90 6,568 characters** (n=2,000 sampled stored articles); ~0.6% exceed 24,000 chars. At a conservative 3.5 chars/token that is **~600–900 tokens**. Recomputed: full taxonomy ≈ 8,100 tok ≈ **$10/mo**; k≈6 ≈ 1,200 tok ≈ **$1.5/mo**. Both still need `usage.input_tokens` measured, including whether the `state` is billed once per request or once per question | sample over `news/data/<domain>/*.json` `content_chars` |
| R11 | Multi-topic needs a `primary` + `secondary` question pair | A `Choice` already returns **a probability over every option**. Thresholding that distribution (all options with p ≥ τ) is a zero-extra-call multi-label candidate and must be measured before spending a second question. And a **two-call hierarchy** (26 categories, then the ~4 subcategories of the winner) needs **no retriever at all** — ~2.1k + ~1.1k tokens ≈ $0.00014/article, ≈ $4/mo — which removes Phase 5's largest risk | `news/prompts/taxonomy_compact.json` (26 / 103); §4.1 |
| R12 | The route probe fails because a 200 interstitial passes `len > 5000` | Partly. The probe runs **inside the cleared browser page** (`page.evaluate(fetch(u, {credentials:"omit"}))`) — i.e. with the browser's TLS/HTTP-2 fingerprint and challenge state — and on success hands the URLs to `save_articles.py`, **a different client**. A browser-side 200 is not evidence the Python client gets 200, whatever the page length. The probe must test the client that will actually fetch | `news/scripts/harvest_browser.mjs:501–515` |
| R13 | GLM "~10 s" per decision | 10.07 s is the **median**. The measured `analyze` stage answered 82 in 1,530 s at 4 workers ≈ **75 s of worker time per answer**, i.e. retries, the canary, the grammar probe and a long tail dominate. A hot-path budget must be sized on p95 with a per-call timeout, not on the median | §2.1; `analyze_local.py` canary + `grammar_is_enforced` |

**Net effect on the recommendation.** The ranking changes. Restoring the scheduler is now
first (it is the difference between 17 days and 1 hour). GCS operations stop being a reason
to defer the hot path; reader egress and `stories.json` become the thing to fix before the
cadence goes up. And Jev's economics improve — a hierarchy with no retriever (~$4/mo) is
cheaper than the shortlist *as the first revision priced it* ($6.42/mo). Re-priced on the
real article size the shortlist is cheaper still (~$1.5/mo), but it needs a retriever nobody
has built, so the hierarchy is the lower-risk default.

### 0.2 Third pass — verification of the second revision

Each §0.1 row was re-derived independently, against the repo's own files and, where the claim
was external, against a primary source. The external checks confirmed; the six defects found
are recorded as G1–G6 and are folded into the sections they belong to. **A fourth check
(§0.3) found that G1 is itself wrong and G6 is verifiable; both are corrected there.**

**Confirmed as written.**

| §0.1 | Claim | Independent check |
| --- | --- | --- |
| R2 | GCS regional-Standard Class A is **$0.050 per 10,000**, so the first revision's $28/$94 were **10× high** | Confirmed from the cited source, verbatim. The table re-derives exactly: 561,600 → **$2.81**, 1,872,000 → **$9.36**, 230,400 → **$1.15**. **The first revision's figure was the error, not this one** |
| R3 | A new `run_id` clears the client cache | `newsapp/app/data.ts:801` — `if (activeManifest?.run_id !== next.run_id) dataCache.clear()`; `stories.json` = **4,358,382 B**, exact |
| R4 | Hot objects are MB-scale, not 100 KB | `latest.json` = **484,370 B**; largest per-domain shard = **1,174,533 B** |
| R7 | The queue orders by day, not arrival | `queue_sort_key` at `analyze_articles.py:331`; 7,736 − 2,583 = **5,153** unanalysed |
| R10 | The article is ~900 tokens, not 4.7k | Over all **7,647** stored articles: median **1,940** chars (n=2,000 sample read 1,994), mean 2,921, p90 6,255, **42 (0.55%)** over 24,000 chars |
| R12 | The probe tests a different client than the fetcher | `harvest_browser.mjs:501` — `page.evaluate(fetch(u, {credentials:"omit"}))` on `links[0]`, then hands off to `save_articles.py`. The "different client" correction is right; the first revision's length theory was only part of it |
| §6.5 | "Most of v4 already exists" | `data.ts:689` validates `inventory: Array<{path, bytes, sha256}>` — correct |

~~**G1 — the gzip premise contradicts the code, so Phase 1b must measure first.**~~
*Withdrawn — see §0.3 V1. `-j` never stores gzip; there is no contradiction.* §6.5 item 2
and Phase 1b prescribe moving to stored `Content-Encoding: gzip` "not `-j`", but
`upload_to_gcs.py:278` **already passes `cp -r -j json`**, and `git log -S'"-j", "json"'`
shows it has been there since `d538b24335` — long before the object R3 inspected. R3's
`x-goog-stored-content-encoding: identity` and that flag cannot both be right. **Phase 1b
opens with one `curl -sI` on a freshly published object plus a stored-bytes-vs-local-bytes
comparison**; if `-j json` is silently not applying, the *reason* is the fix, and `-Z` may not
be it. Corrected in §6.5 and Phase 1b.

**G2 — `articles/<domain>.json` is a hot object that §6.5 never addresses.** R4 names it
(0.3–1.2 MB), but the four additions only split `stories.json` and `latest.json`. Phase 3's
≤500 KB passes only because gzip is counted — the largest shard alone is ~261 KB compressed,
about two-thirds of the budget. Added as §6.5 item 5.

**G3 — §6.1 contradicted R13.** The clock table said "~10 s (GLM)" while R13 establishes
~75 s of worker time per answer and requires budgeting on the tail. Corrected in §6.1.

**G4 — R6 quoted a stale README.** The README says "twelve-stage report";
`upload_to_gcs.py`'s `EXPECTED_STAGES` and `run_nightly.sh`'s `STAGES_EXPECTED` both say
**14**. A hot-path implementer must not encode 12. Corrected in R6.

**G5 — §6.2 called the system "working"** while R1 says it has been dead 17 days. Softened in
§6.2.

~~**G6 — §5.3's "GCS transcodes for the rare client that does not accept gzip" is unverified.**~~
*Now verified — see §0.3 V2.*
GCS's on-the-fly decompression semantics for objects stored with `Content-Encoding: gzip`
were not confirmed from a primary source. Impactless in practice — every browser sends
`Accept-Encoding: gzip` — but flagged in §5.3 rather than asserted.

**Not independently verifiable from this session**, and therefore resting on the second
reviser's access: R1's `crontab -l` (blocked in the sandbox), and the live-bucket reads behind
R1/R3/R5 — the 12 version trees, the stale `manifest.json`, the absent lifecycle
configuration, and the `identity` stored encoding. Everything checkable locally matched, and
the local corpus is consistent with a 2026-09-02 stop.

### 0.3 Fourth check — verification of the third pass

| # | §0.2 said | Verified | Evidence |
| --- | --- | --- | --- |
| V1 | **G1**: `-j json` "is supposed to set" stored `Content-Encoding: gzip`, so the live `identity` encoding contradicts the uploader | **Wrong, and it inverts the fix.** `-j` is gzip **transport** encoding: `gsutil help cp` says it "saves network bandwidth while leaving the data uncompressed in Cloud Storage". `identity` is exactly what `-j` produces — the code and the observation agree. The flag that stores gzip is **`-z json`** (per extension; `-Z` for all files). So the gzip half of Phase 1b is a **one-flag change** (`-j json` → `-z json` in `upload_to_gcs.py:278`), not an investigation. Step 0 is reduced to a post-change check | `gsutil help cp` (`-j`, `-z`/`-Z` entries); `upload_to_gcs.py:276–279` |
| V2 | **G6**: GCS decompression for clients without `Accept-Encoding: gzip` is unverified | **Verified.** For an object stored with `Content-Encoding: gzip`, GCS performs decompressive transcoding when the request lacks `Accept-Encoding: gzip` (served without `Content-Encoding`/`Content-Length`), and serves it as-is with `Content-Encoding: gzip` when the header is present. The one caveat: `Cache-Control: no-transform` disables it. `IMMUTABLE_PUBLIC_CACHE` (`public,max-age=31536000,immutable`) carries no `no-transform`, so it applies | [Cloud Storage transcoding](https://docs.cloud.google.com/storage/docs/transcoding) |
| V3 | **G4**: enforced stage count is 14 | **Confirmed.** `EXPECTED_STAGES` in `upload_to_gcs.py` is a 14-name tuple; `run_nightly.sh:203` `STAGES_EXPECTED=14`. The stale "twelve-stage" text is `news/standalone/README.md:159` — fix the README in the same change as the hot path, not only here | as cited |
| V4 | **G2**: largest per-domain shard ~261 KB compressed | **Confirmed in substance**: `articles/actualno.com.json` gzip -9 = **265,530 B** (~259 KiB) | `gzip -9c … \| wc -c` |
| V5 | R10 recheck "over all 7,647 stored articles: median 1,940, mean 2,921, p90 6,255, 42 over 24k" | **Reproduces within noise.** A full pass over `news/data/<domain>/*.json` finds **7,733** records, median **1,989**, mean **2,956**, p90 **6,288**, **42** over 24,000 chars. The 7,647 is `mention_index`'s scan count, a slightly different filter. Either way the article is ~600–900 tokens | full scan of `content_chars` + title |
| V6 | §0 row 7 / §6.7 quote `CPX22` at **€19.99**; the §5.3 table says **€19.49** | **Both right, differently based**: €19.49 is the plan price, €19.99 includes the now-separate €0.50 primary IPv4. The table's `~$23.19` is computed from €19.99, so its € column and $ column disagree. Fixed in the table. Note that `vps-eu-pricing-2026.md` (untracked, repo root) contains **no Hetzner rows**, so it is not a source for any Hetzner figure here | [byteiota](https://byteiota.com/hetzner-june-2026-price-shock/), [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/); `grep -i hetzner vps-eu-pricing-2026.md` → none |
| V7 | §6.4 debounce: "most 2–5 minute windows contain zero new civic articles" | **Self-contradictory** — the same sentence computes ~15% empty at 5 minutes (Poisson λ≈1.9). At 2 minutes λ≈0.77 and ~46% are empty. Reworded | arithmetic |


### 0.4 Restaged roadmap and the OpenRouter integration

The roadmap is now five phases: (1) integrate Jev through OpenRouter and measure accuracy and
speed; (2) ingest live articles, a test batch then a full 24 h batch, measuring download,
ingestion and Jev; (3) publish with the **current** v3 approach and measure sizes and
timings; (4) run locally for several days with everything logged; (5) decide cloud vs Mac
mini. The §6 designs (content addressing, hot path, hash-keyed cache, wider Jev scope) move
to a measurement-triggered backlog, §7.6. Two findings from re-checking the new staging:

| # | Finding | Evidence |
| --- | --- | --- |
| O1 | **Jev on OpenRouter is a beta on a separate alpha endpoint**, `POST /api/alpha/decisions`, not chat completions; it is absent from the public `GET /api/v1/models` list (447 models, no `typesafe/*`, 2026-09-19); pinned id `typesafe/jev-1.13-20260917`; 32k context. The request shape is documented only in a third-party example repo, so Phase 1 opens with a contract probe | [OpenRouter Jev 1.13](https://openrouter.ai/typesafe/jev-1.13); [typesafe-jev-examples](https://github.com/rajivkuriakose/typesafe-jev-examples); `curl …/api/v1/models` |
| O2 | **A 24 h batch cannot be one download.** A sweep takes `NEWS_ARTICLES_PER_SOURCE=20` items per outlet (`config.env.example`, `run_hourly.sh:141`) and feeds hold only their newest items, so a day's articles have to be collected by repeated sweeps, and a gap between sweeps loses articles without an error. Phase 2.3 measures feed-window overlap per domain for this reason | `news/standalone/config.env.example`; `news/standalone/run_hourly.sh` |

---

### 0.5 Fifth pass — verification of the fourth check

The fourth check's corrections were re-derived independently. It is right on all seven rows,
and three of them correct errors introduced by the **third** pass (§0.2). Four residual
defects were found and are folded into the sections named below as N1–N4.

**Confirmed, including three corrections to §0.2.**

| §0.3 | Claim | Independent check |
| --- | --- | --- |
| V1 | `-j` is gzip **transport** encoding, so `identity` is exactly what `-j json` produces; the flag that stores gzip is `-z json` | **Confirmed verbatim from `gsutil help cp`**: `-j` "saves network bandwidth while **leaving the data uncompressed in Cloud Storage**"; `-z` "reduces network bandwidth and **storage sizes**". **§0.2's G1 was wrong** — it asserted a contradiction where code and observation agreed, and would have sent an implementer hunting a nonexistent bug. §0.3's one-flag fix is correct |
| V2 | GCS decompressive transcoding applies, and `no-transform` is the only caveat | Confirmed as a documented Cloud Storage feature (page: "Transcoding of gzip-compressed files"); `IMMUTABLE_PUBLIC_CACHE` carries no `no-transform`. Full body not re-read in this pass |
| V3 | Enforced stage count is 14 | Confirmed earlier: `EXPECTED_STAGES` = 14-name tuple; `run_nightly.sh` `STAGES_EXPECTED=14` |
| V4 | Largest shard ~260 KB compressed | Confirmed: 1,174,533 B raw, their `gzip -9` measurement 265,530 B |
| V5 | Article sizes reproduce within noise | Confirmed: my 7,647-record pass (median 1,940 / mean 2,921 / p90 6,255) vs their 7,733 (1,989 / 2,956 / 6,288) — different filter (`mention_index` excludes some), same conclusion |
| V6 | `CPX22` €19.49 plan price vs €19.99 with IPv4 | Confirmed — **this was §0.2's own arithmetic inconsistency**, and the fix is right |
| V7 | §6.4's debounce wording was self-contradictory | Confirmed — **§0.2's wording**, not the arithmetic. "Most windows are empty" contradicted the ~15% figure in the same sentence |

**O1 confirmed empirically** (this settles Phase 1's load-bearing dependency, which §0.4 had
marked third-party-sourced):

| probe | result | O1's claim |
| --- | --- | --- |
| `GET https://openrouter.ai/api/v1/models` | **447 models, zero matching `typesafe`/`jev`** | "447 models, none `typesafe/*`" ✅ |
| `POST https://openrouter.ai/api/alpha/decisions` | **401** — endpoint exists and demands auth | separate alpha endpoint ✅ |
| `POST https://openrouter.ai/api/v1/decisions` | **404** | absent from the stable `/api/v1` surface ✅ |

So the alpha endpoint is live and Jev is genuinely off the public catalogue. The request
*shape* remains third-party-sourced, which is exactly why Phase 1 step 1.1 is a contract
probe — that handling needs no change.

**N1 — §1 and §7 disagreed about the scheduler, and §7 lost.** §1 item 0 ranks restoring the
scheduler above everything else in the document; §7 sequenced it at Phase 2 step 2.0, behind
the 1–2 day Jev benchmark, leaving the site stale throughout. Phase 1 needs nothing running
(it benchmarks a file on disk), so this was sequencing, not dependency. **Now Phase 0**, with
§7's preamble stating it runs first or alongside Phase 1. Steps 0.1–0.4 cover host
establishment and exclusivity (which also retires §9.12's two-scheduler race), the restore,
the alarm, and the `_state` re-baseline; Phase 2 step 2.0 is reduced to a re-confirmation.

**N2 — the new perf log would have been archived on every publish.** `news/data/_perf/` sits
inside the private-archive rsync source (`upload_to_gcs.py:255`) and `ARCHIVE_EXCLUDE` (lines
30–33) lists only `_browser|_html|_nightly|evals|gold`, so the log would be uploaded on every
release — growing monotonically through the multi-day Phase 4 run and inflating precisely the
per-publish bytes Phase 3 exists to measure. Requirement added to §7's instrumentation section.

**N3 — the cadence drifted from 5 to 15 minutes without the tables following.** §1 and §5.3
priced 5 minutes; Phase 4 caps the full-tree experiment at 15 (§9.5 repeats it), and §5.3 had
no 15-minute row — so the number Phase 4 will actually produce had no comparator. §5.3 now
carries the 15-minute rows, the storage figure, and an explicit "5 minutes is the target, 15
is the Phase 4 cap" note; §1 item 1 distinguishes them.

**N4 — one model, two id namespaces.** §6.6 recorded `decided_by: "jev-1.13.0"` (the chat's
TypeSafe pin) while §9.6 and Phase 1 use `typesafe/jev-1.13-20260917` (the OpenRouter pin).
The audit field now carries both, named for which gateway each came from.


### 0.6 Sixth pass — verification of §0.5, and story assignment

§0.5's N1–N4 re-checked: N2's `ARCHIVE_EXCLUDE` claim and N3's 15-minute ops/storage rows are
correct (96 × 65 = 6,240 ops/day → $0.94/mo; 27 MB × 96 × 30 ≈ 77.8 GB/mo). Six residual
defects, fixed in place:

| # | Defect | Fix |
| --- | --- | --- |
| S1 | The status banner still said "see Phase −1" after N1 renamed it | → Phase 0 |
| S2 | N3 added 15-minute rows to the ops and storage tables but not to the **reader-egress** table, the line §5.3 calls dominant | 15-minute row added: 12.6 GB/mo ≈ $1.51 raw, $0.33 gzip, ~$0.03 with the `stories` split, per open tab |
| S3 | Phase 4's 15-minute runs assumed the existing transaction can run every 15 minutes; it took 1,772 s (§2.1) and `run_hourly.sh` exits 0 when `var/hourly.lock` is held, so every other run would be skipped silently | Fast runs = same script, same lock, reduced scope (`NEWS_SKIP_BROWSER=1`, small analyze limit); skipped runs are logged |
| S4 | Phase 2.3 called the feed-overlap result the "minimum sweep interval"; it bounds the interval from **above** (sweep at least that often) | Reworded to "longest safe sweep interval"; Phase 4 wording to match |
| S5 | §1 item 2 said to fix the browser tier "right after restoring the scheduler", but §7 schedules it at Phase 2.2, after the Jev benchmark | §1 now points at Phase 2.2 |
| S6 | §0.4 O2's table row ran straight into a `---` with no blank line | Blank line added |

**Story assignment** (the owner's question: can Jev assign articles to the last 1–2 days'
stories, and can creating a new story avoid an LLM?) is analysed in the new **§6.9**, with a
benchmark step (Phase 1.6), a shadow run (Phase 2.4), a gate (§8) and a backlog item (F6).
Short answer: story *creation* already needs no LLM call; the ~400 stories active in a 48 h
window are too many for one `Choice`, so Jev should judge only the prefilter's top-k with a
`new_event` option, behind the existing deterministic vetoes.
---

### 0.7 Seventh pass — verification of §6.9 (story assignment)

Every load-bearing number in §6.9 was re-derived from the repo, and all of them hold. §0.6's
S1–S6 were checked in place and are correct. Five residual defects found, fixed in §6.9 and
Phase 1.4.

**§6.9's evidence, reproduced.**

| §6.9 claim | Independent check |
| --- | --- |
| `MAX_CANDIDATES = 6`, `MIN_CANDIDATE_SCORE = 3` | ✓ `analyze_articles.py:220–221`, including the "date proximity alone (max 2) never surfaces a candidate" comment |
| `MAX_EVENT_GAP_HOURS = 48` | ✓ `home_event_dedupe.py:30` |
| 1,253 stories; **1,166 (93%) singletons**; 87 with ≥2 members | ✓ **exact** — `member_count` distribution `{1:1166, 2:62, 3:17, 4:3, 5:3, 6:1, 7:1}` |
| Active by `last_published`: 24 h **394**, 48 h **398**, 72 h **520** | 24 h ✓ **394**, 48 h ✓ **398** exact; 72 h re-derives as **500** (fixed — see T4) |
| Merge queue: 96 items, 85 accepted, 11 pending, **0 rejected** | ✓ **exact**, including the zero that motivates §6.9.5 |
| `auto_merge_host` docstring records 67% strong cross-outlet candidates | ✓ verbatim in the docstring |
| `candidate_stories`, `auto_merge_host`, `same_event_evidence`, `make_story_id`, `recompute_story`, `save_attempt` exist | ✓ all six |
| §0.6 S1–S6 | ✓ all six in place; no dangling "Phase −1" in prose, §1 item 2 points at Phase 2.2, O2's row has its blank line |

**T1 — the ≤48 h window would change the deterministic rule, not just Jev's shortlist.** The
prefilter has **no window today** — it iterates every story in `index.json` and treats date as
a *score* (`analyze_articles.py:806`: `first <= pub <= last` → 2, else within **7 days** → 1).
A `last_published ≤ 48 h` filter inside `candidate_stories()` tightens that band from 7 days
to 2 and drops candidates `auto_merge_host` can still merge — starting the Jev experiment from
a recall regression in the path Jev has not replaced, when §6.9.1 names recall as the defect.
§6.9.2 now requires the window to bound **the Jev shortlist only** (a parameter, default
unchanged), with a test that the candidate set is identical with Jev off, and notes the honest
side benefit (the scan drops from ~1,253 stories to ~400) so that if it is adopted for the
deterministic path it is adopted *measured*. The same applies to widening `MAX_CANDIDATES`
past 6.

**T2 — §6.9.2 leaned on `LIMITS` as a Jev limit, contradicting §0.1 R9.** R9 established that
the 300-option cap is *this repo's chat-proxy* cap and that TypeSafe's real ceiling is
unverified. The bullet now says so explicitly and rests on the arithmetic that actually
decides it (12–20k tokens, ~$0.0005–0.0009/article, near the 32k context), so a reader does
not conclude Jev is incapable of more than 300 options.

**T3 — the join is serial, so the batch is the number to budget.** §6.9.1 item 5 correctly
puts the decision inside the single-threaded `save_attempt()`, but §6.9.2 budgeted only the
per-call latency. Inside a 100-article batch the join adds ~30–50 s of serialization that
cannot overlap the parallel GLM work. §6.9.2 now states it, names the escape hatch (prefilter
in the worker pool, option list + decision in the save step), and **Phase 1.4 measures the
serial loop** rather than only the concurrent call.

**T4 — the 72 h count re-derives as 500, not 520.** 24 h and 48 h match exactly, and the plan
already flags that day as catch-up mode; the number is corrected and the caveat retained.

**T5 — `make_story_id(date, title, url)` is `make_story_id(published, title_bg, url)`.**
Corrected in §6.9.4, which is a precise source map.


### 0.8 Eighth pass — verification of §0.7

§0.7's evidence table reproduces, and **T2** (the 300-option cap is self-imposed, §0.1 R9)
and **T5** (`make_story_id(published, title_bg, url)`) are correct. Three rows do not hold as
written, and one reference was stale:

| # | §0.7 said | Verified | Evidence |
| --- | --- | --- | --- |
| U1 | **T1**: a ≤48 h window in `candidate_stories()` "removes candidates the existing `auto_merge_host` can still merge", a recall regression | **Inverted when anchored correctly.** `auto_merge_host` decides with `same_event_evidence`, which vetoes any pair **>48 h** apart and any story with no `last_published`. A 48 h window anchored on the article's own `published` therefore removes only candidates the rule already cannot merge — and can *raise* its recall, since `MAX_CANDIDATES = 6` is a top-k cut that stale high-scoring stories can crowd. The real hazard is a different one: anchoring the window on the run's wall clock, which drops valid candidates for backlog articles. §6.9.2 rewritten on that basis; the test now asserts no veto-passing candidate is removed | `analyze_articles.py:804–807`; `home_event_dedupe.py:85–97` (`MAX_EVENT_GAP_HOURS = 48`, `None` on a missing instant) |
| U2 | **T3**: the serial join adds "~30–50 s of pure serialization" per 100-article batch that "the batch cannot overlap away" | **Wrong.** `analyze_local.py` submits every item to the worker pool up front and saves in completion order on the main thread *while the workers keep running*. The join costs wall-clock only if the save loop falls behind the completion rate (~1 answer per 18.7 s measured, vs ~2–3 joins/s capacity) — so the expected cost is one join at the tail. §6.9.2 and Phase 1.4 corrected; the serial measurement is kept, to confirm the capacity | `analyze_local.py` main loop, lines ~795–817 |
| U3 | **T4**: the 72 h count is 500, not 520 | **Both are right — the count is anchor-dependent.** From the newest story's `last_published` (14:46:32Z): 520; from the run's `generated_at` (15:28:56Z): 500. 20 stories fall in that 42-minute band on the 2026-08-30 catch-up day; 24 h and 48 h are identical either way. §6.9.2, §9 and §10 now give 500–520 with the anchor | recount over `index.json` |
| U4 | §6.9.5 said "Phase 1 step 1.7 builds the missing negatives" | That is the report step; the labelled-pair step is **1.6** | §7 Phase 1 |
