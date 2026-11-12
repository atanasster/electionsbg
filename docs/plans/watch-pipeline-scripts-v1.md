# Watch → ingest → publish as plain runnable scripts (v1)

Status: PLAN, nothing built. Written 2026-11-12.

Goal: the daily chain — watch, decide what to ingest, ingest, verify, commit, publish —
runs as `pnpm run pipeline:*` commands with no LLM in the loop. Every run leaves a
report an LLM (or a person) can read cold and use to fix the script that failed.

## 1. What exists today (measured)

| Layer | Today | Driven by |
| ----- | ----- | --------- |
| Watch | `pnpm run watch` → `scripts/watch/index.ts`, ~128 source modules, state in `state/watch/<id>.json`, markdown report in `data-reports/` | script |
| Decide | compare `state/watch/<id>.lastChanged` with `state/ingest/<marker>.lastSuccessfulIngest` through a 133-row table | LLM reading `.claude/skills/process-watch-report/SKILL.md` (582 KB) |
| Ingest | 37 `update-*` runbooks, 16.6k lines of prose | LLM, one `Skill` call per handler |
| Post-steps | alerts, data map, home generators, `db:check-generated`, `db:check-cloud` | LLM typing wrapped commands |
| Commit + manifest | `git commit -- <paths>`, `scripts/upload_manifest.ts write` | LLM |
| Publish | `bucket:sync:paths` + ordered `db:load:*:cloud` from `state/upload/pending.json` | LLM reading `upload-watch-changes/SKILL.md` |

Numbers from `state/perf/*.jsonl` (2026-08-30 → 2026-11-12):

- Ingest trace: 7,220 steps over 65 sessions. 6,933 are already wrapped shell commands.
  The other 287 are "the agent ran a skill" rows, timed by hand with no exit code.
  Those 287 rows are the migration.
- Publish trace: 2,488 steps over 67 sessions, 2,480 already wrapped commands. The
  publish half is a script in all but name.
- Median ingest session 164 min, median publish 64 min.
- Not-ok rates per handler: `update-polls` 9/24, `update-budget` 6/14,
  `update-procurement` 5/37, `update-culture` 3/11, `update-rollcall` 3/24. The
  `db:refresh` → `test:data` tail failed on five recent runs.
- Latest session (2026-11-12) died at its first step: parliament.bg timed out because
  the egress was Bulgarian. Nothing checks egress before starting.

Mapping table shape (133 rows): 105 route to a skill, 13 to a direct command, 5 to an
auto-check (`check_policy_anchors.ts --stamp`), 10 are manual with no handler.

Scriptability of the handlers, from reading every runbook:

| Class | Meaning | Handlers |
| ----- | ------- | -------- |
| FULL | pure command chain today | administration, air-quality, energy, grao, local-taxes, municipal-contacts, open-calls, prices, regional, schools, persons (re-derivation), tr-daily-refresh, culture (films, ДКИ), defense (NATO), social (poverty), the 13 direct-command rows, the 5 policy-anchor checks |
| MOSTLY | chain + small glue (branch on source, derive an argument, turn an eyeballed band into an assert) | parliament-scrape, agri, council-minutes, financing, funds, indicators, kzk-appeals, macro (Eurostat/BNB/WGI arms), noi, nzok (6 of 7 sources), officials, presidential (known cycle), procurement, rollcall, judiciary (declarations) |
| PARTIAL | a real human or LLM judgment step remains | budget (yearly URL/constant curation, WAF downloads), connections (FLAG triage), polls (review/accept), enrich-open-calls, landuse (URL discovery), transparency-lisi, local-elections (coalition overrides), defense (exports, readiness), culture (commissions, НФК grants), judiciary (ВСС tables), nzok (НРД tariffs), persons (sanctions/ДС/regulators), social (ASP, ГИТ drift), macro (CPI, Eurobarometer, Eurobond), the 10 manual sources |

What makes the current system fragile, in order of cost:

1. The routing table, the step order, the cloud loader sets and the failure rules live
   in prose. Three tests (`source_map_coverage`, `cloud_loader_coverage`,
   `skill_wiring`) parse that prose with regexes to keep it honest.
