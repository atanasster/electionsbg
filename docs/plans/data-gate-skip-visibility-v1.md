# Making a skipped data gate say why — v1

**Status:** Tier 1 IN PROGRESS. Step 1 (`f9e9fdba63`) shipped `scripts/lib/report_skip.ts`;
step 2 migrated the pre-existing emitters. Tier 2 remains unbuilt.

**⚠️ Two numbers in this plan were wrong and are corrected in place:** the emitting/silent
split is **3 / 167**, not 5 / 165 (see §4's box), and §4's original code sketch showed an API
that did not survive review — the shipped helper derives its label from `import.meta.url`
rather than taking a hand-typed one, and its `reason` admits `null`/`undefined`.
**Measured:** 2026-08-25 against the working tree at `8053186f3e`, local Postgres
`postgres://postgres:postgres@localhost:5433/electionsbg`, and a simulated database-less
run (`DATABASE_URL` pointed at a dead port) standing in for CI.
**Occasion:** `CODE_REVIEW_REPORT.md` FINDING-002, raised against `3431125b02`. That commit
gave one gate a dual `console.warn` + `ctx.skip(reason)` report and the review asked whether
the pattern should go repo-wide.

---

## 0. Executive summary

**The review's framing understates the problem, and the correction changes what to build.**
FINDING-002 describes the sibling gates as using a _weaker_ reporting pattern —
`console.warn` only, invisible when piped. Measured, that is true of **3 files**. The other
**167 compute a reason string and never emit it at all**:

|                                          |   files |
| ---------------------------------------- | ------: |
| declare `const skip = <reason> \| false` | **170** |
| …and emit it somewhere (`console.warn`)  |   **3** |
| …and emit it nowhere                     | **167** |

So this is not a reporter-visibility problem with a reporting layer that needs strengthening.
For 98% of these gates there is no reporting layer at all — a precise, hand-written sentence
(`"declaration.filed_institution is empty — it comes from a crawl or ship_filed_position.ts,
never from db:refresh"`) is computed at module scope, used as a boolean, and discarded.

**The cost is concentrated in CI, where it is total.** `.github/workflows/test.yml` runs
`npm run test:unit` on `ubuntu-latest` with no database and no gitignored corpora — the step
comment says so: _"Hermetic — no browser, emulator or database"_. So every one of these gates
skips on every push. Measured in the database-less run:

> **162 test files / 1,565 tests skipped. Skip reasons printed: 0.**

Zero includes the 5 that call `console.warn`, because the default reporter intercepts console
output and does not print it when piped. CI's log says `1565 skipped` and nothing else.

**⚠️ THE EXPENSIVE FIX IS NOT THE FIRST THING TO DO, AND THE REVIEW SUGGESTS THE EXPENSIVE
ONE.** FINDING-002 proposes factoring the `gate()` helper into `scripts/lib/data_test_gate.ts`
and adopting it in the siblings. Adoption means rewriting every guarded call site:

| call site form                                                               |     count |
| ---------------------------------------------------------------------------- | --------: |
| `test.skipIf(skip)`                                                          | **1,139** |
| variants (`!ok`, `stateSkip`, `noDb`, `!RUN`, `!built`, `shardSkip`, `bool`) |      ~146 |

**One line per file fixes it, with no config change and no new noise.** The reason
`console.warn` vanishes is that the default reporter _intercepts_ `console.*`.
`process.stderr.write()` is **not** intercepted — verified directly: it prints under the
default reporter, piped, with nothing configured. So the whole fix is a three-line shared
helper that writes the reason to stderr, plus one call per file.

Recommendation: **Tier 1 — the helper plus 170 one-line calls.** Tier 2 (the `gate()` /
`ctx.skip` rewrite, 1,139 edits) only if a structured consumer ever justifies it.
**Do not reach for `disableConsoleIntercept`** — measured, it costs +424 lines of unrelated
output to surface the ~162 useful ones (§3).

---

## 1. Why nothing currently reaches the log

Three independent facts, each measured, that compose into total silence:

1. **`test.skipIf(reason)` discards the reason.** Vitest's `skipIf` takes a _condition_. A
   non-empty string is truthy, so the file's carefully-worded sentence works correctly as a
   boolean and is then dropped on the floor. Nothing in the API records it.
2. **The default reporter prints no test names for a passing or skipped file.** Piped, the
   whole run collapses to `Test Files … / Tests N skipped`. So even a reason encoded into a
   test's _name_ would not appear.
3. **The default reporter intercepts `console.*` and does not print it when piped.** Verified
   with a probe file: `console.warn` at module scope, in `beforeAll`, and inside a test all
   produced no output under the default reporter, and all three appeared under
   `--reporter=verbose`.

Fact 3 is why the 5 emitters emit nothing in CI — and it is a fact about `console`, not about
the stream. `process.stderr.write` sidesteps it with no configuration, which is what §4 is
built on.

### 1.1 What each mechanism can and cannot surface

Verified on a probe file, default reporter, piped:

| mechanism                                            | default reporter    | `--reporter=verbose` |
| ---------------------------------------------------- | ------------------- | -------------------- |
| `console.warn(reason)`                               | ❌                  | ✅                   |
| `console.warn(reason)` + `--disableConsoleIntercept` | ✅ (+424 lines, §3) | ✅                   |
| **`process.stderr.write(reason)`**                   | **✅ (no config)**  | ✅                   |
| `ctx.skip(reason)` note                              | ❌                  | ✅ (`↓ … [reason]`)  |

`ctx.skip` is strictly better _shaped_ — the reason is attached to the test rather than to a
line of stdout, so it survives into the JSON reporter and any tooling built on it — and it is
still invisible in the channel that matters today. That is the whole reason Tier 2 is
separated from Tier 1 rather than bundled with it.

---

## 2. Inventory (measured 2026-08-25)

```
test.skipIf(...)                       182 files
describe.skipIf(...)                    14 files
skip ? describe.skip : describe          2 files   ← the form FINDING-002 quotes
ctx/t.skip() call form                  32 files
const skip = <reason>|false            170 files
  …that emit it                          3 files
  …that do not                         167 files
top-level await computing a skip input  169 files   ← constrains the helper API
  …of the 170, using dbReachable()      75 files   ← the skip is NOT always about Postgres
```

**⚠️ Correcting the review's premise.** FINDING-002 says the siblings use
`const d = skip ? describe.skip : describe` and that this holds for
"the dozens of `scripts/db/tests/*.data.test.ts` files generally". Measured: **2 files** use
that form; **176** use `test.skipIf`. The conclusion it draws still stands — neither form
surfaces the reason — but a sweep scoped to the quoted pattern would touch 2 files and change
nothing.

The three emitters: `eop_notice_coverage`, `isun_clean_delivery`, `aop_experts`.
`party_pair_break` and `mp_loyalty` matched the inventory grep on an IN-TEST partial skip and
belong to the silent set — see §4's box.

---

## 3. Rejected: `disableConsoleIntercept`

The obvious lever, measured and rejected. `disableConsoleIntercept: true` in
`vitest.config.ts` does make `console.warn` print under the default reporter — but it
un-suppresses _every_ `console.*` in the suite. Measured under the CI condition, with
identical run totals on both sides (162 files / 1,565 tests skipped):

| run                         | lines of output |
| --------------------------- | --------------: |
| default                     |             243 |
| `--disableConsoleIntercept` |         **667** |

**+424 lines, and they are not signal.** Bucketed, the additions are dominated by:

```
128  Recharts "The width(0) and height(0) of chart should be greater than 0"  (4 lines x 32)
 74  [prices] matched panel / built index.json / coverage progress logs
 33  [parse] no form-version discriminator — assuming the current form
 32  react-i18next "You will need to pass in an i18next instance"
 12  "The current testing environment is not configured to support act(...)"
 11  ExperimentalWarning: SQLite is an experimental feature
```

Paying 424 lines of component-test and pipeline chatter to surface the ~162 useful ones is the
trade that gets a flag reverted a month later. §4 buys the same visibility for zero noise.

---

## 4. Tier 1 — emit the reason (a 3-line helper + one call × 170 files)

`scripts/lib/report_skip.ts` — **as shipped** (`f9e9fdba63`); the original sketch here took a
hand-typed label and a `string | false`, and review killed both:

```ts
export const reportSkip = (
  moduleUrl: string,
  reason: string | false | null | undefined,
): void => {
  if (!reason) return;
  process.stderr.write(`${gateName(moduleUrl)}: skipped — ${reason}\n`);
};
```

Two changes from the sketch, each for a measured reason:

- **The label is DERIVED from `import.meta.url`, never hand-typed.** ~170 insertions is ~170
  chances to paste the neighbouring file's name, and a later rename leaves the label pointing
  at a file that no longer exists — both invisible, since nobody reads these lines until a CI
  run is already confusing. Deriving also makes the step-3 codemod insert one _identical_ line
  everywhere instead of computing a stem per file.
- **`reason` admits `null` and `undefined`.** The sketch's `string | false` is `TS2345`
  against `isun_clean_delivery` and `aop_experts`, both of which close their ternary with
  `: null` — two of the very files this tier must migrate, so step 2 would not have compiled.
  A bare `boolean` is still rejected: it carries no reason, and stringifying one prints
  `skipped — true`, which reads like a reason and is not one.

Then, in every file already declaring `const skip = <reason> | false`, one line after it:

```ts
reportSkip(import.meta.url, skip);
```

It is mechanical and codemod-able: the anchor is the `const skip = …;` declaration and the
insert is position-independent.

**The existing emitters must migrate too, not be left alone.** Their `console.warn` is
intercepted, so they are invisible in CI exactly like the silent majority — "already
reports" is true of the source and false of the log.

> **⚠️ Corrected during Tier 1 step 2 (`f9e9fdba63`…): it is 3 emitters, not 5, so the
> silent set is 167 rather than 165.** The inventory grep was `console\.warn\(.*skip`,
> which also matched two files whose `console.warn` is an IN-TEST partial skip
> (`party_pair_break`: "artifact absent — parity arm skipped"; `mp_loyalty`: the same for
> `loyalty.json`). Both do declare a file-level `const skip` and never emit it, so they
> belong to the silent set, not the emitting one. All five files are still migrated in
> step 2 — the THREE in-test warnings are invisible for exactly the same reason and are
> converted too (`party_pair_break` carries two: a label arm and a parity arm) — but the split above is what the sweep in §6's acceptance is measured
> against.

**Three cases the codemod must not touch blindly:**

- **Files whose skip variable is not called `skip`** (`stateSkip`, `noDb`, `shardSkip`,
  `built`, `ok`, `RUN` — ~146 call sites). Some are booleans with _no reason to print_. A
  codemod that stringifies `false` emits `skipped — false`, which is worse than silence
  because it looks like a reason. Restrict the codemod to `const skip = … | false` and handle
  the rest by hand, or leave them to Tier 3.
- **Files with more than one skip variable** — the per-test conditions in §2 are not always
  the file-level one. Emitting only the file-level reason there is correct but partial; say so
  in the message rather than implying it covers every test.
- **`describe.skipIf` files (14)** — the same line works, but the reason covers a suite rather
  than a file.

**No config change, and no measurable noise**: the helper writes only when a gate actually
stands down, so a fully-provisioned local run (nothing skipping) prints nothing at all.

---

## 5. Tier 2 — `ctx.skip(reason)` per test (optional, ~1,139 edits)

The shape FINDING-002 actually proposes. A shared helper in **`scripts/lib/`**, not
`scripts/db/lib/`: only **75 of the 170** gates key on `dbReachable()` at all — the rest skip
on an absent gitignored corpus, an unbuilt matview or a missing capture — and the helper's
whole signature is `string | false`, so it holds no Postgres knowledge and must not be filed
as though it did.

```ts
export const makeGate =
  (skip: string | false) =>
  (name: string, assert: () => void | Promise<void>) =>
    test(name, async (ctx) => {
      if (skip) return ctx.skip(skip);
      await assert();
    });
```

**What it buys over Tier 1:** the reason is attached to each test rather than printed once per
file, so it survives into the JSON reporter and anything built on it, and a file with several
distinct skip conditions reports the right one per test.

**What it costs:** 1,139 call-site rewrites plus ~146 hand-checked variants, in files whose
data gates are the repo's most load-sensitive (see
[[reference_test_data_flaky_under_load]]) — so a mechanical error lands as a _silently
skipped_ gate, the exact failure this plan exists to end.

