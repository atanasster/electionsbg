# AI tools workspace — implementation plan v1

Date: 2026-09-10. Status: implemented locally across tiers 0–5; release verification is recorded in `docs/audits/tools-workspace-2026-09-10/verification.md`. The dated audit below preserves the pre-implementation baseline.

## Outcome

Replace `/tools`' giant dropdown with a searchable library and persistent execution workspace. Start with a small gallery of example questions. Every available chat tool remains reachable; each form represents its real execution contract; results retain the exact tool, arguments and context that produced them. Present SQL-only instruments with explicit availability and a route to the data browser.

Preserve the warm paper palette, serif headings, deterministic execution and existing answer renderer. Use short human titles, readable body contrast, restrained terracotta selection accents and lighter workspace surfaces. Technical identifiers remain searchable and copyable under technical details.

## Audit evidence and boundaries

- [Full 228-tool inventory](ai-tools-workspace-inventory-2026-09-10.md): current parameter declarations, discovery counts, snapshot parity, candidate undeclared reads and all 59 SQL-only instruments.
- [Machine-readable audit](ai-tools-workspace-audit-2026-09-10.json): bilingual descriptions, types, explicit defaults/enums, direct reads and question mappings.
- Sources: `ai/tools/registry.ts`, `ai/tools/types.ts`, imported tool implementations, `ai/app/Explorer.tsx`, question catalogues, discovery metadata and `ai/orchestrator/toolSchema.ts`.
- Runtime-imported the composed registry, including `BUDGET_TOOLS` and `WATER_TOOL`; compared IDs and complete parameter objects against the discovery snapshot. Inspected exported functions typed with `ToolArgs`; the unmatched exports found were orchestration/argument helpers, not additional standalone tool definitions.
- Scanned every registered run function for direct `args.foo` reads. This is a candidate detector, not a semantic proof: helper calls, computed access and destructuring require follow-up. Manually verified the specific missing controls below. Compatibility aliases and internal pins must not automatically become form fields.
- No live tool calls or database corpus checks were performed. This audit establishes catalogue/contract defects; it does not certify that all data sources currently answer, or that every website page/API should become a chat tool. Tier 0 completes those explicit capability decisions.

### Measured coverage

| Surface | Count | Finding |
| --- | ---: | --- |
| Registered executable chat tools | 228 | Unique names; all six domains are in Explorer's domain order |
| Parameter declarations | 230 | 11 types currently used; 8 declarations carry closed values |
| Chat discovery questions | 282 | Reference 227 distinct registered tools; no unknown targets |
| SQL-only questions | 59 | Explicitly unavailable in chat; available in SQL catalogue |
| Chat questions with reviewed SQL adapters | 15 | Dual capability, not 15 additional tools |
| Registry domains | 6 | Fiscal 86; elections 57; indicators 40; people 20; local 15; place 10 |

Explorer already lists all 228 tools; its main omission is discovery/usability, not a missing slice of the registry. The discovery catalogue is incomplete. Do not confuse question count with executable capability count.

### Confirmed findings

| Priority | Finding | Evidence / consequence | Planned repair |
| --- | --- | --- | --- |
| P1 | `latestPresidentialPoll` missing from discovery | In registry, absent from question catalogue, parameter snapshot, source map and topic map. Existing catalogue equality test fails. | Add bilingual discovery entry and provenance/topic metadata; snapshot must include its legitimate empty parameter list. Preserve named-candidate and placeholder exclusions. |
| P1 | Stale parameter snapshots | `municipalityResults` and `regionResults` omit supported `party` and `metric=turnout` inputs in `toolParameters.json` and their discovery forms. Explorer itself reads the live fields. | Generate checked metadata from the executable contract; audit optional as well as required inputs. |
| P1 | Supported public controls absent from registry | `agencyPolls` reads `years` and `n`; `localSubMayors` reads `cycle`; `contractSearch` reads `count` (default 12, max 25). None is declared. | Add reviewed fields, bounds, defaults and descriptions; verify each changes the intended request/result. |
| P1 | Explorer bypasses argument validation | Calls `runTool` directly with string form state; required markers do not prevent execution and closed values are unrestricted text. | Validate/coerce with a shared detailed validator before dispatch, preserving meaningful field errors. |
| P1 | Ambiguity choice cannot complete | Explorer does not provide `AnswerView.onClarify` or mount `ClarifyDialog`. | Wire the existing chooser and rerun the chosen tool with its exact returned arguments. |
| P1 | Late results can attach to a different selection | Selection remains editable while awaiting the old request; its completion sets the current envelope unconditionally. | Capture request identity and input snapshot; ignore superseded completions. |
| P2 | Missing distinctions in parameter semantics | Example: `contractSearch.company` is typed `person`; years/counts have only broad shared bounds; handler defaults and limits often are absent from metadata. | Separate company/person lookup semantics; declare per-field constraints and defaults rather than infer from parameter names. |
| P2 | Discovery topics are incomplete | `toolTopics.json` lacks eight generated budget tools plus `latestPresidentialPoll`. Budget questions already have category paths via starter records. | Adopt one authoritative category mapping or a checked projection; avoid another independent map. |
| P2 | Examples, documentation and execution compete | Passive question chips; full schema table before results; technical identifiers dominate selection. | Valid presets, result-first workspace, sources and technical details in separate tabs. |
| P2 | SQL-only instruments absent from this screen | 59 SQL catalogue entries cannot be run with `runTool`. | Explicit SQL availability filter/section and validated data-browser handoff; no automatic promotion to chat. |