2. Success is judged by reading stdout. Summaries and counts are quoted by hand.
3. Scoping arguments (cycle slug, município list, which law, which year) are read out
   of the watcher's free-text describe-line.
4. No runbook registers its own publish needs; the orchestrator re-derives them.
5. Verification is mostly eyeballed `node -e` prints with numeric bands stated in prose.
6. Environment preconditions (egress, Docker PG, Cloud SQL proxy, external drive,
   headed browser) are discovered by failing.

## 2. Target design

```
pnpm run pipeline:doctor      # preflight only
pnpm run pipeline:watch       # today's watcher + JSON report
pnpm run pipeline:plan        # read-only: what would run and why
pnpm run pipeline:ingest      # plan → run → post-steps → verify → commit → manifest → report
pnpm run pipeline:publish     # consume the manifest → bucket + Cloud SQL → verify → report
pnpm run pipeline:nightly     # doctor → watch → ingest → publish (if the gate passes)
pnpm run pipeline:report      # re-render / print the last run's report
```

All under `scripts/pipeline/`. Existing code is reused, not rewritten: the watcher,
`scripts/perf/perf_log.ts`, `scripts/lib/ingest-state.ts`,
`scripts/lib/upload-manifest.ts`, `scripts/lib/data-changes.ts`,
`scripts/bucket_sync_paths.ts`, `scripts/db/refresh_coverage.ts`.

### 2.1 The registry — one typed source of truth

`scripts/pipeline/registry/` replaces the SKILL.md tables. The interface is
`registry/types.ts`; the entries are grouped by family in `registry/handlers/*.ts`.
Shape, in brief:

- `Handler` — `id` (also the default marker), `marker?`, `skill?` (the runbook that
  still documents it), `runner: "script" | "skill" | "operator"`, `sources: string[]`,
  `needs?`, `after?`, `steps`, `operator?`, `agent?`, `publish?`, `changelog`,
  `stamp?: "runner" | "self"`, `followUps?`, `outputs?` (the commit pathspec), `notes?`.
- `Step` — `id` (the perf label), `run` (always `pnpm run …` / `pnpm exec …`),
  `on?` (sources that enable it — per-arm queuing), `args?(ctx)` (scope from watcher
  `meta`; returning null skips the step as "no scope"), `phase`, `timeoutMin?`,
  `okExit?`, `kind?: "command" | "chain"`, `needs?`.
- `publish` — `paths?` (bucket), `cloud?` (commands, optionally `on`-scoped),
  `commitAfter?`, `dirsMatching?` (per-cycle folders resolved by mtime). Cloud
  commands carry NO order of their own: one global `CLOUD_ORDER`
  (`registry/cloud_order.ts`) sorts the merged manifest, so two handlers in one run
  cannot break a "B reads what A wrote" rule between them.
- A self-stamping handler may stamp before its last step; the runner snapshots the
  marker first and restores it if a later step fails.
- `gates` (§2.4) and `knownFailures` (§2.7) are added in their own steps.

Rules the registry enforces by test (`registry/coverage.test.ts`), replacing the
three prose-parsing gates:

- every `SOURCES` id is routed or listed in `UNROUTED` with a reason;
- every `:cloud` script in `package.json` is reachable from a handler or exempted;
- every `pnpm run X` named exists; every `scripts/…` path exists;
- a marker is shared only between handlers of one skill;
- every `on` names a source its own handler listens to;
- `CLOUD_ORDER` satisfies the ordering pairs CLAUDE.md states;
- every `publish.paths` entry passes `isExcluded` from `bucket_sync_paths.ts`.

### 2.2 Planner

Pure function `plan(watchState, ingestState, registry, env) → Plan`. Same rule as
today: queue when the marker is missing or `lastChanged > lastSuccessfulIngest`.
Adds what the prose version cannot express reliably:

- per-arm queuing (`nzok_drug_quarterly` runs one flag, not the whole skill);
- dedupe, fan-out, and `after` ordering by topological sort;
- each entry carries its reason: source id, both timestamps, the watcher detail line;
- an entry whose `needs` are unmet is planned as `blocked` with the unmet need named;
- an entry with an outstanding operator step is planned as `needs-operator`;
- bootstrap policy is a flag (`--bootstrap=run|seed|ask`), default `ask` interactive,
  `seed` never taken unattended.

