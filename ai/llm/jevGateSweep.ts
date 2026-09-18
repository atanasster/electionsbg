// Sweep the Jev routing confidence gate between 0.50 and 0.70.
//
//   TYPESAFE_API_KEY=… npx tsx ai/llm/jevGateSweep.ts           # ask + simulate
//   npx tsx ai/llm/jevGateSweep.ts --resimulate                  # no API calls
//
// Writes ai/evals-internal/jev_gate_sweep.json — internal, not published: it is
// measured on the bank the rules were built from (ai/evals-internal/README.md).
//
// ⚠️ HOW IT AVOIDS THE BIAS THE FIRST RETRY HAD.
// The published artifact ran at 0.70, so every row Jev answered at ≥ 0.70 routes
// identically at any LOWER gate — those rows are reused as they are. Only the
// rows that fell below 0.70 can change, and the artifact did not keep the tool
// Jev picked on them (it kept the rules' fallback route). So each of those rows
// is asked ONCE, with the gate disabled, and its answer is recorded WHATEVER it
// is. Every gate is then simulated from that single sample:
//
//   fresh confidence ≥ g  → Jev's routed outcome
//   otherwise             → the rules' fallback outcome, from the artifact
//
// Asking each row once and keeping every answer is the difference from the
// withdrawn retry, which re-asked only low-confidence rows and kept the ones that
// cleared the gate.
//
// ⚠️ ONE KNOWN WEAKNESS, reported rather than hidden: Jev's confidence is not
// perfectly repeatable, so a re-asked row can come back ≥ 0.70. Those rows count
// as routed even at g = 0.70 here, so the sweep's own 0.70 point can sit slightly
// above the published one. The script prints both, and how many rows crossed.

import { readFileSync, writeFileSync } from "node:fs";
import { evaluateJev, JEV_LANE_CASES, type JevLaneRow } from "./jevLane";
import { directAsk, failures } from "./jevDirectAsk";
import { JEV_CONFIDENCE_GATE } from "./jev";

const ARTIFACT = "ai/evals-internal/jev_lane.json";
// Internal, not published — see ai/evals-internal/README.md.
const OUT = "ai/evals-internal/jev_gate_sweep.json";
const GATES = [0.5, 0.525, 0.55, 0.575, 0.6, 0.625, 0.65, 0.675, 0.7];

type Sample = { index: number; fresh: JevLaneRow };

const LANGS = ["en", "bg"] as const;

/** One row's outcome at gate `g`. Rows above the published gate never change. */
const at = (
  g: number,
  base: JevLaneRow,
  fresh: JevLaneRow | undefined,
): { row: JevLaneRow; fromJev: boolean } => {
  if (!fresh) return { row: base, fromJev: base.routedByJev };
  // An outage on the re-ask leaves the row as the rules answered it.
  if (fresh.degraded || fresh.jevConfidence == null)
    return { row: base, fromJev: false };
  return fresh.jevConfidence >= g
    ? { row: fresh, fromJev: true }
    : { row: base, fromJev: false };
};

const ratio = (xs: boolean[]) =>
  xs.length ? xs.filter(Boolean).length / xs.length : null;

const simulate = (base: JevLaneRow[], samples: Sample[]) => {
  const byIndex = new Map(samples.map((s) => [s.index, s.fresh]));
  return GATES.map((g) => {
    const perLang = Object.fromEntries(
      LANGS.map((lang) => {
        const picked = base
          .map((b, i) => ({ b, ...at(g, b, byIndex.get(i)) }))
          .filter((x) => x.b.lang === lang);
        const rows = picked.map((x) => x.row);
        const annotated = rows.filter((r) => r.argScored);
        const irrelevant = rows.filter((r) => r.expectedTool === null);
        // THE HEAD-TO-HEAD. The rows this gate hands to Jev that 0.70 gave to
        // the rules: on exactly those rows, is Jev right more often than the
        // rules were? Everything else in the sweep is the same rows either way.
        const moved = picked.filter(
          (x) => x.fromJev && byIndex.has(base.indexOf(x.b)),
        );
        return [
          lang,
          {
            n: rows.length,
            toolAcc: ratio(rows.map((r) => r.toolOk)),
            callAcc: ratio(rows.map((r) => r.callOk)),
            argAcc: ratio(annotated.map((r) => r.argsOk === true)),
            irrelevanceAcc: ratio(irrelevant.map((r) => r.callOk)),
            jevRouted: ratio(picked.map((x) => x.fromJev)),
            moved: moved.length,
            movedJevToolAcc: ratio(moved.map((x) => x.row.toolOk)),
            movedRulesToolAcc: ratio(moved.map((x) => x.b.toolOk)),
            movedJevCallAcc: ratio(moved.map((x) => x.row.callOk)),
            movedRulesCallAcc: ratio(moved.map((x) => x.b.callOk)),
          },
        ];
      }),
    );
    return { gate: g, metrics: perLang };
  });
};

