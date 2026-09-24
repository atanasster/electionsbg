// Buffer accounting for `EXPLAIN (ANALYZE, BUFFERS)` output, shared by the buffer-ceiling
// gates (person_connections.data.test.ts, person_by_name.data.test.ts). Those gates are how
// a query rewrite is kept from silently regressing to a whole-corpus scan, so THIS is the
// measuring instrument: when it is wrong, every ceiling built on it stops measuring while
// still reporting green.
//
// It lived in both gates as a copy-pasted regex, and both copies carried the same defect —
// which is the argument for one implementation with one test.

/**
 * Total shared-buffer ACCESSES (hit + read) in the EXECUTION section of a plan.
 *
 * Three details, each of which produced a wrong number in a shipped gate:
 *
 * 1. **`shared` prefixes the group ONCE.** Postgres prints `Buffers: shared hit=3684
 *    read=7545, local hit=…, temp read=…` — one keyword per pool, then its counters. A regex
 *    like /shared (?:hit|read)=(\d+)/ matches `shared hit=` but not the bare `read=`, so it
 *    scores only what was already CACHED instead of what the query touched. That is not a
 *    conservative error and it is load-dependent: the same body scored 3,684 on a warm cache
 *    and 11 after other tests churned shared_buffers — passing alone, failing in a full run.
 * 2. **Zero-valued counters are OMITTED.** A fully-cached plan prints `shared hit=22` with no
 *    `read=`; a cold one prints `shared read=4461` with no `hit=`. Anchoring on either alone
 *    scores the other case as 0 — under any ceiling, in the dangerous direction.
 * 3. **Planning buffers are not execution.** EXPLAIN ends with a `Planning:` section carrying
 *    its own `Buffers:` line: catalog reads for BUILDING the plan, which scale with the schema
 *    rather than the function under test. They are ~0 on a backend that just ran the query and
 *    hundreds on a fresh one, so counting them makes the score depend on which pooled client
 *    the test happened to get.
 *
 * `dirtied`/`written` are excluded (writeback, not accesses), and so are the `local` and `temp`
 * pools (temp-table and sort/hash spill buffers — different resources from shared_buffers).
 *
 * @throws if the plan carries no execution `Buffers:` line — a silent 0 would sail under every
 *         ceiling, so a format change must fail loudly instead.
 */
export const sumExecutionBuffers = (
  rows: { "QUERY PLAN": string }[],
): number => {
  const all = rows
    .map((r) => r["QUERY PLAN"])
    .join("\n")
    .split("\n");
  // "Planning:" (the section), never "Planning Time:" (the scalar, which has no buffers).
  const planningAt = all.findIndex((l) => /^\s*Planning:/.test(l));
  const lines = (planningAt === -1 ? all : all.slice(0, planningAt)).filter(
    (l) => l.includes("Buffers:"),
  );
  if (!lines.length)
    throw new Error(
      "EXPLAIN reported no execution Buffers: line — parser needs updating " +
        "(scripts/db/lib/explain_buffers.ts)",
    );
  return lines
    .flatMap((l) => [...l.matchAll(/shared ([^,]*)/g)])
    .flatMap((m) => [...m[1].matchAll(/\b(?:hit|read)=(\d+)/g)])
    .reduce((n, m) => n + Number(m[1]), 0);
};

/**
 * Shared-buffer accesses (hit + read) of the ROOT node only — the first execution `Buffers:`
 * line, which Postgres reports INCLUSIVE of every child, InitPlan and CTE beneath it.
 *
 * Use this instead of `sumExecutionBuffers` when a ceiling has to be proportional to a row
 * count. The sum counts each probe once per ancestor that re-reports it, so its per-row cost
 * scales with the plan's nesting depth rather than with the work done — funds_news reported
 * ~26 "buffers" per probe that actually touched 3.
 *
 * Same parsing rules as `sumExecutionBuffers`: the whole `shared` group, zero counters omitted,
 * the `Planning:` section excluded, and a throw rather than a silent 0.
 */
export const rootExecutionBuffers = (
  rows: { "QUERY PLAN": string }[],
): number => {
  const all = rows
    .map((r) => r["QUERY PLAN"])
    .join("\n")
    .split("\n");
  const planningAt = all.findIndex((l) => /^\s*Planning:/.test(l));
  const first = (planningAt === -1 ? all : all.slice(0, planningAt)).find((l) =>
    l.includes("Buffers:"),
  );
  if (!first)
    throw new Error(
      "EXPLAIN reported no execution Buffers: line — parser needs updating " +
        "(scripts/db/lib/explain_buffers.ts)",
    );
  return [...first.matchAll(/shared ([^,]*)/g)]
    .flatMap((m) => [...m[1].matchAll(/\b(?:hit|read)=(\d+)/g)])
    .reduce((n, m) => n + Number(m[1]), 0);
};
