// Run the JEV lane over the shared 841-case bank and publish its artifact.
//
//   TYPESAFE_API_KEY=… npx tsx ai/llm/jevLane.run.ts [caseLimit]
//   TYPESAFE_API_KEY=… npx tsx ai/llm/jevLane.run.ts --retry-degraded
//
// Writes data/ai/evals/current_jev.json, which ai/llm/evalsIndex.ts picks up
// automatically — the eval page reads the manifest, so a new lane appears
// without editing the page.
//
// This is the THIRD lane of the comparison the plan asks for:
//   non_ai.json        the deterministic keyword router (free, offline)
//   current_*.json     Gemini Flash
//   current_jev.json   this one
//
// All three are scored by the same functions on the same cases (see
// ai/llm/jevLane.ts), so the numbers are comparable rather than merely
// adjacent.
//
// Cost: 841 cases x 2 languages ≈ 1,682 routing calls at ~$0.0005 → under $1.
// Add the tier-2 second calls and it is still well under that per run.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { evaluateJev, JEV_LANE_CASES, type JevLaneRow } from "./jevLane";
import { LEGACY_GROUPS } from "../tests/nonAiEval";
import { callSystemOne, MODEL } from "./fcEval.jev";
import type { askJev } from "./jevClient";
import { JEV_MODEL_NOTE } from "./jevPrompt";
import type { Lang } from "../tools/types";

const OUT = "data/ai/evals/current_jev.json";

/** An `askJev`-shaped function that calls the TypeSafe API directly, for the
 *  node harness. Shares `callSystemOne` (retries, backoff) with fcEval.jev.ts.
 *
 *  ⚠️ THIS IS NOT THE PRODUCTION TRANSPORT, AND EVERY DIFFERENCE FLATTERS THE
 *  LANE. Read the published number as "how well Jev routes", never as "how
 *  often the chat will route through Jev":
 *
 *    production                     this harness
 *    1.2s client budget             no timeout
 *    2s server abort                —
 *    no retries in the turn         6 retries, 2–14s backoff
 *    circuit breaker after 3 fails  none
 *    model pinned (jev-1.13.0)      jev-latest
 *    payload validated by our proxy sent straight to the API
 *
 *  The last row is the one that bit: two registry tools produced option text
 *  over the proxy's limit, so production 400'd on every routing call while
 *  this harness scored perfectly. `jevPrompt.payload.test.ts` now gates it. */
const failures = new Map<string, number>();
const directAsk =
  (apiKey: string, maxRetries?: number): typeof askJev =>
  async (state, questions) => {
    const { res, latencyMs, error } = await callSystemOne(
      apiKey,
      { state, model: MODEL, questions },
      { maxRetries },
    );
    if (error || !res?.answers) {
      // Counted by cause, so a run can say whether its fallbacks were rate
      // limits (an artifact of the harness) or real rejections (a defect).
      const cause = (error ?? "no answers").slice(0, 60);
      failures.set(cause, (failures.get(cause) ?? 0) + 1);
      return null;
    }
    return {
      answers: res.answers as never,
      model: res.model,
      usage: res.usage,
      latencyMs,
    };
  };