### Internal and compatibility arguments

`candidateResult.partyNum` is an internal clarification pin: a chooser returns it to disambiguate a name. Preserve it through trusted clarification execution without making it a normal required input or allowing a general validator to strip it. Classify aliases such as `companyConnections.eik`, `personProfile.person`, `nzokPrivateHospitals.mode`, and `regionResults.place` separately from missing public controls. The audit inventory contains every direct-read candidate. The generated budget factory's conditional `year` access creates false positives for tools whose specs have no year.

### Verification run

Ran the following eight existing suites with Vitest: questionAdapter, starters, discoverySemantics, shared question catalogue, SQL catalogue, SQL capabilities, presidentialPollsDepth and areaResults.party. Result: **1,175 passed; 1 failed; 8 files**. The sole failure is the catalogue/registry set equality in `src/lib/questions/catalog.test.ts`, missing `latestPresidentialPoll`. These are hermetic contract checks, not production-data validation.

## Product and architecture decisions

1. **One entry per executable tool.** Multiple question presets belong to that tool. Build the chat library from `TOOLS`, enriched by question metadata, so a missing starter cannot hide a registered capability. During development, missing enrichment fails a completeness gate; runtime has a readable description fallback.
2. **Separate discovery from contracts.** Tool metadata owns execution types, requiredness, limits, allowed values and runtime default policies. Editorial metadata owns concise BG/EN titles, examples and category placement. Generate `toolParameters.json` through a deterministic, checked build script or replace it with an import-free generated manifest. The main website must not import the executable registry and its dependency tree merely to render question pickers.
3. **Distinguish presets from defaults.** A question preset can choose a specific entity/year; that does not change the tool's default. Likewise, question-level requiredness may be stricter than the underlying tool. Document these differences instead of mechanically forcing all schemas equal.
4. **Use existing taxonomy.** Reuse `QUESTION_CATEGORIES` and the shared selector's search/category semantics after inspecting their fit. Keep backend domains for execution; do not present six giant groups as the only navigation. Label presidential instruments correctly rather than under a parliamentary-only heading.
5. **Support data-browser instruments honestly.** Default view is executable chat tools. A clearly labelled SQL/data-browser filter includes SQL-only questions. Dual-capability questions stay attached to their existing tool with an alternative action. Reuse SQL availability and URL builders; never invent a chat wrapper from a SQL recipe.
6. **Deterministic execution remains explicit.** Selecting a tool or loading a preset never runs it. “Покажи данните” / “Show data” validates and executes. “Отвори в чата” transfers a validated intent with matching visible text, not an unbound natural-language example.
7. **Result ownership is immutable.** Store `{tool, args, context, requestedAt, envelope}` for each completed run; draft edits mark it stale. Clear or restore the appropriate per-tool result when switching tools. Never label an old result with new inputs.
8. **No speculative autocomplete.** Use existing lookup capabilities with appropriate company/person/place distinctions and exact stable IDs. Where no reliable lookup exists, use labelled text with examples and preserve the tool's ambiguity workflow. Local election cycles and presidential years have separate value sources.

