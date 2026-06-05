# AI chat (ai.electionsbg.com) — implementation plan

A standalone, in-browser chat that answers questions about Bulgarian elections,
grounded in the site's own pre-processed JSON. Free to run (no backend, no
per-query cost): a small open model runs in the visitor's browser; all numbers
come from deterministic TypeScript, never from the model.

Status: **M3 wired — WebLLM model provider lives alongside the rules provider.**
The chat answers BG/EN questions across 6 domains via the deterministic provider
(router → tools → template narrator) by default; a `WebLLMProvider` can be
selected from the header to let an in-browser model drive tool selection +
narration behind the same `LLMProvider` interface. Verified end to end in a real
browser: Qwen2.5-1.5B loaded over WebGPU (~1.1 GB), picked a tool via
grammar-constrained JSON, ran it, and narrated from facts only (no hallucinated
numbers). Caveat: small generic models route Bulgarian poorly (Qwen-1.5B
mis-routed a simple party-votes query) — confirming BgGPT (Bulgarian-native) is
the right default; it + EuroLLM are wired as drop-in options pending the **M0**
MLC compile (shown disabled, "requires MLC build"). The heuristic router remains
the default and the always-on fallback (every model step degrades to it on
failure). See "Milestones".

M3 layers: `ai/orchestrator/toolSchema.ts` (JSON-schema for the 49-tool enum +
validate/coerce model output → Route, falling back to the heuristic router on any
invalid output), `ai/orchestrator/prompts.ts` (tool catalogue + few-shot +
narration prompt), `ai/llm/models.ts` (model registry), `ai/llm/webllm.ts`
(`WebLLMProvider`, WebGPU-gated, lazy-imported so the 6 MB runtime only loads
when a model is picked — the main bundle stays ~242 KB gzip). Plumbing unit-test:
`npx tsx ai/orchestrator/toolSchema.harness.ts`.

Tools (49) grouped by `domain`:
- **elections** (15): nationalResults, partyResult, machineVoteShare, turnout,
  compareElections, machineVoteSeries, turnoutSeries, partyTimeline, pollAccuracy
  (now with grade + threshold-call rate), agencyProfile, latestPolls,
  regionBreakdown, electionAnomalies, regionHistory, voteTransitions
- **local** (6): localCouncilVoteShare, localMayorsWon, localMunicipality,
  localMayorRace, localCouncil, chmiEvents
- **fiscal** (9): budgetOverview, budgetByFunction (COFOG), procurementTotals,
  fundsOverview, govDebt, noiFunds, budgetExecution (KFP monthly), ministryBudget,
  investmentProjects (Приложение III)
- **people** (5): governments, mpAssetsTop, mpConnectionsTop, officialsAssetsTop,
  financingOverview
- **indicators** (8): macroIndicator (40 indicators, broadly aliased),
  macroOverview, macroByCategory, subnationalIndicator, regionIndicator,
  transparencyScore, localTaxes, landUse
- **place** / "my area" (6): governanceProfile (composite place-ladder dashboard,
  now incl. GRAO population + air quality + council activity), census,
  procurementBySettlement, airQuality, graoPopulation, councilResolutions

Place-keying gotcha handled: the council ingest keys some oblast centres with a
different obshtina code than `municipalities.json` (Русе = RSE01 vs RSE27) —
`councilResolutions` falls back to matching the council entry's `meta.name`.

Shared infra: `ai/tools/place.ts` resolves free-text BG/EN place names →
obshtina/oblast/ekatte (handles Sofia synthetic `SOF`/`SOF00`, Plovdiv city vs
province, ambiguous names). `ai/tools/localDataset.ts` = local-cycle registry +
fetchers.