// ⚠️ THE FIELD NAMES ARE THE MANIFEST'S, NOT OURS. `ai/llm/evalsIndex.ts`
// compacts every `current_*.json` by reading `toolAcc`/`callAcc`/`argN`/
// `argAcc`, and `evalsIndex.test.ts` regenerates the index and compares — so an
// artifact using its own names is silently dropped from the page AND breaks
// that test. Same shape as `currentEval.ts`'s `summarize`, which is the lane
// this comparison is against.
const summarize = (rows: JevLaneRow[]) =>
  Object.fromEntries(
    (["en", "bg"] as const).map((lang) => {
      const l = rows.filter((r) => r.lang === lang);
      const annotated = l.filter((r) => r.argScored);
      const irrelevant = l.filter((r) => r.expectedTool === null);
      const routed = l.filter((r) => r.routedByJev);
      const ratio = (xs: JevLaneRow[], key: "toolOk" | "callOk") =>
        xs.length ? xs.filter((r) => r[key]).length / xs.length : null;
      return [
        lang,
        {
          n: l.length,
          toolAcc: ratio(l, "toolOk"),
          callAcc: ratio(l, "callOk"),
          argN: annotated.length,
          // `argsOk` is null on an unannotated row, so the explicit `=== true`
          // is what makes this a measurement rather than a truthiness accident.
          argAcc: annotated.length
            ? annotated.filter((r) => r.argsOk === true).length /
              annotated.length
            : null,
          // Jev returns typed answers, so there is no JSON to fail to parse —
          // null rather than 1, which would claim a metric this lane does not
          // measure.
          jsonValidRate: null,
          // THE metric that judges abstention: did the lane correctly call
          // nothing when nothing applied?
          irrelevanceAcc: ratio(irrelevant, "callOk"),
          // ⚠️ REPORTED, NOT BURIED. Jev is the only lane that can decline, so
          // its accuracy without these numbers flatters it.
          //
          // NOTE `jevRouted` is NOT a decline rate — a confident `no_tool` is
          // still Jev routing the turn. `jevDeclined` is the decline rate, and
          // the two answer different questions.
          jevRouted: l.length ? routed.length / l.length : null,
          jevDeclined: l.length
            ? l.filter((r) => r.routedByJev && !r.selected).length / l.length
            : null,
          // Two DIFFERENT reasons the fallback answered, kept apart. `degraded`
          // is an outage (the harness's problem, and it should be ~0);
          // `jevUnsure` is Jev abstaining below the confidence gate (the
          // router's own behaviour, and part of what this lane is).
          degraded: l.length
            ? l.filter((r) => r.degraded).length / l.length
            : null,
          jevUnsure: l.length
            ? l.filter((r) => r.unsure).length / l.length
            : null,
          // Accuracy ON THE TURNS JEV ACTUALLY ROUTED — the other half of the
          // abstention story.
          toolAccWhenRouted: ratio(routed, "toolOk"),
        },
      ];
    }),
  );

/** The artifact, built from a full set of rows. Shared by a fresh run and a
 *  retry, so a spliced artifact cannot be summarised differently. */
const buildArtifact = (
  rows: JevLaneRow[],
  caseCount: number,
  caseIds: string[],
  startedAt: string,
  retried?: { passes: number; rows: number; stillDegraded: number },
) => {
  const legacy = rows.filter((r) =>
    (LEGACY_GROUPS as readonly string[]).includes(r.group),
  );
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  return {
    label: "Jev (TypeSafe) routing",
    model: JEV_MODEL_NOTE,
    provider: "typesafe",
    startedAt,
    finishedAt: new Date().toISOString(),
    caseCount,
    caseGroups: groups,
    toolCount: null,
    // The bank is shared, so its hash makes a cross-lane comparison verifiable
    // rather than assumed.
    suiteHash: createHash("sha256")
      .update(JSON.stringify(caseIds))
      .digest("hex")
      .slice(0, 12),
    ...(retried ? { retried } : {}),
    metrics: summarize(rows),
    legacyMetrics: summarize(legacy),
    groups: Object.fromEntries(
      groups.map((g) => [g, summarize(rows.filter((r) => r.group === g))]),
    ),
    rows,
  };
};

const report = (artifact: ReturnType<typeof buildArtifact>) => {
  const m = artifact.metrics as Record<
    string,
    {
      toolAcc: number | null;
      jevRouted: number | null;
      degraded: number | null;
      jevUnsure: number | null;
      irrelevanceAcc: number | null;
    }
  >;
  const pct = (x: number | null) =>
    x == null ? "n/a" : `${(100 * x).toFixed(1)}%`;
  for (const lang of ["en", "bg"] as const)
    console.error(
      `  ${lang.toUpperCase()} tool ${pct(m[lang].toolAcc)} · routed by Jev ${pct(m[lang].jevRouted)} · below gate ${pct(m[lang].jevUnsure)} · unavailable ${pct(m[lang].degraded)} · irrelevance ${pct(m[lang].irrelevanceAcc)}`,
    );
  if (failures.size)
    console.error(
      `  call failures by cause: ${[...failures].map(([k, v]) => `${v}× ${k}`).join(" | ")}`,
    );
};

/**
 * `--retry-degraded`: re-evaluate ONLY the rows where Jev was UNAVAILABLE, and
 * splice them back into the published artifact. Makes no API call when there
 * are none.
 *
 * ⚠️ OUTAGES ONLY — never the `unsure` rows, and that is the whole design.
 * Retrying an outage is unbiased: whether the API answered is independent of
 * what Jev would have said. Retrying a LOW-CONFIDENCE row is not: re-asking
 * only the rows below the gate and keeping whichever answer clears it samples
 * Jev's run-to-run variation near the threshold selectively, and inflates the
 * routed share. The first version of this mode did exactly that — 18 of 321
 * "recovered" on its first pass, none of them outages — and was stopped before
 * it wrote.
 *
 * Rows written before `unsure` existed carry both states in `degraded`. They
 * are split OFFLINE first, from their own recorded confidence: an outage has
 * none, a below-gate answer has one. No row is re-asked to do this.
 *
 * Whatever cannot be recovered stays degraded and is reported in `retried`,
 * never dropped — removing it would shrink the bank under the other lanes.
 */