## Delivery sequence

### Tier 0 — Complete the capability and parameter ledger

Deliverables:
- Turn the audit into a repeatable registry-to-discovery comparison script and a checked coverage ledger.
- For all 228 tools, reconcile public inputs against implementation and helper consumption: name, semantic kind, requiredness, default/fallback, allowed values, bounds, aliases, context dependencies and internal pins. Record an explicit disposition for every undeclared-read candidate.
- Reconcile the 59 SQL-only instruments and 15 reviewed dual-capability questions. Inventory additional API/dashboard capabilities by family and classify them as represented by a tool, SQL-only, internal/supporting, or a proposed future tool. Do not claim universal website coverage merely from registry parity; list each intentional exclusion with a reason.
- Fix the confirmed discovery and parameter defects. For example presets, use existing structured `legacyChatArgs`/question defaults and resolve through the existing adapters; do not parse prose to manufacture arguments.
- Add a generated-metadata parity gate covering optional fields, empty parameter arrays and removed IDs. Existing required-only checks are insufficient.

Acceptance:
- Registered tool names equal library executable IDs, with zero duplicates and no unclassified missing entries.
- Every public parameter is represented or has a documented question-preset restriction; internal pins and compatibility aliases have separate handling.
- Registry, validator, generated manifest, presets and documentation agree on execution semantics. All audit findings either fixed or explicitly scoped with reasons.
- Existing catalogue failure becomes green; add focused regressions for each confirmed missing control.

### Tier 1 — Shared input contract and validation

Deliverables:
- Extend `ToolParam` with the minimum reviewed semantic metadata (e.g. company kind, field-specific bounds, option labels, supported-value/default policy). Avoid a universal name-based heuristic.
- Create detailed validation results for field errors and normalized arguments, while keeping `validateToolArgs`' existing null-return contract compatible for model/router consumers.
- Separate draft text from typed arguments. Blank optional fields are omitted, explicit defaults are actually applied/displayed, and explicit invalid values never silently become a different year or limit.
- Reconcile dynamic defaults with handler behavior; show “latest available” only where that is the real rule. Invalid/unavailable coverage is distinct from zero results.
- Keep internal clarification pins through a narrow trusted path; test `candidateResult.partyNum` in particular.

Acceptance:
- Tests cover required/blank input, enums, year/count boundaries, defaults, aliases, internal pins and cross-field rules actually supported by handlers.
- Model tool schema, question adapter and Explorer consume the same constraints without changing existing validated starter intent.
- Exact election selection and bare-year fan-out remain distinct; presidential year-to-contest adaptation remains explicit.

### Tier 2 — Searchable library and welcoming start

Deliverables:
- Replace the select with a responsive library: search, category/subcategory filters, counts, compact tool rows, selected state and recent tools.
- Search bilingual titles, descriptions, question aliases and technical IDs. Reuse established normalization/transliteration where appropriate; support keyboard selection and clear/no-results states.
- Draft concise BG/EN titles for every tool. Do not use IDs as the visible primary label.
- Show a small curated gallery (approximately 4–6 existing question presets) when no tool is selected. Entries demonstrate different topics and real required inputs.
- Add SQL availability/filter and safe data-browser links from the existing catalogue.

Acceptance:
- All executable IDs remain reachable by search and category; unknown categories cannot silently drop tools.
- Search results and category counts describe the filtered population accurately; presets do not inflate tool counts.
- Keyboard users can search, select, clear and return from detail without losing focus.

### Tier 3 — Persistent tool workspace and execution states

Deliverables:
- Tool header: human title, concise purpose, category and small technical identifier disclosure.
- Typed parameter form with optional settings disclosure and actionable presets. Result area beneath it with “Резултат / Източници / Технически” tabs.
- Keep `AnswerView`; move `ReturnShape` into technical details. Preserve coverage caveats in the answer itself. Display provenance as readable sources, with links only where a verified source resolver supplies them.
- Implement idle, invalid, running, success, empty, error, clarification and edited-since-run states.
- Request-generation guard prevents an older async completion from mutating a newer selection/result. Use abort only if the data-client contract supports it; ignoring superseded results is mandatory either way.
- Wire `ClarifyDialog`, retry and “Open in chat” with exact validated intent. Store draft inputs per tool for this session.