Verified: node harness + place harness ALL PASS (every tool runs against real
data + router maps ~40 BG/EN questions across all 5 domains), typecheck + repo
eslint clean, `build:ai` OK, browser conversation renders charts/tables/scalars
in both languages (e.g. "кмет на Пловдив" → mayor card, "инфлация" → line chart,
"данъците в Пловдив" → tax table vs national avg, "безработицата в Сливен" →
per-município series). Run locally with `npm run dev:ai` (5180);
`npm run ai:harness` + `npx tsx ai/tools/place.harness.ts`.

Phase C shipped: `governanceProfile`, `census`, `procurementBySettlement`.
Still on the roadmap: MP/official profiles, roll-call metrics, EU-funds-by-place.
Router note: at 28 tools the heuristic router is past its comfortable limit
(topic × place × entity) — the Explorer covers the long tail, and this is the
main motivation to land the M3 grammar-constrained LLM router next.

---

## Locked decisions

| Decision | Choice |
| --- | --- |
| Repo structure | Second Vite entry in this repo (`ai/` + `vite.config.ai.ts` → `dist-ai`), importing `@/theme`, `@/i18n`, `@/components/ui/*` directly. No workspace refactor. |
| Inference | In-browser only (WebLLM + WebGPU). BgGPT-2.6B default, EuroLLM-1.7B switch, both MLC-compiled and hosted free on HuggingFace. WebGPU feature-detected; no-WebGPU → graceful unsupported state. |
| Question → data | Grammar-constrained tool-calling (XGrammar JSON). Model emits `{tool, args}`; deterministic tools compute; model narrates. |

## Core thesis — the two-brain split

A 1.7–2.6B model that runs free in a browser cannot do arithmetic and will
hallucinate vote totals. So it never touches numbers:

- **Brain 1 — deterministic compute (`ai/tools/`).** Computes every figure from
  the JSON. Always exact. Pure TypeScript, unit-testable without a browser.
- **Brain 2 — the LLM.** Two jobs only: (a) parse the question into a structured
  tool call, (b) narrate the tool's result. Never computes, never invents a
  number. Every answer footers its data provenance.

---

## Data foundation (what exists today)

- **Hosted on a GCS bucket** (`VITE_DATA_BASE_URL=https://storage.googleapis.com/data-electionsbg-com`).
  The AI app bundles no data — it fetches the same JSON the main app does, via
  the same origin seam (`ai/tools/dataClient.ts`, mirroring `src/data/dataUrl.ts`).
- **`src/data/json/elections.json`** (84 KB, bundled): `ElectionInfo[]`, newest
  first, all 13 parliamentary elections. Each entry:
  - `name` — `"YYYY_MM_DD"` (the election id / date).
  - `results.protocol` — `totalActualVoters`, `numRegisteredVoters`,
    `numValidMachineVotes`, `numValidVotes` (= paper valid votes), `numMachineBallots`,
    `numPaperBallotsFound`, …
  - `results.votes[]` — per party: `partyNum`, `nickName`, `commonName[]`,
    `totalVotes`, `machineVotes`, `paperVotes`, `suemgVotes`.
  - `hasSuemg`, `hasRecount`, `hasPreferences`, `hasFinancials`.
  - **Latest election = index `[0]` = `2026_04_19`.**
- **Derived metrics computable from the bundled file with zero fetches:**
  - turnout % = `totalActualVoters / numRegisteredVoters`
  - machine share % = `numValidMachineVotes / (numValidMachineVotes + numValidVotes)`
    (verified: 2026 → 47.61%, matches `national_summary.paperMachine.machinePct`)
  - per-party national votes and computed % (sum of `votes[].totalVotes`)
- **Per-election fetches** (from the bucket, on demand):
  - `/{election}/national_summary.json` — `parties[]` with `pct`, `seats`,
    `passedThreshold`, `color`; `turnout`; `paperMachine`; `anomalies`; `topCities`…
  - `/{election}/region_votes.json` — per-oblast, per-party machine/paper/suemg.
- **Cross-election lineage:** `/canonical_parties.json` — `parties[]` with `id`,
  `displayName`, `displayNameEn`, `color`, `history[]` of `{election, partyNum,
  nickName, name}`. Threads party identity across renames/merges (ГЕРБ's partyNum
  changes each cycle; БСП → БСП-ОЛ).