const retryDegraded = async (apiKey: string) => {
  const prior = JSON.parse(readFileSync(OUT, "utf8")) as {
    startedAt: string;
    caseCount: number;
    rows: (JevLaneRow & { unsure?: boolean })[];
  };
  if (prior.caseCount !== JEV_LANE_CASES.length) {
    console.error(
      `refusing: ${OUT} covers ${prior.caseCount} cases, the bank has ${JEV_LANE_CASES.length}.`,
    );
    process.exit(1);
  }
  let migrated = 0;
  const rows: JevLaneRow[] = prior.rows.map((r) => {
    if (r.unsure !== undefined) return r as JevLaneRow;
    const unsure = r.degraded && r.jevConfidence != null;
    if (unsure) migrated++;
    return { ...r, unsure, degraded: r.degraded && !unsure };
  });
  const byId = new Map(JEV_LANE_CASES.map((c) => [c.id, c]));
  let pending = rows.map((_, i) => i).filter((i) => rows[i].degraded);
  const initial = pending.length;
  console.error(
    `retry: ${migrated} legacy rows split out as below-gate (no call made); ` +
      `${initial} real outage(s) to re-ask`,
  );
  let passes = 0;
  while (pending.length && passes < 5) {
    passes++;
    const before = pending.length;
    for (const i of pending) {
      const c = byId.get(rows[i].id);
      if (!c) throw new Error(`case ${rows[i].id} is no longer in the bank`);
      rows[i] = await evaluateJev(
        c,
        rows[i].lang,
        undefined,
        directAsk(apiKey, 12),
      );
    }
    pending = pending.filter((i) => rows[i].degraded);
    console.error(`  pass ${passes}: outages ${before} → ${pending.length}`);
    if (pending.length && pending.length >= before) break; // no progress
    if (pending.length) await new Promise((r) => setTimeout(r, 30_000));
  }
  const stillDegraded = rows.filter((r) => r.degraded).length;
  const artifact = buildArtifact(
    rows,
    prior.caseCount,
    JEV_LANE_CASES.map((c) => c.id),
    prior.startedAt,
    { passes, rows: initial, stillDegraded },
  );
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
  report(artifact);
  console.error(
    `  re-asked ${initial} outage row(s) in ${passes} pass(es); ${stillDegraded} still unavailable`,
  );
  console.error(`wrote ${OUT}`);
};

const main = async () => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is required.");
    process.exit(1);
  }
  if (process.argv.includes("--retry-degraded")) return retryDegraded(apiKey);
  const limit = Number(process.argv[2]) || JEV_LANE_CASES.length;
  const cases = JEV_LANE_CASES.slice(0, limit);
  // A partial run must not sit at the published path pretending to be the
  // lane's result — the page would then compare a 12-case smoke run against
  // two full lanes.
  if (cases.length < JEV_LANE_CASES.length && !process.env.JEV_LANE_PARTIAL) {
    console.error(
      `refusing to publish a ${cases.length}-case run over the full-bank artifact.\n` +
        `Set JEV_LANE_PARTIAL=1 to override (it will still write ${OUT}).`,
    );
    process.exit(1);
  }
  const startedAt = new Date().toISOString();
  console.error(
    `jev lane: ${cases.length} cases x 2 langs = ${cases.length * 2} routing calls…`,
  );

  // ⚠️ NOT `askJev`. That client posts to OUR proxy and requires a browser
  // Turnstile session, so under node it returns null for every call and the
  // lane would score 0% while looking like it ran. The operator harness talks
  // to the API directly with its own key — the same split fcEval.jev.ts uses.
  const rows: JevLaneRow[] = [];
  let done = 0;
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) {
      rows.push(
        await evaluateJev(c, lang as Lang, undefined, directAsk(apiKey)),
      );
      if (++done % 100 === 0) console.error(`  ${done}/${cases.length * 2}`);
    }

  const artifact = buildArtifact(
    rows,
    cases.length,
    cases.map((c) => c.id),
    startedAt,
  );
  mkdirSync("data/ai/evals", { recursive: true });
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
  report(artifact);
  console.error(`wrote ${OUT}`);
};

main();