`pipeline:plan` prints this and writes `plan.json`. It never mutates anything.

### 2.3 Step executor

One function runs every command in both runners.

- spawns the command, tees stdout and stderr to `logs/pipeline/<session>/<seq>-<step>.log`
  with a timestamp prefix per line and a header (command, cwd, env overrides, git sha);
- appends the row to the existing `state/perf/*.jsonl` via `perf_log.ts` — the trace
  format and history stay continuous;
- enforces a timeout; kills the process group; records `timeout` distinctly from `error`;
- pins the environment per step: local steps always get the local `DATABASE_URL`,
  cloud steps the cloud one, so a leaked export cannot cause `28P01`;
- reads an optional structured result (2.4);
- on non-zero exit runs the classifier (2.7) and writes a failure packet (2.8).

No retries by default. A step may declare `retry: { classes: ["upstream-down"], max: 1 }`.

### 2.4 Structured results and gates

Two additions turn "read the output and decide" into data.

**Result file.** The executor sets `PIPELINE_RESULT_FILE`. A script may write JSON there:

```json
{ "summary": "3 new sessions, 412 items", "counts": {"sessions": 3, "items": 412},
  "changed": true, "warnings": ["2 MPs unmatched"], "skipped": [{"what": "…", "why": "…"}] }
```

A helper `scripts/pipeline/lib/result.ts` (`reportResult({...})`) makes this one line
per script. Scripts that do not write it still work; their summary falls back to
`git diff --stat` over the handler's declared outputs. Adoption is incremental and is
what Tier 3 mostly consists of.

**Gates.** Every eyeballed band in a runbook becomes a declared assertion run after the
handler's steps:

```ts
gates: [
  jsonGate("data/grao/index.json", (j) => between(j.settlements.length, 5000, 5300)),
  jsonGate("data/local_taxes/index.json", (j) => Object.keys(j.scoresByObshtina).length === 265),
  noShrink("data/financing/index.json", (j) => j.years.length),       // vs HEAD
  outputLacks(/⚠ .* SKIPPED/),                                        // culture
  outputLacks(/GATE [AE] DISARMED/),                                  // kzk
  vitest("scripts/db/tests/open_calls.data.test.ts"),
]
```

A failed gate is a failed handler: no stamp, publish held. The gate's expected and
observed values go in the report verbatim.

### 2.5 Post-steps

The cross-cutting steps become a small second registry with explicit triggers:

| Post-step | Trigger | Order constraint |
| --------- | ------- | ---------------- |
| person chain (`db:resolve:persons` + repair chain) | any people-source handler ran | before graph, persons-browse |
| `db:gen-hub-stats` | procurement, kzk, ngo-funding | after their loaders |
| `db:gen-sector-stats` | agency budget edits, procurement | — |
| roads / water / transport hub stats | procurement, funds | after transport map loaders |
| `run_policy_baseline.ts` | customs, nap, eurostat_policy, December КФП | after `run_consumption_coicop.ts` |
| `prices:payloads` | fuel/energy/eurostat moved without `kzp_prices` | — |
| `gen_textbook_market.ts` | procurement | — |
| `myarea:alerts` (+ `:cloud`) | always | — |
| `data:map` | always | — |
| home generators → `home:health` | always | hub-stats → flyover → price-events → feed |
| `db:check-generated`, `db:check-cloud` | always | last; findings, not failures |

Each handler's `followUps` names the ones it triggers; the runner dedupes and orders.

### 2.6 Human and LLM steps — explicit, never guessed

A script cannot read a PDF and key 27 scores. The plan does not pretend otherwise:

- An `OperatorStep` declares what must be done and a **done-check** the script can
  evaluate: a file exists in a drop dir, a code constant covers the year the watcher
  reports, an inbox is empty.
- Unmet → the handler's automated arm still runs if the registry says it is
  independent; the item lands in `state/pipeline/needs-operator.json` with the
  instruction, URL, drop path and age in days. It stays there across runs until the
  done-check passes. The report lists it under **Needs operator**.