---

## Architecture

```
ai.electionsbg.com (static, all in-browser)
  Reused shell: ThemeContext + i18n + components/ui (gear menu: theme/lang) + chart.tsx/table.tsx

  Chat UI ── Orchestrator ──┬─ LLM runtime (WebLLM: BgGPT / EuroLLM, WebGPU, XGrammar)
   election picker (=latest) ├─ Tools layer (Brain 1): elections.json + bucket fetches
   model switch              └─ Renderer: Envelope → chart/table (reuses @/components/ui)

  Model weights: free on HuggingFace · Data: existing GCS bucket · Hosting: Firebase free tier
```

### Orchestration loop (in-browser)

```
question
 → classify: quantitative (tool) | explanatory (RAG) | chit-chat
 → tool:        LLM emits {tool,args} under JSON grammar
                · default args.election = latest
                · cross-election tools take n / explicit list
              → run tool (Brain 1) → Envelope
              → LLM narrates Envelope.facts (numbers injected, never generated)
              → render text + viz
 → explanatory: RAG over a static embeddings index (articles, llms-full.txt, glossary) → narrate w/ citations
```

### The result envelope (`ai/tools/types.ts`)

Every tool returns a normalized `Envelope`: `kind` (`scalar|table|series`),
`title`, optional `columns/rows` (table), `series` + `categories` (chart),
`viz` (`line|bar|pie|none`), `facts` (flat numbers the LLM narrates), and
`provenance` (source files). The renderer maps `kind`/`viz` onto the existing
`@/components/ui/chart` (Recharts wrapper, theme colors `chart-1..5`) and
`@/components/ui/table`.

---

## Module layout

```
ai/
  index.html · main.tsx · App.tsx          # M2 shell (theme/i18n reuse)
  app/Explorer.tsx                         # M1 dropdown harness (run a tool, render result)
  render/AnswerView.tsx                    # Envelope → chart/table/scalar
  tools/
    types.ts        # Envelope, ToolDef, ToolContext
    dataset.ts      # bundled elections.json access (latest, lastN, chrono)
    dataClient.ts   # per-election/bucket fetch (pluggable fetcher: browser vs node)
    format.ts       # bilingual number/date formatting
    matchParty.ts   # fuzzy party resolution (nickName/name/commonName)
    series.ts       # turnoutSeries, machineVoteSeries, metricSeries
    national.ts     # nationalResults, partyResult
    parties.ts      # partyTimeline (canonical lineage)
    registry.ts     # tool name → {schema, run, defaultViz, examples}
    harness.ts      # node (tsx) correctness harness
  (M3) llm/, orchestrator/                  # WebLLM provider + grammar + loop
vite.config.ai.ts · ai/tsconfig.json
```

---

## Tools (Brain 1) — initial set

| Tool | Source | Net? | Answers |
| --- | --- | --- | --- |
| `nationalResults(election=latest)` | national_summary | 1 | party votes/%/seats, threshold |
| `partyResult(party, election=latest)` | national_summary / elections.json | 0–1 | one party's result |
| `turnout(election)` / `turnoutSeries(n)` | elections.json | 0 | turnout + cross-election trend |
| `machineVoteShare(election)` / `machineVoteSeries(n)` | elections.json | 0 | machine % (the showcase) |
| `partyTimeline(party)` | canonical_parties + elections.json | 1 | one party across all elections |
| `compareElections(a, b, metric)` | elections.json | 0 | side-by-side |
| `regionBreakdown(election, metric)` | region_votes | 1 | per-oblast table/bar |

Cross-election series tools need **no fetches** (bundled `elections.json`).

---

## Testing