Acceptance:
- Slow tool A resolving after selection of B never appears under B. A newer run wins over an older one.
- Ambiguous places and candidates can be resolved end to end; cancellation leaves a usable result/chooser.
- Edited inputs cannot masquerade as the inputs used for the displayed result.
- Presets populate fields; execution remains deliberate. Errors preserve user input.

### Tier 4 — Navigation, responsive polish and accessibility

Deliverables:
- Desktop: approximately 300–340px library alongside flexible workspace, respecting the existing app's fixed header/footer and inner main scroll container.
- Mobile: catalogue then full-width tool detail with an obvious back action, preserved catalogue search/scroll and comfortable touch targets. Avoid nested horizontal overflow.
- Add visible Chat / Tools navigation appropriate to the header, maintaining the about/evaluation links.
- Define a versioned URL state (e.g. `?tool=<id>&args=<encoded-json>`) with validated allowlisted inputs, bounded size and safe handling of unknown versions/IDs. Parse through the shared contract; do not auto-run an inbound link. Preserve language and browser back/forward behavior.
- Explicit share action includes draft or executed settings with clear wording. Persist only recent IDs by default; keep typed names and draft inputs in session unless a separate retention choice is made.
- Tune light/dark surfaces, selected states, focus rings, field labels, result announcements and reduced motion.

Acceptance:
- Verify 360px mobile, tablet and desktop; both languages and themes; keyboard-only interaction and visible focus.
- Result updates are announced without surprising focus jumps. Tabs and optional controls have accessible labels and semantics.
- Deep links round-trip validated settings; malformed inputs have a recoverable message; back restores selection and filter state.

### Tier 5 — Regression, performance and release readiness

Deliverables:
- Extend Vitest configuration so `ai/app/**/*.test.tsx` runs under jsdom. Currently browser tests include only `src`/`newsapp`, while AI tests in the node project match only `.test.ts`; dropping a new Explorer TSX test beside the component would otherwise collect nothing.
- Component tests exercise meaningful user flows: discovery, required validation, presets, stale inputs, request races, ambiguity, errors and navigation. Keep algorithm/contract tests separate.
- Browser smoke checks use stubbed deterministic responses for repeatability; perform a small read-only live-data smoke matrix separately across the six domains and the main parameter kinds. A source outage is reported as such, never treated as zero data.
- Run the targeted suites listed above, new coverage/contract gates, AI typecheck/build (`npm run build:ai`) and applicable lint. Re-run shared selector/SQL tests when their contracts change.
- Measure AI bundle impact and verify generated discovery metadata does not make the main site's entry graph import executable tools. Reuse the existing entry-graph gate if changing cross-app imports.

Acceptance:
- All relevant tests pass, including the previously failing catalogue parity test; verify actual collection of new UI tests.
- All 228 current tools are accounted for; new tools automatically enter the library and trigger metadata/contract completeness checks. The gate is derived from the registry, not a hard-coded count of 228.
- Supported parameters and valid presets are verified across the ledger; all remaining exclusions and live-source limitations are named.
- Screenshots demonstrate the accepted desktop/mobile direction in BG/EN and light/dark, with no dropdown takeover or clipped forms.

## Suggested implementation boundaries

- `ai/app/Explorer.tsx`: composition; extract focused library, parameter form, result panel and workspace state modules under `ai/app/explorer/`.
- `ai/tools/types.ts`, `ai/orchestrator/toolSchema.ts`, affected tool definitions: executable contracts and compatible validation.
- `ai/app/toolParameters.json` plus generation/check script: import-free projection for the main site.
- `ai/app/starterPrompts.json`, sources/topics/aliases and shared question catalogue: discovery completeness and structured presets.
- `ai/App.tsx`: navigation/context handoff and URL integration, preserving the existing application shell.
- `vitest.config.ts`: explicit UI test collection/environment, without moving existing Node tool tests into jsdom.

## Scope and sequencing

Contract audit and repair precede form rendering; library and form implementation then converge in the workspace, followed by navigation and verification. This plan does not add an LLM dependency to tool execution, invent missing data coverage, or automatically expose arbitrary SQL as chat tools. New instruments identified by the broader capability ledger are separate, explicitly described additions with their own contracts.

No production deployment is part of this planning change. Implementation should finish with a reviewable diff and verification report; deployment follows the project's applicable AI hosting workflow when requested.