- LLM-assisted steps (`polls:review` subagent readings, `enrich-open-calls`
  extraction, Gemini OCR) are a distinct step kind, `agent`, off by default in
  `pipeline:nightly`. They are listed under **Needs agent** with the exact command and
  the skill doc to follow. Their outputs already pass deterministic gates
  (`polls:accept` evidence lock, `enrich_gate.ts`), which stay.

This preserves the current unattended contract: human-judgment steps are skipped and
reported, a `partial` handler is stamped only if its registry entry says the
automated part is complete on its own.

### 2.7 Failure classification

`scripts/pipeline/classify.ts` maps (exit code, signal, log tail, step metadata) to a
class. Global patterns first, then the handler's `knownFailures`.

| Class | Typical evidence | Retry | Holds publish |
| ----- | ---------------- | ----- | ------------- |
| `egress` | connect timeout to a host whose `needs` differ from detected egress | no | yes |
| `upstream-down` | 5xx, ECONNRESET, DNS | once | yes |
| `waf-blocked` | 245-byte "Request Rejected", CF challenge HTML | no | yes |
| `upstream-shape` | canary mismatch, `Unrecognised…LabelError`, header not found | no | yes |
| `gate-failed` | declared gate | no | yes |
| `shrink-refused` | "refusing to shrink/prune" | no | yes |
| `missing-input` | skip-and-warn text, absent drop file | no | no (→ needs operator) |
| `db-local-down` | ECONNREFUSED :5433 | no | yes |
| `db-auth` | `28P01` | no | yes |
| `proxy-down` | "Connection terminated unexpectedly", :5434 closed | once after restart check | yes |
| `lock-timeout` | `55P03` | once | yes |
| `disk` | `53100`, ENOSPC, `/dev/shm` resize | no | yes |
| `test-flaky` | red `*.data.test.ts` that passes solo | re-run red files solo once | no if green solo |
| `timeout` | executor kill | no | yes |
| `code-bug` | TypeError/ReferenceError with a frame in `scripts/` | no | yes |
| `unknown` | anything else | no | yes |