const pct = (x: number | null | undefined) =>
  x == null ? "  n/a" : `${(100 * x).toFixed(1).padStart(5)}%`;

const print = (sweep: ReturnType<typeof simulate>) => {
  for (const lang of LANGS) {
    console.log(
      `\n${lang.toUpperCase()}  gate   routed  select  usable   args  silent-ok | moved  Jev-sel rules-sel  Jev-call rules-call`,
    );
    for (const { gate, metrics } of sweep) {
      const m = metrics[lang] as Record<string, number | null>;
      console.log(
        `    ${gate.toFixed(3)}  ${pct(m.jevRouted)} ${pct(m.toolAcc)} ${pct(m.callAcc)} ${pct(m.argAcc)} ${pct(m.irrelevanceAcc)}  | ${String(m.moved).padStart(5)} ${pct(m.movedJevToolAcc)}  ${pct(m.movedRulesToolAcc)}   ${pct(m.movedJevCallAcc)}  ${pct(m.movedRulesCallAcc)}`,
      );
    }
  }
};

const main = async () => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
    caseCount: number;
    rows: JevLaneRow[];
  };
  if (artifact.caseCount !== JEV_LANE_CASES.length)
    throw new Error(
      `${ARTIFACT} covers ${artifact.caseCount} cases, the bank has ${JEV_LANE_CASES.length}`,
    );
  if (JEV_CONFIDENCE_GATE !== 0.7)
    throw new Error(
      `the artifact was measured at 0.70; the shipped gate is now ${JEV_CONFIDENCE_GATE} — re-run the lane first`,
    );
  const base = artifact.rows;

  let samples: Sample[];
  if (process.argv.includes("--resimulate")) {
    samples = (JSON.parse(readFileSync(OUT, "utf8")) as { samples: Sample[] })
      .samples;
  } else {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");
    const byId = new Map(JEV_LANE_CASES.map((c) => [c.id, c]));
    const targets = base.map((r, i) => ({ r, i })).filter(({ r }) => r.unsure);
    console.error(`re-asking ${targets.length} below-gate rows once each…`);
    samples = [];
    for (const { r, i } of targets) {
      const c = byId.get(r.id);
      if (!c) throw new Error(`case ${r.id} is no longer in the bank`);
      // gate 0: route on whatever Jev picks, so the answer is recorded as-is.
      const fresh = await evaluateJev(
        c,
        r.lang,
        undefined,
        directAsk(apiKey),
        0,
      );
      samples.push({ index: i, fresh });
      if (samples.length % 50 === 0)
        console.error(`  ${samples.length}/${targets.length}`);
    }
  }

  const sweep = simulate(base, samples);
  const outages = samples.filter((s) => s.fresh.degraded).length;
  const crossed = samples.filter(
    (s) => (s.fresh.jevConfidence ?? 0) >= JEV_CONFIDENCE_GATE,
  ).length;
  const drift = samples
    .filter((s) => s.fresh.jevConfidence != null)
    .map((s) =>
      Math.abs(s.fresh.jevConfidence! - (base[s.index].jevConfidence ?? 0)),
    );
  const meanDrift = drift.length
    ? drift.reduce((a, b) => a + b, 0) / drift.length
    : null;

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        publishedGate: JEV_CONFIDENCE_GATE,
        gates: GATES,
        reasked: samples.length,
        outagesOnReask: outages,
        // Rows below 0.70 in the published run that came back ≥ 0.70: Jev's
        // run-to-run variation, which lifts the sweep's own 0.70 point.
        crossedPublishedGate: crossed,
        meanConfidenceDrift: meanDrift,
        sweep,
        samples,
      },
      null,
      2,
    ) + "\n",
  );

  print(sweep);
  console.log(
    `\nre-asked ${samples.length} rows · ${outages} outages · ${crossed} came back ≥ 0.70 · mean |Δconfidence| ${meanDrift?.toFixed(3) ?? "n/a"}`,
  );
  if (failures.size)
    console.log(
      `call failures: ${[...failures].map(([k, v]) => `${v}× ${k}`).join(" | ")}`,
    );
  console.log(`wrote ${OUT}`);
};

main();