**Recommendation: do not do this now.** Tier 1 alone delivers the stated goal ("a piped CI
log stops losing skip reasons"). Tier 2 should wait for a concrete consumer of the structured
form — a CI annotation, a skip-drift dashboard — rather than being bought on aesthetics.

---

## 6. Verification and gate

**Acceptance for Tier 1**, run in the database-less condition:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:59999/electionsbg" npm run test:unit 2>&1 \
  | grep -c "skipped — "
```

Today this prints **0**. After the sweep it must print a number close to the count of skipped
FILES (162 measured — not the 1,565 skipped tests, since Tier 1 reports once per file).

**Gate.** A test that fails when a file computes a reason and drops it — the same
static-analysis shape as `src/entryGraph.test.ts` and `scripts/i18n/key_usage.test.ts`, both
of which exist because the failure they catch is invisible in review:

- parse every `*.test.ts` under `scripts/` for a `const skip = … | false` declaration;
- fail when such a file never passes it to `reportSkip` (or a `ctx.skip`);
- carry an exemption list with reasons, so a deliberate omission is a decision and a stale
  exemption fails too.

Without that gate Tier 1 decays the moment the next data gate is written, and it decays
silently — which is how the 167 got here.

---

## 7. What this plan does not fix

- **Bare-boolean skips with no reason at all** (`test.skipIf(!hasStore)`, `!RUN`, `!built`).
  Emitting for these requires _inventing_ a reason per site, which is authorship, not a
  sweep. Tier 3, unscoped.
- **`return t.skip()` with no note** (`bill_and_topics.data.test.ts` and neighbours) — same
  class.
- **Why so much skips at all.** 162 files skipping in CI is the designed behaviour of a repo
  whose corpora are gitignored crawls; this plan makes the silence legible, not smaller.
- **CI is currently red for unrelated reasons** — measured in the same database-less run,
  4 files fail without a database: `bootstrap_roles`, `cloud_loader_coverage`,
  `ogAndSitemapCoverage`, `governanceNonPlace`. The last two are the `/governance/mayor-pay`
  route (commit `1f196d41fb`) not yet registered in `GOVERNANCE_NON_PLACE_SEGMENTS` nor in the
  sitemap. Out of scope here, but any acceptance run above will show them.