`knownFailures` is where the troubleshooting tables in the runbooks go: each entry is
`{ pattern, class, advice, never? }`. `never` carries the rules a fixer must not break
("never lower `minimumYears`", "never relax the enrich gate", "re-seed a canary only on
a confirmed upstream change").

### 2.8 Reports — built for an LLM to fix from

Per session, two tiers:

- `state/pipeline/runs/<session>/` — committed, small: `run.json`, `report.md`,
  `failures/<step>.md`. Keep the last 90 sessions; older ones are pruned by the runner.
- `logs/pipeline/<session>/` — gitignored, full per-step logs.

`run.json` (schema versioned, validated by test):

```json
{
  "schema": 1, "session": "…", "kind": "ingest", "startedAt": "…", "endedAt": "…",
  "git": {"shaStart": "…", "shaEnd": "…", "dirtyAtStart": ["…"]},
  "env": {"egress": "BG|non-BG|unknown", "pgLocal": true, "proxy": false, "node": "…"},
  "plan": [{"handler": "…", "arm": "…", "reason": {"source": "…", "lastChanged": "…", "lastIngest": "…"}}],
  "handlers": [{
    "id": "…", "status": "ok|partial|failed|blocked|needs-operator|skipped",
    "stamped": true, "summary": "…", "counts": {},
    "steps": [{"seq": 12, "id": "…", "command": "…", "exitCode": 0, "durationMs": 0,
               "medianMs": 0, "log": "logs/pipeline/…", "class": null}],
    "gates": [{"id": "…", "ok": false, "expected": "…", "observed": "…"}],
    "filesChanged": ["…"]
  }],
  "postSteps": [], "findings": [], "needsOperator": [], "needsAgent": [],
  "publish": {"decision": "go|held", "heldBecause": ["…"], "manifest": {}},
  "verdict": "clean|degraded|failed"
}
```

`report.md` is rendered from `run.json` only, with fixed headings in a fixed order:
Verdict → Failures → Needs operator → Needs agent → What ran → Findings
(`db:check-*`, watcher errors) → Timings vs median → Publish decision → Next commands.

`failures/<step>.md` — the repair packet. One per failed step, self-contained:

1. **What failed**: handler, step id, exact command, exit code, duration, class.
2. **Reproduce**: one copy-paste command, including env pins and `--session`.
3. **Evidence**: the first error line, then the last 80 log lines, with the log path
   and line numbers. Long lines truncated at 400 chars with the cut marked.
4. **Expected vs observed** for a gate failure.
5. **Where the code is**: the script's entry file plus its local imports, from
   `scripts/lib/module_graph.ts`. Tests that cover it.
6. **What changed**: `git log -5 --oneline -- <those files>`; the watcher's `detail`
   and `meta` for the triggering source; last 5 outcomes of this step from the trace.
7. **Known guidance**: matching `knownFailures` advice and every `never` rule.
8. **State left behind**: marker not stamped; files modified and uncommitted; whether
   a partial write happened; how to reset (`git checkout -- <paths>`), stated only
   when the handler declares its outputs.
9. **Done means**: the command that must exit 0 and the gates that must pass.

Hard rules for report content: no prose invented by the runner, every number comes
from a result file, a gate or the trace; nothing from a log is rendered as markdown
structure (same flattening `scripts/watch/report.ts` already does); secrets are
redacted with the existing `redactUrl`.

### 2.9 Preflight (`pipeline:doctor`)

Runs first, also standalone. Each check is a named result in `run.json.env`.

- egress: resolve public IP country once; mark handlers `blocked` whose `needs`
  conflict, instead of letting them time out one by one;
- Docker Postgres reachable on 5433; `/dev/shm` size; free disk in the Docker VM;
- Cloud SQL proxy on 5434 and `.pgpass` readable (publish only);
- `raw_data/prices` symlink target mounted; `pdftotext`, `unzip`, `gsutil` on PATH;
- headed-browser capability (a display is present) for КЗК, CIK, МОН;
- git: on `main`, no rebase in progress, list of dirty paths under the runner's trees;
- single-run lock `state/pipeline/lock` (pid + session), stale-lock detection;
- pending manifest age.

### 2.10 Commit, manifest, publish

- Commit: explicit pathspec only, built from the handlers' declared outputs plus the
  state trees. A path already staged by someone else is excluded and reported, and
  holds the publish — the current rule.
- Manifest: written from the registry (`publish.paths`, `publish.cloud`), merged in
  first-seen order, plus `generatedPathsTouched` as today. No hand-typed `--cloud`.
- Publish gate: mechanical, same conditions as today's "major issue" list.
- `pipeline:publish`: dry-run sync → per-subtree sync with byte counts → cloud loaders
  in manifest order → verify (`db:check-generated`, live hash spot checks) →
  `upload_manifest done` → commit the trace. A failed cloud loader stops the chain and
  leaves the manifest pending; the report names the first command not run.
- Interactive use asks for confirmation before touching production unless `--yes`.

## 3. Watcher hardening

The watcher is already a script; this is about making its output machine-usable and
its failures diagnosable.

1. **JSON report** beside the markdown: `data-reports/<date>.json` with per-source
   status, duration, error class, `meta`. The planner and the run report read this for
   narration instead of parsing markdown.
2. **Structured scope in `meta`**. Every source whose describe-line is currently parsed
   for arguments emits them as data: `meta.scope = { cycles: [...] }`,
   `{ obshtini: [...] }`, `{ year }`, `{ datasets: [...] }`. Affected today:
   `cik_results`, `cik_presidential`, `municipal_naredba`, `capital_programs`,
   `eurostat` (which datasets), `dv_laws` (which law), `egov_budget_execution`
   (December snapshot), `nzok_*`.
3. **Declared egress per source** (`egress: "bg" | "non-bg" | "any"`). A source that
   cannot be probed from the current egress reports `blocked-egress`, not `error`, and
   does not consume its cadence window.
4. **Health ledger** `state/watch/_health.json`: consecutive error count and first
   failure time per source (state files are deliberately not written on error, so this
   is separate). The report flags a source failing for more than N runs.
5. **Per-source timing and error class** in the report; the 300 s timeout stays.
6. **Tests.** 21 of ~128 sources have one. Add a record/replay harness:
   `pnpm run watch --record <id>` saves the raw responses to
   `scripts/watch/sources/__fixtures__/<id>/`; a generic test replays them and asserts
   the fingerprint is stable and `detail`/`meta` have the declared shape. Target: every
   source has a replay fixture; sources with parsing logic also keep a hand-written
   test. `publishes` declared on every source so `cadence.test.ts` covers all.
7. Exit code stays 0 on per-source errors; `--strict` exits 1 for use in the doctor.

## 4. Testing

| Level | What | Where |
| ----- | ---- | ----- |
| Registry coverage | the six rules in 2.1 | `scripts/pipeline/registry/coverage.test.ts` |
| Planner | fixtures of watch + ingest state → expected queue: multi-day gap, fan-out, dedupe, shared and split markers, bootstrap, blocked, needs-operator | `planner.test.ts` |
| Executor | fake commands: exit codes, timeout, env pinning, log tee, result file, perf row written | `executor.test.ts` |
| Classifier | golden log excerpts taken from real failures in the trace (egress, proxy, 28P01, canary, shrink, flaky) → expected class | `classify.test.ts` + `__fixtures__/` |
| Gates | each gate helper against synthetic files; a mutation case per helper proving it can fail | `gates.test.ts` |
| Runner, simulated | `pipeline:ingest --simulate` swaps every command for a stub driven by a scenario file; asserts stamping, publish hold, commit pathspec, manifest contents | `runner.sim.test.ts` |
| Fault injection | scenario: step 3 of handler B fails → B unstamped, A and C stamped, publish held, packet written, exit code 1 | same harness |
| Report | `run.json` schema validation; `report.md` and a failure packet snapshot from a fixed `run.json` | `report.test.ts` |
| Publish | fake `gsutil` / loader binaries on PATH: order preserved, stop on first failure, manifest left pending | `publish.sim.test.ts` |
| Parity (shadow) | for N nightly runs, compare `plan.json` with the handlers the LLM run actually recorded in the perf trace | `scripts/pipeline/shadow_compare.ts`, report-only |
| Watcher | replay fixtures (section 3.6) | `scripts/watch/sources/` |

All of it is hermetic and runs in `pnpm run test:ci`. `--dry-run` on every runner prints
the commands without running them.

Exit codes for the runners: 0 clean, 1 handler or gate failure, 2 runner crash,
3 preflight blocked, 4 publish held with ingest ok.

## 5. Migration tiers

Each tier ships alone and leaves the skill path working. The skills are not deleted
until Tier 6.

**Tier 0 — registry and planner (read-only).**
Build the registry for all 133 rows from the inventories, `pipeline:plan`,
`pipeline:doctor`, the coverage tests. Repoint `source_map_coverage`,
`cloud_loader_coverage`, `skill_wiring` at the registry. Run the planner in shadow next
to the nightly LLM run. Done when shadow agrees on the queue for 7 consecutive runs or
every difference is explained and fixed on one side.

**Tier 1 — publish runner.**
`pipeline:publish` with executor, classifier, report, packets. Lowest risk: 2,480 of
2,488 historic steps are already plain commands. `upload-watch-changes/SKILL.md`
shrinks to "run it, read the report". Done when 5 real publishes go through it.

**Tier 2 — ingest runner, FULL handlers.**
Runner core, post-steps, commit, manifest, publish gate. Handlers not yet migrated are
planned as `delegated`: listed under **Needs agent** with their skill name. The nightly
routine becomes: run `pipeline:nightly`, then the agent handles only the delegated
list. Add `reportResult` and gates to the FULL handlers as they move.

**Tier 3 — MOSTLY handlers**, in order of run frequency and failure rate:
procurement → prices (already FULL, verify) → rollcall → council-minutes → macro →
open-calls → budget's monthly КФП arm → funds → officials → nzok → persons chain →
kzk → the rest. Per handler: branch conditions from structured `meta`, eyeballed
bands to gates, summary to result file, cloud set to `publish.cloud`,
troubleshooting table to `knownFailures`. Specific glue already identified:

- rollcall Step 5c: derive the four pinned counts instead of hand-editing the test;
- `test:data` policy: re-run red files solo once, fail only if still red;
- `ted:ingest` / `adfi:ingest` / `cprs:ingest`: always pass `--apply` / `--refresh`,
  and gate on "rows written > 0 or source unchanged" so a dry-run exit 0 cannot stamp;
- kzk: needs `headed` + `egress:bg`; planned as `blocked` otherwise, never attempted.

**Tier 4 — PARTIAL handlers.**
Split each into automated arm + `OperatorStep` with a done-check. Where a judgment
step is really "find a URL" (landuse, ВСС tables, НФК grants, КФН ZIP), write the
discovery scraper and gate it. Where it is triage (connections FLAG lines, coalition
overrides, alias tables), add an accepted-list file so "no new unreviewed item" is
assertable, and queue new items for the operator. Reading figures out of PDFs stays
human or `agent`.

**Tier 5 — watcher hardening** (section 3). Independent of Tiers 1–4 except 3.2
(structured scope), which Tier 3 needs for the handlers listed there — do those
sources first.

**Tier 6 — retire the prose orchestration.**
Schedule `pipeline:nightly` from launchd or keep the Claude routine as a thin wrapper
(open decision 1). Generate a short handler index from the registry. Reduce each
`update-*` skill to its operator/agent steps and a pointer to the registry entry.
`process-watch-report` becomes "run `pipeline:nightly`; if the verdict is not clean,
open the failure packets and fix".

## 6. Defects found during the analysis (fix as the handlers move)

- Seven watched ids have no row in the canonical table: `bnb_fdi`, `eurobarometer`,
  `ember_generation`, `eurostat_energy_prices`, `cik_results`, `cik_presidential`,
  `egov_municipal_execution`.
- Runbooks name commands that do not exist: `bucket:sync:dry-run` (macro, regional,
  indicators), `pnpm run typecheck` (defense), `bucket:sync data/<dir>/` (defense,
  judiciary, noi), `pnpm run data --connections|--companies` (connections), an
  `update-fuel` skill.
- `update-air-quality` and `update-local-taxes` gate the changelog append on
  `git diff` after the commit, so it is likely always empty.
- `update-local-taxes` and the ЕРИК outputs of `update-financing` state no publish step.
- `isun_clean_delivery` is "operator export" in the orchestrator and `--fetch` in
  CLAUDE.md; `update-noi` says both manual download and `--fetch`.
- `procurement_scope_windows` runs a `:cloud` command inline, against the rule that
  only the publish half touches Cloud SQL.
- `update-administration` and `update-agri` describe a hand-written marker.
- `parliament-scrape` and `update-connections` still reference `public/parliament/`.
- `update-procurement` is routed `ted_bg`, `adfi_inspections`, `aop_experts` but has
  no steps for them; the commands live only in the orchestrator table.

## 7. Risks

- **Lost knowledge.** The runbooks carry hard-won warnings. Mitigation: nothing is
  deleted before its content is in `knownFailures`, a gate, or a remaining doc; Tier 6
  is last.
- **Over-confident automation.** A gate that is too loose stamps a bad ingest.
  Mitigation: every gate helper has a mutation test; publish stays held on any
  `unknown` class; shadow period before each tier takes over.
- **Concurrent committer.** Unchanged from today: explicit pathspec, lock file, staged
  paths excluded and reported.
- **Registry drift from scripts.** Coverage tests fail on a missing script, path,
  source or `:cloud` loader.
- **Long runs.** Median 164 min ingest. The runner must be resumable:
  `pipeline:ingest --resume <session>` skips handlers already stamped in that session.

## 8. Open decisions

1. Scheduler: keep the Claude nightly routine as a wrapper around `pipeline:nightly`
   (it can also act on failure packets), or move to launchd and invoke an agent only on
   a non-clean verdict. Recommendation: keep the wrapper through Tier 4, decide at
   Tier 6.
2. Commit `state/pipeline/runs/` (small, 90-session cap) or keep runs local.
   Recommendation: commit — the perf trace is committed for the same reason.
3. Whether `agent` steps (polls review, enrichment) may run inside the nightly wrapper
   or stay operator-triggered. Recommendation: polls review yes, enrichment promotion
   never.