Run `npm run ai:test:all` (or individually):
- `ai/tools/harness.ts` — every tool against real data, with golden assertions
- `ai/tools/place.harness.ts` — the place resolver
- `ai/orchestrator/toolSchema.harness.ts` — the model tool-call parse/validate
- `ai/tests/regression.ts` (`npm run ai:test`) — **53 prompt → expected-response
  cases across all 49 tools**: asserts the router picks the right tool *and* the
  tool returns the expected envelope (golden values for stable election/census
  data, structural checks for volatile assets/polls). A data refresh or routing
  change that breaks an expectation fails loudly — update the golden value or fix
  the routing. Add a case per new tool.

## Deployment (Firebase multi-site) — M2 ✅ wired

The config is in place: `firebase.json` `hosting` is now an **array of two
targets** (`main` → `dist`, `ai` → `dist-ai`), each with its own rewrite/headers/
predeploy; `.firebaserc` maps the targets per project (`elections-bg` → main+ai,
`electionsbg-staging` → main only). Scripts: `build:ai`, `deploy:ai`,
`deploy:ai:fast`. The existing `deploy`/`staging` scripts are now `--only
hosting:main`, so they're unchanged in effect. `wasm` is served `immutable`.

The AI build is **slimmed**: `vite.config.ai.ts` keeps `publicDir` for dev but a
`prune-dist-ai` plugin trims `dist-ai` after build to the app + the few static
assets the chat references — **24 files / ~7 MB** (no parliament/articles/sitemap
copy), well under the file ceiling.

**Setup:** `ai.electionsbg.com` is a **separate Firebase project** `electionsbg-ai`
(its own `electionsbg-ai.web.app`). `.firebaserc` adds an `ai` project alias and an
`ai` hosting target mapped to it; `deploy:ai` = `firebase deploy --only hosting:ai
-P ai`.

**Operator go-live steps:**
1. `npm run deploy:ai` (predeploy runs `build:ai`; deploys `dist-ai` → the
   `electionsbg-ai` project).
2. In that project's Hosting → **Add custom domain** `ai.electionsbg.com`, add the
   DNS records Firebase shows (the console already lists it as "Needs setup").
3. Verify `https://ai.electionsbg.com` loads; pick a model on a WebGPU browser.

---

## Milestones

| # | Deliverable | Proves |
| --- | --- | --- |
| **M0** | Compile BgGPT-2.6B + EuroLLM-1.7B to MLC, host on HF, load in a throwaway WebLLM page; verify BG output + WebGPU + grammar-constrained JSON | model path works in-browser |
| **M1** ✅ | Deterministic tools library (8 tools) + dropdown harness rendering charts/tables; node correctness harness | numbers 100% correct; charts reuse site components |
| **M2** ◑ | Standalone Vite app: reused theme + bilingual chat UI, election-context picker (=latest), provider pill, Chat/Tools toggle. **Built & browser-verified.** Remaining: Firebase multi-site wiring + deploy to ai.electionsbg.com | look + bilingual shell (deploy pending) |
| **M2.5** ✅ | Orchestrator (heuristic router + template narrator) behind `LLMProvider`; `HeuristicProvider` answers today with no model | demoable end-to-end at $0 |
| **M3** | WebLLM wired as a second `LLMProvider`; grammar-constrained tool selection + narration; model switcher (BgGPT/EuroLLM) | end-to-end NL → answer via on-device model |
| **M4** | Static embeddings index for explanatory questions + citations | "what is X" questions |
| **M5** (optional) | LoRA on synthetic (question→tool-call) pairs from elections.json (free Colab); recompile to MLC | small-model routing reliability |

## Risks

- **WebGPU absent** → feature-detect; offer EuroLLM-lite; graceful unsupported state.
- **First-load weights (1.5–2 GB)** → one-time, cached in IndexedDB; show progress.
- **BgGPT→MLC compile** → de-risked by M0 before app is built around it.
- **Small-model routing reliability** → grammar-constrained decoding; deterministic
  fallback router; fine-tune (M5) if needed.
- **Hallucinated numbers** → structurally impossible: model narrates `facts` only;
  every answer shows provenance.
