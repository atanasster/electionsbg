# Deferred locale bundles — v1

The translation corpus is one flat i18next namespace that **every page downloads
before it can paint**. `tests/perf.spec.ts` budgets it per language in brotli, and
by 2026-08-22 that budget had become unpayable: the corpus grows ~1-2 KB br per
language per day, the two one-off savings available had both been spent, and the
budget tripped again four days after the last one.

This splits the corpus by ROUTE REACHABILITY. Core stays what every page needs; a
**deferred bundle** ships with the routes that declare it.

## What was already spent

| date       | lever                                                                                 | bg                | en                |
| ---------- | ------------------------------------------------------------------------------------- | ----------------- | ----------------- |
| 2026-08-13 | `json.namedExports: false` — emit `JSON.parse("…")` instead of 6,063 minified aliases | 189,485 → 137,192 | 172,586 → 119,571 |
| 2026-08-18 | `i18n:prune` — 486 keys nothing could ask for                                         | 149,826 → 143,384 | 131,349 → 125,436 |
| 2026-08-22 | **this**                                                                              | 147,845 → 114,803 | 129,418 → 99,553  |

The 2026-08-18 prune left EN clearing its ceiling by **64 bytes**, and its own gate
(`scripts/i18n/key_usage.test.ts`) now keeps the dead set at zero — so there was no
second prune to find. Neither of the first two levers can be pulled again.

## Design

**One namespace, several files.** `src/locales/<lang>/translation.json` is the core
corpus; `budget.json` and `methodology.json` are bundles, merged into the _same_
i18next namespace with `addResourceBundle`. Every call site stays a plain
`t("budget_hub_title")` — there is no namespace for a component to declare, and
therefore none to forget.

**The route declares the bundle, and nothing else does.** `withBundle("budget", …)`
in `src/routes.tsx` fetches the bundle ALONGSIDE the screen's own chunk;
Suspense holds the render until both land, so a screen never paints with its own
strings missing, and the two requests never serialise.

**Which keys may leave is DERIVED.** `scripts/i18n/bundles.ts` proves a key is named
only by modules that no route outside the bundle can statically reach.
`split_bundles.ts --apply` moves them, in both directions. There is no curated list.

## Why this is safe, and where the safety comes from

A key whose bundle is not loaded renders as **its own identifier, at a 200** —
`budget_hub_title` where a heading belongs, with nothing logged and no row count
moving. So the analysis is biased toward core in every ambiguous case: named outside
`src/`, named by a data artifact, reachable from the shell, or reachable from an
untagged route ⇒ core. Measured, 4,614 of 6,253 keys stay in core for the last of
those reasons alone.

Three independent guards, deliberately not one:

1. **The exact scan makes the verdict a proof.** The owner index is a fast
   aligned-token pass, but every key it clears is then re-checked with plain
   `includes` against the concatenated text of _every file the bundle's routes do
   not exclusively reach_. Two consequences worth stating: the route parser does not
   have to be complete (an unrecognised route shape leaves its modules outside every
   closure, hence in the scanned text), and the index does not have to be exact (it
   can only fail to notice an owner, and any file it missed is in that text too).
   Verified: the strengthened scan moved 0 keys, i.e. the fast and exact answers
   agree on today's corpus.
2. **`scripts/i18n/bundle_reachability.test.ts`** re-derives the split from the route
   tags in seconds and fails naming the key and the routes that can now reach it. It
   carries a mutation check — untagging `budget` must move every one of its keys back
   to core — because every assertion in it is "the wrong list is empty", which an
   analysis that had stopped seeing routes satisfies perfectly.
3. **The runtime heals.** A missing key pulls every bundle and re-renders
   (`bindI18nStore: "added"`). It should never fire; it exists because the analysis
   reads call sites with regexes and the cost of being wrong is a live page. It
   deliberately does NOT consult a key→bundle manifest — one in the core chunk would
   cost most of what the split saved.

Plus two end-to-end assertions in `tests/perf.spec.ts`, which are the only ones that
watch a browser rather than an artifact: a bundled route fetches its bundle and _no
other_, and renders no raw key; an untagged route fetches no bundle at all.

## Measurements (2026-08-22, brotli q11, real emitted chunks)

| chunk                              | bg                        | en                       |
| ---------------------------------- | ------------------------- | ------------------------ |
| core `translation`                 | **114,803** (was 147,845) | **99,553** (was 129,418) |
| `budget` (909 keys, 21 routes)     | 27,238                    | 22,939                   |
| `methodology` (210 keys, 6 routes) | 13,173                    | 9,987                    |

1,119 of 6,253 keys deferred; −22.4% bg / −23.1% en on the corpus every page pays
for. Budgets re-ratcheted to measured +5%: core bg 120,500 / en 104,500.

## Traps this cost, recorded so the next bundle does not repeat them

- **A key family is NOT a route.** `budget_*` is 934 keys, and 25 of them are named
  by the header search, the report menus, the governance cards and the My-Area tile —
  all shell-reachable. Splitting on the prefix would have shipped raw keys on the
  home page. Reachability and prefix agree on nothing in particular.
- **Test files are not owners.** A budget screen's test names every key it asserts
  on and ships to nobody. Counting tests as owners puts the whole bundle back in
  core; `key_usage.ts` still reads them, because a key a test names is a key whose
  deletion should fail loudly. The two questions differ and the exclusion lives only
  in `bundles.ts`.
- **The prune must write per FILE.** `prune_translations.ts` wrote the kept corpus to
  `translation.json`; unchanged, that folds every bundle into the core chunk on the
  next prune, hands the budgets their whole overage back, and every key count
  reconciles.
- **`loadCorpus` must read the UNION.** Reading the core file alone reports all 1,119
  bundled keys as dead — and the prune would then delete them.
- **A language switch must carry the loaded bundles over.** The route wrapper has
  already run, so nothing refetches; without the re-merge in `changeLanguage`, a
  visitor switching language while reading `/budget/execution` watches the page turn
  into identifiers, on the happy path.
- **`src/locales/allKeys.ts` is a second door.** It statically imports all three
  chunks for the component tests; anything the shell can reach that imports it puts
  every bundle back on the critical path. Held by the reachability gate (source) and
  by `tests/perf.spec.ts` (artifact).

## Open

The corpus keeps growing, so the budgets will trip again — and the lever is now
repeatable rather than one-shot. Measured exclusive weight of the next candidates,
per language, brotli:

| bundle        | keys | ≈ br saved |
| ------------- | ---- | ---------- |
| `funds`       | 425  | ~7.5 KB    |
| `procurement` | 399  | ~7 KB      |
| `person`      | 476  | ~7 KB      |
| `indicators`  | 248  | ~7 KB      |
| `local`       | 231  | ~4 KB      |

Adding one is: name it in `src/locales/bundles.ts`, tag its routes with
`withBundle()`, `npm run i18n:split -- --apply`, re-ratchet `tests/perf.spec.ts`.
The gate covers the rest.
